import { Position, TextDocumentPositionParams, Range } from 'vscode-languageserver/node';
import { findFullRange } from '../utils/functions';
import { parsedDocuments, documents } from '../utils/variables';
import * as ld from '../utils/languageDefinitions';

export function onDeclaration(params: TextDocumentPositionParams) {
	const parsed = parsedDocuments.get(params.textDocument.uri);
	if (parsed === undefined) {return null;}
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {return null;}
	if (doc.languageId !== "objectscript-class") {return null;}

	for (let i = 0; i < parsed[params.position.line].length; i++) {
		const symbolstart: number = parsed[params.position.line][i].p;
		const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
		if (params.position.character >= symbolstart && params.position.character <= symbolend) {
			// We found the right symbol in the line

			if (parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_param_attrindex) {
				// This is a parameter

				var decrange: Range | null = null;
				const thisparam = doc.getText(findFullRange(params.position.line,parsed,i,symbolstart,symbolend));
				// Scan to the method definition or label that denotes the code block
				for (let j = params.position.line; j >= 0; j--) {
					if (parsed[j].length === 0) {
						continue;
					}
					else if (parsed[j][0].l == ld.cls_langindex && parsed[j][0].s == ld.cls_keyword_attrindex) {
						// This is the method definition
						if (
							parsed[j][parsed[j].length-1].l == ld.cls_langindex && parsed[j][parsed[j].length-1].s == ld.cls_delim_attrindex &&
							doc.getText(Range.create(
								Position.create(j,parsed[j][parsed[j].length-1].p),
								Position.create(j,parsed[j][parsed[j].length-1].p+parsed[j][parsed[j].length-1].c)
							)) === "("
						) {
							// This is a multi-line method definition
							for (let mline = j+1; mline < parsed.length; mline++) {
								// Loop through the line and look for this parameter

								for (let tkn = 0; tkn < parsed[mline].length; tkn++) {
									if (parsed[mline][tkn].l == ld.cls_langindex && parsed[mline][tkn].s == ld.cls_param_attrindex) {
										// This is a parameter
										const paramrange = Range.create(
											Position.create(mline,parsed[mline][tkn].p),
											Position.create(mline,parsed[mline][tkn].p+parsed[mline][tkn].c)
										);
										const paramtext = doc.getText(paramrange);
										if (thisparam === paramtext) {
											// This is the correct parameter
											decrange = paramrange;
											break;
										}
									}
								}
								if (decrange !== null) {
									// We found the parameter
									break;
								}
								else if (
									parsed[mline][parsed[mline].length-1].l == ld.cls_langindex && parsed[mline][parsed[mline].length-1].s == ld.cls_delim_attrindex &&
									doc.getText(Range.create(
										Position.create(mline,parsed[mline][parsed[mline].length-1].p),
										Position.create(mline,parsed[mline][parsed[mline].length-1].p+parsed[mline][parsed[mline].length-1].c)
									)) !== ","
								) {
									// We've reached the end of the method definition
									break;
								}
							}
						}
						else {
							// This is a single-line method definition
							for (let tkn = 0; tkn < parsed[j].length; tkn++) {
								if (parsed[j][tkn].l == ld.cls_langindex && parsed[j][tkn].s == ld.cls_param_attrindex) {
									// This is a parameter
									const paramrange = Range.create(
										Position.create(j,parsed[j][tkn].p),
										Position.create(j,parsed[j][tkn].p+parsed[j][tkn].c)
									);
									const paramtext = doc.getText(paramrange);
									if (thisparam === paramtext) {
										// This is the correct parameter
										decrange = paramrange;
										break;
									}
								}
							}
						}
						break;
					}
				}
				if (decrange !== null) {
					// We found the parameter declaration
					return {
						uri: params.textDocument.uri,
						range: decrange
					};
				}
			}
			else if (parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_localdec_attrindex) {
				// This is a declared local variable

				var decrange: Range | null = null;
				const thisvar = doc.getText(findFullRange(params.position.line,parsed,i,symbolstart,symbolend));
				// Scan to the top of the class member to find the #Dim
				for (let j = params.position.line; j >= 0; j--) {
					if (parsed[j].length === 0) {
						continue;
					}
					else if (parsed[j][0].l == ld.cls_langindex && parsed[j][0].s == ld.cls_keyword_attrindex) {
						// This is the definition for the class member that the variable is in
						break;
					}
					else if (parsed[j][0].l == ld.cos_langindex && parsed[j][0].s == ld.cos_ppc_attrindex) {
						// This is a preprocessor command
						const command = doc.getText(Range.create(Position.create(j,parsed[j][0].p),Position.create(j,parsed[j][1].p+parsed[j][1].c)));
						if (command.toLowerCase() === "#dim") {
							// This is a #Dim
							for (let k = 2; k < parsed[j].length; k++) {
								if (parsed[j][k].s === ld.cos_localdec_attrindex) {
									// This is a declared local variable
									const localdecrange = Range.create(Position.create(j,parsed[j][k].p),Position.create(j,parsed[j][k].p+parsed[j][k].c));
									var localvar = doc.getText(localdecrange);
									if (localvar === thisvar) {
										// This is the #Dim for this variable
										decrange = localdecrange;
										break;
									}
								}
							}
						}
						if (decrange !== null) {
							// We found the local variable declaration
							break;
						}
					}
				}
				if (decrange !== null) {
					// We found the local variable declaration
					return {
						uri: params.textDocument.uri,
						range: decrange
					};
				}
			}
			else if (parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_localvar_attrindex) {
				// This is a public variable

				var decrange: Range | null = null;
				const thisvar = doc.getText(findFullRange(params.position.line,parsed,i,symbolstart,symbolend));
				// Scan to the top of the class member to find the #Dim
				for (let j = params.position.line; j >= 0; j--) {
					if (parsed[j].length === 0) {
						continue;
					}
					else if (parsed[j][0].l == ld.cls_langindex && parsed[j][0].s == ld.cls_keyword_attrindex) {
						// This is the definition for the class member that the variable is in
						const keytext = doc.getText(Range.create(
							Position.create(j,parsed[j][0].p),
							Position.create(j,parsed[j][0].p+parsed[j][0].c)
						)).toLowerCase();
						if (keytext.indexOf("method") !== -1) {
							// This public variable is in a method so see if it's in the PublicList

							// The keyword list might be on a following line
							for (let k = j; k < parsed.length; k++) {
								if (parsed[k].length === 0) {
									continue;
								}
								var prevkey: string = "";
								for (let tkn = 1; tkn < parsed[k].length; tkn++) {
									if (parsed[k][tkn].l == ld.cls_langindex && parsed[k][tkn].s == ld.cls_keyword_attrindex) {
										// This token is a keyword
										prevkey = doc.getText(Range.create(
											Position.create(k,parsed[k][tkn].p),
											Position.create(k,parsed[k][tkn].p+parsed[k][tkn].c)
										)).toLowerCase();
									}
									else if (prevkey === "publiclist" && parsed[k][tkn].l == ld.cls_langindex && parsed[k][tkn].s == ld.cls_iden_attrindex) {
										// This is an identifier in the PublicList
										const idenrange = Range.create(Position.create(k,parsed[k][tkn].p),Position.create(k,parsed[k][tkn].p+parsed[k][tkn].c));
										const identext = doc.getText(idenrange);
										if (identext === thisvar) {
											// This identifier is the variable that we're looking for
											decrange = idenrange;
											break;
										}
									}
								}
								if (
									parsed[k][parsed[k].length-1].l == ld.cls_langindex && parsed[k][parsed[k].length-1].s == ld.cls_delim_attrindex &&
									doc.getText(Range.create(
										Position.create(k,parsed[k][parsed[k].length-1].p),
										Position.create(k,parsed[k][parsed[k].length-1].p+parsed[k][parsed[k].length-1].c)
									)) === "{"
								) {
									// The last token on this line is an open curly, so this is the end of the method definition
									break;
								}
							}
						}
						break;
					}
					else if (parsed[j][0].l == ld.cos_langindex && parsed[j][0].s == ld.cos_ppc_attrindex) {
						// This is a preprocessor command
						const command = doc.getText(Range.create(Position.create(j,parsed[j][0].p),Position.create(j,parsed[j][1].p+parsed[j][1].c)));
						if (command.toLowerCase() === "#dim") {
							// This is a #Dim
							for (let k = 2; k < parsed[j].length; k++) {
								if (parsed[j][k].s === ld.cos_localvar_attrindex) {
									// This is a public variable
									const pubrange = Range.create(Position.create(j,parsed[j][k].p),Position.create(j,parsed[j][k].p+parsed[j][k].c));
									var localvar = doc.getText(pubrange);
									if (localvar === thisvar) {
										// This is the #Dim for this variable
										decrange = pubrange;
										break;
									}
								}
							}
						}
						if (decrange !== null) {
							// We found the public variable declaration
							break;
						}
					}
				}
				if (decrange !== null) {
					// We found the pubic variable declaration
					return {
						uri: params.textDocument.uri,
						range: decrange
					};
				}
			}
		}
	}
}
