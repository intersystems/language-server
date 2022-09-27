import { Position, RenameParams, TextDocumentPositionParams, TextEdit, Range } from 'vscode-languageserver/node';
import { documents } from '../utils/variables';
import * as ld from '../utils/languageDefinitions';
import { getParsedDocument } from '../utils/functions';

export async function onPrepareRename(params: TextDocumentPositionParams) {
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {return null;}
	const parsed = await getParsedDocument(params.textDocument.uri);
	if (parsed === undefined) {return null;}

	if (doc.languageId === "objectscript-class") {
		var result: Range | null = null;

		var symbollang: number = -1;
		for (let i = 0; i < parsed[params.position.line].length; i++) {
			const symbolstart: number = parsed[params.position.line][i].p;
			const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
			if (params.position.character >= symbolstart && params.position.character <= symbolend) {
				// We found the right symbol in the line
				if (
					(parsed[params.position.line][i].l == ld.cos_langindex &&
					(parsed[params.position.line][i].s == ld.cos_localdec_attrindex ||
					parsed[params.position.line][i].s == ld.cos_param_attrindex ||
					parsed[params.position.line][i].s == ld.cos_otw_attrindex ||
					parsed[params.position.line][i].s == ld.cos_localundec_attrindex)) ||
					(parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_param_attrindex)
				) {
					// Only save the symbol range if it's potentially renameable
					result = Range.create(Position.create(params.position.line,symbolstart),Position.create(params.position.line,symbolend));
					symbollang = parsed[params.position.line][i].l;
				}
				break;
			}
		}

		if (symbollang === ld.cls_langindex) {
			if (
				parsed[params.position.line][0].l === ld.cls_langindex && parsed[params.position.line][0].s === ld.cls_keyword_attrindex &&
				doc.getText(Range.create(
					Position.create(params.position.line,parsed[params.position.line][0].p),
					Position.create(params.position.line,parsed[params.position.line][0].p+parsed[params.position.line][0].c)
				)).toLowerCase().indexOf("method") === -1
			) {
				// This UDL parameter isn't part of a method definition so we can't rename it
				result = null;
			}
			else {
				// Check if this method is ProcedureBlock
				var methodprocedureblock: boolean | undefined = undefined;
				if (
					parsed[params.position.line][0].l === ld.cls_langindex && parsed[params.position.line][0].s === ld.cls_keyword_attrindex &&
					doc.getText(Range.create(
						Position.create(params.position.line,parsed[params.position.line][0].p),
						Position.create(params.position.line,parsed[params.position.line][0].p+parsed[params.position.line][0].c)
					)).toLowerCase().indexOf("method") !== -1
				) {
					// This is a single-line method definition so look for the ProcedureBlock keyword on this line
					for (let l = 1; l < parsed[params.position.line].length; l++) {
						if (parsed[params.position.line][l].l == ld.cls_langindex && parsed[params.position.line][l].s == ld.cls_keyword_attrindex) {
							const kw = doc.getText(Range.create(
								Position.create(params.position.line,parsed[params.position.line][l].p),
								Position.create(params.position.line,parsed[params.position.line][l].p+parsed[params.position.line][l].c)
							));
							if (kw.toLowerCase() === "procedureblock") {
								// The ProcedureBlock keyword is set
								if (
									doc.getText(Range.create(
										Position.create(params.position.line,parsed[params.position.line][l+1].p),
										Position.create(params.position.line,parsed[params.position.line][l+1].p+parsed[params.position.line][l+1].c)
									)) === "="
								) {
									// The ProcedureBlock keyword has a value
									const kwval = doc.getText(Range.create(
										Position.create(params.position.line,parsed[params.position.line][l+2].p),
										Position.create(params.position.line,parsed[params.position.line][l+2].p+parsed[params.position.line][l+2].c)
									));
									if (kwval === "0") {
										methodprocedureblock = false;
									}
									else {
										methodprocedureblock = true;
									}
								}
								else {
									// The ProcedureBlock keyword doesn't have a value
									methodprocedureblock = true;
								}
								break;
							}
						}
					}
				}
				else {
					// This is a multi-line method definition
					for (let mline = params.position.line+1; mline < parsed.length; mline++) {
						if (
							parsed[mline][parsed[mline].length-1].l == ld.cls_langindex && parsed[mline][parsed[mline].length-1].s == ld.cls_delim_attrindex &&
							doc.getText(Range.create(
								Position.create(mline,parsed[mline][parsed[mline].length-1].p),
								Position.create(mline,parsed[mline][parsed[mline].length-1].p+parsed[mline][parsed[mline].length-1].c)
							)) !== ","
						) {
							// We've passed the argument lines so look for the ProcedureBlock keyword on this line
							for (let l = 1; l < parsed[mline].length; l++) {
								if (parsed[mline][l].l == ld.cls_langindex && parsed[mline][l].s == ld.cls_keyword_attrindex) {
									const kw = doc.getText(Range.create(Position.create(mline,parsed[mline][l].p),Position.create(mline,parsed[mline][l].p+parsed[mline][l].c)));
									if (kw.toLowerCase() === "procedureblock") {
										// The ProcedureBlock keyword is set
										if (
											doc.getText(Range.create(
												Position.create(mline,parsed[mline][l+1].p),
												Position.create(mline,parsed[mline][l+1].p+parsed[mline][l+1].c)
											)) === "="
										) {
											// The ProcedureBlock keyword has a value
											const kwval = doc.getText(Range.create(
												Position.create(mline,parsed[mline][l+2].p),
												Position.create(mline,parsed[mline][l+2].p+parsed[mline][l+2].c)
											));
											if (kwval === "0") {
												methodprocedureblock = false;
											}
											else {
												methodprocedureblock = true;
											}
										}
										else {
											// The ProcedureBlock keyword doesn't have a value
											methodprocedureblock = true;
										}
										break;
									}
								}
							}
							break;
						}
					}
				}

				if (methodprocedureblock === undefined) {
					// Defer to the class's setting
					var classprocedureblock: boolean = true;
					for (let line = 0; line <= params.position.line; line++) {
						if (parsed[line].length === 0) {
							continue;
						}
						if (
							parsed[line][0].l === ld.cls_langindex && parsed[line][0].s === ld.cls_keyword_attrindex &&
							doc.getText(Range.create(
								Position.create(line,parsed[line][0].p),
								Position.create(line,parsed[line][0].p+parsed[line][0].c)
							)).toLowerCase() === "class"
						) {
							// This line is the class definition
							for (let ctkn = 2; ctkn < parsed[line].length; ctkn++) {
								if (
									parsed[line][ctkn].l === ld.cls_langindex && parsed[line][ctkn].s === ld.cls_keyword_attrindex &&
									doc.getText(Range.create(
										Position.create(line,parsed[line][ctkn].p),
										Position.create(line,parsed[line][ctkn].p+parsed[line][ctkn].c)
									)).toLowerCase() === "procedureblock"
								) {
									// The ProcedureBlock keyword is set
									if (
										parsed[line][ctkn-1].l === ld.cls_langindex && parsed[line][ctkn-1].s === ld.cls_keyword_attrindex &&
										doc.getText(Range.create(
											Position.create(line,parsed[line][ctkn-1].p),
											Position.create(line,parsed[line][ctkn-1].p+parsed[line][ctkn-1].c)
										)).toLowerCase() === "not"
									) {
										// The methods in this class are not ProcedureBlock by default
										classprocedureblock = false;
									}
									break;
								}
							}
						}
					}
					if (!classprocedureblock) {
						// We don't allow renaming on methods that aren't ProcedureBlock
						result = null;
					}
				}
				else {
					if (!methodprocedureblock) {
						// We don't allow renaming on methods that aren't ProcedureBlock
						result = null;
					}
				}
			}
		}
		
		return result;
	}
	else {
		// We don't support renaming on routines, include files or csp files
		return null;
	}
}

export async function onRenameRequest(params: RenameParams) {
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {return null;}
	const parsed = await getParsedDocument(params.textDocument.uri);
	if (parsed === undefined) {return null;}

	// Loop through the line that we're on to find the token type and old name
	var oldname: string = "";
	var lang: number = -1;
	var type: number = -1;
	for (let i = 0; i < parsed[params.position.line].length; i++) {
		const symbolstart: number = parsed[params.position.line][i].p;
		const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
		if (params.position.character >= symbolstart && params.position.character <= symbolend) {
			// We found the right symbol in the line
			if (
				(parsed[params.position.line][i].l == ld.cos_langindex &&
				(parsed[params.position.line][i].s == ld.cos_localdec_attrindex ||
				parsed[params.position.line][i].s == ld.cos_param_attrindex ||
				parsed[params.position.line][i].s == ld.cos_otw_attrindex ||
				parsed[params.position.line][i].s == ld.cos_localundec_attrindex)) ||
				(parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_param_attrindex)
			) {
				// This token is a type that we support renaming on
				lang = parsed[params.position.line][i].l;
				if (lang === ld.cls_langindex) {
					type = ld.cos_param_attrindex;
				}
				else {
					type = parsed[params.position.line][i].s;
				}
				oldname = doc.getText(Range.create(Position.create(params.position.line,symbolstart),Position.create(params.position.line,symbolend)));
			}
			break;
		}
	}
	if (type === -1) {
		// This token isn't a type that we support renaming on
		return null;
	}

	// Compute the TextEdits
	var edits: TextEdit[] = [];
	if (lang === ld.cos_langindex) {
		// Loop up in the file and compute edits on every line until you reach the method definition
		for (let line1 = params.position.line-1; line1 >= 0; line1--) {
			if (parsed[line1].length === 0) {
				continue;
			}
			if (parsed[line1][0].l === ld.cls_langindex) {
				if (type !== ld.cos_param_attrindex) {
					break;
				}
				else {
					// Loop through the line looking for the parameter definition
					var foundparamdefn = false;
					for (let udltkn = 0; udltkn < parsed[line1].length; udltkn++) {
						if (parsed[line1][udltkn].l == ld.cls_langindex && parsed[line1][udltkn].s == ld.cls_param_attrindex) {
							// This token is a UDL parameter
							const udltknrange = Range.create(Position.create(line1,parsed[line1][udltkn].p),Position.create(line1,parsed[line1][udltkn].p+parsed[line1][udltkn].c));
							const udltkntext = doc.getText(udltknrange);
							if (udltkntext === oldname) {
								// This is an instance of the variable that we're renaming
								edits.push({
									range: udltknrange,
									newText: params.newName
								});
								foundparamdefn = true;
								break;
							}
						}
					}
					if (foundparamdefn) {
						break;
					}
				}
			}
			for (let tkn1 = 0; tkn1 < parsed[line1].length; tkn1++) {
				if (parsed[line1][tkn1].l == ld.cos_langindex && parsed[line1][tkn1].s == type) {
					// This token is the same type as the one we're renaming
					const tkn1range = Range.create(Position.create(line1,parsed[line1][tkn1].p),Position.create(line1,parsed[line1][tkn1].p+parsed[line1][tkn1].c));
					const tkn1text = doc.getText(tkn1range);
					if (tkn1text === oldname) {
						// This is an instance of the variable that we're renaming
						edits.push({
							range: tkn1range,
							newText: params.newName
						});
					}
				}
			}
		}

		// Loop down in the file and compute edits on every line until you reach the end of the method
		for (let line2 = params.position.line; line2 < parsed.length; line2++) {
			if (parsed[line2].length === 0) {
				continue;
			}
			if (parsed[line2][0].l === ld.cls_langindex) {
				break;
			}
			for (let tkn2 = 0; tkn2 < parsed[line2].length; tkn2++) {
				if (parsed[line2][tkn2].l == ld.cos_langindex && parsed[line2][tkn2].s == type) {
					// This token is the same type as the one we're renaming
					const tkn2range = Range.create(Position.create(line2,parsed[line2][tkn2].p),Position.create(line2,parsed[line2][tkn2].p+parsed[line2][tkn2].c));
					const tkn2text = doc.getText(tkn2range);
					if (tkn2text === oldname) {
						// This is an instance of the variable that we're renaming
						edits.push({
							range: tkn2range,
							newText: params.newName
						});
					}
				}
			}
		}
	}
	else {
		// Loop down in the file and compute edits on every line until you reach the end of the method
		for (let line3 = params.position.line; line3 < parsed.length; line3++) {
			if (parsed[line3].length === 0) {
				continue;
			}
			if (line3 !== params.position.line && parsed[line3][0].l === ld.cls_langindex && parsed[line3][0].s === ld.cls_keyword_attrindex) {
				break;
			}
			for (let tkn3 = 0; tkn3 < parsed[line3].length; tkn3++) {
				if (
					(parsed[line3][tkn3].l == ld.cos_langindex && parsed[line3][tkn3].s == type) ||
					(parsed[line3][tkn3].l == ld.cls_langindex && parsed[line3][tkn3].s == ld.cls_param_attrindex)
				) {
					// This token is the same type as the one we're renaming
					const tkn3range = Range.create(Position.create(line3,parsed[line3][tkn3].p),Position.create(line3,parsed[line3][tkn3].p+parsed[line3][tkn3].c));
					const tkn3text = doc.getText(tkn3range);
					if (tkn3text === oldname) {
						// This is an instance of the variable that we're renaming
						edits.push({
							range: tkn3range,
							newText: params.newName
						});
					}
				}
			}
		}
	}

	// Return the edits if there are any
	if (edits.length > 0) {
		return {
			changes: {
				[params.textDocument.uri]: edits
			}
		};
	}
	else {
		return null;
	}
}
