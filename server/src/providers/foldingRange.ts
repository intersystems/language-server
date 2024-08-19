import { FoldingRange, FoldingRangeKind, FoldingRangeParams, Range } from 'vscode-languageserver/node';
import { documents, mppContinue } from '../utils/variables';
import * as ld from '../utils/languageDefinitions';
import { getParsedDocument } from '../utils/functions';

const cosRegionRegex = new RegExp("^(?:\/\/|#;) *#(?:end){0,1}region(?: +.*){0,1}$");
const clsRegionRegex = new RegExp("^\/\/ *#(?:end){0,1}region(?: +.*){0,1}$");

export async function onFoldingRanges(params: FoldingRangeParams) {
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {return null;}
	const parsed = await getParsedDocument(params.textDocument.uri);
	if (parsed === undefined) {return null;}
	const result: FoldingRange[] = [];

	const openranges: FoldingRange[] = [];
	let inMultiLineMacro: boolean = false;
	let dottedDoLevel: number = 0;
	let inJSONXData: boolean = false;
	let routinename = "";
	for (let line = 0; line < parsed.length; line++) {
		if (parsed[line].length === 0) {
			if (openranges.length > 0 && openranges[openranges.length-1].kind === FoldingRangeKind.Comment) {
				// Comment block ended, so close the range and append it to the result array if the range is more than one line
				if (openranges[openranges.length-1].startLine < openranges[openranges.length-1].endLine) {
					result.push(openranges[openranges.length-1]);
				}
				openranges.pop();
			}
			// Close any open dotted Do ranges
			for (let idx = openranges.length-1; idx >= 0; idx--) {
				if (openranges[idx].kind === "isc-dotteddo") {
					openranges[idx].endLine = line-1;
					result.push(openranges[idx]);
					openranges.splice(idx,1);
					dottedDoLevel--;
				}
			}
			continue;
		}
		const firsttokentext = doc.getText(Range.create(line,parsed[line][0].p,line,parsed[line][0].p+parsed[line][0].c));
		const lineFromFirstToken = doc.getText(Range.create(line,parsed[line][0].p,line,parsed[line][parsed[line].length-1].p+parsed[line][parsed[line].length-1].c));
		if (
			(parsed[line][0].l === ld.cls_langindex && parsed[line][0].s === ld.cls_desc_attrindex) ||
			(parsed[line][0].l === ld.cos_langindex && parsed[line][0].s === ld.cos_dcom_attrindex)
		) {
			// This line is a UDL description or COS documentation comment

			if (openranges.length === 0 || (openranges.length > 0 && openranges[openranges.length-1].kind !== FoldingRangeKind.Comment)) {
				// Start a new range
				openranges.push({
					startLine: line,
					endLine: line,
					kind: FoldingRangeKind.Comment
				});
			}
			else {
				// Extend the existing range
				openranges[openranges.length-1].endLine = line;
			}
		}
		else {
			// This line isn't a UDL description or COS documentation comment

			if (openranges.length > 0 && openranges[openranges.length-1].kind === FoldingRangeKind.Comment) {
				// Comment block ended, so close the range and append it to the result array if the range is more than one line
				if (openranges[openranges.length-1].startLine < openranges[openranges.length-1].endLine) {
					result.push(openranges[openranges.length-1]);
				}
				openranges.pop();
			}
			if (inMultiLineMacro) {
				// Check if the last token is a ##Continue
				if (!(
					parsed[line][parsed[line].length-1].l == ld.cos_langindex && parsed[line][parsed[line].length-1].s == ld.cos_ppf_attrindex &&
					mppContinue.test(doc.getText(Range.create(
						line,parsed[line][parsed[line].length-1].p,
						line,parsed[line][parsed[line].length-1].p+parsed[line][parsed[line].length-1].c
					)))
				)) {
					// This is the end of a multi-line macro
					var prevrange = openranges.length-1;
					for (let rge = openranges.length-1; rge >= 0; rge--) {
						if (openranges[rge].kind === "isc-mlmacro") {
							prevrange = rge;
							break;
						}
					}
					if (openranges[prevrange].startLine < line) {
						openranges[prevrange].endLine = line;
						result.push(openranges[prevrange]);
					}
					openranges.splice(prevrange,1);
					inMultiLineMacro = false;
				}
			}
			if (
				parsed[line][parsed[line].length-1].l == ld.cls_langindex && parsed[line][parsed[line].length-1].s == ld.cls_delim_attrindex &&
				doc.getText(Range.create(
					line,parsed[line][parsed[line].length-1].p,
					line,parsed[line][parsed[line].length-1].p+parsed[line][parsed[line].length-1].c
				)) == "{"
			) {
				// This line ends with a UDL open curly

				if (
					(parsed[line].length === 1 && parsed[line-1][0].l == ld.cls_langindex && parsed[line-1][0].s == ld.cls_keyword_attrindex &&
					doc.getText(Range.create(line-1,parsed[line-1][0].p,line-1,parsed[line-1][0].p+parsed[line-1][0].c)).toLowerCase() === "class")
					||
					(parsed[line].length > 1 && parsed[line][0].l == ld.cls_langindex && parsed[line][0].s == ld.cls_keyword_attrindex &&
					firsttokentext.toLowerCase() === "class")
				) {
					// This is the open curly for a class, so don't create a folding range for it
					continue;
				}

				// Open a new member range
				openranges.push({
					startLine: line,
					endLine: line,
					kind: "isc-member"
				});

				// Scan forward in the file and look for the next line that starts with a UDL keyword or close brace
				for (let nl = line+1; nl < parsed.length; nl++) {
					if (parsed[nl].length === 0) {
						continue;
					}
					if (
						parsed[nl][0].l === ld.cls_langindex &&
						(parsed[nl][0].s === ld.cls_keyword_attrindex ||
						(parsed[nl][0].s === ld.cls_delim_attrindex && 
						doc.getText(Range.create(
							nl,parsed[nl][0].p,
							nl,parsed[nl][0].p+parsed[nl][0].c
						)) === "}"))
					) {
						// Close the member range
						if (
							parsed[nl][0].s === ld.cls_delim_attrindex && 
							doc.getText(Range.create(
								nl,parsed[nl][0].p,
								nl,parsed[nl][0].p+parsed[nl][0].c
							)) === "}"
						) {
							openranges[openranges.length-1].endLine = nl-1;
						}
						else {
							openranges[openranges.length-1].endLine = nl;
						}
						if (openranges[openranges.length-1].startLine < openranges[openranges.length-1].endLine) {
							result.push(openranges[openranges.length-1]);
						}
						openranges.pop();
						break;
					}
				}
			}
			if (
				parsed[line][0].l == ld.cos_langindex && parsed[line][0].s == ld.cos_label_attrindex && parsed[line][0].p == 0 &&
				firsttokentext != routinename && (doc.languageId == "objectscript" || doc.languageId == "objectscript-int")
			) {
				// This line starts with a routine label

				// Scan through the line to look for an open curly
				var foundopencurly =  false;
				for (let tkn = 1; tkn < parsed[line].length; tkn++) {
					if (parsed[line][tkn].l === ld.cos_langindex && parsed[line][tkn].s === ld.cos_brace_attrindex) {
						const bracetext = doc.getText(Range.create(line,parsed[line][tkn].p,line,parsed[line][tkn].p+parsed[line][tkn].c));
						if (bracetext === "{") {
							foundopencurly = true;
							break;
						}
					}
				}

				if (!foundopencurly) {
					// Only create a label range if it won't be handled by our ObjectScript code block processing code

					// Open a new member range
					openranges.push({
						startLine: line,
						endLine: line,
						kind: "isc-member"
					});

					// Loop through the file from this line to find the next label
					var precedingcomments = 0;
					for (let nl = line+1; nl < parsed.length; nl++) {
						if (parsed[nl].length === 0) {
							precedingcomments = 0;
							continue;
						}
						if (parsed[nl][0].l === ld.cos_langindex && (parsed[nl][0].s === ld.cos_comment_attrindex || parsed[nl][0].s === ld.cos_dcom_attrindex)) {
							// Don't fold comments that immediately precede the next label
							precedingcomments++;
						}
						else if (parsed[nl][0].l == ld.cos_langindex && parsed[nl][0].s == ld.cos_label_attrindex && parsed[nl][0].p == 0) {
							// This is the next label
							openranges[openranges.length-1].endLine = nl-precedingcomments-1;
							if (openranges[openranges.length-1].startLine < openranges[openranges.length-1].endLine) {
								result.push(openranges[openranges.length-1]);
							}
							openranges.pop();
							break;
						}
						else {
							precedingcomments = 0;
						}
					}

					if (openranges.length > 0 && openranges[openranges.length-1].kind === "isc-member") {
						// This is the last label in the file so its endLine is the end of the file
						openranges[openranges.length-1].endLine = parsed.length-1;
						result.push(openranges[openranges.length-1]);
						openranges.pop();
					}
				}
			}
			if (
				parsed[line][0].l === ld.cos_langindex && parsed[line][0].s === ld.cos_command_attrindex &&
				firsttokentext.toLowerCase() === "routine"
			) {
				// This is the ROUTINE header line
				routinename = doc.getText(Range.create(line,parsed[line][1].p,line,parsed[line][1].p+parsed[line][1].c));
			}
			if (
				parsed[line].length >= 2 &&
				(parsed[line][0].l == ld.cos_langindex && parsed[line][0].s == ld.cos_ppc_attrindex) &&
				(parsed[line][1].l == ld.cos_langindex && parsed[line][1].s == ld.cos_ppc_attrindex)
			) {
				// This line starts with a COS preprocessor command

				const ppc = doc.getText(Range.create(line,parsed[line][0].p,line,parsed[line][1].p+parsed[line][1].c)).toLowerCase();
				if (ppc === "#if" || ppc === "#ifdef" || ppc === "#ifndef" || ppc === "#ifundef") {
					// These preprocessor commands always open a new range
					openranges.push({
						startLine: line,
						endLine: line,
						kind: "isc-ppc"
					});
				}
				else if (ppc === "#elseif" || ppc === "#elif" || ppc === "#else") {
					// These preprocessor commands always open a new range and close the previous one
					var prevrange = openranges.length-1;
					for (let rge = openranges.length-1; rge >= 0; rge--) {
						if (openranges[rge].kind === "isc-ppc") {
							prevrange = rge;
							break;
						}
					}
					if (openranges[prevrange].startLine < line-1) {
						openranges[prevrange].endLine = line-1;
						result.push(openranges[prevrange]);
					}
					openranges.splice(prevrange,1);
					openranges.push({
						startLine: line,
						endLine: line,
						kind: "isc-ppc"
					});
				}
				else if (ppc === "#endif") {
					// #EndIf always closes the previous range
					var prevrange = openranges.length-1;
					for (let rge = openranges.length-1; rge >= 0; rge--) {
						if (openranges[rge].kind === "isc-ppc") {
							prevrange = rge;
							break;
						}
					}
					if (prevrange >= 0 && openranges[prevrange].startLine < line-1) {
						openranges[prevrange].endLine = line-1;
						result.push(openranges[prevrange]);
					}
					openranges.splice(prevrange,1);
				}
				else if (ppc === "#define" || ppc === "#def1arg") {
					// Check if the last token is a ##Continue
					if (
						parsed[line][parsed[line].length-1].l == ld.cos_langindex && parsed[line][parsed[line].length-1].s == ld.cos_ppf_attrindex &&
						mppContinue.test(doc.getText(Range.create(
							line,parsed[line][parsed[line].length-1].p,
							line,parsed[line][parsed[line].length-1].p+parsed[line][parsed[line].length-1].c
						)))
					) {
						// This is the start of a multi-line macro definition
						openranges.push({
							startLine: line,
							endLine: line,
							kind: "isc-mlmacro"
						});
						inMultiLineMacro = true;
					}
				}
			}
			else if (parsed[line][0].l == ld.xml_langindex) {
				// This is a line of XML

				// Loop through the line of XML tokens and look for tag delimiters
				for (let xmltkn = 0; xmltkn < parsed[line].length; xmltkn++) {
					if (parsed[line][xmltkn].l == ld.xml_langindex && parsed[line][xmltkn].s == ld.xml_tagdelim_attrindex) {
						// This is a tag delimiter 
						const tokentext = doc.getText(Range.create(
							line,parsed[line][xmltkn].p,
							line,parsed[line][xmltkn].p+parsed[line][xmltkn].c
						));
						if (tokentext === "<") {
							// Open a new XML range
							openranges.push({
								startLine: line,
								endLine: line,
								kind: "isc-xml"
							});
						}
						else if (tokentext === "</" || tokentext === "/>") {
							// Close the most recent XML range
							var prevrange = openranges.length-1;
							for (let rge = openranges.length-1; rge >= 0; rge--) {
								if (openranges[rge].kind === "isc-xml") {
									prevrange = rge;
									break;
								}
							}
							if (prevrange >= 0 && openranges[prevrange].startLine < line-1) {
								openranges[prevrange].endLine = line-1;
								result.push(openranges[prevrange]);
							}
							openranges.splice(prevrange,1);
						}
					}
				}
			}
			else if (parsed[line].length > 1 && parsed[line][0].l == ld.cls_langindex && parsed[line][0].s == ld.cls_delim_attrindex) {
				// This line starts with a UDL delimiter

				const firsttwochars = doc.getText(Range.create(line,0,line,2));
				if (firsttwochars === "</") {
					// Close the most recent Storage range
					var prevrange = openranges.length-1;
					for (let rge = openranges.length-1; rge >= 0; rge--) {
						if (openranges[rge].kind === "isc-storage") {
							prevrange = rge;
							break;
						}
					}
					if (prevrange >= 0 && openranges[prevrange].startLine < line-1) {
						openranges[prevrange].endLine = line-1;
						result.push(openranges[prevrange]);
					}
					openranges.splice(prevrange,1);
				}
				else if (firsttwochars.slice(0,1) === "<") {
					// This is an XML open tag
					// Only create a Storage range for it if it's not closed on this line
					var closed = 0;
					for (let stkn = 1; stkn < parsed[line].length; stkn++) {
						if (
							stkn !== parsed[line].length - 1 &&
							parsed[line][stkn].l == ld.cls_langindex && parsed[line][stkn].s == ld.cls_delim_attrindex &&
							parsed[line][stkn+1].l == ld.cls_langindex && parsed[line][stkn+1].s == ld.cls_delim_attrindex &&
							doc.getText(Range.create(line,parsed[line][stkn].p,line,parsed[line][stkn+1].p+parsed[line][stkn+1].c)) === "</"
						) {
							closed = 1;
							break;
						}
					}
					if (!closed) {
						openranges.push({
							startLine: line,
							endLine: line,
							kind: "isc-storage"
						});
					}
				}
			}
			else if (
				(
					// Region marker within ObjectScript
					parsed[line].length === 1 && parsed[line][0].l === ld.cos_langindex && parsed[line][0].s === ld.cos_comment_attrindex &&
					cosRegionRegex.test(lineFromFirstToken)
				)
				||
				(
					// Region marker within UDL
					parsed[line].length === 2 && parsed[line][0].l === ld.cls_langindex && parsed[line][0].s === ld.cls_comment_attrindex &&
					clsRegionRegex.test(lineFromFirstToken)
				)
			) {
				// This line contains a region marker

				if (lineFromFirstToken.includes("#region")) {
					// Create a new Region range
					openranges.push({
						startLine: line,
						endLine: line,
						kind: FoldingRangeKind.Region
					});
				}
				else {
					// Close the most recent Region range
					var prevrange = openranges.length-1;
					for (let rge = openranges.length-1; rge >= 0; rge--) {
						if (openranges[rge].kind === FoldingRangeKind.Region) {
							prevrange = rge;
							break;
						}
					}
					if (prevrange >= 0) {
						openranges[prevrange].endLine = line;
						result.push(openranges[prevrange]);
						openranges.splice(prevrange,1);
					}		
				}
			}
			else if (parsed[line][0].l == ld.cls_langindex && parsed[line][0].s == ld.cls_keyword_attrindex) {
				// This line starts with a UDL keyword

				const keytext = firsttokentext.toLowerCase();
				if (keytext === "xdata") {
					// This line is that start of an XData block
					for (let k = 3; k < parsed[line].length; k++) {
						if (parsed[line][k].l == ld.cls_langindex && parsed[line][k].s == ld.cls_keyword_attrindex) {
							// This is a UDL trailing keyword
							const keytext = doc.getText(Range.create(
								line,parsed[line][k].p,
								line,parsed[line][k].p+parsed[line][k].c
							)).toLowerCase();
							if (keytext === "mimetype") {
								// The MimeType keyword is present
								if (parsed[line][k+2] !== undefined) {
									// An MimeType is specified
									const mimetype = doc.getText(Range.create(
										line,parsed[line][k+2].p+1,
										line,parsed[line][k+2].p+parsed[line][k+2].c-1
									));
									if (mimetype === "application/json") {
										// This is the start of an XData block containing JSON
										inJSONXData = true;
									}
								}
								break;
							}
						}
					}
				}
				else if (inJSONXData && keytext !== "xdata") {
					// We've reached the next class member
					inJSONXData = false;
				}
			}
			else if (inJSONXData) {
				// We're in a JSON XData block so look for opening/closing curly braces and brackets

				for (let tkn = 0; tkn < parsed[line].length; tkn++) {
					if (parsed[line][tkn].l === ld.javascript_langindex && parsed[line][tkn].s === ld.javascript_delim_attrindex) {
						// This is a JSON bracket
						const jb = doc.getText(Range.create(line,parsed[line][tkn].p,line,parsed[line][tkn].p+parsed[line][tkn].c));
						if (jb === "[" || jb === "{") {
							// Create a new JSON range
							openranges.push({
								startLine: line,
								endLine: line,
								kind: "isc-json"
							});
						}
						else if (jb === "]" || jb === "}") {
							// Close the most recent JSON range
							var prevrange = openranges.length-1;
							for (let rge = openranges.length-1; rge >= 0; rge--) {
								if (openranges[rge].kind === "isc-json") {
									prevrange = rge;
									break;
								}
							}
							if (prevrange >= 0 && openranges[prevrange].startLine < line-1) {
								openranges[prevrange].endLine = line-1;
								result.push(openranges[prevrange]);
							}
							openranges.splice(prevrange,1);
						}
					}
				}
			}
			else {
				for (let tkn = 0; tkn < parsed[line].length; tkn++) {
					if (parsed[line][tkn].l === ld.cos_langindex && parsed[line][tkn].s === ld.cos_jsonb_attrindex) {
						// This is a JSON bracket
						const jb = doc.getText(Range.create(line,parsed[line][tkn].p,line,parsed[line][tkn].p+parsed[line][tkn].c));
						if (jb === "[" || jb === "{") {
							// Create a new JSON range
							openranges.push({
								startLine: line,
								endLine: line,
								kind: "isc-json"
							});
						}
						else {
							// Close the most recent JSON range
							var prevrange = openranges.length-1;
							for (let rge = openranges.length-1; rge >= 0; rge--) {
								if (openranges[rge].kind === "isc-json") {
									prevrange = rge;
									break;
								}
							}
							if (prevrange >= 0 && openranges[prevrange].startLine < line-1) {
								openranges[prevrange].endLine = line-1;
								result.push(openranges[prevrange]);
							}
							openranges.splice(prevrange,1);
						}
					}
					if (tkn+1 > dottedDoLevel && parsed[line][tkn].l === ld.cos_langindex && parsed[line][tkn].s === ld.cos_dots_attrindex) {
						// This is the start of a dotted Do
						dottedDoLevel++;
						openranges.push({
							startLine: line-1,
							endLine: line-1,
							kind: "isc-dotteddo"
						});
					}
					if (tkn === 0 && dottedDoLevel > 0) {
						// We're in a dotted Do, so check if the line begins with the correct number of dots

						if (parsed[line].length >= dottedDoLevel) {
							for (let level = dottedDoLevel-1; level >= 0; level--) {
								if (parsed[line][level].l !== ld.cos_langindex || parsed[line][level].s !== ld.cos_dots_attrindex) {
									// This dotted Do level is closed
									var prevrange = openranges.length-1;
									for (let rge = openranges.length-1; rge >= 0; rge--) {
										if (openranges[rge].kind === "isc-dotteddo") {
											prevrange = rge;
											break;
										}
									}
									openranges[prevrange].endLine = line-1;
									result.push(openranges[prevrange]);
									openranges.splice(prevrange,1);
									dottedDoLevel--;
								}
							}
						}
						else {
							// At least one dotted Do level is closed
							for (let level = dottedDoLevel-1; level >= 0; level--) {
								if (level > parsed[line].length-1) {
									// Close all dotted Do levels that are greater than the length of this line
									var prevrange = openranges.length-1;
									for (let rge = openranges.length-1; rge >= 0; rge--) {
										if (openranges[rge].kind === "isc-dotteddo") {
											prevrange = rge;
											break;
										}
									}
									openranges[prevrange].endLine = line-1;
									result.push(openranges[prevrange]);
									openranges.splice(prevrange,1);
									dottedDoLevel--;
								}
								else if (parsed[line][level].l !== ld.cos_langindex || parsed[line][level].s !== ld.cos_dots_attrindex) {
									// This dotted Do level is closed
									var prevrange = openranges.length-1;
									for (let rge = openranges.length-1; rge >= 0; rge--) {
										if (openranges[rge].kind === "isc-dotteddo") {
											prevrange = rge;
											break;
										}
									}
									openranges[prevrange].endLine = line-1;
									result.push(openranges[prevrange]);
									openranges.splice(prevrange,1);
									dottedDoLevel--;
								}
							}
						}
					}
					if (parsed[line][tkn].l === ld.cos_langindex && parsed[line][tkn].s === ld.cos_embo_attrindex) {
						// This is an embedded code block open token
						openranges.push({
							startLine: line,
							endLine: line,
							kind: "isc-embedded"
						});
					}
					if (parsed[line][tkn].l === ld.cos_langindex && parsed[line][tkn].s === ld.cos_embc_attrindex) {
						// This is an embedded code block close token
						var prevrange = openranges.length-1;
						for (let rge = openranges.length-1; rge >= 0; rge--) {
							if (openranges[rge].kind === "isc-embedded") {
								prevrange = rge;
								break;
							}
						}
						if (prevrange >= 0 && openranges[prevrange].startLine < line-1) {
							openranges[prevrange].endLine = line-1;
							result.push(openranges[prevrange]);
						}
						openranges.splice(prevrange,1);
					}
				}
			}
			// Done with special processing, so loop again to find all ObjectScript braces, UDL parentheses and HTML script tags
			for (let tkn = 0; tkn < parsed[line].length; tkn++) {
				if (parsed[line][tkn].l === ld.cos_langindex && parsed[line][tkn].s === ld.cos_brace_attrindex) {
					const bracetext = doc.getText(Range.create(line,parsed[line][tkn].p,line,parsed[line][tkn].p+parsed[line][tkn].c));
					if (bracetext === "{") {
						// Open a new ObjectScript code block range
						openranges.push({
							startLine: line,
							endLine: line,
							kind: "isc-cosblock"
						});
					}
					else {
						// Close the most recent ObjectScript code block range
						var prevrange = openranges.length-1;
						for (let rge = openranges.length-1; rge >= 0; rge--) {
							if (openranges[rge].kind === "isc-cosblock") {
								prevrange = rge;
								break;
							}
						}
						if (prevrange >= 0 && openranges[prevrange].startLine < line-1) {
							openranges[prevrange].endLine = line-1;
							result.push(openranges[prevrange]);
						}
						openranges.splice(prevrange,1);
					}
				}
				else if (parsed[line][tkn].l === ld.cls_langindex && parsed[line][tkn].s === ld.cls_delim_attrindex) {
					const delimtext = doc.getText(Range.create(line,parsed[line][tkn].p,line,parsed[line][tkn].p+parsed[line][tkn].c));
					if (delimtext === "(") {
						// Open a new UDL parentheses range
						openranges.push({
							startLine: line,
							endLine: line,
							kind: "isc-udlparen"
						});
					}
					else if (delimtext === ")") {
						// Close the most recent UDL parentheses range
						var prevrange = openranges.length-1;
						for (let rge = openranges.length-1; rge >= 0; rge--) {
							if (openranges[rge].kind === "isc-udlparen") {
								prevrange = rge;
								break;
							}
						}
						if (prevrange >= 0 && openranges[prevrange].startLine < line-1) {
							openranges[prevrange].endLine = line-1;
							result.push(openranges[prevrange]);
						}
						openranges.splice(prevrange,1);
					}
				}
				else if (
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
					)).toLowerCase() === "script"
				) {
					// Open a new HTML script tag range
					openranges.push({
						startLine: line,
						endLine: line,
						kind: "isc-htmlscript"
					});
				}
				else if (
					tkn < parsed[line].length - 3 &&
					parsed[line][tkn].l == ld.html_langindex && parsed[line][tkn].s == ld.html_delim_attrindex &&
					parsed[line][tkn+1].l == ld.html_langindex && parsed[line][tkn+1].s == ld.html_delim_attrindex &&
					parsed[line][tkn+2].l == ld.html_langindex && parsed[line][tkn+2].s == ld.html_tag_attrindex &&
					doc.getText(Range.create(
						line,parsed[line][tkn+2].p,
						line,parsed[line][tkn+2].p+parsed[line][tkn+2].c
					)).toLowerCase() === "script"
				) {
					// Close the most recent HTML script tag range
					var prevrange = openranges.length-1;
					for (let rge = openranges.length-1; rge >= 0; rge--) {
						if (openranges[rge].kind === "isc-htmlscript") {
							prevrange = rge;
							break;
						}
					}
					if (prevrange >= 0 && openranges[prevrange].startLine < line-1) {
						openranges[prevrange].endLine = line-1;
						result.push(openranges[prevrange]);
					}
					openranges.splice(prevrange,1);
				}
				else if (parsed[line][tkn].l == ld.cos_langindex && parsed[line][tkn].s == ld.cos_comment_attrindex) {
					const inCComment = openranges.length && openranges[openranges.length - 1].kind == "isc-ccomment";
					if (!inCComment && doc.getText(Range.create(line,parsed[line][tkn].p,line,parsed[line][tkn].p+2)) == "/*") {
						// Open a new C-style comment range
						openranges.push({
							startLine: line,
							endLine: line,
							kind: "isc-ccomment"
						});
					} else if (inCComment && doc.getText(Range.create(line,parsed[line][tkn].p+parsed[line][tkn].c-2,line,parsed[line][tkn].p+parsed[line][tkn].c)) == "*/") {
						// Close the most recent C-style comment range
						const cCommentRange = openranges.pop();
						cCommentRange.endLine = line - 1;
						cCommentRange.kind = FoldingRangeKind.Comment;
						if (cCommentRange.endLine > cCommentRange.startLine) result.push(cCommentRange);
					}
				}
			}
		}
	}

	return result;
}
