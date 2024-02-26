import { DocumentUri } from 'vscode-languageserver-textdocument';
import { DocumentFormattingParams, DocumentRangeFormattingParams, Position, TextEdit, Range } from 'vscode-languageserver/node';
import { findFullRange, getLanguageServerSettings, getParsedDocument, getServerSpec, haltOrHang, makeRESTRequest, normalizeClassname } from '../utils/functions';
import { CommandDoc, StudioOpenDialogFile, ServerSpec } from '../utils/types';
import { documents } from '../utils/variables';
import * as ld from '../utils/languageDefinitions';
import commands = require("../documentation/commands.json");
import structuredSystemVariables = require("../documentation/structuredSystemVariables.json");
import systemFunctions = require("../documentation/systemFunctions.json");
import systemVariables = require("../documentation/systemVariables.json");

/**
 * Run the formatter on `range` of document `uri`.
 * 
 * @param uri The uri of the TextDocument to format.
 * @param range The range within `uri` to format.
 */
async function formatText(uri: DocumentUri, range?: Range): Promise<TextEdit[] | null> {
	const result: TextEdit[] = [];
	const doc = documents.get(uri);
	if (doc === undefined) {return null;}
	const parsed = await getParsedDocument(uri);
	if (parsed === undefined) {return null;}
	const settings = await getLanguageServerSettings(uri);
	const server: ServerSpec = await getServerSpec(doc.uri);

	if (range == undefined) {
		// If no range was specified, format the whole document

		// Find the last non-empty line
		let lastnonempty = parsed.length - 1;
		for (let nl = parsed.length-1; nl >= 0; nl--) {
			if (parsed[nl].length === 0) {
				continue;
			}
			lastnonempty = nl;
			break;
		}
		range = Range.create(0, 0, lastnonempty, parsed[lastnonempty][parsed[lastnonempty].length-1].p + parsed[lastnonempty][parsed[lastnonempty].length-1].c);
	}

	let classes: StudioOpenDialogFile[] = [];
	let inheritedpackages: string[] | undefined = undefined;
	if (settings.formatting.expandClassNames) {
		// Get all classes
		const respdata = await makeRESTRequest("POST",1,"/action/query",server,{
			query: "SELECT Name||'.cls' AS Name FROM %Dictionary.ClassDefinition",
			parameters: []
		});
		if (Array.isArray(respdata?.data?.result?.content)) {
			classes = respdata.data.result.content;
		}
		if (doc.languageId === "objectscript-class") {
			let clsname = "";
			let hassupers = false;

			// Find the class name and if the class has supers
			for (let i = 0; i < parsed.length; i++) {
				if (parsed[i].length === 0) {
					continue;
				}
				else if (parsed[i][0].l == ld.cls_langindex && parsed[i][0].s == ld.cls_keyword_attrindex) {
					// This line starts with a UDL keyword

					let keyword = doc.getText(Range.create(Position.create(i,parsed[i][0].p),Position.create(i,parsed[i][0].p+parsed[i][0].c))).toLowerCase();
					if (keyword === "class") {
						clsname = doc.getText(findFullRange(i,parsed,1,parsed[i][1].p,parsed[i][1].p+parsed[i][1].c));
						for (let j = 1; j < parsed[i].length; j++) {
							if (
								parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_keyword_attrindex &&
								doc.getText(Range.create(
									Position.create(i,parsed[i][j].p),
									Position.create(i,parsed[i][j].p+parsed[i][j].c)
								)).toLowerCase() === "extends"
							) {
								// The 'Extends' keyword is present
								hassupers = true;
								break;
							}
						}
						break;
					}
				}
			}
			if (hassupers) {
				const pkgquerydata = {
					query: "SELECT $LISTTOSTRING(Importall) AS Importall FROM %Dictionary.CompiledClass WHERE Name = ?",
					parameters: [clsname]
				};
				const pkgrespdata = await makeRESTRequest("POST",1,"/action/query",server,pkgquerydata);
				if (pkgrespdata?.data?.result?.content?.length == 1) {
					// We got data back
					inheritedpackages = pkgrespdata.data.result.content[0].Importall != "" ?
						pkgrespdata.data.result.content[0].Importall.replace(/[^\x20-\x7E]/g,'').split(',') : [];
				}
			}
		}
	}

	// Loop through the tokens in the range
	for (let line = range.start.line; line <= range.end.line; line++) {
		if (parsed[line] == undefined || parsed[line].length == 0) {
			// Nothing to format on this line
			continue;
		}
		for (let token = 0; token < parsed[line].length; token++) {
			if (line === range.start.line && parsed[line][token].p < range.start.character) {
				continue;
			}
			else if (line === range.end.line && parsed[line][token].p > range.end.character) {
				break;
			}
			if (parsed[line][token].l == ld.cos_langindex && parsed[line][token].s == ld.cos_command_attrindex) {
				// This is an ObjectScript command
		
				const commandrange = Range.create(Position.create(line,parsed[line][token].p),Position.create(line,parsed[line][token].p + parsed[line][token].c));
				const commandtext = doc.getText(commandrange);
				var commanddoc: CommandDoc | undefined;
				if (commandtext.toUpperCase() === "H") {
					// This is "halt" or "hang"
					commanddoc = haltOrHang(doc,parsed,line,token);
				}
				else {
					commanddoc = commands.find((el) => el.label === commandtext.toUpperCase() || el.alias.includes(commandtext.toUpperCase()));
				}
				if (commanddoc !== undefined) {
					var idealcommandtext = "";
					if (settings.formatting.commands.length === "short" && commanddoc.alias.length === 2) {
						idealcommandtext = commanddoc.alias[1];
					}
					else {
						idealcommandtext = commanddoc.label;
					}
					if (settings.formatting.commands.case === "lower") {
						idealcommandtext = idealcommandtext.toLowerCase();
					}
					else if (settings.formatting.commands.case === "word") {
						if (idealcommandtext === "ELSEIF") {
							idealcommandtext = "ElseIf";
						}
						else if (idealcommandtext.charAt(0) === "Z") {
							if (idealcommandtext.charAt(1) === "Z") {
								idealcommandtext = idealcommandtext.slice(0,3) + idealcommandtext.slice(3).toLowerCase();
							}
							else {
								idealcommandtext = idealcommandtext.slice(0,2) + idealcommandtext.slice(2).toLowerCase();
							}
						}
						else {
							idealcommandtext = idealcommandtext.slice(0,1) + idealcommandtext.slice(1).toLowerCase();
						}
					}
					if (commandtext !== idealcommandtext) {
						// Replace old text with the new text
						result.push({
							range: commandrange,
							newText: idealcommandtext
						});
					}
				}
			}
			else if (parsed[line][token].l == ld.cos_langindex && parsed[line][token].s == ld.cos_sysf_attrindex) {
				// This is a system function
		
				const sysfrange = Range.create(Position.create(line,parsed[line][token].p),Position.create(line,parsed[line][token].p + parsed[line][token].c));
				const sysftext = doc.getText(sysfrange);
				const sysfdoc = systemFunctions.find((el) => el.label === sysftext.toUpperCase() || el.alias.includes(sysftext.toUpperCase()));
				if (sysfdoc !== undefined) {
					var idealsysftext = "";
					if (settings.formatting.system.length === "short" && sysfdoc.alias.length === 2) {
						idealsysftext = sysfdoc.alias[1];
					}
					else {
						idealsysftext = sysfdoc.label;
					}
					if (settings.formatting.system.case === "lower") {
						idealsysftext = idealsysftext.toLowerCase();
					}
					else if (settings.formatting.system.case === "word") {
						if (idealsysftext === "$BITCOUNT") {idealsysftext = "$BitCount";}
						else if (idealsysftext === "$BITFIND") {idealsysftext = "$BitFind";}
						else if (idealsysftext === "$BITLOGIC") {idealsysftext = "$BitLogic";}
						else if (idealsysftext === "$CLASSMETHOD") {idealsysftext = "$ClassMethod";}
						else if (idealsysftext === "$CLASSNAME") {idealsysftext = "$ClassName";}
						else if (idealsysftext === "$FNUMBER") {idealsysftext = "$FNumber";}
						else if (idealsysftext === "$INUMBER") {idealsysftext = "$INumber";}
						else if (idealsysftext === "$ISOBJECT") {idealsysftext = "$IsObject";}
						else if (idealsysftext === "$ISVALIDNUM") {idealsysftext = "$IsValidNum";}
						else if (idealsysftext === "$ISVALIDDOUBLE") {idealsysftext = "$IsValidDouble";}
						else if (idealsysftext === "$ISVECTOR") {idealsysftext = "$IsVector";}
						else if (idealsysftext === "$LISTBUILD") {idealsysftext = "$ListBuild";}
						else if (idealsysftext === "$LISTDATA") {idealsysftext = "$ListData";}
						else if (idealsysftext === "$LISTFIND") {idealsysftext = "$ListFind";}
						else if (idealsysftext === "$LISTFROMSTRING") {idealsysftext = "$ListFromString";}
						else if (idealsysftext === "$LISTGET") {idealsysftext = "$ListGet";}
						else if (idealsysftext === "$LISTLENGTH") {idealsysftext = "$ListLength";}
						else if (idealsysftext === "$LISTNEXT") {idealsysftext = "$ListNext";}
						else if (idealsysftext === "$LISTSAME") {idealsysftext = "$ListSame";}
						else if (idealsysftext === "$LISTTOSTRING") {idealsysftext = "$ListToString";}
						else if (idealsysftext === "$LISTUPDATE") {idealsysftext = "$ListUpdate";}
						else if (idealsysftext === "$LISTVALID") {idealsysftext = "$ListValid";}
						else if (idealsysftext === "$NCONVERT") {idealsysftext = "$NConvert";}
						else if (idealsysftext === "$PREFETCHOFF") {idealsysftext = "$PrefetchOff";}
						else if (idealsysftext === "$PREFETCHON") {idealsysftext = "$PrefetchOn";}
						else if (idealsysftext === "$QLENGTH") {idealsysftext = "$QLength";}
						else if (idealsysftext === "$QSUBSCRIPT") {idealsysftext = "$QSubscript";}
						else if (idealsysftext === "$SCONVERT") {idealsysftext = "$SConvert";}
						else if (idealsysftext === "$SORTBEGIN") {idealsysftext = "$SortBegin";}
						else if (idealsysftext === "$SORTEND") {idealsysftext = "$SortEnd";}
						else if (idealsysftext === "$VECTORDEFINED") {idealsysftext = "$VectorDefined";}
						else if (idealsysftext.charAt(1) === "W") {
							idealsysftext = idealsysftext.slice(0,3) + idealsysftext.slice(3).toLowerCase();
						}
						else if (idealsysftext.charAt(1) === "Z" && idealsysftext.charAt(2) !== "O" && idealsysftext.charAt(2) !== "F") {
							idealsysftext = idealsysftext.slice(0,3) + idealsysftext.slice(3).toLowerCase();
						}
						else {
							idealsysftext = idealsysftext.slice(0,2) + idealsysftext.slice(2).toLowerCase();
						}
					}
					else {
		
					}
					if (sysftext !== idealsysftext) {
						// Replace old text with the new text
						result.push({
							range: sysfrange,
							newText: idealsysftext
						});
					}
				}
			}
			else if (parsed[line][token].l == ld.cos_langindex && parsed[line][token].s == ld.cos_ssysv_attrindex) {
				// This is a structured system variable
		
				const ssysvrange = Range.create(Position.create(line,parsed[line][token].p),Position.create(line,parsed[line][token].p + parsed[line][token].c));
				const ssysvtext = doc.getText(ssysvrange);
				if (ssysvtext !== "^$") {
					if (ssysvtext.indexOf("^$") === -1) {
						const ssysvdoc = structuredSystemVariables.find((el) => el.label === "^$"+ssysvtext.toUpperCase() || el.alias.includes("^$"+ssysvtext.toUpperCase()));
						if (ssysvdoc !== undefined) {
							var idealssysvtext = "";
							if (settings.formatting.system.length === "short" && ssysvdoc.alias.length === 2) {
								idealssysvtext = ssysvdoc.alias[1].slice(2);
							}
							else {
								idealssysvtext = ssysvdoc.label.slice(2);
							}
							if (settings.formatting.system.case === "lower") {
								idealssysvtext = idealssysvtext.toLowerCase();
							}
							else if (settings.formatting.system.case === "word") {
								idealssysvtext = idealssysvtext.slice(0,1) + idealssysvtext.slice(1).toLowerCase();
							}
							if (ssysvtext !== idealssysvtext) {
								// Replace old text with the new text
								result.push({
									range: ssysvrange,
									newText: idealssysvtext
								});
							}
						}
					}
					else {
						const ssysvdoc = structuredSystemVariables.find((el) => el.label === ssysvtext.toUpperCase() || el.alias.includes(ssysvtext.toUpperCase()));
						if (ssysvdoc !== undefined) {
							var idealssysvtext = "";
							if (settings.formatting.system.length === "short" && ssysvdoc.alias.length === 2) {
								idealssysvtext = ssysvdoc.alias[1];
							}
							else {
								idealssysvtext = ssysvdoc.label;
							}
							if (settings.formatting.system.case === "lower") {
								idealssysvtext = idealssysvtext.toLowerCase();
							}
							else if (settings.formatting.system.case === "word") {
								idealssysvtext = idealssysvtext.slice(0,3) + idealssysvtext.slice(3).toLowerCase();
							}
							if (ssysvtext !== idealssysvtext) {
								// Replace old text with the new text
								result.push({
									range: ssysvrange,
									newText: idealssysvtext
								});
							}
						}
					}
				}
			}
			else if (parsed[line][token].l == ld.cos_langindex && parsed[line][token].s == ld.cos_sysv_attrindex) {
				// This is a system variable
		
				const sysvrange = Range.create(Position.create(line,parsed[line][token].p),Position.create(line,parsed[line][token].p + parsed[line][token].c));
				const sysvtext = doc.getText(sysvrange);
				const sysvdoc = systemVariables.find((el) => el.label === sysvtext.toUpperCase() || el.alias.includes(sysvtext.toUpperCase()));
				if (sysvdoc !== undefined) {
					var idealsysvtext = "";
					if (settings.formatting.system.length === "short" && sysvdoc.alias.length === 2) {
						if (sysvtext.toUpperCase() === "$SYSTEM" && parsed[line][token+1].l == ld.cos_langindex && parsed[line][token+1].s == ld.cos_clsname_attrindex) {
							// $SYSTEM is being used as part of a class name and can't be shortened
							idealsysvtext = sysvdoc.label;
						}
						else {
							idealsysvtext = sysvdoc.alias[1];
						}
					}
					else {
						idealsysvtext = sysvdoc.label;
					}
					if (settings.formatting.system.case === "lower") {
						idealsysvtext = idealsysvtext.toLowerCase();
					}
					else if (settings.formatting.system.case === "word") {
						if (idealsysvtext.charAt(1) === "Z") {
							idealsysvtext = idealsysvtext.slice(0,3) + idealsysvtext.slice(3).toLowerCase();
						}
						else {
							idealsysvtext = idealsysvtext.slice(0,2) + idealsysvtext.slice(2).toLowerCase();
						}
					}
					if (sysvtext !== idealsysvtext) {
						// Replace old text with the new text
						result.push({
							range: sysvrange,
							newText: idealsysvtext
						});
					}
				}
			}
			else if (parsed[line][token].l == ld.cos_langindex && parsed[line][token].s == ld.cos_zcom_attrindex) {
				// This is an unknown Z command
		
				const unkncrange = Range.create(Position.create(line,parsed[line][token].p),Position.create(line,parsed[line][token].p + parsed[line][token].c));
				const unknctext = doc.getText(unkncrange);
				var idealunknctext = unknctext;
				if (settings.formatting.commands.case === "upper") {
					idealunknctext = idealunknctext.toUpperCase();
				}
				else if (settings.formatting.commands.case === "lower") {
					idealunknctext = idealunknctext.toLowerCase();
				}
				else {
					idealunknctext = idealunknctext.slice(0,2).toUpperCase() + idealunknctext.slice(2).toLowerCase();
				}
				if (unknctext !== idealunknctext) {
					result.push({
						range: unkncrange,
						newText: idealunknctext
					});
				}
			}
			else if (parsed[line][token].l == ld.cos_langindex && (parsed[line][token].s == ld.cos_uknzfunc_attrindex || parsed[line][token].s == ld.cos_uknzvar_attrindex)) {
				// This is an unknown Z function or variable
		
				const unknsrange = Range.create(Position.create(line,parsed[line][token].p),Position.create(line,parsed[line][token].p + parsed[line][token].c));
				const unknstext = doc.getText(unknsrange);
				var idealunknstext = unknstext;
				if (settings.formatting.system.case === "upper") {
					idealunknstext = idealunknstext.toUpperCase();
				}
				else if (settings.formatting.system.case === "lower") {
					idealunknstext = idealunknstext.toLowerCase();
				}
				else {
					idealunknstext = idealunknstext.slice(0,3).toUpperCase() + idealunknstext.slice(3).toLowerCase();
				}
				if (unknstext !== idealunknstext) {
					result.push({
						range: unknsrange,
						newText: idealunknstext
					});
				}
			}
			else if (
				classes.length > 0 &&
				((parsed[line][token].l == ld.cls_langindex && parsed[line][token].s == ld.cls_clsname_attrindex) ||
				(parsed[line][token].l == ld.cos_langindex && parsed[line][token].s == ld.cos_clsname_attrindex)) &&
				(token == 0 || (token > 0 && (parsed[line][token-1].l != parsed[line][token].l || parsed[line][token-1].s != parsed[line][token].s))) &&
				settings.formatting.expandClassNames
			) {
				// This is the first token of a class name

				// Don't format a class name that follows the "Class" keyword
				if (token !== 0 && parsed[line][token-1].l == ld.cls_langindex && parsed[line][token-1].s == ld.cls_keyword_attrindex) {
					// The previous token is a UDL keyword
					const prevkeytext = doc.getText(Range.create(
						Position.create(line,parsed[line][token-1].p),
						Position.create(line,parsed[line][token-1].p+parsed[line][token-1].c)
					)).toLowerCase();
					if (prevkeytext === "class") {
						continue;
					}
				}
				// Don't format package names in the Import line
				if (
					token !== 0 && parsed[line][0].l == ld.cls_langindex && parsed[line][0].s == ld.cls_keyword_attrindex &&
					doc.getText(Range.create(
						Position.create(line,parsed[line][0].p),
						Position.create(line,parsed[line][0].p+parsed[line][0].c)
					)).toLowerCase() == "import"
				) {
					break;
				}

				// Get the full text of the selection
				let wordrange = findFullRange(line,parsed,token,parsed[line][token].p,parsed[line][token].p+parsed[line][token].c);
				let word = doc.getText(wordrange);
				if (word.charAt(0) === ".") {
					// Can't format $SYSTEM.ClassName
					continue;
				}
				if (word.charAt(0) === '"') {
					// This classname is delimited with ", so strip them
					word = word.slice(1,-1);
				}

				if (!word.includes(".")) {
					// Normalize the class name
					let possiblecls = {num: 0};
					let normalizedname = await normalizeClassname(doc,parsed,word,server,line,classes,possiblecls,inheritedpackages);
					if (normalizedname != "") {
						result.push({
							range: wordrange,
							newText: normalizedname
						});
					}
				}
			}
		}
	}
	return result;
}

export async function onDocumentFormatting(params: DocumentFormattingParams): Promise<TextEdit[] | null> {
	return formatText(params.textDocument.uri);
}

export async function onDocumentRangeFormatting(params: DocumentRangeFormattingParams): Promise<TextEdit[] | null> {
	return formatText(params.textDocument.uri, params.range);
}
