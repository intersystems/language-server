import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentFormattingParams, DocumentRangeFormattingParams, Position, TextEdit, Range } from 'vscode-languageserver/node';
import { getLanguageServerSettings, haltOrHang } from '../utils/functions';
import { compressedline, LanguageServerConfiguration, CommandDoc } from '../utils/types';
import { parsedDocuments, documents } from '../utils/variables';
import * as ld from '../utils/languageDefinitions';
import commands = require("../documentation/commands.json");
import structuredSystemVariables = require("../documentation/structuredSystemVariables.json");
import systemFunctions = require("../documentation/systemFunctions.json");
import systemVariables = require("../documentation/systemVariables.json");

/**
 * Compute a TextEdit for this token. Called during a whole document or range formatting on every token.
 * 
 * @param doc The TextDocument that the token is in.
 * @param parsed The tokenized representation of doc.
 * @param settings The language server configuration settings.
 * @param line The line that the token is in.
 * @param token The offset of the token in the line.
 */
function formatToken(doc: TextDocument, parsed: compressedline[], settings: LanguageServerConfiguration, line: number, token: number): TextEdit | null {

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
				return {
					range: commandrange,
					newText: idealcommandtext
				};
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
				return {
					range: sysfrange,
					newText: idealsysftext
				};
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
						return {
							range: ssysvrange,
							newText: idealssysvtext
						};
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
						return {
							range: ssysvrange,
							newText: idealssysvtext
						};
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
				return {
					range: sysvrange,
					newText: idealsysvtext
				};
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
			return {
				range: unkncrange,
				newText: idealunknctext
			};
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
			return {
				range: unknsrange,
				newText: idealunknstext
			};
		}
	}
	return null;
};

export async function onDocumentFormatting(params: DocumentFormattingParams): Promise<TextEdit[] | null> {
	var result: TextEdit[] = [];
	const parsed = parsedDocuments.get(params.textDocument.uri);
	if (parsed === undefined) {return null;}
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {return null;}
	const settings = await getLanguageServerSettings();

	// Loop through all of the tokens
	for (let i = 0; i < parsed.length; i++) {
		for (let j = 0; j < parsed[i].length; j++) {
			const edit = formatToken(doc,parsed,settings,i,j);
			if (edit !== null){
				result.push(edit);
			}
		}
	}
	return result;
}

export async function onDocumentRangeFormatting(params: DocumentRangeFormattingParams): Promise<TextEdit[] | null> {
	var result: TextEdit[] = [];
	const parsed = parsedDocuments.get(params.textDocument.uri);
	if (parsed === undefined) {return null;}
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {return null;}
	const settings = await getLanguageServerSettings();

	// Loop through the tokens in the range
	for (let i = params.range.start.line; i <= params.range.end.line; i++) {
		for (let j = 0; j < parsed[i].length; j++) {
			if (i === params.range.start.line && parsed[i][j].p < params.range.start.character) {
				continue;
			}
			else if (i === params.range.end.line && parsed[i][j].p > params.range.end.character) {
				break;
			}
			const edit = formatToken(doc,parsed,settings,i,j);
			if (edit !== null){
				result.push(edit);
			}
		}
	}
	return result;
}
