import { DocumentSymbol, DocumentSymbolParams, Position, SymbolKind, Range } from 'vscode-languageserver/node';
import { findFullRange } from '../utils/functions';
import { parsedDocuments, documents } from '../utils/variables';
import * as ld from '../utils/languageDefinitions';

export function onDocumentSymbol(params: DocumentSymbolParams) {
	const parsed = parsedDocuments.get(params.textDocument.uri);
	if (parsed === undefined) {return null;}
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {return null;}
	var result: DocumentSymbol[] = [];

	if (doc.languageId === "objectscript-class") {
		// Loop through the file and look for the class definition and class members

		const isValidKeyword = (keyword: string): boolean => {
			return (
				keyword !== "import" &&
				keyword.indexOf("include") === -1 &&
				keyword !== "byref" &&
				keyword !== "byval" &&
				keyword !== "output"
			);
		};
		var cls: DocumentSymbol = {
			name: "",
			kind: SymbolKind.Class,
			range: Range.create(Position.create(0,0),Position.create(0,0)),
			selectionRange: Range.create(Position.create(0,0),Position.create(0,0))
		};
		var members: DocumentSymbol[] = [];
		for (let line = 0; line < parsed.length; line++) {
			if (parsed[line].length === 0) {
				continue;
			}
			if (parsed[line][0].l === ld.cls_langindex && parsed[line][0].s === ld.cls_keyword_attrindex && parsed[line].length > 1) {
				// This line starts with a UDL keyword
				
				const keywordtext = doc.getText(Range.create(Position.create(line,parsed[line][0].p),Position.create(line,parsed[line][0].p+parsed[line][0].c)));
				const keywordtextlower = keywordtext.toLowerCase();
				if (keywordtextlower === "class") {
					// This is the class definition
					
					// Find the last non-empty line
					var lastnonempty = parsed.length-1;
					for (let nl = parsed.length-1; nl > line; nl--) {
						if (parsed[nl].length === 0) {
							continue;
						}
						lastnonempty = nl;
						break;
					}

					// Update the DocumentSymbol object
					cls.selectionRange = findFullRange(line,parsed,1,parsed[line][1].p,parsed[line][1].p+parsed[line][1].c);
					cls.name = doc.getText(cls.selectionRange);
					cls.range = Range.create(Position.create(line,0),Position.create(lastnonempty,parsed[lastnonempty][parsed[lastnonempty].length-1].p+parsed[lastnonempty][parsed[lastnonempty].length-1].c));
				}
				else if (isValidKeyword(keywordtextlower)) {
					// This is a class member definition

					// Loop through the file from this line to find the next class member
					var lastnonempty = line;
					for (let nl = line+1; nl < parsed.length; nl++) {
						if (parsed[nl].length === 0) {
							continue;
						}
						if (parsed[nl][0].l === ld.cls_langindex) {
							if (parsed[nl][0].s === ld.cls_desc_attrindex) {
								break;
							}
							if (parsed[nl][0].s === ld.cls_keyword_attrindex) {
								const nextkeytext = doc.getText(Range.create(nl,parsed[nl][0].p,nl,parsed[nl][0].p+parsed[nl][0].c)).toLowerCase();
								if (isValidKeyword(nextkeytext)) {
									break;
								}
							}
						}
						lastnonempty = nl;
					}

					if (lastnonempty === cls.range.end.line) {
						// This is the last member, so fix its ending line
						for (let nl = lastnonempty-1; nl > line; nl--) {
							if (parsed[nl].length === 0) {
								continue;
							}
							lastnonempty = nl;
							break;
						}
					}

					// Loop upwards in the file to capture the documentation for this member
					var firstnondoc = line-1;
					for (let nl = line-1; nl >= 0; nl--) {
						firstnondoc = nl;
						if (parsed[nl].length === 0) {
							break;
						}
						if (parsed[nl][0].l === ld.cls_langindex && parsed[nl][0].s !== ld.cls_desc_attrindex) {
							break;
						}
					}

					var kind: SymbolKind = SymbolKind.Property;
					if (keywordtextlower.indexOf("method") !== -1 || keywordtextlower === "query") {
						kind = SymbolKind.Method;
					}
					else if (keywordtextlower === "parameter") {
						kind = SymbolKind.Constant;
					}
					else if (keywordtextlower === "index") {
						kind = SymbolKind.Key;
					}
					else if (keywordtextlower === "xdata" || keywordtextlower === "storage") {
						kind = SymbolKind.Struct;
					}

					members.push({
						name: doc.getText(Range.create(Position.create(line,parsed[line][1].p),Position.create(line,parsed[line][1].p+parsed[line][1].c))),
						kind: kind,
						range: Range.create(Position.create(firstnondoc+1,0),Position.create(lastnonempty,parsed[lastnonempty][parsed[lastnonempty].length-1].p+parsed[lastnonempty][parsed[lastnonempty].length-1].c)),
						selectionRange: Range.create(Position.create(line,parsed[line][1].p),Position.create(line,parsed[line][1].p+parsed[line][1].c)),
						detail: keywordtext
					});
				}
			}
		}
		if (cls.name !== "") {
			cls.children = members;
			result.push(cls);
		}
	}
	else if (doc.languageId === "objectscript-macros") {
		// Loop through the file and look for macro definitions

		var prevdoccomments = 0;
		var multilinestart = -1;
		for (let line = 0; line < parsed.length; line++) {
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
			const secondtokentext = doc.getText(Range.create(Position.create(line,parsed[line][1].p),Position.create(line,parsed[line][1].p+parsed[line][1].c))).toLowerCase();
			if (parsed[line][1].l === ld.cos_langindex && parsed[line][1].s === ld.cos_ppc_attrindex && (secondtokentext === "define" || secondtokentext === "def1arg")) {
				// This line contains a macro definition

				if (
					parsed[line][parsed[line].length-1].l === ld.cos_langindex && parsed[line][parsed[line].length-1].s === ld.cos_ppf_attrindex &&
					doc.getText(Range.create(
						Position.create(line,parsed[line][parsed[line].length-1].p),
						Position.create(line,parsed[line][parsed[line].length-1].p+parsed[line][parsed[line].length-1].c)
					)).toLowerCase() === "continue"
				 ) {
					// This is the start of a multi-line macro definition
					multilinestart = line;
				}
				else {
					// This is a single line macro definition
					var fullrange: Range = Range.create(Position.create(line-prevdoccomments,0),Position.create(line,parsed[line][parsed[line].length-1].p+parsed[line][parsed[line].length-1].c));
					prevdoccomments = 0;
					result.push({
						name: doc.getText(Range.create(Position.create(line,parsed[line][2].p),Position.create(line,parsed[line][2].p+parsed[line][2].c))),
						kind: SymbolKind.Constant,
						range: fullrange,
						selectionRange: Range.create(Position.create(line,parsed[line][2].p),Position.create(line,parsed[line][2].p+parsed[line][2].c))
					});
				}
			}
			else if (
				multilinestart !== -1 && 
				(parsed[line][parsed[line].length-1].l !== ld.cos_langindex || parsed[line][parsed[line].length-1].s !== ld.cos_ppf_attrindex ||
				doc.getText(Range.create(
					Position.create(line,parsed[line][parsed[line].length-1].p),
					Position.create(line,parsed[line][parsed[line].length-1].p+parsed[line][parsed[line].length-1].c)
				)).toLowerCase() !== "continue")
			) {
				// This is the end of a multi-line macro definition
				var fullrange: Range = Range.create(Position.create(multilinestart-prevdoccomments,0),Position.create(line,parsed[line][parsed[line].length-1].p+parsed[line][parsed[line].length-1].c));
				prevdoccomments = 0;
				result.push({
					name: doc.getText(Range.create(Position.create(multilinestart,parsed[multilinestart][2].p),Position.create(multilinestart,parsed[multilinestart][2].p+parsed[multilinestart][2].c))),
					kind: SymbolKind.Constant,
					range: fullrange,
					selectionRange: Range.create(Position.create(multilinestart,parsed[multilinestart][2].p),Position.create(multilinestart,parsed[multilinestart][2].p+parsed[multilinestart][2].c))
				});
				multilinestart = -1;
			}
		}
	}
	else if (doc.languageId === "objectscript" || doc.languageId === "objectscript-int") {
		// Loop through the file and look for labels

		var routinename = "";
		for (let line = 0; line < parsed.length; line++) {
			if (parsed[line].length === 0) {
				continue;
			}
			const firsttokenrange = Range.create(Position.create(line,parsed[line][0].p),Position.create(line,parsed[line][0].p+parsed[line][0].c));
			const firsttokentext = doc.getText(firsttokenrange);
			if (parsed[line][0].l === ld.cos_langindex && parsed[line][0].s === ld.cos_label_attrindex && firsttokentext !== routinename) {
				// This line contains a label

				// Loop through the file from this line to find the next label
				var lastnonempty = line;
				for (let nl = line+1; nl < parsed.length; nl++) {
					if (parsed[nl].length === 0) {
						continue;
					}
					if (parsed[nl][0].l === ld.cos_langindex && parsed[nl][0].s === ld.cos_label_attrindex) {
						break;
					}
					lastnonempty = nl;
				}

				result.push({
					name: firsttokentext,
					kind: SymbolKind.Method,
					range: Range.create(firsttokenrange.start,Position.create(lastnonempty,parsed[lastnonempty][parsed[lastnonempty].length-1].p+parsed[lastnonempty][parsed[lastnonempty].length-1].c)),
					selectionRange: firsttokenrange
				});
			}
			else if (parsed[line][0].l === ld.cos_langindex && parsed[line][0].s === ld.cos_command_attrindex && firsttokentext.toLowerCase() === "routine") {
				// This is the ROUTINE header line
				routinename = doc.getText(Range.create(Position.create(line,parsed[line][1].p),Position.create(line,parsed[line][1].p+parsed[line][1].c)));
			}
		}
	}
	else if (doc.languageId === "objectscript-csp") {
		// Loop through the file and look for HTML script tags

		var symbolopen: boolean = false;
		for (let line = 0; line < parsed.length; line++) {
			if (parsed[line].length === 0) {
				continue;
			}
			for (let tkn = 0; tkn < parsed[line].length; tkn++) {
				if (
					tkn < parsed[line].length - 1 &&
					parsed[line][tkn].l == ld.html_langindex && parsed[line][tkn].s == ld.html_delim_attrindex &&
					parsed[line][tkn+1].l == ld.html_langindex && parsed[line][tkn+1].s == ld.html_tag_attrindex &&
					doc.getText(Range.create(
						Position.create(line,parsed[line][tkn].p),
						Position.create(line,parsed[line][tkn].p+parsed[line][tkn].c)
					)) === "<" &&
					doc.getText(Range.create(
						Position.create(line,parsed[line][tkn+1].p),
						Position.create(line,parsed[line][tkn+1].p+parsed[line][tkn+1].c)
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
								Position.create(line,parsed[line][stkn].p),
								Position.create(line,parsed[line][stkn].p+parsed[line][stkn].c)
							)).toLowerCase();
							if (parsed[line].length > stkn + 2) {
								const valrange: Range = Range.create(
									Position.create(line,parsed[line][stkn+2].p),
									Position.create(line,parsed[line][stkn+2].p+parsed[line][stkn+2].c)
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
						Position.create(line,parsed[line][tkn+2].p),
						Position.create(line,parsed[line][tkn+2].p+parsed[line][tkn+2].c)
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