import { DocumentSymbol, DocumentSymbolParams, Position, SymbolKind, Range, SymbolTag } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { findFullRange, getParsedDocument, isClassMember, labelIsProcedureBlock, prevToken } from '../utils/functions';
import { documents, mppContinue } from '../utils/variables';
import * as ld from '../utils/languageDefinitions';
import { compressedline } from '../utils/types';

/** Loop through the class from this line until the next class member or the end of the class */
function processMember(doc: TextDocument, parsed: compressedline[], line: number): { deprecated: boolean, lastNonEmpty: number } {
	let lastNonEmpty = line;
	let deprecated;
	for (let nl = line; nl < parsed.length; nl++) {
		if (!parsed[nl]?.length) continue;
		if (nl > line && parsed[nl][0].l === ld.cls_langindex) {
			if (parsed[nl][0].s === ld.cls_desc_attrindex) {
				break;
			}
			if (parsed[nl][0].s === ld.cls_keyword_attrindex) {
				const nextkeytext = doc.getText(Range.create(nl,parsed[nl][0].p,nl,parsed[nl][0].p+parsed[nl][0].c)).toLowerCase();
				if (isClassMember(nextkeytext)) {
					break;
				}
			}
		}
		if (deprecated == undefined) {
			const depTkn = parsed[nl].findIndex((e) => 
				e.l == ld.cls_langindex && e.s == ld.cls_keyword_attrindex && doc.getText(Range.create(nl,e.p,nl,e.p+e.c)).toLowerCase() == "deprecated"
			);
			if (depTkn != -1) {
				const previous = prevToken(parsed,nl,depTkn);
				deprecated = previous && doc.getText(
					Range.create(previous[0],parsed[previous[0]][previous[1]].p,previous[0],parsed[previous[0]][previous[1]].p+parsed[previous[0]][previous[1]].c)
				).toLowerCase() != "not";
			}
		}
		lastNonEmpty = nl;
	}
	if (deprecated == undefined) deprecated = false;
	return { deprecated, lastNonEmpty };
}

export async function onDocumentSymbol(params: DocumentSymbolParams) {
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {return null;}
	const parsed = await getParsedDocument(params.textDocument.uri);
	if (parsed === undefined) {return null;}
	var result: DocumentSymbol[] = [];

	if (doc.languageId === "objectscript-class") {
		// Loop through the file and look for the class definition and class members

		const cls: DocumentSymbol = {
			name: "",
			kind: SymbolKind.Class,
			range: Range.create(0,0,0,0),
			selectionRange: Range.create(0,0,0,0)
		};
		const members: DocumentSymbol[] = [];
		for (let line = 0; line < parsed.length; line++) {
			if (!parsed[line]?.length) continue;
			if (parsed[line][0].l === ld.cls_langindex && parsed[line][0].s === ld.cls_keyword_attrindex && parsed[line].length > 1) {
				// This line starts with a UDL keyword
				
				const keywordtext = doc.getText(Range.create(line,parsed[line][0].p,line,parsed[line][0].p+parsed[line][0].c));
				const keywordtextlower = keywordtext.toLowerCase();
				if (keywordtextlower === "class") {
					// This is the class definition
					
					// Find the last non-empty line
					let lastnonempty = parsed.length-1;
					for (let nl = parsed.length-1; nl > line; nl--) {
						if (!parsed[nl]?.length) continue;
						lastnonempty = nl;
						break;
					}

					// Update the DocumentSymbol object
					cls.selectionRange = findFullRange(line,parsed,1,parsed[line][1].p,parsed[line][1].p+parsed[line][1].c);
					cls.name = doc.getText(cls.selectionRange);
					cls.range = Range.create(line,0,lastnonempty,parsed[lastnonempty][parsed[lastnonempty].length-1].p+parsed[lastnonempty][parsed[lastnonempty].length-1].c);

					// Determine if this class is Deprecated
					const { deprecated } = processMember(doc,parsed,line);
					if (deprecated) cls.tags = [SymbolTag.Deprecated];
				}
				else if (isClassMember(keywordtextlower)) {
					// This is a class member definition

					const memName = doc.getText(Range.create(line,parsed[line][1].p,line,parsed[line][1].p+parsed[line][1].c));
					if (memName.trim() == "") continue;

					// Loop through the file from this line to find the next class member
					let { deprecated, lastNonEmpty } = processMember(doc,parsed,line);

					if (lastNonEmpty === cls.range.end.line) {
						// This is the last member, so fix its ending line
						for (let nl = lastNonEmpty-1; nl > line; nl--) {
							if (!parsed[nl]?.length) continue;
							lastNonEmpty = nl;
							break;
						}
					}

					// Loop upwards in the file to capture the documentation for this member
					let firstnondoc = line-1;
					for (let nl = line-1; nl >= 0; nl--) {
						firstnondoc = nl;
						if (!parsed[nl]?.length || (parsed[nl][0].l === ld.cls_langindex && parsed[nl][0].s !== ld.cls_desc_attrindex)) break;
					}

					members.push({
						name: memName,
						kind: 
							["method","classmethod","clientmethod"].includes(keywordtextlower) ? SymbolKind.Method :
							keywordtextlower == "query" ? SymbolKind.Function :
							keywordtextlower == "trigger" ? SymbolKind.Event :
							keywordtextlower == "parameter" ? SymbolKind.Constant :
							keywordtextlower == "index" ? SymbolKind.Array :
							keywordtextlower == "foreignkey" ? SymbolKind.Key :
							keywordtextlower == "xdata" ? SymbolKind.Struct :
							keywordtextlower == "storage" ? SymbolKind.Object :
							keywordtextlower == "projection" ? SymbolKind.Interface :
							SymbolKind.Property, // Property and Relationship
						range: Range.create(firstnondoc+1,0,lastNonEmpty,parsed[lastNonEmpty][parsed[lastNonEmpty].length-1].p+parsed[lastNonEmpty][parsed[lastNonEmpty].length-1].c),
						selectionRange: Range.create(line,parsed[line][1].p,line,parsed[line][1].p+parsed[line][1].c),
						tags: deprecated ? [SymbolTag.Deprecated] : undefined,
						detail: keywordtext
					});
				}
			}
		}
		if (cls.name) {
			cls.children = members;
			result.push(cls);
		}
	}
	else if (doc.languageId === "objectscript-macros") {
		// Loop through the file and look for macro definitions

		let prevdoccomments = 0;
		let multilinestart = -1;
		for (let line = 0; line < parsed.length; line++) {
			if (!parsed[line]?.length) {
				prevdoccomments = 0;
				continue;
			}
			if (parsed[line].length < 3) {
				if (parsed[line].length === 1) {
					if (parsed[line][0].l === ld.cos_langindex && parsed[line][0].s === ld.cos_dcom_attrindex) {
						// This line contains a documentation (///) comment
						prevdoccomments++;
					}
					else {
						prevdoccomments = 0;
					}
				}
				continue;
			}
			const secondtokentext = doc.getText(Range.create(line,parsed[line][1].p,line,parsed[line][1].p+parsed[line][1].c)).toLowerCase();
			if (parsed[line][1].l === ld.cos_langindex && parsed[line][1].s === ld.cos_ppc_attrindex && (secondtokentext === "define" || secondtokentext === "def1arg")) {
				// This line contains a macro definition

				if (
					parsed[line][parsed[line].length-1].l === ld.cos_langindex && parsed[line][parsed[line].length-1].s === ld.cos_ppf_attrindex &&
					mppContinue.test(doc.getText(Range.create(
						line,parsed[line][parsed[line].length-1].p,
						line,parsed[line][parsed[line].length-1].p+parsed[line][parsed[line].length-1].c
					)))
				 ) {
					// This is the start of a multi-line macro definition
					multilinestart = line;
				}
				else {
					// This is a single line macro definition
					var fullrange: Range = Range.create(line-prevdoccomments,0,line,parsed[line][parsed[line].length-1].p+parsed[line][parsed[line].length-1].c);
					prevdoccomments = 0;
					result.push({
						name: doc.getText(Range.create(line,parsed[line][2].p,line,parsed[line][2].p+parsed[line][2].c)),
						kind: SymbolKind.Constant,
						range: fullrange,
						selectionRange: Range.create(line,parsed[line][2].p,line,parsed[line][2].p+parsed[line][2].c)
					});
				}
			}
			else if (
				multilinestart != -1 && 
				!(
					parsed[line][parsed[line].length-1].l == ld.cos_langindex && parsed[line][parsed[line].length-1].s == ld.cos_ppf_attrindex &&
					mppContinue.test(doc.getText(Range.create(
						line,parsed[line][parsed[line].length-1].p,
						line,parsed[line][parsed[line].length-1].p+parsed[line][parsed[line].length-1].c
					)))
				)
			) {
				// This is the end of a multi-line macro definition
				prevdoccomments = 0;
				result.push({
					name: doc.getText(Range.create(multilinestart,parsed[multilinestart][2].p,multilinestart,parsed[multilinestart][2].p+parsed[multilinestart][2].c)),
					kind: SymbolKind.Constant,
					range: Range.create(multilinestart-prevdoccomments,0,line,parsed[line][parsed[line].length-1].p+parsed[line][parsed[line].length-1].c),
					selectionRange: Range.create(multilinestart,parsed[multilinestart][2].p,multilinestart,parsed[multilinestart][2].p+parsed[multilinestart][2].c)
				});
				multilinestart = -1;
			}
		}
	}
	else if (doc.languageId === "objectscript" || doc.languageId === "objectscript-int") {
		// Loop through the file and look for labels

		for (let line = 0; line < parsed.length; line++) {
			if (!parsed[line]?.length) continue;
			if (
				parsed[line][0].l == ld.cos_langindex &&
				parsed[line][0].s == ld.cos_label_attrindex &&
				parsed[line][0].p == 0
			) {
				// This line contains a label in the first column

				const labelrange = findFullRange(line,parsed,0,parsed[line][0].p,parsed[line][0].p+parsed[line][0].c);
				const label = doc.getText(labelrange);
				const inProcedureBlock = (
					result.length > 0 &&
					Array.isArray(result[result.length - 1].children) &&
					labelrange.start.line >= result[result.length - 1].range.start.line &&
					labelrange.start.line <= result[result.length - 1].range.end.line
				);
				
				let firstbrace: [number, number] | undefined = undefined;
				if (!inProcedureBlock) {
					// Check if this label is a procedure block
					firstbrace = labelIsProcedureBlock(doc,parsed,line);
				}

				let endLine = line;
				if (firstbrace != undefined) {
					// Loop through the file from the first brace until we hit the last closing brace
					let openbrace = 0;
					let brk = false;
					for (let nl = (parsed[firstbrace[0]].length - 1 == firstbrace[1] ? firstbrace[0] + 1 : firstbrace[0]); nl < parsed.length; nl++) {
						for (let nt = (nl == firstbrace[0] ? firstbrace[1] + 1 : 0); nt < parsed[nl].length; nt++) {
							if (parsed[nl][nt].l == ld.cos_langindex && parsed[nl][nt].s == ld.cos_brace_attrindex) {
								const brace = doc.getText(Range.create(nl,parsed[nl][nt].p,nl,parsed[nl][nt].p+parsed[nl][nt].c));
								if (brace == "{") {
									openbrace++;
								} else {
									if (openbrace == 0) {
										endLine = nl;
										brk = true;
										break;
									}
									else {
										openbrace--;
									}
								}
							}
						}
						if (brk) {
							break;
						}
					}
				}
				else {
					// Loop through the file from this line to find the next label
					for (let nl = line+1; nl < parsed.length; nl++) {
						if (!parsed[nl]?.length) {
							continue;
						}
						if (parsed[nl][0].l === ld.cos_langindex && parsed[nl][0].s === ld.cos_label_attrindex) {
							break;
						}
						endLine = nl;
					}
				}
				
				if (inProcedureBlock) {
					// Append this symbol to the children array of the previous symbol
					result[result.length - 1].children?.push({
						name: label,
						kind: SymbolKind.Method,
						range: Range.create(labelrange.start,Position.create(endLine,parsed[endLine][parsed[endLine].length-1].p+parsed[endLine][parsed[endLine].length-1].c)),
						selectionRange: labelrange
					});
				}
				else {
					result.push({
						name: label,
						kind: SymbolKind.Method,
						range: Range.create(labelrange.start,Position.create(endLine,parsed[endLine][parsed[endLine].length-1].p+parsed[endLine][parsed[endLine].length-1].c)),
						selectionRange: labelrange,
						children: firstbrace != undefined ? [] : undefined
					});
				}
			}
		}
	}
	else if (doc.languageId === "objectscript-csp") {
		// Loop through the file and look for HTML script tags

		let symbolopen: boolean = false;
		for (let line = 0; line < parsed.length; line++) {
			if (!parsed[line]?.length) continue;
			for (let tkn = 0; tkn < parsed[line].length; tkn++) {
				if (
					tkn < parsed[line].length - 1 &&
					parsed[line][tkn].l == ld.html_langindex && parsed[line][tkn].s == ld.html_delim_attrindex &&
					parsed[line][tkn+1].l == ld.html_langindex && parsed[line][tkn+1].s == ld.html_tag_attrindex &&
					doc.getText(Range.create(
						line,parsed[line][tkn].p,
						line,parsed[line][tkn].p+parsed[line][tkn].c
					)) === "<" &&
					doc.getText(Range.create(
						line,parsed[line][tkn+1].p,
						line,parsed[line][tkn+1].p+parsed[line][tkn+1].c
					)).toLowerCase() === "script" && !symbolopen
				) {
					// This line contains an HTML open script tag so create a new symbol if we can

					// Scan the rest of the line for the following attributes:
					// language, method, name
					var lang: string = "";
					var method: string = "";
					var name: string = "";
					var methodrange: Range = Range.create(0,0,0,0);
					var namerange: Range = Range.create(0,0,0,0);
					for (let stkn = tkn+2; stkn < parsed[line].length; stkn++) {
						if (parsed[line][stkn].l == ld.html_langindex && parsed[line][stkn].s == ld.html_name_attrindex) {
							// This is an attribute

							const attrtext: string = doc.getText(Range.create(
								line,parsed[line][stkn].p,
								line,parsed[line][stkn].p+parsed[line][stkn].c
							)).toLowerCase();
							if (parsed[line].length > stkn + 2) {
								const valrange: Range = Range.create(
									line,parsed[line][stkn+2].p,
									line,parsed[line][stkn+2].p+parsed[line][stkn+2].c
								);
								var valtext: string = doc.getText(valrange);
								if (valtext.startsWith('"') && valtext.endsWith('"')) {
									// Strip leading and trailing quotes
									valtext = valtext.slice(1,-1);
								}

								if (attrtext === "language") {
									lang = valtext;
								}
								else if (attrtext === "method") {
									method = valtext;
									methodrange = valrange;
								}
								else if (attrtext === "name") {
									name = valtext;
									namerange = valrange;
								}
							}
						}
					}

					if (
						((lang.toLowerCase() === "cache" || lang.toLowerCase() === "basic") && method !== "") ||
						((lang.toLowerCase() === "sql" || lang.toLowerCase() === "esql") && name !== "")
					) {
						// This script has enough attributes to open
						
						const startpos: Position = Position.create(line,parsed[line][tkn].p);
						var detail: string = "ObjectScript";
						if (lang.toLowerCase() === "basic") {
							detail = "Basic";
						}
						else if (lang.toLowerCase() === "sql" || lang.toLowerCase() === "esql") {
							detail = "SQL";
						}
						result.push({
							name: (method !== "" ? method : name),
							kind: SymbolKind.Method,
							detail: detail,
							selectionRange: (method !== "" ? methodrange : namerange),
							// We will update range.end later
							range: Range.create(startpos,startpos)
						});
						symbolopen = true;
					}
				}
				if (
					tkn < parsed[line].length - 3 &&
					parsed[line][tkn].l == ld.html_langindex && parsed[line][tkn].s == ld.html_delim_attrindex &&
					parsed[line][tkn+1].l == ld.html_langindex && parsed[line][tkn+1].s == ld.html_delim_attrindex &&
					parsed[line][tkn+2].l == ld.html_langindex && parsed[line][tkn+2].s == ld.html_tag_attrindex &&
					doc.getText(Range.create(
						line,parsed[line][tkn+2].p,
						line,parsed[line][tkn+2].p+parsed[line][tkn+2].c
					)).toLowerCase() === "script" && symbolopen
				) {
					// This line starts with a HTML close script tag so close the open symbol

					result[result.length-1].range.end = Position.create(line,parsed[line][tkn+3].p+parsed[line][tkn+3].c);
					symbolopen = false;
				}
			}	
		}
	}

	return result;
}
