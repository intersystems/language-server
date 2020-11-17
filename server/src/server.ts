import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	Range,
	Position,
	TextDocumentSyncKind,
	SignatureHelpParams,
	SignatureHelp,
	SignatureInformation,
	SignatureHelpTriggerKind,
	DocumentFormattingParams,
	TextEdit,
	CompletionParams,
	DocumentRangeFormattingParams,
	Proposed,
	ProposedFeatures,
	MarkupContent,
	DocumentSymbolParams,
	SymbolKind,
	DocumentSymbol,
	FoldingRangeParams,
	FoldingRange,
	FoldingRangeKind,
	RenameParams
} from 'vscode-languageserver';

import { TextDocument } from 'vscode-languageserver-textdocument';

import axios, { AxiosResponse } from 'axios';
import axiosCookieJarSupport from 'axios-cookiejar-support';
import tough = require('tough-cookie');
axiosCookieJarSupport(axios);

import { compressedline, monikeropttype, monikerinfo } from './types';
import { startcombridge, parsedocument } from './parse';
import { parseText, getLegend } from './sem';
import * as XMLAssist from './xmlassist';
import * as ld from './languagedefns';

import commands = require("./documentation/commands.json");
import structuredSystemVariables = require("./documentation/structuredSystemVariables.json");
import systemFunctions = require("./documentation/systemFunctions.json");
import systemVariables = require("./documentation/systemVariables.json");
import parameterTypes = require("./documentation/parameterTypes.json");
import preprocessorDirectives = require("./documentation/preprocessor.json");

import classKeywords = require("./documentation/keywords/Class.json");
import constraintKeywords = require("./documentation/keywords/Constraint.json");
import foreignkeyKeywords = require("./documentation/keywords/ForeignKey.json");
import indexKeywords = require("./documentation/keywords/Index.json");
import methodKeywords = require("./documentation/keywords/Method.json");
import parameterKeywords = require("./documentation/keywords/Parameter.json");
import projectionKeywords = require("./documentation/keywords/Projection.json");
import propertyKeywords = require("./documentation/keywords/Property.json");
import queryKeywords = require("./documentation/keywords/Query.json");
import triggerKeywords = require("./documentation/keywords/Trigger.json");
import xdataKeywords = require("./documentation/keywords/XData.json");

/**
 * The configuration options exposed by the client.
 */
type LanguageServerConfiguration = {
	formatting: {
		commands: {
			case: "upper" | "lower" | "word",
			length: "short" | "long"
		},
		system: {
			case: "upper" | "lower" | "word",
			length: "short" | "long"
		}
	},
	hover: {
		commands: boolean,
		system: boolean,
		preprocessor: boolean
	},
	diagnostics: {
		routines: boolean,
		parameters: boolean,
		classes: boolean
	},
	signaturehelp: {
		documentation: boolean
	}
};

/**
 * Data returned by a query of %Library.RoutineMgr_StudioOpenDialog.
 */
type StudioOpenDialogFile = {
	Name: string
};

/**
 * Schema of an element in the command documentation file.
 */
type CommandDoc = {
    label: string;
    alias: string[];
    documentation: string[];
    link: string;
    insertText?: string;
};

/**
 * Structure of request body for HTTP POST /action/query.
 */
type QueryData = {
	query: string,
	parameters: any[]
};

/**
 * Context of the method/routine that a macro is in.
 */
type MacroContext = {
	docname: string,
	superclasses: string[],
	includes: string[],
	includegenerators: string[],
	imports: string[],
	mode: string,
	cursor?: string // Only needed for /action/getmacrolist
};

/**
 * Result of a call to parseDimLime().
 */
type DimResult = {
	founddim: boolean,
	class: string
};

/**
 * Class that a member is in and how that class was determined.
 */
type ClassMemberContext = {
	baseclass: string,
	context: "instance" | "class" | "system" | ""
};

/**
 * Schema of an element in a UDL keyword documentation file.
 */
type KeywordDoc = {
	name: string,
	description: string,
	type?: string,
	constraint?: string | string[]
};

/**
 * IRIS server information received from an 'intersystems/server/resolveFromUri' request.
 */
export type ServerSpec = {
	scheme: string,
	host: string,
	port: number,
	pathPrefix: string,
	apiVersion: number,
	namespace: string,
	username: string,
	serverName: string,
	password: string,
	active: boolean
};

/**
 * Context of the method/routine that a macro is in, including extra information needed for macro expansion.
 */
type SignatureHelpMacroContext = {
	docname: string,
	macroname: string,
	superclasses: string[],
	includes: string[],
	includegenerators: string[],
	imports: string[],
	mode: string,
	arguments: string
};

/**
 * The content of the last SignatureHelp documentation sent and the type of signature that it applies to.
 */
type SignatureHelpDocCache = {
	doc: MarkupContent,
	type: "macro" | "method"
};

/**
 * The number of possible classes that this short class name could map to.
 */
type PossibleClasses = {
	num: number
};

/**
 * TextDocument URI's mapped to the tokenized representation of the document.
 */
let parsedDocuments: Map<string, compressedline[]> = new Map();

/**
 * Node IPC connection between the server and client.
 */
let connection = createConnection(ProposedFeatures.all);

/**
 * TextDocument manager.
 */
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

/**
 * Cache of the language server configuration parameters received from the client.
 */
let languageServerSettings: LanguageServerConfiguration | undefined;

/**
 * Cache of the MacroContext computed for a completion request that is used by the corresponding completion resolve requests.
 */
var macroCompletionCache: MacroContext;

/**
 * TextDocument URI's mapped to the document's semantic tokens builder.
 */
let tokenBuilders: Map<string, ProposedFeatures.SemanticTokensBuilder> = new Map();

/**
 * ServerSpec's mapped to the XML assist schema cache for that server.
 */
let schemaCaches: Map<ServerSpec, XMLAssist.SchemaCache> = new Map();

/**
 * TextDocument URI's mapped to the InterSystems server that the document belongs to.
 */
let serverSpecs: Map<string, ServerSpec> = new Map();

/**
 * Cache of the macro context info required to do a macro expansion when the selected parameter changes.
 */
var signatureHelpMacroCache: SignatureHelpMacroContext;

/**
 * Cache of the documentation content sent for the last triggered SignatureHelp.
 */
var signatureHelpDocumentationCache: SignatureHelpDocCache | undefined = undefined;

/**
 * The start position of the active SignatureHelp.
 */
var signatureHelpStartPosition: Position | undefined = undefined;

/**
 * Cookie jar for REST requests to InterSystems servers.
 */
let cookieJar: tough.CookieJar = new tough.CookieJar();

/**
 * Compute diagnositcs for this document and sent them to the client.
 * 
 * @param doc The TextDocument to compute diagnostic for.
 */
async function computeDiagnostics(doc: TextDocument) {
	// Get the parsed document
	const parsed = parsedDocuments.get(doc.uri);
	if (parsed !== undefined) {
		const server: ServerSpec = await getServerSpec(doc.uri);
		const settings = await getLanguageServerSettings();
		let diagnostics: Diagnostic[] = [];

		var files: StudioOpenDialogFile[] = [];
		var querydata: QueryData;
		if (settings.diagnostics.routines || settings.diagnostics.classes) {
			if (settings.diagnostics.routines && settings.diagnostics.classes) {
				// Get all classes and routines
				querydata = {
					query: "SELECT {fn CONCAT(Name,'.cls')} AS Name FROM %Dictionary.ClassDefinition UNION ALL SELECT Name FROM %Library.RoutineMgr_StudioOpenDialog(?,?,?,?,?,?,?)",
					parameters: ["*.mac,*.inc,*.int",1,1,1,1,0,0]
				};
			}
			else if (!settings.diagnostics.routines && settings.diagnostics.classes) {
				// Get all classes
				querydata = {
					query: "SELECT {fn CONCAT(Name,'.cls')} AS Name FROM %Dictionary.ClassDefinition",
					parameters: []
				};
			}
			else {
				// Get all routines
				querydata = {
					query: "SELECT Name FROM %Library.RoutineMgr_StudioOpenDialog(?,?,?,?,?,?,?)",
					parameters: ["*.mac,*.inc,*.int",1,1,1,1,0,0]
				};
			}
			const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
			if (respdata !== undefined && "content" in respdata.data.result && respdata.data.result.content !== undefined) {
				files = respdata.data.result.content;
			}
		}
		
		const firstlineisroutine: boolean =

			// The document is not empty and the first line is not empty
			parsed.length > 0 && parsed[0].length > 0 &&

			// The first character was parsed as a COS command
			parsed[0][0].l == ld.cos_langindex && parsed[0][0].s == ld.cos_command_attrindex &&

			// The document begins with "ROUTINE" (case-insensitive)
			doc.getText(Range.create(Position.create(0,parsed[0][0].p),Position.create(0,parsed[0][0].p+parsed[0][0].c))).toLowerCase() === "routine";

		const startline: number = (firstlineisroutine) ? 1 : 0;

		// Loop through the parsed document to find errors and warnings
		for (let i = startline; i < parsed.length; i++) {

			// Loop through the line's tokens
			for (let j = 0; j < parsed[i].length; j++) {
				const symbolstart: number = parsed[i][j].p;
				const symbolend: number =  parsed[i][j].p + parsed[i][j].c;

				if (j > 0 && parsed[i][j].l === parsed[i][j-1].l && parsed[i][j].s === parsed[i][j-1].s) {
					// If this token is the same as the last, skip it
					continue;
				}
				if (parsed[i][j].s === ld.error_attrindex) {
					// This is an error token
					let diagnostic: Diagnostic = {
						severity: DiagnosticSeverity.Error,
						range: {
							start: Position.create(i,symbolstart),
							end: Position.create(i,symbolend)
						},
						message: "Syntax error.",
						source: 'InterSystems Language Server'
					};
					diagnostics.push(diagnostic);
				}
				else if (parsed[i][j].l == ld.cos_langindex && parsed[i][j].s === ld.cos_otw_attrindex) {
					// This is an OptionTrackWarning (unset local variable)
					const varrange = Range.create(Position.create(i,symbolstart),Position.create(i,symbolend));
					let diagnostic: Diagnostic = {
						severity: DiagnosticSeverity.Warning,
						range: varrange,
						message: "Local variable '"+doc.getText(varrange)+"' is undefined.",
						source: 'InterSystems Language Server'
					};
					diagnostics.push(diagnostic);
				}
				else if (
					j === 0 && parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_keyword_attrindex &&
					doc.getText(Range.create(Position.create(i,0),Position.create(i,9))).toLowerCase() === "parameter" &&
					settings.diagnostics.parameters
				) {
					if (
						parsed[i].length > 3 &&
						parsed[i][2].l == ld.cls_langindex && parsed[i][2].s === ld.cls_keyword_attrindex &&
						doc.getText(Range.create(Position.create(i,parsed[i][2].p),Position.create(i,parsed[i][2].p+parsed[i][2].c))).toLowerCase() === "as"
					) {
						const tokenrange = Range.create(Position.create(i,parsed[i][3].p),Position.create(i,parsed[i][3].p+parsed[i][3].c));
						const tokentext = doc.getText(tokenrange).toUpperCase();
						const thistypedoc = parameterTypes.find((typedoc) => typedoc.name === tokentext);
						if (thistypedoc === undefined) {
							let diagnostic: Diagnostic = {
								severity: DiagnosticSeverity.Warning,
								range: tokenrange,
								message: "Invalid parameter type.",
								source: 'InterSystems Language Server'
							};
							diagnostics.push(diagnostic);
						}
						else {
							if (parsed[i].length > 5) {
								const valrange = Range.create(Position.create(i,parsed[i][parsed[i].length-2].p),Position.create(i,parsed[i][parsed[i].length-2].p+parsed[i][parsed[i].length-2].c));
								const valtext = doc.getText(valrange);
								if (
									(thistypedoc.name === "STRING" && (parsed[i][parsed[i].length-2].l !== ld.cls_langindex || parsed[i][parsed[i].length-2].s !== ld.cls_str_attrindex)) ||
									(thistypedoc.name === "COSEXPRESSION" && (parsed[i][parsed[i].length-2].l !== ld.cls_langindex || parsed[i][parsed[i].length-2].s !== ld.cls_str_attrindex)) ||
									(thistypedoc.name === "CLASSNAME" && (parsed[i][parsed[i].length-2].l !== ld.cls_langindex || parsed[i][parsed[i].length-2].s !== ld.cls_str_attrindex)) ||
									(thistypedoc.name === "INTEGER" && (parsed[i][parsed[i].length-2].l !== ld.cls_langindex || parsed[i][parsed[i].length-2].s !== ld.cls_num_attrindex)) ||
									(thistypedoc.name === "BOOLEAN" && (parsed[i][parsed[i].length-2].l !== ld.cls_langindex || parsed[i][parsed[i].length-2].s !== ld.cls_num_attrindex || (valtext !== "1" && valtext !== "0")))
								) {
									let diagnostic: Diagnostic = {
										severity: DiagnosticSeverity.Warning,
										range: valrange,
										message: "Parameter value and type do not match.",
										source: 'InterSystems Language Server'
									};
									diagnostics.push(diagnostic);
								}
								else if (thistypedoc.name === "CLASSNAME" && settings.diagnostics.classes) {
									// Validate the class name in the string
									var classname: string = valtext.slice(1,-1);
									if (classname.indexOf("%") === 0 && classname.indexOf(".") === -1) {
										classname = "%Library.".concat(classname.slice(1));
									}
									// Check if class exists
									const filtered = files.filter(file => file.Name === classname+".cls");
									if (filtered.length !== 1) {
										let diagnostic: Diagnostic = {
											severity: DiagnosticSeverity.Warning,
											range: valrange,
											message: "Class '"+classname+"' does not exist.",
											source: 'InterSystems Language Server'
										};
										diagnostics.push(diagnostic);
									}
								}
							}
						}
					}
					break;
				}
				else if (j === 0 && parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_keyword_attrindex && doc.getText(Range.create(Position.create(i,0),Position.create(i,6))).toLowerCase() === "import") {
					// Don't validate import packages
					break;
				}
				else if (files.length > 0) {
					// Check that all classes, routines and include files in this document exist in the database
					if (
						((parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_clsname_attrindex) ||
						(parsed[i][j].l == ld.cos_langindex && parsed[i][j].s == ld.cos_clsname_attrindex)) &&
						settings.diagnostics.classes
					) {
						// This is a class name

						// Don't validate a class name that follows the "Class" keyword
						if (j !== 0 && parsed[i][j-1].l == ld.cls_langindex && parsed[i][j-1].s == ld.cls_keyword_attrindex) {
							// The previous token is a UDL keyword
							const prevkeytext = doc.getText(Range.create(
								Position.create(i,parsed[i][j-1].p),
								Position.create(i,parsed[i][j-1].p+parsed[i][j-1].c)
							)).toLowerCase();
							if (prevkeytext === "class") {
								continue;
							}
						}

						// Get the full text of the selection
						let wordrange = findFullRange(i,parsed,j,symbolstart,symbolend);
						let word = doc.getText(wordrange);
						if (word.charAt(0) === ".") {
							// This might be $SYSTEM.ClassName
							const prevseven = doc.getText(Range.create(
								Position.create(i,wordrange.start.character-7),
								Position.create(i,wordrange.start.character)
							));
							if (prevseven.toUpperCase() !== "$SYSTEM") {
								// This classname is invalid
								let diagnostic: Diagnostic = {
									severity: DiagnosticSeverity.Error,
									range: wordrange,
									message: "Invalid class name.",
									source: 'InterSystems Language Server'
								};
								diagnostics.push(diagnostic);
							}
							continue;
						}
						if (word.charAt(0) === '"') {
							// This classname is delimited with ", so strip them
							word = word.slice(1,-1);
						}

						// Normalize the class name if there are imports
						var possiblecls = {num: 0};
						let normalizedname = await normalizeClassname(doc,parsed,word,server,i,files,possiblecls);
						
						if (normalizedname === "" && possiblecls.num > 0) {
							// The class couldn't be resolved with the imports
							let diagnostic: Diagnostic = {
								severity: DiagnosticSeverity.Error,
								range: wordrange,
								message: "Class name '"+word+"' is ambiguous.",
								source: 'InterSystems Language Server'
							};
							diagnostics.push(diagnostic);
						}
						else {
							// Check if class exists
							const filtered = files.filter(file => file.Name === normalizedname+".cls");
							if (filtered.length !== 1) {
								let diagnostic: Diagnostic = {
									severity: DiagnosticSeverity.Error,
									range: wordrange,
									message: "Class '"+word+"' does not exist.",
									source: 'InterSystems Language Server'
								};
								diagnostics.push(diagnostic);
							}
						}
					}
					else if (
						((parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_rtnname_attrindex) ||
						(parsed[i][j].l == ld.cos_langindex && parsed[i][j].s == ld.cos_rtnname_attrindex)) &&
						settings.diagnostics.routines
					) {
						// This is a routine name

						// Get the full text of the selection
						let wordrange = findFullRange(i,parsed,j,symbolstart,symbolend);
						let word = doc.getText(wordrange);

						// Determine if this is an include file
						var isinc = false;
						if (parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_rtnname_attrindex) {
							isinc = true;
						}
						else {
							if (
								parsed[i][j-1].l == ld.cos_langindex &&
								parsed[i][j-1].s == ld.cos_ppc_attrindex &&
								doc.getText(
									Range.create(
										Position.create(i,parsed[i][j-1].p),
										Position.create(i,parsed[i][j-1].p+parsed[i][j-1].c)
									)
								).toLowerCase() === "include"
							) {
								isinc = true;
							}
						}

						// Check if the routine exists
						if (isinc) {
							if (!files.some(file => file.Name === (word+".inc"))) {
								let diagnostic: Diagnostic = {
									severity: DiagnosticSeverity.Error,
									range: wordrange,
									message: "Include file '"+word+"' does not exist.",
									source: 'InterSystems Language Server'
								};
								diagnostics.push(diagnostic);
							}
						}
						else {
							const macexists = files.some(file => file.Name === (word+".mac"));
							const intexists = files.some(file => file.Name === (word+".int"));
							if (!macexists && !intexists) {
								let diagnostic: Diagnostic = {
									severity: DiagnosticSeverity.Error,
									range: wordrange,
									message: "Routine '"+word+"' does not exist.",
									source: 'InterSystems Language Server'
								};
								diagnostics.push(diagnostic);
							}
						}
					}
				}
			}
		}

		// Send computed diagnostics to the client
		connection.sendDiagnostics({uri: doc.uri, diagnostics});
	}
};

/**
 * Determine if the command at position (line,token) in doc is a "HALT" or "HANG".
 * 
 * @param doc The TextDocument that the command is in.
 * @param parsed The tokenized representation of doc.
 * @param line The line that the command is in.
 * @param token The offset of the command in the line.
 */
function haltOrHang(doc: TextDocument, parsed: compressedline[], line: number, token: number): CommandDoc | undefined {
	if (parsed[line][token+1] === undefined) {
		// This is a "halt"
		return commands.find((el) => el.label === "HALT");
	}
	else {
		var nexttokentext = doc.getText(Range.create(Position.create(line,parsed[line][token+1].p),Position.create(line,parsed[line][token+1].p + parsed[line][token+1].c)));
		if (nexttokentext === ":") {
			// There's a postconditional
			nexttokentext = doc.getText(Range.create(Position.create(line,parsed[line][token+2].p),Position.create(line,parsed[line][token+2].p + parsed[line][token+2].c)));
			const restofline = doc.getText(Range.create(Position.create(line,parsed[line][token+2].p + parsed[line][token+2].c),Position.create(line+1,0))).trim();
			if (nexttokentext === "(") {
				var opencount = 1;
				var closecount = 0;
				var lastclose = 0;
				for (let i = 0; i < restofline.length; i++) {
					if (restofline.charAt(i) === "(") {
						opencount++;
					}
					else if (restofline.charAt(i) === ")") {
						closecount++;
					}
					if (opencount === closecount) {
						lastclose= i;
						break;
					}
				}
				if (lastclose === restofline.length-1) {
					// This is a "halt"
					return commands.find((el) => el.label === "HALT");
				}
				else {
					// This is a "hang"
					return commands.find((el) => el.label === "HANG");
				}
			}
			else {
				const restoflinearr = restofline.split(" ");
				if (restoflinearr.length === 1) {
					// This is a "halt"
					return commands.find((el) => el.label === "HALT");
				}
				else {
					// This is a "hang"
					return commands.find((el) => el.label === "HANG");
				}
			}
		}
		else {
			// This is a "hang"
			return commands.find((el) => el.label === "HANG");
		}
	}
};

/**
 * Get the configuration parameters from the cache or the client if the cache is empty.
 */
async function getLanguageServerSettings(): Promise<LanguageServerConfiguration> {
	if (languageServerSettings !== undefined) {
		return languageServerSettings;
	}
	const newsettings = await connection.workspace.getConfiguration("intersystems.language-server");
	languageServerSettings = newsettings;
	return newsettings;
};

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
	else if (parsed[line][token].l == ld.cos_langindex && (parsed[line][token].s == ld.cos_zf_attrindex || parsed[line][token].s == ld.cos_zv_attrindex)) {
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

/**
 * Build the list of all full class names for code completion, with import resolution.
 * 
 * @param doc The TextDocument that we're providing completion suggestions in.
 * @param parsed The tokenized representation of doc.
 * @param server The server that doc is associated with.
 * @param line The line of doc that we're in.
 */
async function completionFullClassName(doc: TextDocument, parsed: compressedline[], server: ServerSpec, line: number): Promise<CompletionItem[]> {
	var result: CompletionItem[] = [];

	// Get the list of imports for resolution
	const imports = getImports(doc,parsed,line);

	// Get all classes
	const querydata = {
		query: "SELECT Name FROM %Library.RoutineMgr_StudioOpenDialog(?,?,?,?,?,?,?)",
		parameters: ["*.cls",1,1,1,1,0,0]
	};
	const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
	if (respdata !== undefined && respdata.data.result.content.length > 0) {
		for (let clsobj of respdata.data.result.content) {
			var displayname: string = clsobj.Name.slice(0,-4);
			if (imports.length > 0) {
				// Resolve import
				for (let imp of imports) {
					if (displayname.indexOf(imp) === 0 && displayname.slice(imp.length+1).indexOf(".") === -1) {
						displayname = displayname.slice(imp.length+1);
						break;
					}
				}
				if (displayname.slice(0,9) === "%Library.") {
					// Use short form for %Library classes
					displayname = "%" + displayname.slice(9);
				}
				result.push({
					label: displayname,
					kind: CompletionItemKind.Class,
					data: ["class",clsobj.Name,doc.uri]
				});
			}
			else {
				if (displayname.slice(0,9) === "%Library.") {
					// Use short form for %Library classes
					displayname = "%" + displayname.slice(9);
				}
				result.push({
					label: displayname,
					kind: CompletionItemKind.Class,
					data: ["class",clsobj.Name,doc.uri]
				});
			}
		}
	}
	return result;
};

/**
 * Build the list of all packages for code completion.
 * 
 * @param server The server that this document is associated with.
 */
async function completionPackage(server: ServerSpec): Promise<CompletionItem[]> {
	var result: CompletionItem[] = [];

	// Get all the packages
	const querydata = {
		query: "SELECT DISTINCT $PIECE(Name,'.',1,$LENGTH(Name,'.')-2) AS Package FROM %Library.RoutineMgr_StudioOpenDialog(?,?,?,?,?,?,?)",
		parameters: ["*.cls",1,1,1,1,0,0]
	};
	const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
	if (respdata !== undefined && respdata.data.result.content.length > 0) {
		for (let packobj of respdata.data.result.content) {
			result.push({
				label: packobj.Package,
				kind: CompletionItemKind.Module,
				data: "package"
			});
		}
	}
	return result;
};

/**
 * Build the list of all include files for code completion.
 * 
 * @param server The server that this document is associated with.
 */
async function completionInclude(server: ServerSpec): Promise<CompletionItem[]> {
	var result: CompletionItem[] = [];

	// Get all inc files
	const querydata = {
		query: "SELECT Name FROM %Library.RoutineMgr_StudioOpenDialog(?,?,?,?,?,?,?)",
		parameters: ["*.inc",1,1,1,1,0,0]
	};
	const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
	if (respdata !== undefined && respdata.data.result.content.length > 0) {
		for (let incobj of respdata.data.result.content) {
			result.push({
				label: incobj.Name.slice(0,-4),
				kind: CompletionItemKind.File,
				data: "inc"
			});
		}
	}
	return result;
};

/**
 * Find the full range of this word.
 * 
 * @param line The line that the word is in.
 * @param parsed The tokenized representation of the document.
 * @param lineidx The position of the token in the line.
 * @param symbolstart The start of the selected token.
 * @param symbolend The end of the selected token.
 */
function findFullRange(line: number, parsed: compressedline[], lineidx: number, symbolstart: number, symbolend: number): Range {
	var rangestart: number = symbolstart;
	var rangeend: number = symbolend;
	// Scan backwards on the line to see where the selection starts
	var newidx = lineidx;
	while (true) {
		newidx--;
		if ((newidx == -1) || (parsed[line][newidx].l != parsed[line][lineidx].l) || 
		(parsed[line][newidx].s != parsed[line][lineidx].s)) {
			break;
		}
		rangestart = parsed[line][newidx].p;
	}
	// Scan forwards on the line to see where the selection ends
	var newidx = lineidx;
	while (true) {
		newidx++;
		if ((parsed[line][newidx] === undefined) ||
		(parsed[line][newidx].l != parsed[line][lineidx].l) || 
		(parsed[line][newidx].s != parsed[line][lineidx].s)) {
			break;
		}
		rangeend = parsed[line][newidx].p + parsed[line][newidx].c;
	}
	return Range.create(Position.create(line,rangestart),Position.create(line,rangeend));
};

/**
 * Get the context of the method/routine that a macro is in.
 * 
 * @param doc The TextDocument that the macro is in.
 * @param parsed The tokenized representation of doc.
 * @param line The line that the macro is in.
 */
function getMacroContext(doc: TextDocument, parsed: compressedline[], line: number): MacroContext {
	var result: MacroContext = {
		docname: "",
		superclasses: [],
		includes: [],
		includegenerators: [],
		imports: [],
		mode: ""
	};
	if (doc.languageId == "objectscript-class") {
		// This is a class
		for (let i = 0; i < parsed.length; i++) {
			if (parsed[i].length === 0) {
				continue;
			}
			else if (parsed[i][0].l == ld.cls_langindex && parsed[i][0].s == ld.cls_keyword_attrindex) {
				// This line starts with a UDL keyword
	
				var keyword = doc.getText(Range.create(Position.create(i,parsed[i][0].p),Position.create(i,parsed[i][0].p+parsed[i][0].c)));
				if (keyword.toLowerCase() === "class") {
					var seenextends = false;
					for (let j = 1; j < parsed[i].length; j++) {
						if (parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_clsname_attrindex) {
							if (seenextends) {
								// This is a piece of a subclass
								if (result.superclasses.length === 0) {
									result.superclasses.push("");
								}
								result.superclasses[result.superclasses.length-1] = result.superclasses[result.superclasses.length-1].concat(
									doc.getText(Range.create(Position.create(i,parsed[i][j].p),Position.create(i,parsed[i][j].p+parsed[i][j].c)))
								);
							}
							else {
								result.docname = result.docname.concat(doc.getText(Range.create(Position.create(i,parsed[i][j].p),Position.create(i,parsed[i][j].p+parsed[i][j].c))));
							}
						}
						else if (parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_keyword_attrindex) {
							// The only keyword we can see is 'Extends'
							seenextends = true;
						}
						else {
							// This is a delimiter
							if (j === parsed[i].length - 1) {
								// This is the trailing ")"
								break;
							}
							else {
								if (parsed[i][j+1].l == ld.cls_langindex && parsed[i][j+1].s == ld.cls_clsname_attrindex) {
									// This is a "," or the opening "("
									result.superclasses.push("");
								}
								else {
									// This is the trailing ")"
									break;
								}
							}
						}
					}
					break;
				}
				else if (keyword.toLowerCase() === "include") {
					var codes = doc.getText(Range.create(Position.create(i,parsed[i][1].p),Position.create(i,parsed[i][parsed[i].length-1].p+parsed[i][parsed[i].length-1].c)));
					result.includes = codes.replace("(","").replace(")","").replace(/\s+/g,"").split(",");
				}
				else if (keyword.toLowerCase() === "includegenerator") {
					var codes = doc.getText(Range.create(Position.create(i,parsed[i][1].p),Position.create(i,parsed[i][parsed[i].length-1].p+parsed[i][parsed[i].length-1].c)));
					result.includegenerators = codes.replace("(","").replace(")","").replace(/\s+/g,"").split(",");
				}
				else if (keyword.toLowerCase() === "import") {
					var codes = doc.getText(Range.create(Position.create(i,parsed[i][1].p),Position.create(i,parsed[i][parsed[i].length-1].p+parsed[i][parsed[i].length-1].c)));
					result.imports = codes.replace("(","").replace(")","").replace(/\s+/g,"").split(",");
				}
			}
		}
		for (let k = line; k >= 0; k--) {
			if (parsed[k].length === 0) {
				continue;
			}
			if (parsed[k][0].l == ld.cls_langindex && parsed[k][0].s == ld.cls_keyword_attrindex) {
				// This is the definition for the method that the macro is in
				if (
					parsed[k][parsed[k].length-1].l == ld.cls_langindex && parsed[k][parsed[k].length-1].s == ld.cls_delim_attrindex &&
					doc.getText(Range.create(
						Position.create(k,parsed[k][parsed[k].length-1].p),
						Position.create(k,parsed[k][parsed[k].length-1].p+parsed[k][parsed[k].length-1].c)
					)) === "("
				) {
					// This is a multi-line method definition
					for (let mline = k+1; mline < parsed.length; mline++) {
						if (
							parsed[mline][parsed[mline].length-1].l == ld.cls_langindex && parsed[mline][parsed[mline].length-1].s == ld.cls_delim_attrindex &&
							doc.getText(Range.create(
								Position.create(mline,parsed[mline][parsed[mline].length-1].p),
								Position.create(mline,parsed[mline][parsed[mline].length-1].p+parsed[mline][parsed[mline].length-1].c)
							)) !== ","
						) {
							// We've passed the argument lines so look for the CodeMode keyword on this line
							for (let l = 1; l < parsed[mline].length; l++) {
								if (parsed[mline][l].l == ld.cls_langindex && parsed[mline][l].s == ld.cls_keyword_attrindex) {
									const kw = doc.getText(Range.create(Position.create(mline,parsed[mline][l].p),Position.create(mline,parsed[mline][l].p+parsed[mline][l].c)));
									if (kw.toLowerCase() === "codemode") {
										// The CodeMode keyword is set
										const kwval = doc.getText(Range.create(Position.create(mline,parsed[mline][l+2].p),Position.create(mline,parsed[mline][l+2].p+parsed[mline][l+2].c)));
										if (kwval.toLowerCase() === "generator" || kwval.toLowerCase() === "objectgenerator") {
											result.mode = "generator";
										}
										break;
									}
								}
							}
							break;
						}
					}
				}
				else {
					// This is a single-line method definition so look for the CodeMode keyword on this line
					for (let l = 1; l < parsed[k].length; l++) {
						if (parsed[k][l].l == ld.cls_langindex && parsed[k][l].s == ld.cls_keyword_attrindex) {
							const kw = doc.getText(Range.create(Position.create(k,parsed[k][l].p),Position.create(k,parsed[k][l].p+parsed[k][l].c)));
							if (kw.toLowerCase() === "codemode") {
								// The CodeMode keyword is set
								const kwval = doc.getText(Range.create(Position.create(k,parsed[k][l+2].p),Position.create(k,parsed[k][l+2].p+parsed[k][l+2].c)));
								if (kwval.toLowerCase() === "generator" || kwval.toLowerCase() === "objectgenerator") {
									result.mode = "generator";
								}
								break;
							}
						}
					}
				}
				break;
			}
		}
		result.docname = result.docname.concat(".cls");
	}
	else {
		// This is a routine
		var foundinc = false;
		for (let i = 0; i < parsed.length; i++) {
			if (i === 0) {
				// Get the routine name from the ROUTINE header line
				const fullline = doc.getText(Range.create(Position.create(0,0),Position.create(0,parsed[0][parsed[0].length-1].p+parsed[0][parsed[0].length-1].c)));
				result.docname = fullline.split(" ")[1] + ".mac";
			}
			else if (parsed[i].length === 0) {
				continue;
			}
			else if (parsed[i][0].l == ld.cos_langindex && parsed[i][0].s == ld.cos_ppc_attrindex) {
				// This is a preprocessor command
				const command = doc.getText(Range.create(Position.create(i,parsed[i][0].p),Position.create(i,parsed[i][1].p+parsed[i][1].c)));
				if (command.toLowerCase() === "#include") {
					foundinc = true;
					result.includes.push(doc.getText(Range.create(Position.create(i,parsed[i][2].p),Position.create(i,parsed[i][2].p+parsed[i][2].c))));
				} 
				else if (command.toLowerCase() !== "#include" && foundinc) {
					break;
				}
			}
			else {
				if (foundinc) {
					break;
				}
			}
		}
	}

	return result;
};

/**
 * Parse a line of ObjectScript code that starts with #Dim and look to see if it contains selector.
 * 
 * @param doc The TextDocument that the line is in.
 * @param parsed The tokenized representation of doc.
 * @param line The line to parse.
 * @param selector The variable that we're looking for.
 */
function parseDimLine(doc: TextDocument, parsed: compressedline[], line: number, selector: string): DimResult {
	var result: DimResult = {
		founddim: false,
		class: ""
	};
	for (let k = 2; k < parsed[line].length; k++) {
		if (parsed[line][k].s === ld.cos_localdec_attrindex) {
			// This is a declared local variable
			var localvar = doc.getText(Range.create(Position.create(line,parsed[line][k].p),Position.create(line,parsed[line][k].p+parsed[line][k].c)));
			if (localvar === selector) {
				// This is the #Dim for the selector
				result.founddim = true;
			}
		}
		else if (parsed[line][k].s === ld.cos_command_attrindex) {
			// This is the "As" keyword
			if (result.founddim) {
				const nextword = doc.getText(Range.create(Position.create(line,parsed[line][k+1].p),Position.create(line,parsed[line][k+1].p+parsed[line][k+1].c)));
				if (parsed[line][k+1].s === ld.cos_clsname_attrindex) {
					result.class = doc.getText(findFullRange(line,parsed,k+1,parsed[line][k+1].p,parsed[line][k+1].p+parsed[line][k+1].c));
				}
				else if (nextword.toLowerCase() === "list") {
					result.class = "%Collection.ListOfObj";
				}
				else if (nextword.toLowerCase() === "array") {
					result.class = "%Collection.ArrayOfObj";
				}
			}
			break;
		}
		else if (parsed[line][k].s === ld.cos_oper_attrindex) {
			// This is the "=" operator
			break;
		}
	}
	return result;
};

/**
 * Get the list of all imported packages at this line of a document.
 * 
 * @param doc The TextDocument of the class to examine.
 * @param parsed The tokenized representation of doc.
 * @param line The line in the document that we need to resolve imports at.
 */
function getImports(doc: TextDocument, parsed: compressedline[], line: number): string[] {
	var result: string[] = [];
	if (doc.languageId === "objectscript-class") {
		// Look for the "Import" keyword
		for (let i = 0; i < parsed.length; i++) {
			if (parsed[i].length === 0) {
				continue;
			}
			else if (parsed[i][0].l == ld.cls_langindex && parsed[i][0].s == ld.cls_keyword_attrindex) {
				// This line starts with a UDL keyword
	
				var keyword = doc.getText(Range.create(Position.create(i,parsed[i][0].p),Position.create(i,parsed[i][0].p+parsed[i][0].c))).toLowerCase();
				if (keyword === "import") {
					var codes = doc.getText(Range.create(Position.create(i,parsed[i][1].p),Position.create(i,parsed[i][parsed[i].length-1].p+parsed[i][parsed[i].length-1].c)));
					result = codes.replace("(","").replace(")","").replace(/\s+/g,"").split(",");
				}
				else if (keyword === "class") {
					// Add the current package if it's not explicitly imported
					const classname = doc.getText(findFullRange(i,parsed,1,parsed[i][1].p,parsed[i][1].p+parsed[i][1].c));
					if (!result.includes(classname.slice(0,classname.lastIndexOf(".")))) {
						result.push(classname.slice(0,classname.lastIndexOf(".")));
					}
					break;
				}
			}
		}
		// Look for #import's in the method containing this line
		for (let i = line; i >= 0; i--) {
			if (parsed[i].length === 0) {
				continue;
			}
			if (parsed[i][0].l == ld.cls_langindex && parsed[i][0].s == ld.cls_keyword_attrindex) {
				// This is the definition for the method that the line is in
				break;
			}
			if (
				parsed[i].length > 2 &&
				(parsed[i][0].l == ld.cos_langindex && parsed[i][0].s == ld.cos_ppc_attrindex) &&
				(parsed[i][1].l == ld.cos_langindex && parsed[i][1].s == ld.cos_ppc_attrindex) &&
				(doc.getText(Range.create(Position.create(i,parsed[i][0].p),Position.create(i,parsed[i][1].p+parsed[i][1].c))).toLowerCase() === "#import")
			) {
				// This is a #import
				const restofline = doc.getText(Range.create(Position.create(i,parsed[i][2].p),Position.create(i+1,0)));
				const packages = restofline.match(/(%?[a-z]+(\.a-z)*)/gi);
				if (packages !== null) {
					for (let p of packages) {
						if (!result.includes(p)) {
							result.push(p);
						}
					}
				}
			}
		}
	}
	else if (doc.languageId === "objectscript" || doc.languageId === "objectscript-csp") {
		// Look for #import's above this line
		for (let i = line; i >= 0; i--) {
			if (
				parsed[i].length > 2 &&
				(parsed[i][0].l == ld.cos_langindex && parsed[i][0].s == ld.cos_ppc_attrindex) &&
				(parsed[i][1].l == ld.cos_langindex && parsed[i][1].s == ld.cos_ppc_attrindex) &&
				(doc.getText(Range.create(Position.create(i,parsed[i][0].p),Position.create(i,parsed[i][1].p+parsed[i][1].c))).toLowerCase() === "#import")
			) {
				// This is a #import
				const restofline = doc.getText(Range.create(Position.create(i,parsed[i][2].p),Position.create(i+1,0)));
				const packages = restofline.match(/(%?[a-z]+(\.a-z)*)/gi);
				if (packages !== null) {
					for (let p of packages) {
						if (!result.includes(p)) {
							result.push(p);
						}
					}
				}
			}
		}
		if (result.length === 0) {
			// User package is only auto-imported if there are no other imports
			result.push("User");
		}
	}
	return result;
};

/**
 * Normalize a class name using the import statements at the top of the class, if applicable.
 * Optionally pass in an array of all the files in that database to avoid making an extra REST request and
 * an object to output the number full class names that this short class name may resolve to.
 * The optional arguments are only used by computeDiagnostics().
 * 
 * @param doc The TextDocument that the class name is in.
 * @param parsed The tokenized representation of doc.
 * @param clsname The class name to normalize.
 * @param server The server that doc is associated with.
 * @param line The line of doc that we're in.
 * @param allfiles An array of all files in a database.
 * @param possiblecls The number of possible classes that this short class name could map to.
 */
async function normalizeClassname(
	doc: TextDocument, parsed: compressedline[], clsname: string, server: ServerSpec, line: number, allfiles?: StudioOpenDialogFile[], possiblecls?: PossibleClasses
): Promise<string> {
	var result = "";

	if (clsname === "") {
		// Can't normalize an empty string
		return result;
	}
	if (clsname.indexOf("%") === 0) {
		// Any class name that starts with "%" is fully resolved
		if (clsname.indexOf(".") === -1) {
			// This is the special case where "%Library" is shortened to "%"
			return "%Library.".concat(clsname.slice(1));
		}
		else {
			return clsname;
		}
	}
	if (clsname.indexOf(".") !== -1) {
		// Any class name that contains a "." is fully resolved
		return clsname;
	}
	const imports = getImports(doc,parsed,line);
	if (imports.length > 0) {
		if (allfiles === undefined) {
			// Get all potential fully qualified classnames
			const querydata = {
				query: "SELECT Name FROM %Dictionary.ClassDefinition WHERE $PIECE(Name,'.',$LENGTH(Name,'.')) = ?",
				parameters: [clsname]
			};
			const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
			if (respdata !== undefined && "content" in respdata.data.result) {
				if (respdata.data.result.content.length === 1) {
					// We got back exactly one class

					const clsobj = respdata.data.result.content[0];
					if (clsobj.Name === clsname) {
						// The one class we got back is exactly the one we were looking for
						result = clsname; 
					}
					else {
						// The class isn't an exact match. Check if any of the imports appear.
						var foundimport = false;
						for (let j = 0; j < imports.length; j++) {
							const numdots = imports[j].replace(/[^\.]/g,"").length;
							if (clsobj.Name.indexOf(imports[j]) === 0 && clsobj.Name.replace(/[^\.]/g,"").length === numdots+1) {
								foundimport = true;
								break;
							}
						}
						if (foundimport) {
							result = clsobj.Name;
						}
					}
				}
				if (respdata.data.result.content.length > 1) {
					// We got data back
					
					const potential = respdata.data.result.content.filter((clsobj) => {
						for (let j = 0; j < imports.length; j++) {
							const numdots = imports[j].replace(/[^\.]/g,"").length;
							if (clsobj.Name.indexOf(imports[j]) === 0 && clsobj.Name.replace(/[^\.]/g,"").length === numdots+1) {
								return true;
							}
						}
						return false;
					});
					if (potential.length === 1) {
						result = potential[0].Name;
					}
				}
			}
		}
		else {
			// This was called from computeDiagnosics(), which already has an array of all the classes in the database
			const filtered = allfiles.filter(file => file.Name.indexOf("."+clsname+".cls") !== -1);
			if (filtered.length === 1) {
				const clsobj = filtered[0];
				if (clsobj.Name.slice(0,-4) === clsname) {
					// The one class we got back is exactly the one we were looking for
					result = clsname; 
				}
				else {
					// The class isn't an exact match. Check if any of the imports appear.
					var foundimport = false;
					for (let j = 0; j < imports.length; j++) {
						const numdots = imports[j].replace(/[^\.]/g,"").length;
						if (clsobj.Name.indexOf(imports[j]) === 0 && clsobj.Name.replace(/[^\.]/g,"").length === numdots+2) {
							foundimport = true;
							break;
						}
					}
					if (foundimport) {
						result = clsobj.Name.slice(0,-4);
					}
				}
			}
			else if (filtered.length > 1) {
				const potential = filtered.filter((clsobj) => {
					for (let j = 0; j < imports.length; j++) {
						const numdots = imports[j].replace(/[^\.]/g,"").length;
						if (clsobj.Name.indexOf(imports[j]) === 0 && clsobj.Name.replace(/[^\.]/g,"").length === numdots+2) {
							return true;
						}
					}
					return false;
				});
				if (potential.length === 1) {
					result = potential[0].Name.slice(0,-4);
				}
				else if (potential.length > 1 && possiblecls !== undefined) {
					possiblecls.num = potential.length;
				}
			}
		}
	}
	else {
		result = clsname;
	}
	return result;
};

/**
 * Determine the normalized name of the class that a member is in and how that class was determined.
 * 
 * @param doc The TextDocument that the class member is in.
 * @param parsed The tokenized representation of doc.
 * @param dot The token number of the ".".
 * @param line The line that the class member is in.
 * @param server The server that doc is associated with.
 */
async function getClassMemberContext(doc: TextDocument, parsed: compressedline[], dot: number, line: number, server: ServerSpec): Promise<ClassMemberContext> {
	var result: ClassMemberContext = {
		baseclass: "",
		context: ""
	};
	
	const dottxt = doc.getText(Range.create(
		Position.create(line,parsed[line][dot].p),
		Position.create(line,parsed[line][dot].p+parsed[line][dot].c)
	));
	if (dottxt === "..") {
		// This is relative dot syntax
			
		// Find the class name
		for (let i = 0; i < parsed.length; i++) {
			if (parsed[i].length === 0) {
				continue;
			}
			else if (parsed[i][0].l == ld.cls_langindex && parsed[i][0].s == ld.cls_keyword_attrindex) {
				// This line starts with a UDL keyword
	
				var keyword = doc.getText(Range.create(Position.create(i,parsed[i][0].p),Position.create(i,parsed[i][0].p+parsed[i][0].c)));
				if (keyword.toLowerCase() === "class") {
					for (let j = 1; j < parsed[i].length; j++) {
						if (parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_clsname_attrindex) {
							result.baseclass = result.baseclass.concat(doc.getText(Range.create(Position.create(i,parsed[i][j].p),Position.create(i,parsed[i][j].p+parsed[i][j].c))));
						}
						else if (parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_keyword_attrindex) {
							// We hit the 'Extends' keyword
							break;
						}
					}
					break;
				}
			}
		}
		// Find the type of this method
		for (let k = line-1; k >= 0; k--) {
			if (parsed[k].length === 0) {
				continue;
			}
			if (parsed[k][0].l == ld.cls_langindex && parsed[k][0].s == ld.cls_keyword_attrindex) {
				// This is the definition for the method that the selector is in
				const keytext = doc.getText(Range.create(Position.create(k,parsed[k][0].p),Position.create(k,parsed[k][0].p+parsed[k][0].c)));
				if (keytext.toLowerCase() === "method") {
					result.context = "instance";
				}
				else {
					result.context = "class";
				}
				break;
			}
		}
	}
	else if (parsed[line][dot-1].l == ld.cos_langindex && parsed[line][dot-1].s == ld.cos_delim_attrindex) {
		// The token before the dot is a delimiter
		const tkntext = doc.getText(Range.create(
			Position.create(line,parsed[line][dot-1].p),
			Position.create(line,parsed[line][dot-1].p+parsed[line][dot-1].c)
		));
		if (tkntext === ")") {
			// This is the end of a ##class

			result = {
				baseclass: await normalizeClassname(doc,parsed,doc.getText(findFullRange(line,parsed,dot-2,parsed[line][dot-2].p,parsed[line][dot-2].p+parsed[line][dot-2].c)),server,line),
				context: "class"
			};
		}
	}
	else if (parsed[line][dot-1].l == ld.cos_langindex && parsed[line][dot-1].s == ld.cos_clsname_attrindex) {
		// The token before the dot is part of a class name

		result = {
			baseclass: "%SYSTEM".concat(doc.getText(findFullRange(line,parsed,dot-1,parsed[line][dot-1].p,parsed[line][dot-1].p+parsed[line][dot-1].c))),
			context: "system"
		};
	}
	else if (parsed[line][dot-1].l == ld.cos_langindex && parsed[line][dot-1].s == ld.cos_param_attrindex) {
		// The token before the dot is a parameter

		const thisparam = doc.getText(findFullRange(line,parsed,dot-1,parsed[line][dot-1].p,parsed[line][dot-1].p+parsed[line][dot-1].c));
		// Scan to the method definition
		for (let j = line; j >= 0; j--) {
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

						const paramcon = await findMethodParameterClass(doc,parsed,mline,server,thisparam);
						if (paramcon !== undefined) {
							// We found the parameter
							result = paramcon;
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
					const paramcon = await findMethodParameterClass(doc,parsed,j,server,thisparam);
					if (paramcon !== undefined) {
						result = paramcon;
					}
				}
				break;
			}
		}
	}
	else if (parsed[line][dot-1].l == ld.cos_langindex && parsed[line][dot-1].s == ld.cos_localdec_attrindex) {
		// The token before the dot is a declared local variable 

		var founddim = false;
		const thisvar = doc.getText(findFullRange(line,parsed,dot-1,parsed[line][dot-1].p,parsed[line][dot-1].p+parsed[line][dot-1].c));
		// Scan to the top of the method to find the #Dim
		for (let j = line; j >= 0; j--) {
			if (parsed[j].length === 0) {
				continue;
			}
			else if (parsed[j][0].l == ld.cls_langindex && parsed[j][0].s == ld.cls_keyword_attrindex) {
				// This is the definition for the method that the variable is in
				break;
			}
			else if (parsed[j][0].l == ld.cos_langindex && parsed[j][0].s == ld.cos_ppc_attrindex) {
				// This is a preprocessor command
				const command = doc.getText(Range.create(Position.create(j,parsed[j][0].p),Position.create(j,parsed[j][1].p+parsed[j][1].c)));
				if (command.toLowerCase() === "#dim") {
					// This is a #Dim
					const dimresult = parseDimLine(doc,parsed,j,thisvar);
					founddim = dimresult.founddim;
					if (founddim) {
						result = {
							baseclass: await normalizeClassname(doc,parsed,dimresult.class,server,j),
							context: "instance"
						};
					}
				}
				if (founddim) {
					break;
				}
			}
		}
	}
	else if (parsed[line][dot-1].l == ld.cos_langindex && parsed[line][dot-1].s == ld.cos_sysv_attrindex) {
		// The token before the dot is a system variable

		const thisvar = doc.getText(findFullRange(line,parsed,dot-1,parsed[line][dot-1].p,parsed[line][dot-1].p+parsed[line][dot-1].c)).toLowerCase();
		if (thisvar === "$this") {
			// Find the class name
			for (let i = 0; i < parsed.length; i++) {
				if (parsed[i].length === 0) {
					continue;
				}
				else if (parsed[i][0].l == ld.cls_langindex && parsed[i][0].s == ld.cls_keyword_attrindex) {
					// This line starts with a UDL keyword
		
					var keyword = doc.getText(Range.create(Position.create(i,parsed[i][0].p),Position.create(i,parsed[i][0].p+parsed[i][0].c)));
					if (keyword.toLowerCase() === "class") {
						for (let j = 1; j < parsed[i].length; j++) {
							if (parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_clsname_attrindex) {
								result.baseclass = result.baseclass.concat(doc.getText(Range.create(Position.create(i,parsed[i][j].p),Position.create(i,parsed[i][j].p+parsed[i][j].c))));
								result.context = "instance";
							}
							else if (parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_keyword_attrindex) {
								// We hit the 'Extends' keyword
								break;
							}
						}
						break;
					}
				}
			}

		}
	}

	return result;
};

/**
 * Make a REST request to an InterSystems server.
 * 
 * @param method The REST method.
 * @param api The version of the Atelier API to use.
 * @param path The path portion of the URL.
 * @param server The server to send the request to.
 * @param data Optional request data. Usually passed for POST requests.
 * @param checksum Optional checksum. Only passed for SASchema requests.
 */
export async function makeRESTRequest(method: "GET"|"POST", api: number, path: string, server: ServerSpec, data?: any, checksum?: string): Promise<AxiosResponse | undefined> {
	if (api > server.apiVersion) {
		// The server doesn't support the Atelier API version required to make this request
		return undefined;
	}

	// Build the URL
	var url = server.scheme + "://" + server.host + ":" + String(server.port);
	if (server.pathPrefix !== "") {
		url = url.concat("/",server.pathPrefix)
	}
	url = encodeURI(url + "/api/atelier/v" + String(server.apiVersion) + "/" + server.namespace + path);

	// Make the request
	try {
		if (checksum !== undefined) {
			// This is a SASchema request
			
			// Make the initial request
			var respdata: AxiosResponse;
			respdata = await axios.request(
				{
					method: "GET",
					url: url,
					headers: {
						"if-none-match": checksum
					},
					withCredentials: true,
					jar: cookieJar,
					validateStatus: function (status) {
						return status < 500;
					}
				}
			);
			if (respdata.status === 202) {
				// The schema is being recalculated so we need to make another call to get it
				respdata = await axios.request(
					{
						method: "GET",
						url: url,
						withCredentials: true,
						jar: cookieJar
					}
				);
				return respdata;
			}
			else if (respdata.status === 304) {
				// The schema hasn't changed
				return undefined;
			}
			else if (respdata.status === 401) {
				// Either we had no cookies or they expired, so resend the request with basic auth

				respdata = await axios.request(
					{
						method: "GET",
						url: url,
						headers: {
							"if-none-match": checksum
						},
						auth: {
							username: server.username,
							password: server.password
						},
						withCredentials: true,
						jar: cookieJar
					}
				);
				if (respdata.status === 202) {
					// The schema is being recalculated so we need to make another call to get it
					respdata = await axios.request(
						{
							method: "GET",
							url: url,
							withCredentials: true,
							jar: cookieJar
						}
					);
					return respdata;
				}
				else if (respdata.status === 304) {
					// The schema hasn't changed
					return undefined;
				}
				else {
					// We got the schema
					return respdata;
				}
			}
			else {
				// We got the schema
				return respdata;
			}
		}
		else {
			// This is a different request
	
			var respdata: AxiosResponse;
			if (data !== undefined) {
				respdata = await axios.request(
					{
						method: method,
						url: url,
						data: data,
						headers: {
							'Content-Type': 'application/json'
						},
						withCredentials: true,
						jar: cookieJar,
						validateStatus: function (status) {
							return status < 500;
						}
					}
				);
				if (respdata.status === 401) {
					// Either we had no cookies or they expired, so resend the request with basic auth

					respdata = await axios.request(
						{
							method: method,
							url: url,
							data: data,
							headers: {
								'Content-Type': 'application/json'
							},
							auth: {
								username: server.username,
								password: server.password
							},
							withCredentials: true,
							jar: cookieJar
						}
					);
				}
			}
			else {
				respdata = await axios.request(
					{
						method: method,
						url: url,
						withCredentials: true,
						jar: cookieJar
					}
				);
				if (respdata.status === 401) {
					// Either we had no cookies or they expired, so resend the request with basic auth

					respdata = await axios.request(
						{
							method: method,
							url: url,
							auth: {
								username: server.username,
								password: server.password
							},
							withCredentials: true,
							jar: cookieJar
						}
					);
				}
			}
			return respdata;
		}
	} catch (error) {
		console.log(error);
		return undefined;
	}
};

/**
 * Get the semantic tokens builder for this document, or create one if it doesn't exist.
 * 
 * @param document The TextDocument
 */
function getTokenBuilder(document: TextDocument): ProposedFeatures.SemanticTokensBuilder {
	let result = tokenBuilders.get(document.uri);
	if (result !== undefined) {
		return result;
	}
	result = new ProposedFeatures.SemanticTokensBuilder();
	tokenBuilders.set(document.uri, result);
	return result;
}

/**
 * Get the ServerSpec for this document, or ask the client if it's not in the cache.
 * 
 * @param uri The TextDocument URI
 */
async function getServerSpec(uri: string): Promise<ServerSpec> {
	const spec = serverSpecs.get(uri);
	if (spec !== undefined) {
		return spec;
	}
	const newspec: ServerSpec = await connection.sendRequest("intersystems/server/resolveFromUri",uri);
	serverSpecs.set(uri, newspec);
	return newspec;
};

/**
 * Create the URI for the result of a 'textDocument/definition' request.
 * 
 * @param paramsUri The URI of the document that the definition request was made on.
 * @param filename The name of the file that contains the definition.
 * @param ext The extension of the file that contains the definition.
 */
async function createDefinitionUri(paramsUri: string, filename: string, ext: string): Promise<string> {
	var thisdocuri: string = paramsUri;
	if (paramsUri.slice(0,4) === "file") {
		try {
			thisdocuri = await connection.sendRequest("intersystems/uri/localToVirtual",paramsUri);
		}
		catch (error) {
			console.log(error);
			return "";
		}
	}
	var url = new URL(thisdocuri);
	url.pathname = encodeURI("/" + filename.replace(/\./g,"/") + ext);
	return url.toString();
};

/**
 * Edit the macro argument list to markdown-emphasize a given argument in the list.
 * 
 * @param arglist The list of arguments.
 * @param arg The one-indexed number of the argument to emphasize.
 */
function emphasizeArgument(arglist: string, arg: number): string {
	var numargs: number = arglist.split(" ").length;
	if (arg > numargs) {
		// The given argument doesn't exist in the list
		return arglist;
	}

	var start: number = -1; // inclusive
	var end: number = -1; // exclusive
	var spacesfound: number = 0;
	var lastspace: number = 0;
	if (arg === numargs) {
		// The last argument alwasy ends at the second-to-last position
		end = arglist.length - 1;
	}
	if (arg === 1) {
		// The first argument always starts at position 1
		start = 1;
		if (end === -1) {
			// Find the first space
			end = arglist.indexOf(" ") - 1;
		}
	}
	if (start !== -1 && end !== -1) {
		// Do the replacement
		return arglist.slice(0,start) + "_**" + arglist.slice(start,end) + "**_" + arglist.slice(end);
	}
	else {
		// Find the unknown positions
		var result = arglist;
		while (arglist.indexOf(" ",lastspace+1) !== -1) {
			const thisspace = arglist.indexOf(" ",lastspace);
			spacesfound++;
			if (arg === spacesfound + 1) {
				// This is the space before the argument
				start = thisspace + 1;
				if (end === -1) {
					// Look for the next space
					end = arglist.indexOf(" ",start) - 1;
				}
				result = arglist.slice(0,start) + "_**" + arglist.slice(start,end) + "**_" + arglist.slice(end);
				break;
			}
			lastspace = thisspace;
		}
		return result;
	}
};

/**
 * Determine if the selected macro is defined in the current file.
 * Returns the line number of the macro definition if it was found or -1 if it wasn't.
 * 
 * @param doc The TextDocument that the macro is in.
 * @param parsed The tokenized representation of doc.
 * @param line The line that the macro is in.
 * @param macro The selected macro.
 */
function isMacroDefinedAbove(doc: TextDocument, parsed: compressedline[], line: number, macro: string): number {
	var result: number = -1;

	// Loop through the file, looking for macro definitions
	for (let ln = line-1; ln >= 0; ln--) {
		if (parsed[ln].length < 4) {
			continue;
		}
		if (parsed[ln][0].l == ld.cos_langindex && parsed[ln][0].s == ld.cos_ppc_attrindex) {
			// This line begins with a preprocessor command
			const ppctext = doc.getText(Range.create(
				Position.create(ln,parsed[ln][1].p),
				Position.create(ln,parsed[ln][1].p+parsed[ln][1].c)
			)).toLowerCase();
			if (ppctext === "define" || ppctext === "def1arg") {
				// This is a macro definition
				const macrotext = doc.getText(Range.create(
					Position.create(ln,parsed[ln][2].p),
					Position.create(ln,parsed[ln][2].p+parsed[ln][2].c)
				));
				if (macrotext === macro) {
					// We found the definition for the selected macro
					result = ln;
					break;
				}
			}
		}
		if (doc.languageId === "objectscript-class" && parsed[ln][0].l == ld.cls_langindex && parsed[ln][0].s == ld.cls_keyword_attrindex) {
			// We've reached the top of the containing method 
			break;
		}
	}

	return result;
}

/**
 * Look through this line of a method definition for parameter "thisparam".
 * If it's found, return its class. Helper method for getClassMemberContext().
 * 
 * @param doc The TextDocument that the method definition is in.
 * @param parsed The tokenized representation of doc.
 * @param line The line that the method definition is in.
 * @param server The server that doc is associated with.
 * @param thisparam The parameter that we're looking for.
 */
async function findMethodParameterClass(doc: TextDocument, parsed: compressedline[], line: number, server: ServerSpec, thisparam: string): Promise<ClassMemberContext | undefined> {
	var result: ClassMemberContext | undefined = undefined;
	for (let tkn = 0; tkn < parsed[line].length; tkn++) {
		if (parsed[line][tkn].l == ld.cls_langindex && parsed[line][tkn].s == ld.cls_param_attrindex) {
			// This is a parameter
			const paramtext = doc.getText(Range.create(
				Position.create(line,parsed[line][tkn].p),
				Position.create(line,parsed[line][tkn].p+parsed[line][tkn].c)
			));
			if (thisparam === paramtext) {
				// This is the correct parameter
				if (parsed[line][tkn+1].l == ld.cls_langindex && parsed[line][tkn+1].s == ld.cls_keyword_attrindex) {
					// The token following the parameter name is "as", so this parameter has a type
					const clsname = doc.getText(findFullRange(line,parsed,tkn+2,parsed[line][tkn+2].p,parsed[line][tkn+2].p+parsed[line][tkn+2].c));
					result = {
						baseclass: await normalizeClassname(doc,parsed,clsname,server,line),
						context: "instance"
					};
				}
				else if (
					parsed[line][tkn+1].l == ld.cls_langindex && parsed[line][tkn+1].s == ld.cls_delim_attrindex &&
					doc.getText(Range.create(
						Position.create(line,parsed[line][tkn+1].p),
						Position.create(line,parsed[line][tkn+1].p+parsed[line][tkn+1].c)
					)) === "..."
				) {
					// The token following the parameter name is "...", so this is a variable argument parameter
					if (parsed[line][tkn+2].l == ld.cls_langindex && parsed[line][tkn+2].s == ld.cls_keyword_attrindex) {
						// The token following the "..." is "as", so this parameter has a type
						const clsname = doc.getText(findFullRange(line,parsed,tkn+3,parsed[line][tkn+3].p,parsed[line][tkn+3].p+parsed[line][tkn+3].c));
						result = {
							baseclass: await normalizeClassname(doc,parsed,clsname,server,line),
							context: "instance"
						};
					}
				}
				break;
			}
		}
	}
	return result;
}

/**
 * Normalize a system function, variable or structured system variable
 * name according to the language server configuration settings.
 * 
 * @param name The name of this system object. Must be in the "default" state, which is long form and all uppercase.
 * @param type The type of this system object.
 * @param settings The language server configuration settings.
 */
function normalizeSystemName(name: string, type: "sf"|"sv"|"ssv"|"unkn", settings: LanguageServerConfiguration): string {
	var result: string = "";
	if (type === "sf") {
		// This is a system function

		const sysfdoc = systemFunctions.find((el) => el.label === name.toUpperCase());
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
			result = idealsysftext;
		}
	}
	else if (type === "ssv") {
		// This is a structured system variable

		const ssysvdoc = structuredSystemVariables.find((el) => el.label === name.toUpperCase());
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
			result = idealssysvtext;
		}
	}
	else if (type === "sv") {
		// This is a system variable

		const sysvdoc = systemVariables.find((el) => el.label === name.toUpperCase());
		if (sysvdoc !== undefined) {
			var idealsysvtext = "";
			if (settings.formatting.system.length === "short" && sysvdoc.alias.length === 2) {
				idealsysvtext = sysvdoc.alias[1];
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
			result = idealsysvtext;
		}
	}
	else {
		// This is an unknown Z function or variable

		var idealunknstext = name;
		if (settings.formatting.system.case === "upper") {
			idealunknstext = idealunknstext.toUpperCase();
		}
		else if (settings.formatting.system.case === "lower") {
			idealunknstext = idealunknstext.toLowerCase();
		}
		else {
			idealunknstext = idealunknstext.slice(0,3).toUpperCase() + idealunknstext.slice(3).toLowerCase();
		}
		result = idealunknstext;
	}
	return result;
}

/**
 * Escape a UDL identifier using quotes, if necessary.
 * 
 * @param identifier The identifier to modify.
 * @param direction Pass 1 to add quotes if necessary, 0 to remove existing quotes.
 */
function quoteUDLIdentifier(identifier: string, direction: 0 | 1): string {
	var result: string = identifier;
	if (direction === 0 && identifier.indexOf('"') === 0) {
		// Remove first and last characters
		result = result.slice(1,-1);
		// Turn any "" into "
		result = result.replace(/""/g,'"');
	}
	else if (direction === 1 && identifier.indexOf('"') !== 0) {
		var needsquoting: boolean = false;
		for (let i = 0; i < result.length; i++) {
			const char: string = result.charAt(i);
			const code: number = result.charCodeAt(i);
			if (i === 0) {
				if (!(char === "%" || (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || code > 0x80)) {
					needsquoting = true;
					break;
				}
			}
			else {
				if (!((char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || code > 0x80 || (char >= '0' && char <= '9'))) {
					needsquoting = true;
					break;
				}
			}
		}
		if (needsquoting) {
			// Turn any " into ""
			result = result.replace(/"/g,'""');
			// Add " to start and end of identifier
			result = '"' + result + '"';
		}
	}
	return result;
}

connection.onInitialize((params: InitializeParams) => {
	// set up COMBridge for communication with the Studio coloring libraries
	startcombridge("CLS,COS,INT,XML,BAS,CSS,HTML,JAVA,JAVASCRIPT,MVBASIC,SQL");

	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Full,
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: [".","$","("," ","<",'"',"#"]
			},
			hoverProvider: true,
			definitionProvider: true,
			signatureHelpProvider: {
				triggerCharacters: ["(",","],
				retriggerCharacters: [","]
			},
			documentFormattingProvider: true,
			documentRangeFormattingProvider: true,
			semanticTokensProvider: {
				legend: getLegend(),
				documentProvider: {
					edits: true
				}
			},
			documentSymbolProvider: true,
			foldingRangeProvider: true,
			renameProvider: {
				prepareProvider: true
			}
		}
	};
});

connection.onInitialized(() => {
	// Register for relevant configuration changes.
	connection.client.register(DidChangeConfigurationNotification.type, {section: ["intersystems.language-server","intersystems.servers","objectscript.conn"]});
});

connection.onDidChangeConfiguration(change => {
	// Clear our caches
	languageServerSettings = undefined;
	serverSpecs.clear();
	schemaCaches.clear();

	// Update diagnostics for all open documents
	documents.all().forEach(computeDiagnostics);
});

documents.onDidClose(e => {
	parsedDocuments.delete(e.document.uri);
	tokenBuilders.delete(e.document.uri);
	serverSpecs.delete(e.document.uri);
	connection.sendDiagnostics({uri: e.document.uri, diagnostics: []});
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(async change => {
	if (change.document.languageId === "objectscript-class") {
		parsedDocuments.set(change.document.uri,parsedocument("CLS",monikeropttype.NONE,change.document.getText()).compressedlinearray);
	}
	else if (change.document.languageId === "objectscript" || change.document.languageId === "objectscript-macros") {
		parsedDocuments.set(change.document.uri,parsedocument("COS",monikeropttype.NONE,change.document.getText()).compressedlinearray);
	}
	else if (change.document.languageId === "objectscript-csp") {
		parsedDocuments.set(change.document.uri,parsedocument("HTML",monikeropttype.NONE,change.document.getText()).compressedlinearray);
	}
	await computeDiagnostics(change.document);
});

connection.onDocumentFormatting(
	async (params: DocumentFormattingParams): Promise<TextEdit[] | null> => {
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
);

connection.onDocumentRangeFormatting(
	async (params: DocumentRangeFormattingParams): Promise<TextEdit[] | null> => {
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
);

connection.onSignatureHelp(
	async (params: SignatureHelpParams): Promise<SignatureHelp | null> => {
		const parsed = parsedDocuments.get(params.textDocument.uri);
		if (parsed === undefined) {return null;}
		const doc = documents.get(params.textDocument.uri);
		if (doc === undefined) {return null;}
		const server: ServerSpec = await getServerSpec(params.textDocument.uri);
		const settings = await getLanguageServerSettings();

		if (params.context === undefined) {
			// Context is required for accurate help
			return null;
		}
		else {
			if (params.context.isRetrigger && params.context.activeSignatureHelp !== undefined) {
				const prevchar = doc.getText(Range.create(Position.create(params.position.line,params.position.character-1),params.position));
				if (prevchar === ")") {
					// The user closed the signature
					signatureHelpDocumentationCache = undefined;
					signatureHelpStartPosition = undefined;
					return null;
				}

				if (signatureHelpStartPosition !== undefined) {
					// Determine the active parameter
					var activeparam = 0;
					const text = doc.getText(Range.create(signatureHelpStartPosition,params.position));
					var openparencount = 0;
					for (let i = 0; i < text.length; i++) {
						const char = text.charAt(i);
						if (char === "(") {
							openparencount++;
						}
						else if (char === ")") {
							openparencount--;
						}
						else if (char === "," && openparencount === 0) {
							// Only increment parameter number if comma isn't inside nested parentheses
							activeparam++;
						}
					}

					params.context.activeSignatureHelp.activeParameter = activeparam;
					if (signatureHelpDocumentationCache !== undefined) {
						if (signatureHelpDocumentationCache.type === "macro" && params.context.activeSignatureHelp.activeParameter !== null) {
							// This is a macro with active parameter

							// Get the macro expansion with the next parameter emphasized
							var expinputdata = {...signatureHelpMacroCache};
							expinputdata.arguments = emphasizeArgument(expinputdata.arguments,params.context.activeSignatureHelp.activeParameter+1);
							const exprespdata = await makeRESTRequest("POST",2,"/action/getmacroexpansion",server,expinputdata)
							if (exprespdata !== undefined && exprespdata.data.result.content.expansion.length > 0) {
								signatureHelpDocumentationCache.doc = {
									kind: "markdown",
									value: exprespdata.data.result.content.expansion.join("\n")
								};
								params.context.activeSignatureHelp.signatures[0].documentation = signatureHelpDocumentationCache.doc;
							}
						}
						else {
							// This is a method or macro without active parameter
							params.context.activeSignatureHelp.signatures[0].documentation = signatureHelpDocumentationCache.doc;
						}
					}
					return params.context.activeSignatureHelp;
				}
			}
			var thistoken: number = -1;
			for (let i = 0; i < parsed[params.position.line].length; i++) {
				const symbolstart: number = parsed[params.position.line][i].p;
				const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
				thistoken = i;
				if (params.position.character >= symbolstart && params.position.character <= symbolend) {
					// We found the right symbol in the line
					break;
				}
			}
			const triggerlang: number = parsed[params.position.line][thistoken].l;
			const triggerattr: number = parsed[params.position.line][thistoken].s;
			if (
				!params.context.isRetrigger && params.context.triggerKind === SignatureHelpTriggerKind.TriggerCharacter &&
				params.context.triggerCharacter === "(" && triggerlang === ld.cos_langindex &&
				triggerattr !== ld.cos_comment_attrindex && triggerattr !== ld.cos_dcom_attrindex
			) {
				// This is potentially the start of a signature
	
				if (parsed[params.position.line][thistoken-1].l == ld.cos_langindex && parsed[params.position.line][thistoken-1].s == ld.cos_macro_attrindex) {
					// This is a macro
	
					// Get the details of this class
					const maccon = getMacroContext(doc,parsed,params.position.line);
	
					// Get the full range of the macro
					const macrorange = findFullRange(params.position.line,parsed,thistoken-1,parsed[params.position.line][thistoken-1].p,parsed[params.position.line][thistoken-1].p+parsed[params.position.line][thistoken-1].c);
					const macroname = doc.getText(macrorange).slice(3);

					// Get the macro signature from the server
					const inputdata = {
						docname: maccon.docname,
						macroname: macroname,
						superclasses: maccon.superclasses,
						includes: maccon.includes,
						includegenerators: maccon.includegenerators,
						imports: maccon.imports,
						mode: maccon.mode
					};
					const respdata = await makeRESTRequest("POST",2,"/action/getmacrosignature",server,inputdata);
					if (respdata !== undefined && respdata.data.result.content.signature !== "") {
						// The macro signature was found
						const sigtext = respdata.data.result.content.signature.replace(/\s+/g,"");
						const paramsarr: string[] = sigtext.slice(1,-1).split(",");
						var sig: SignatureInformation = {
							label: sigtext.replace(",",", "),
							parameters: []
						};
						var startidx: number = 0;
						for (let i = 0; i < paramsarr.length; i++) {
							const start = sig.label.indexOf(paramsarr[i],startidx);
							const end = start + paramsarr[i].length;
							startidx = end;
							if (sig.parameters !== undefined) {
								sig.parameters.push({
									label: [start,end]
								});
							}
						}

						// Get the macro expansion with the first parameter emphasized
						signatureHelpMacroCache = {
							docname: maccon.docname,
							macroname: macroname,
							superclasses: maccon.superclasses,
							includes: maccon.includes,
							includegenerators: maccon.includegenerators,
							imports: maccon.imports,
							mode: maccon.mode,
							arguments: sig.label
						};
						var expinputdata = {...signatureHelpMacroCache};
						expinputdata.arguments = emphasizeArgument(sig.label,1);
						const exprespdata = await makeRESTRequest("POST",2,"/action/getmacroexpansion",server,expinputdata)
						if (exprespdata !== undefined && exprespdata.data.result.content.expansion.length > 0) {
							signatureHelpDocumentationCache = {
								type: "macro",
								doc: {
									kind: "markdown",
									value: exprespdata.data.result.content.expansion.join("\n")
								}
							};
							sig.documentation = signatureHelpDocumentationCache.doc;
						}
						signatureHelpStartPosition = params.position;
						return {
							signatures: [sig],
							activeSignature: 0,
							activeParameter: 0
						};
					}
				}
				else if (
					parsed[params.position.line][thistoken-1].l == ld.cos_langindex && 
					(parsed[params.position.line][thistoken-1].s == ld.cos_method_attrindex || parsed[params.position.line][thistoken-1].s == ld.cos_mem_attrindex)
				) {
					// This is a method or multidimensional property

					// Get the full text of the member
					const member = doc.getText(Range.create(
						Position.create(params.position.line,parsed[params.position.line][thistoken-1].p),
						Position.create(params.position.line,parsed[params.position.line][thistoken-1].p+parsed[params.position.line][thistoken-1].c)
					));

					// Get the base class that this member is in
					const membercontext = await getClassMemberContext(doc,parsed,thistoken-2,params.position.line,server);
					if (membercontext.baseclass === "") {
						// If we couldn't determine the class, don't return anything
						return null;
					}

					// Get the method signature
					const querydata = {
						query: "SELECT FormalSpec, ReturnType, Description FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND Name = ?",
						parameters: [membercontext.baseclass,member]
					};
					const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
					if (respdata !== undefined && "content" in respdata.data.result && respdata.data.result.content.length > 0) {
						// We got data back
						const memobj = respdata.data.result.content[0];
						var sig: SignatureInformation = {
							label: "(".concat(memobj.FormalSpec.replace(/:/g," As ").replace(/,/g,", ").replace(/\*/g,"Output ").replace(/&/g,"ByRef ").replace(/=/g," = "),")"),
							parameters: []
						};
						if (settings.signaturehelp.documentation) {
							signatureHelpDocumentationCache = {
								type: "method",
								doc: {
									kind: "markdown",
									value: memobj.Description
								}
							};
							sig.documentation = signatureHelpDocumentationCache.doc;
						}
						
						const paramsarr: string[] = sig.label.slice(1,-1).split(", ");
						for (let i = 0; i < paramsarr.length; i++) {
							if (sig.parameters !== undefined) {
								const start = sig.label.indexOf(paramsarr[i]);
								const end = start + paramsarr[i].length;
								sig.parameters.push({
									label: [start,end]
								});
							}
						}
						if (memobj.ReturnType !== "") {
							sig.label = sig.label.concat(" As ",memobj.ReturnType);
						}
						signatureHelpStartPosition = params.position;
						return {
							signatures: [sig],
							activeSignature: 0,
							activeParameter: 0
						};
					}
				}
			}
			else if (
				!params.context.isRetrigger && params.context.triggerKind === SignatureHelpTriggerKind.TriggerCharacter &&
				params.context.triggerCharacter === "," && triggerlang === ld.cos_langindex &&
				triggerattr !== ld.cos_comment_attrindex && triggerattr !== ld.cos_dcom_attrindex
			) {
				// This is potentially the argument list for a signature

				// Loop backwards in the file and look for the first open parenthesis that isn't closed
				var numclosed = 0;
				var sigstartln = -1;
				var sigstarttkn = -1;
				for (let ln = params.position.line; ln >= 0; ln--) {
					var starttkn = parsed[ln].length-1;
					if (ln === params.position.line) {
						starttkn = thistoken-1;
					}
					for (let tkn = starttkn; tkn >= 0; tkn--) {
						if (parsed[ln][tkn].l === ld.cos_langindex && parsed[ln][tkn].s === ld.cos_delim_attrindex) {
							const delimtext = doc.getText(Range.create(Position.create(ln,parsed[ln][tkn].p),Position.create(ln,parsed[ln][tkn].p+parsed[ln][tkn].c)));
							if (delimtext === "(") {
								if (numclosed === 0) {
									sigstartln = ln;
									sigstarttkn = tkn;
									break;
								}
								else {
									numclosed--;
								}
							}
							else if (delimtext === ")") {
								numclosed++;
							}
						}
					}
					if (sigstartln !== -1 && sigstartln !== -1) {
						break;
					}
				}

				if (sigstartln !== -1 && sigstarttkn !== -1) {
					// We found an open parenthesis token that wasn't closed

					// Check the language and attribute of the token before the "("
					if (parsed[sigstartln][sigstarttkn-1].l == ld.cos_langindex && parsed[sigstartln][sigstarttkn-1].s == ld.cos_macro_attrindex) {
						// This is a macro

						// Get the details of this class
						const maccon = getMacroContext(doc,parsed,sigstartln);
		
						// Get the full range of the macro
						const macrorange = findFullRange(sigstartln,parsed,sigstarttkn-1,parsed[sigstartln][sigstarttkn-1].p,parsed[sigstartln][sigstarttkn-1].p+parsed[sigstartln][sigstarttkn-1].c);
						const macroname = doc.getText(macrorange).slice(3);

						// Get the macro signature from the server
						const inputdata = {
							docname: maccon.docname,
							macroname: macroname,
							superclasses: maccon.superclasses,
							includes: maccon.includes,
							includegenerators: maccon.includegenerators,
							imports: maccon.imports,
							mode: maccon.mode
						};
						const respdata = await makeRESTRequest("POST",2,"/action/getmacrosignature",server,inputdata);
						if (respdata !== undefined && respdata.data.result.content.signature !== "") {
							// The macro signature was found
							const sigtext = respdata.data.result.content.signature.replace(/\s+/g,"");
							const paramsarr: string[] = sigtext.slice(1,-1).split(",");
							var sig: SignatureInformation = {
								label: sigtext.replace(",",", "),
								parameters: []
							};
							var startidx: number = 0;
							for (let i = 0; i < paramsarr.length; i++) {
								const start = sig.label.indexOf(paramsarr[i],startidx);
								const end = start + paramsarr[i].length;
								startidx = end;
								if (sig.parameters !== undefined) {
									sig.parameters.push({
										label: [start,end]
									});
								}
							}

							// Determine the active parameter
							var activeparam = 0;
							const text = doc.getText(Range.create(Position.create(sigstartln,parsed[sigstartln][sigstarttkn].p+1),params.position));
							var openparencount = 0;
							for (let i = 0; i < text.length; i++) {
								const char = text.charAt(i);
								if (char === "(") {
									openparencount++;
								}
								else if (char === ")") {
									openparencount--;
								}
								else if (char === "," && openparencount === 0) {
									// Only increment parameter number if comma isn't inside nested parentheses
									activeparam++;
								}
							}

							// Get the macro expansion with the correct parameter emphasized
							signatureHelpMacroCache = {
								docname: maccon.docname,
								macroname: macroname,
								superclasses: maccon.superclasses,
								includes: maccon.includes,
								includegenerators: maccon.includegenerators,
								imports: maccon.imports,
								mode: maccon.mode,
								arguments: sig.label
							};
							var expinputdata = {...signatureHelpMacroCache};
							expinputdata.arguments = emphasizeArgument(sig.label,activeparam+1);
							const exprespdata = await makeRESTRequest("POST",2,"/action/getmacroexpansion",server,expinputdata)
							if (exprespdata !== undefined && exprespdata.data.result.content.expansion.length > 0) {
								signatureHelpDocumentationCache = {
									type: "macro",
									doc: {
										kind: "markdown",
										value: exprespdata.data.result.content.expansion.join("\n")
									}
								};
								sig.documentation = signatureHelpDocumentationCache.doc;
							}
							signatureHelpStartPosition = Position.create(sigstartln,parsed[sigstartln][sigstarttkn].p+1);
							return {
								signatures: [sig],
								activeSignature: 0,
								activeParameter: activeparam
							};
						}
					}
					else if (
						parsed[sigstartln][sigstarttkn-1].l == ld.cos_langindex && 
						(parsed[sigstartln][sigstarttkn-1].s == ld.cos_method_attrindex || parsed[sigstartln][sigstarttkn-1].s == ld.cos_mem_attrindex)
					) {
						// This is a method or multidimensional property
						
						// Get the full text of the member
						const member = doc.getText(Range.create(
							Position.create(sigstartln,parsed[sigstartln][sigstarttkn-1].p),
							Position.create(sigstartln,parsed[sigstartln][sigstarttkn-1].p+parsed[sigstartln][sigstarttkn-1].c)
						));

						// Get the base class that this member is in
						const membercontext = await getClassMemberContext(doc,parsed,sigstarttkn-2,sigstartln,server);
						if (membercontext.baseclass === "") {
							// If we couldn't determine the class, don't return anything
							return null;
						}

						// Get the method signature
						const querydata = {
							query: "SELECT FormalSpec, ReturnType, Description FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND Name = ?",
							parameters: [membercontext.baseclass,member]
						};
						const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
						if (respdata !== undefined && "content" in respdata.data.result && respdata.data.result.content.length > 0) {
							// We got data back
							const memobj = respdata.data.result.content[0];
							var sig: SignatureInformation = {
								label: "(".concat(memobj.FormalSpec.replace(/:/g," As ").replace(/,/g,", ").replace(/\*/g,"Output ").replace(/&/g,"ByRef ").replace(/=/g," = "),")"),
								parameters: []
							};
							if (settings.signaturehelp.documentation) {
								signatureHelpDocumentationCache = {
									type: "method",
									doc: {
										kind: "markdown",
										value: memobj.Description
									}
								};
								sig.documentation = signatureHelpDocumentationCache.doc;
							}
							
							const paramsarr: string[] = sig.label.slice(1,-1).split(", ");
							for (let i = 0; i < paramsarr.length; i++) {
								if (sig.parameters !== undefined) {
									const start = sig.label.indexOf(paramsarr[i]);
									const end = start + paramsarr[i].length;
									sig.parameters.push({
										label: [start,end]
									});
								}
							}
							if (memobj.ReturnType !== "") {
								sig.label = sig.label.concat(" As ",memobj.ReturnType);
							}
							
							// Determine the active parameter
							var activeparam = 0;
							const text = doc.getText(Range.create(Position.create(sigstartln,parsed[sigstartln][sigstarttkn].p+1),params.position));
							var openparencount = 0;
							for (let i = 0; i < text.length; i++) {
								const char = text.charAt(i);
								if (char === "(") {
									openparencount++;
								}
								else if (char === ")") {
									openparencount--;
								}
								else if (char === "," && openparencount === 0) {
									// Only increment parameter number if comma isn't inside nested parentheses
									activeparam++;
								}
							}

							signatureHelpStartPosition = Position.create(sigstartln,parsed[sigstartln][sigstarttkn].p+1);
							return {
								signatures: [sig],
								activeSignature: 0,
								activeParameter: activeparam
							};
						}
					}
				}
			}
			return null;
		}
	}
);

// This handler provides the initial list of the completion items.
connection.onCompletion(
	async (params: CompletionParams): Promise<CompletionItem[] | null> => {
		var result: CompletionItem[] = [];
		const parsed = parsedDocuments.get(params.textDocument.uri);
		if (parsed === undefined) {return null;}
		const doc = documents.get(params.textDocument.uri);
		if (doc === undefined) {return null;}
		if (params.position.line === parsed.length) {return null;}
		const server: ServerSpec = await getServerSpec(params.textDocument.uri);
		const prevline = doc.getText(Range.create(Position.create(params.position.line,0),params.position));
		const classregex = /^class[ ]+%?[\p{L}\d]+(\.{1}[\p{L}\d]+)* +extends[ ]+(\(([%]?[\p{L}\d]+(\.{1}[\p{L}\d]+)*,[ ]*)*)?$/iu;
		var firsttwotokens = "";
		if (parsed[params.position.line].length >= 2) {
			firsttwotokens = doc.getText(Range.create(
				Position.create(params.position.line,parsed[params.position.line][0].p),
				Position.create(params.position.line,parsed[params.position.line][1].p+parsed[params.position.line][1].c)
			));
		}
		var thistoken: number = -1;
		for (let i = 0; i < parsed[params.position.line].length; i++) {
			const symbolstart: number = parsed[params.position.line][i].p;
			const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
			thistoken = i;
			if (params.position.character >= symbolstart && params.position.character <= symbolend) {
				// We found the right symbol in the line
				break;
			}
		}
		if (thistoken === -1) {return null;}
		const triggerlang: number = parsed[params.position.line][thistoken].l;
		if (
			(triggerlang == ld.cos_langindex &&
			(parsed[params.position.line][thistoken].s == ld.cos_comment_attrindex ||
			parsed[params.position.line][thistoken].s == ld.cos_dcom_attrindex))
			||
			(triggerlang == ld.cls_langindex &&
			(parsed[params.position.line][thistoken].s == ld.cls_desc_attrindex ||
			parsed[params.position.line][thistoken].s == ld.cls_comment_attrindex))
		) {
			// Don't provide completion inside of a comment
			return null;
		}
		var openparencount = 0;
		var closeparencount = 0;
		for (let char = 0; char < prevline.length; char++) {
			if (prevline.charAt(char) === "(") {
				openparencount++;
			}
			else if (prevline.charAt(char) === ")") {
				closeparencount++;
			}
		}
		const settings = await getLanguageServerSettings();

		if (prevline.slice(-3) === "$$$" && triggerlang === ld.cos_langindex) {
			// This is a macro

			// Get the details of this class and store them in the cache
			var maccon = getMacroContext(doc,parsed,params.position.line);
			macroCompletionCache = maccon;

			// Get the entire macro list from the server
			var cursorisopen: boolean = true;
			while (cursorisopen) {
				const respdata = await makeRESTRequest("POST",2,"/action/getmacrolist",server,maccon);
				if (respdata !== undefined && respdata.data.result.content.macros.length > 0) {
					// We got data back
					for (let i = 0; i < respdata.data.result.content.macros.length; i++) {
						if (respdata.data.result.content.macros[i].slice(respdata.data.result.content.macros[i].length-1) === "(") {
							result.push({
								label: respdata.data.result.content.macros[i].slice(0,respdata.data.result.content.macros[i].length-1),
								kind: CompletionItemKind.Text,
								data: ["macro",doc.uri]
							});
						}
						else {
							result.push({
								label: respdata.data.result.content.macros[i],
								kind: CompletionItemKind.Text,
								data: ["macro",doc.uri]
							});
						}
					}
					if (respdata.data.result.content.cursor !== "") {
						// The list is incomplete
						maccon.cursor = respdata.data.result.content.cursor;
					}
					else {
						// The list is complete
						cursorisopen = false;
					}
				}
				else {
					cursorisopen = false;
				}
			}
		}
		else if (prevline.slice(-1) === "$" && prevline.charAt(prevline.length-2) !== "$" && triggerlang === ld.cos_langindex) {
			if (prevline.charAt(prevline.length-2) === "^") {
				// This is a structured system variable
				for (let ssv of structuredSystemVariables) {
					const label = normalizeSystemName(ssv.label,"ssv",settings);
					result.push({
						label: label,
						kind: CompletionItemKind.Variable,
						insertText: label.slice(2) + "(",
						data: "ssv",
						documentation: {
							kind: "markdown",
							value: ssv.documentation.join("")
						}
					});
				}
			}
			else {
				// This is a system variable or function
				for (let sv of systemVariables) {
					const label = normalizeSystemName(sv.label,"sv",settings);
					result.push({
						label: label,
						kind: CompletionItemKind.Variable,
						insertText: label.slice(1),
						data: "sv",
						documentation: {
							kind: "markdown",
							value: sv.documentation.join("")
						}
					});
				}
				for (let sf of systemFunctions) {
					if (sf.deprecated === undefined) {
						const label = normalizeSystemName(sf.label,"sf",settings);
						result.push({
							label: label,
							kind: CompletionItemKind.Function,
							insertText: label.slice(1) + "(",
							data: "sf",
							documentation: {
								kind: "markdown",
								value: sf.documentation.join("")
							}
						});
					}
				}
			}
		}
		else if (
			(prevline.slice(-6).toLowerCase() === "class(" && triggerlang === ld.cos_langindex) ||
			(prevline.slice(-3).toLowerCase() === "as " && prevline.slice(0,9).toLowerCase() !== "parameter"  && (triggerlang === ld.cos_langindex || triggerlang === ld.cls_langindex)) ||
			(prevline.slice(-3).toLowerCase() === "of "  && triggerlang === ld.cos_langindex) ||
			classregex.test(prevline)
		) {
			// This is a full class name

			result = await completionFullClassName(doc,parsed,server,params.position.line);
		}
		else if (prevline.slice(-3).toLowerCase() === "as " && prevline.slice(0,9).toLowerCase() === "parameter"  && triggerlang === ld.cls_langindex) {
			// This is a parameter type
			for (let pt of parameterTypes) {
				result.push({
					label: pt.name,
					kind: CompletionItemKind.EnumMember,
					data: "parametertype",
					documentation: {
						kind: "plaintext",
						value: pt.documentation
					}
				});
			}
		}
		else if (
			(prevline.slice(-1) === "." && prevline.slice(-2,-1) !== "," && prevline.slice(-2,-1) !== " "  &&
			thistoken !== 0 && (triggerlang === ld.cos_langindex || triggerlang === ld.cls_langindex)) ||
			(prevline.slice(-2) === ".#" && triggerlang === ld.cos_langindex)
		) {
			var prevtokentype = "";
			var prevtokentext = "";
			const prevtokenrange = findFullRange(params.position.line,parsed,thistoken-1,parsed[params.position.line][thistoken-1].p,parsed[params.position.line][thistoken-1].p+parsed[params.position.line][thistoken-1].c);
			prevtokentext = doc.getText(prevtokenrange);
			if ((parsed[params.position.line][thistoken-1].l == ld.cls_langindex && parsed[params.position.line][thistoken-1].s == ld.cls_clsname_attrindex) ||
			(parsed[params.position.line][thistoken-1].l == ld.cos_langindex && parsed[params.position.line][thistoken-1].s == ld.cos_clsname_attrindex)) {
				// This is a class name
				const prevchar = doc.getText(Range.create(Position.create(params.position.line,prevtokenrange.start.character-1),Position.create(params.position.line,prevtokenrange.start.character)));
				if (prevchar === " " || prevchar === "(" || prevchar === ",") {
					prevtokentype = "class";
				}
			}
			else if (parsed[params.position.line][thistoken-1].l == ld.cos_langindex && parsed[params.position.line][thistoken-1].s == ld.cos_sysv_attrindex && prevtokentext.toLowerCase() === "$system") {
				// This is $SYSTEM
				prevtokentype = "system";
			}
			if (prevtokentype === "class" || prevtokentype === "system") {
				// This is a partial class name

				var filter = "";
				if (prevtokentype === "system") {
					filter = "%SYSTEM.";
				}
				else {
					if (prevtokentext.slice(-1) !== ".") {
						filter = prevtokentext + ".";
					}
					else {
						filter = prevtokentext;
					}
				}

				// Get all classes that match the filter
				const querydata = {
					query: "SELECT Name FROM %Library.RoutineMgr_StudioOpenDialog(?,?,?,?,?,?,?,?)",
					parameters: ["*.cls",1,1,1,1,0,0,"Name %STARTSWITH '"+filter+"'"]
				};
				const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
				if (respdata !== undefined && respdata.data.result.content.length > 0) {
					// We got data back

					for (let clsobj of respdata.data.result.content) {
						result.push({
							label: clsobj.Name.replace(filter,"").slice(0,-4),
							kind: CompletionItemKind.Class,
							data: ["class",clsobj.Name,doc.uri]
						});
					}
				}
			}
			else {
				// This is a class member

				if (prevline.slice(-2) === ".#") {
					// Get the base class that this member is in
					const membercontext = await getClassMemberContext(doc,parsed,thistoken-1,params.position.line,server);
					if (membercontext.baseclass === "") {
						// If we couldn't determine the class, don't return anything
						return null;
					}

					// Query the server to get the names and descriptions of all parameters
					const data: QueryData = {
						query: "SELECT Name, Description, Origin, Type FROM %Dictionary.CompiledParameter WHERE parent->ID = ? AND deprecated = 0",
						parameters: [membercontext.baseclass]
					}
					const respdata = await makeRESTRequest("POST",1,"/action/query",server,data);
					if (respdata !== undefined && "content" in respdata.data.result && respdata.data.result.content.length > 0) {
						// We got data back

						for (let memobj of respdata.data.result.content) {
							const quotedname = quoteUDLIdentifier(memobj.Name,1);
							var item: CompletionItem = {
								label: ""
							};
							item = {
								label: "#" + quotedname,
								kind: CompletionItemKind.Property,
								data: "member",
								documentation: {
									kind: "markdown",
									value: memobj.Description
								},
								sortText: quotedname,
								insertText: quotedname
							};
							if (memobj.Type !== "") {
								item.detail = memobj.Type;
							}
							if (memobj.Origin === membercontext.baseclass) {
								// Members from the base class should appear first
								item.sortText = "##" + quotedname;
							}
							else {
								item.sortText = item.label;
							}
							result.push(item);
						}
					}
				}
				else {
					// Get the base class that this member is in
					const membercontext = await getClassMemberContext(doc,parsed,thistoken,params.position.line,server);
					if (membercontext.baseclass === "") {
						// If we couldn't determine the class, don't return anything
						return null;
					}
					
					// Query the server to get the names and descriptions of all appropriate class members
					var data: QueryData = {
						query: "",
						parameters: []
					};
					if (membercontext.context === "class") {
						data.query = "SELECT Name, Description, Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND classmethod = 1 AND deprecated = 0 UNION ALL ";
						data.query = data.query.concat("SELECT Name, Description, Origin, '' AS FormalSpec, Type, 'parameter' AS MemberType FROM %Dictionary.CompiledParameter WHERE parent->ID = ? AND deprecated = 0");
						data.parameters = [membercontext.baseclass,membercontext.baseclass];
					}
					else if (membercontext.context === "instance") {
						data.query = "SELECT Name, Description, Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND classmethod = 0 AND deprecated = 0 UNION ALL ";
						data.query = data.query.concat("SELECT Name, Description, Origin, '' AS FormalSpec, Type, 'property' AS MemberType FROM %Dictionary.CompiledProperty WHERE parent->ID = ? AND relationship = 0 AND deprecated = 0");
						data.parameters = [membercontext.baseclass,membercontext.baseclass];
					}
					else {
						data.query = "SELECT Name, Description, Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND classmethod = 1 AND deprecated = 0";
						data.parameters = [membercontext.baseclass];
					}
					const respdata = await makeRESTRequest("POST",1,"/action/query",server,data);
					if (respdata !== undefined && respdata.data.result.content.length > 0) {
						// We got data back
						
						for (let memobj of respdata.data.result.content) {
							const quotedname = quoteUDLIdentifier(memobj.Name,1);
							var item: CompletionItem = {
								label: ""
							};
							if (memobj.MemberType === "method") {
								item = {
									label: quotedname,
									kind: CompletionItemKind.Method,
									data: "member",
									documentation: {
										kind: "markdown",
										value: memobj.Description
									}
								};
								if (memobj.Type !== "") {
									item.detail = memobj.Type;
								}
								if (memobj.FormalSpec === "") {
									// Insert trailing parentheses because method takes no arguments
									item.insertText = quotedname + "()";
								}
							}
							else if (memobj.MemberType === "parameter") {
								item = {
									label: "#" + quotedname,
									kind: CompletionItemKind.Property,
									data: "member",
									documentation: {
										kind: "markdown",
										value: memobj.Description
									},
									sortText: quotedname
								};
								if (memobj.Type !== "") {
									item.detail = memobj.Type;
								}
							}
							else {
								item = {
									label: quotedname,
									kind: CompletionItemKind.Property,
									data: "member",
									documentation: {
										kind: "markdown",
										value: memobj.Description
									}
								};
								if (memobj.Type !== "") {
									item.detail = memobj.Type;
								}
							}
							if (memobj.Origin === membercontext.baseclass) {
								// Members from the base class should appear first
								item.sortText = "##" + quotedname;
							}
							else {
								item.sortText = item.label;
							}
							result.push(item);
						}
					}
				}
			}
		}
		else if (
			((prevline.slice(-1) === " " || prevline.slice(-1) === "," || prevline.slice(-1) === "(") && triggerlang === ld.cls_langindex &&
			(prevline.slice(0,7).toLowerCase() === "include" || prevline.slice(0,16).toLowerCase() === "includegenerator")) ||
			(parsed[params.position.line].length === 2 && firsttwotokens.toLowerCase() === "#include" && triggerlang === ld.cos_langindex)
		) {
			// This is an include file

			result = await completionInclude(server);
		}
		else if (
			(prevline.slice(-1) === " " || prevline.slice(-1) === "," || prevline.slice(-1) === "(") &&
			(prevline.slice(0,6).toLowerCase() === "import") && triggerlang === ld.cls_langindex
		) {
			// This is an import

			result = await completionPackage(server);
		}
		else if (
			(prevline.slice(-2) === "[ " || (prevline.slice(-2) === ", " &&
			openparencount === closeparencount)) && triggerlang === ld.cls_langindex &&
			parsed[params.position.line][0].l == ld.cls_langindex && parsed[params.position.line][0].s == ld.cls_keyword_attrindex
		) {
			var foundopenbrace = false;
			var foundclosingbrace = false;
			for (let i = 1; i < parsed[params.position.line].length; i++) {
				const symbolstart: number = parsed[params.position.line][i].p;
				const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
				if (params.position.character <= symbolstart) {
					break;
				}
				const symboltext = doc.getText(Range.create(Position.create(params.position.line,symbolstart),Position.create(params.position.line,symbolend)));
				if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_delim_attrindex && symboltext === "[") {
					foundopenbrace = true;
				}
				else if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_delim_attrindex && symboltext === "]") {
					foundclosingbrace = true;
				}
			}
			if (foundopenbrace && !foundclosingbrace) {
				// This is a UDL keyword
				
				const keywordtype = doc.getText(Range.create(
					Position.create(params.position.line,parsed[params.position.line][0].p),
					Position.create(params.position.line,parsed[params.position.line][0].p+parsed[params.position.line][0].c)
				)).toLowerCase();
				var keywordsarr: KeywordDoc[] =[];
				if (keywordtype === "class") {
					keywordsarr = classKeywords.slice();
				}
				else if (keywordtype === "constraint") {
					keywordsarr = constraintKeywords.slice();
				}
				else if (keywordtype === "foreignkey") {
					keywordsarr = foreignkeyKeywords.slice();
				}
				else if (keywordtype === "index") {
					keywordsarr = indexKeywords.slice();
				}
				else if (keywordtype === "method" || keywordtype === "classmethod") {
					keywordsarr = methodKeywords.slice();
				}
				else if (keywordtype === "parameter") {
					keywordsarr = parameterKeywords.slice();
				}
				else if (keywordtype === "projection") {
					keywordsarr = projectionKeywords.slice();
				}
				else if (keywordtype === "property") {
					keywordsarr = propertyKeywords.slice();
				}
				else if (keywordtype === "query") {
					keywordsarr = queryKeywords.slice();
				}
				else if (keywordtype === "trigger") {
					keywordsarr = triggerKeywords.slice();
				}
				else if (keywordtype === "xdata") {
					keywordsarr = xdataKeywords.slice();
				}
				for (let keydoc of keywordsarr) {
					var doctext = keydoc.description;
					if (doctext.toLowerCase() !== "deprecated.") {
						if ("constraint" in keydoc && keydoc.constraint instanceof Array) {
							doctext = doctext.concat("\n\n","Permitted Values: ",keydoc.constraint.join(", "));
						}
						var compitem: CompletionItem = {
							label: keydoc.name,
							kind: CompletionItemKind.Keyword,
							data: "keyword",
							documentation: {
								kind: "plaintext",
								value: doctext
							}
						}
						if (!("type" in keydoc) || ("type" in keydoc && keydoc.type !== "KW_TYPE_BOOLEAN")) {
							compitem.insertText = keydoc.name + " =";
						}
						result.push(compitem);
					}
				}
			}
		}
		else if (
			parsed[params.position.line][0].l == ld.cls_langindex && parsed[params.position.line][0].s == ld.cls_keyword_attrindex && triggerlang === ld.cls_langindex &&
			(prevline.slice(-2) === "= " || (prevline.slice(-2) === ", " && openparencount > closeparencount) || prevline.slice(-3) === "= (")
		) {
			var foundopenbrace = false;
			var foundclosingbrace = false;
			var thiskeyword = "";
			for (let i = 1; i < parsed[params.position.line].length; i++) {
				const symbolstart: number = parsed[params.position.line][i].p;
				const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
				if (params.position.character <= symbolstart) {
					break;
				}
				const symboltext = doc.getText(Range.create(Position.create(params.position.line,symbolstart),Position.create(params.position.line,symbolend))).toLowerCase();
				if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_delim_attrindex && symboltext === "[") {
					foundopenbrace = true;
				}
				else if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_delim_attrindex && symboltext === "]") {
					foundclosingbrace = true;
				}
				else if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_keyword_attrindex) {
					thiskeyword = symboltext;
				}
			}
			if (foundopenbrace && !foundclosingbrace) {
				// This is a value for a UDL keyword

				const keywordtype = doc.getText(Range.create(
					Position.create(params.position.line,parsed[params.position.line][0].p),
					Position.create(params.position.line,parsed[params.position.line][0].p+parsed[params.position.line][0].c)
				)).toLowerCase();
				var keywordsarr: KeywordDoc[] =[];
				if (keywordtype === "class") {
					keywordsarr = classKeywords.slice();
				}
				else if (keywordtype === "constraint") {
					keywordsarr = constraintKeywords.slice();
				}
				else if (keywordtype === "foreignkey") {
					keywordsarr = foreignkeyKeywords.slice();
				}
				else if (keywordtype === "index") {
					keywordsarr = indexKeywords.slice();
				}
				else if (keywordtype === "method" || keywordtype === "classmethod") {
					keywordsarr = methodKeywords.slice();
				}
				else if (keywordtype === "parameter") {
					keywordsarr = parameterKeywords.slice();
				}
				else if (keywordtype === "projection") {
					keywordsarr = projectionKeywords.slice();
				}
				else if (keywordtype === "property") {
					keywordsarr = propertyKeywords.slice();
				}
				else if (keywordtype === "query") {
					keywordsarr = queryKeywords.slice();
				}
				else if (keywordtype === "trigger") {
					keywordsarr = triggerKeywords.slice();
				}
				else if (keywordtype === "xdata") {
					keywordsarr = xdataKeywords.slice();
				}
				
				const thiskeydoc = keywordsarr.find((keydoc) => keydoc.name.toLowerCase() === thiskeyword);
				if (thiskeydoc !== undefined && "constraint" in thiskeydoc) {
					// The keyword was found and has a constraint
					if (thiskeydoc.constraint instanceof Array) {
						// Static list of permitted values
						for (let val of thiskeydoc.constraint) {
							result.push({
								label: val,
								kind: CompletionItemKind.EnumMember,
								data: "keywordvalue"
							});
						}
					}
					else if (thiskeydoc.constraint === "KW_SYSENUM_CLASS_LIST") {
						// List of classes
						result = await completionFullClassName(doc,parsed,server,params.position.line);
					}
					else if (thiskeydoc.constraint === "KW_SYSENUM_PACKAGE_LIST") {
						// List of packages
						result = await completionPackage(server);
					}
					else if (thiskeydoc.constraint === "KW_SYSENUM_INCFILE_LIST") {
						// List of includes
						result = await completionInclude(server);
					}
					else if (thiskeydoc.constraint === "KW_SYSENUM_METHOD_LIST") {
						// List of methods

						// Find the class name
						var thisclass = "";
						for (let i = 0; i < parsed.length; i++) {
							if (parsed[i].length === 0) {
								continue;
							}
							else if (parsed[i][0].l == ld.cls_langindex && parsed[i][0].s == ld.cls_keyword_attrindex) {
								// This line starts with a UDL keyword
								var keyword = doc.getText(Range.create(Position.create(i,parsed[i][0].p),Position.create(i,parsed[i][0].p+parsed[i][0].c)));
								if (keyword.toLowerCase() === "class") {
									for (let j = 1; j < parsed[i].length; j++) {
										if (parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_clsname_attrindex) {
											thisclass = thisclass.concat(doc.getText(Range.create(Position.create(i,parsed[i][j].p),Position.create(i,parsed[i][j].p+parsed[i][j].c))));
										}
										else if (parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_keyword_attrindex) {
											// We hit the 'Extends' keyword
											break;
										}
									}
									break;
								}
							}
						}
						const querydata = {
							query: "SELECT Name, Description, Origin FROM %Dictionary.CompiledMethod WHERE parent->ID = ?",
							parameters:[thisclass]
						};
						const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
						if (respdata !== undefined && "content" in respdata.data.result && respdata.data.result.content.length > 0) {
							// We got data back
							
							for (let method of respdata.data.result.content) {
								var item: CompletionItem  = {
									label: method.Name,
									kind: CompletionItemKind.Method,
									data: "member",
									documentation: {
										kind: "markdown",
										value: method.Description
									}
								};
								if (method.Origin === method.baseclass) {
									// Members from the base class should appear first
									item.sortText = "##" + method.Name;
								}
								else {
									item.sortText = item.label;
								}
								result.push(item);
							}
						}
					}
				}
			}
		}
		else if ((prevline.slice(-1) === " " || prevline.slice(-1) === "<" || prevline.slice(-1) === '"') && triggerlang === ld.xml_langindex) {
			// Scan up to see if the XData block has an XMLNamespace
			// Also find the parent element
			var xmlns: string = "";
			var xmlstartline: number = -1;
			for (let j = params.position.line; j >= 0; j--) {
				if (parsed[j].length === 0) {
					continue;
				}
				if (parsed[j][0].l == ld.cls_langindex && parsed[j][0].s == ld.cls_keyword_attrindex) {
					// This is the definition for the XData block
					for (let k = 3; k < parsed[j].length; k++) {
						if (parsed[j][k].l == ld.cls_langindex && parsed[j][k].s == ld.cls_keyword_attrindex) {
							// This is a UDL trailing keyword
							const keytext = doc.getText(Range.create(
								Position.create(j,parsed[j][k].p),
								Position.create(j,parsed[j][k].p+parsed[j][k].c)
							)).toLowerCase();
							if (keytext === "xmlnamespace") {
								// An XMLNamespace is defined
								xmlns = doc.getText(Range.create(
									Position.create(j,parsed[j][k+2].p+1),
									Position.create(j,parsed[j][k+2].p+parsed[j][k+2].c-1)
								));
								break;
							}
						}
					}
					break;
				}
				else if (parsed[j][0].l == ld.xml_langindex) {
					// This is a line of XML
					xmlstartline = j;
				}
			}
			if (xmlns !== "") {
				// An XMLNamespace is defined
				
				// Only proceed if we can provide suggestions
				if (
					(prevline.slice(-1) === " " &&
					prevline.indexOf("<") !== -1 &&
					prevline.charAt(prevline.lastIndexOf("<")+1) !== "!" &&
					prevline.split("<").length > prevline.split(">").length) ||
					prevline.slice(-1) === "<" || prevline.slice(-1) === '"'
				) {
					// Get the SchemaCache for this server or create one if it doesn't exist
					var schemaCache = schemaCaches.get(server);
					if (schemaCache === undefined) {
						schemaCache = new XMLAssist.SchemaCache(server);
						schemaCaches.set(server,schemaCache);
					}

					// Get the Schema from the SchemaCache
					const schema = await schemaCache.getSchema(xmlns);

					if (schema !== undefined) {
						// We got a SASchema back from the server
						
						// Parse the XML from the beginning to the completion position and build a string with the full element tree
						var openelem: string[] = [];
						for (let xmlline = xmlstartline; xmlline <= params.position.line; xmlline++) {
							var endtkn: number = parsed[xmlline].length - 1;
							if (xmlline === params.position.line) {
								// Don't parse past the completion position
								endtkn = thistoken - 1;
							}
							for (let xmltkn = 0; xmltkn <= endtkn; xmltkn++) {
								if (parsed[xmlline][xmltkn].l == ld.xml_langindex && parsed[xmlline][xmltkn].s == ld.xml_tagdelim_attrindex) {
									// This is a tag delimiter 
									const tokentext = doc.getText(Range.create(
										Position.create(xmlline,parsed[xmlline][xmltkn].p),
										Position.create(xmlline,parsed[xmlline][xmltkn].p+parsed[xmlline][xmltkn].c)
									));
									if (tokentext === "<") {
										// The upcoming element is being opened
										openelem.push(doc.getText(Range.create(
											Position.create(xmlline,parsed[xmlline][xmltkn+1].p),
											Position.create(xmlline,parsed[xmlline][xmltkn+1].p+parsed[xmlline][xmltkn+1].c)
										)));
									}
									else if (tokentext === "</") {
										// The upcoming element is being closed
										openelem.splice(openelem.lastIndexOf(doc.getText(Range.create(
											Position.create(xmlline,parsed[xmlline][xmltkn+1].p),
											Position.create(xmlline,parsed[xmlline][xmltkn+1].p+parsed[xmlline][xmltkn+1].c)
										))),1);
									}
									else if (tokentext === "/>") {
										// The previous element has been closed
										openelem.pop();
									}
								}
							}
						}
						const elementPath = openelem.join("/");
						const schemaQuery = schema.querySchema(elementPath);
						if (schemaQuery === undefined) {
							// We didn't get a result
							return null;
						}

						if (prevline.slice(-1) === " ") {
							// Looking for possible attribute values

							var possibleAttrs = schemaQuery.getAttributes();
							
							// Find any attribute names that are already used
							var usedAttrs: string[] = [];
							for (let tkn = parsed[params.position.line].length-1; tkn >= 0; tkn--) {
								if (parsed[params.position.line][tkn].p >= params.position.character) {
									continue;
								}
								if (parsed[params.position.line][tkn].l == ld.xml_langindex && parsed[params.position.line][tkn].s == ld.xml_attr_attrindex) {
									// This is an attribute name
									usedAttrs.push(doc.getText(Range.create(
										Position.create(params.position.line,parsed[params.position.line][tkn].p),
										Position.create(params.position.line,parsed[params.position.line][tkn].p+parsed[params.position.line][tkn].c)
									)));
								}
							}

							// Filter out all attribute names that have already been used
							possibleAttrs = possibleAttrs.filter((el) => !usedAttrs.includes(el));

							// Create the CompletionItem's
							for (let attr of possibleAttrs) {
								result.push({
									label: attr,
									kind: CompletionItemKind.Field,
									insertText: attr+"=",
									data: "SASchema"
								});
							}
						}
						else if (prevline.slice(-1) === "<") {
							// Looking for child element names

							var childElems = schemaQuery.getElements();

							// Create the CompletionItem's for the children
							for (let elem of childElems) {
								result.push({
									label: elem,
									kind: CompletionItemKind.Property,
									data: "SASchema"
								});
							}

							// Create the completion item for the closing tag
							result.push({
								label: "/"+openelem[openelem.length-1]+">",
								kind: CompletionItemKind.Property,
								data: "SASchema",
								sortText: "zzzzz"+"/"+openelem[openelem.length-1]+">"
							});
						}
						else {
							// Looking for an attribute value enum

							// Find the name of the attribute that we're looking for values for
							var selector: string = "";
							for (let tkn = parsed[params.position.line].length-1; tkn >= 0; tkn--) {
								if (parsed[params.position.line][tkn].p >= params.position.character) {
									continue;
								}
								if (parsed[params.position.line][tkn].l == ld.xml_langindex && parsed[params.position.line][tkn].s == ld.xml_attr_attrindex) {
									// This is an attribute name
									selector = doc.getText(Range.create(
										Position.create(params.position.line,parsed[params.position.line][tkn].p),
										Position.create(params.position.line,parsed[params.position.line][tkn].p+parsed[params.position.line][tkn].c)
									));
									break;
								}
							}

							var attrMoniker = schemaQuery.getAttributeMoniker(selector);
							if (attrMoniker === "" || attrMoniker.slice(0,4) === "enum") {
								// If the attribute moniker is an enum, create CompletionItem's for all possible values
								const vals = attrMoniker.slice(5).split(",");
								for (let val of vals) {
									if (val !== "!") {
										result.push({
											label: val,
											kind: CompletionItemKind.EnumMember,
											insertText: val + '"',
											data: "SASchema"
										});
									}
								}
							}
						}
					}
				}
			}
		}
		else if (prevline.slice(-2) === "##" && triggerlang === ld.cos_langindex) {
			// This is a double-pound preprocessor directive

			if (thistoken === 0) {
				// This preprocessor directive is on the start of the line

				for (let dir of preprocessorDirectives) {
					if (dir.start && dir.label.slice(0,2) === "##") {
						result.push({
							label: dir.label,
							kind: CompletionItemKind.Keyword,
							documentation: {
								kind: "markdown",
								value: dir.documentation + "\n\n" + `[Online documentation](${"https://docs.intersystems.com/irislatest"}${dir.link})`
							},
							insertText: dir.label.slice(2),
							data: "Preprocessor"
						});
					}
				}
			}
			else {
				// This preprocessor directive is mid-line

				for (let dir of preprocessorDirectives) {
					if (dir.middle && dir.label.slice(0,2) === "##") {
						result.push({
							label: dir.label,
							kind: CompletionItemKind.Keyword,
							documentation: {
								kind: "markdown",
								value: dir.documentation + "\n\n" + `[Online documentation](${"https://docs.intersystems.com/irislatest"}${dir.link})`
							},
							insertText: dir.label.slice(2),
							data: "Preprocessor"
						});
					}
				}
			}
		}
		else if (prevline.slice(-1) === "#" && triggerlang === ld.cos_langindex) {
			// This is a preprocessor directive

			if (thistoken === 0) {
				// This preprocessor directive is on the start of the line

				for (let dir of preprocessorDirectives) {
					if (dir.start) {
						result.push({
							label: dir.label,
							kind: CompletionItemKind.Keyword,
							documentation: {
								kind: "markdown",
								value: dir.documentation + "\n\n" + `[Online documentation](${"https://docs.intersystems.com/irislatest"}${dir.link})`
							},
							insertText: dir.label.slice(1),
							data: "Preprocessor"
						});
					}
				}
			}
			else {
				// This preprocessor directive is mid-line

				for (let dir of preprocessorDirectives) {
					if (dir.middle) {
						result.push({
							label: dir.label,
							kind: CompletionItemKind.Keyword,
							documentation: {
								kind: "markdown",
								value: dir.documentation + "\n\n" + `[Online documentation](${"https://docs.intersystems.com/irislatest"}${dir.link})`
							},
							insertText: dir.label.slice(1),
							data: "Preprocessor"
						});
					}
				}
			}
		}
		return result;
	}
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	async (item: CompletionItem): Promise<CompletionItem> => {
		if (item.data instanceof Array && item.data[0] === "class") {
			// Get the description for this class from the server
			const server: ServerSpec = await getServerSpec(item.data[2]);
			const respdata = await makeRESTRequest("POST",1,"/action/index",server,[item.data[1]]);
			if (respdata !== undefined && respdata.data.result.content.length > 0) {
				// The class was found
				item.documentation = {
					kind: "markdown",
					value: respdata.data.result.content[0].content.desc.join(" ")
				};
			}
		}
		else if (item.data instanceof Array && item.data[0] === "macro") {
			// Get the macro definition from the server
			const server: ServerSpec = await getServerSpec(item.data[1]);
			const querydata = {
				docname: macroCompletionCache.docname,
				macroname: item.label,
				superclasses: macroCompletionCache.superclasses,
				includes: macroCompletionCache.includes,
				includegenerators: macroCompletionCache.includegenerators,
				imports: macroCompletionCache.imports,
				mode: macroCompletionCache.mode
			};
			const respdata = await makeRESTRequest("POST",2,"/action/getmacrodefinition",server,querydata);
			if (respdata !== undefined && respdata.data.result.content.definition.length > 0) {
				// The macro definition was found
				const parts = respdata.data.result.content.definition[0].trim().split(/[ ]+/);
				var defstr = "";
				if (parts[0].charAt(0) === "#") {
					defstr = defstr.concat(parts[1],"\n",parts.slice(2).join());
				}
				else {
					defstr = defstr.concat(parts[0],"\n",parts.slice(1).join());
				}
				item.documentation = {
					kind: "plaintext",
					value: defstr
				};
			}
		}
		return item;
	}
);

connection.onHover(
	async (params: TextDocumentPositionParams) => {
		const parsed = parsedDocuments.get(params.textDocument.uri);
		if (parsed === undefined) {return null;}
		const doc = documents.get(params.textDocument.uri);
		if (doc === undefined) {return null;}
		const server: ServerSpec = await getServerSpec(params.textDocument.uri);
		const settings = await getLanguageServerSettings();

		for (let i = 0; i < parsed[params.position.line].length; i++) {
			const symbolstart: number = parsed[params.position.line][i].p;
			const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
			if (params.position.character >= symbolstart && params.position.character <= symbolend) {
				// We found the right symbol in the line

				if (((parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_clsname_attrindex) ||
				(parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_clsname_attrindex))
				&& doc.getText(Range.create(Position.create(params.position.line,0),Position.create(params.position.line,6))).toLowerCase() !== "import") {
					// This is a class name
		
					// Get the full text of the selection
					let wordrange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
					let word = doc.getText(wordrange);
					if (word.charAt(0) === ".") {
						// This might be $SYSTEM.ClassName
						const prevseven = doc.getText(Range.create(
							Position.create(params.position.line,wordrange.start.character-7),
							Position.create(params.position.line,wordrange.start.character)
						));
						if (prevseven.toUpperCase() === "$SYSTEM") {
							// This is $SYSTEM.ClassName
							word = "%SYSTEM" + word;
						}
						else {
							// This classname is invalid
							return null;
						}
					}
					if (word.charAt(0) === '"') {
						// This classname is delimited with ", so strip them
						word = word.slice(1,-1);
					}

					// Normalize the class name if there are imports
					let normalizedname = await normalizeClassname(doc,parsed,word,server,params.position.line);

					// Get the description for this class from the server
					const respdata = await makeRESTRequest("POST",1,"/action/index",server,[normalizedname.concat(".cls")]);
					if (respdata !== undefined && respdata.data.result.content.length === 1 && respdata.data.result.content[0].status === "") {
						// The class was found
						return {
							contents: [normalizedname,respdata.data.result.content[0].content.desc.join(" ")],
							range: wordrange
						};
					}
				}
				else if (parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_macro_attrindex ) {
					// This is a macro

					// Get the details of this class
					const maccon = getMacroContext(doc,parsed,params.position.line);

					// Get the full range of the macro
					const macrorange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
					var macrotext = doc.getText(macrorange);
					if (macrotext.slice(0,3) === "$$$") {
						macrotext = macrotext.slice(3);
					}
					
					// Check if the macro definition appears in the current file
					const macrodefline = isMacroDefinedAbove(doc,parsed,params.position.line,macrotext);
					
					if (macrodefline !== -1) {
						// The macro definition is in the current file

						var defstr = "";
						for (let ln = macrodefline; ln < parsed.length; ln++) {
							const deflinetext = doc.getText(Range.create(
								Position.create(ln,0),
								Position.create(ln,parsed[ln][parsed[ln].length-1].p+parsed[ln][parsed[ln].length-1].c)
							));
							const parts = deflinetext.trim().split(/[ ]+/);
							
							if (
								parsed[ln][parsed[ln].length-1].l == ld.cos_langindex &&
								parsed[ln][parsed[ln].length-1].s == ld.cos_ppf_attrindex &&
								doc.getText(Range.create(
									Position.create(ln,parsed[ln][parsed[ln].length-1].p),
									Position.create(ln,parsed[ln][parsed[ln].length-1].p+parsed[ln][parsed[ln].length-1].c)
								)).toLowerCase() === "continue"
							) {
								// This is one line of a multi-line macro definition

								if (ln == macrodefline) {
									// This is the first line of a multi-line macro definition

									defstr = parts.slice(2).join(" ").slice(0,-10) + "  \n";
								}
								else {
									defstr = defstr + deflinetext.trim().slice(0,-10) + "  \n";
								}
							}
							else {
								if (ln == macrodefline) {
									// This is a one line macro definition

									defstr = parts.slice(2).join(" ");
								}
								else {
									// This is the last line of a multi-line macro definition

									defstr = defstr + deflinetext.trim();
								}
								// We've captured all the lines of this macro definition
								break;
							}
						}
						
						return {
							contents: defstr,
							range: macrorange
						};
					}
					else {
						// The macro is defined in another file

						// Get the rest of the line following the macro
						const restofline = doc.getText(Range.create(
							Position.create(params.position.line,macrorange.end.character),
							Position.create(params.position.line,parsed[params.position.line][parsed[params.position.line].length-1].p+parsed[params.position.line][parsed[params.position.line].length-1].c)
						));
						
						// If this macro takes arguments, send them in the request body
						var macroargs = "";
						if (restofline.charAt(0) === "(") {
							var opencount: number = 1;
							var closeidx: number = -1;
							for (let rlidx = 1; rlidx < restofline.length; rlidx++) {
								if (restofline.charAt(rlidx) === ")") {
									opencount--;
									if (opencount === 0) {
										closeidx = rlidx;
										break;
									}
								}
								else if (restofline.charAt(rlidx) === "(") {
									opencount++;
								}
							}
							if (closeidx !== -1) {
								// Get all of the arguments
								macroargs = restofline.slice(0,closeidx+1).replace(" ","");
							}
							else {
								// The argument list is incomplete
								macroargs = "incomplete";
							}
						}

						// If the arguments list is either not needed or complete, get the macro expansion
						if (macroargs !== "incomplete") {
							// Get the macro expansion from the server
							const expquerydata = {
								docname: maccon.docname,
								macroname: macrotext,
								arguments: macroargs,
								superclasses: maccon.superclasses,
								includes: maccon.includes,
								includegenerators: maccon.includegenerators,
								imports: maccon.imports,
								mode: maccon.mode
							};
							const exprespdata = await makeRESTRequest("POST",2,"/action/getmacroexpansion",server,expquerydata);
							if (exprespdata !== undefined && exprespdata.data.result.content.expansion.length > 0) {
								// We got data back
								const exptext = exprespdata.data.result.content.expansion.join("  \n");
								if (exptext.slice(0,5) === "ERROR") {
									// An error occurred while generating the expansion, so return the definition instead
									const defquerydata = {
										docname: maccon.docname,
										macroname: macrotext,
										superclasses: maccon.superclasses,
										includes: maccon.includes,
										includegenerators: maccon.includegenerators,
										imports: maccon.imports,
										mode: maccon.mode
									};
									const defrespdata = await makeRESTRequest("POST",2,"/action/getmacrodefinition",server,defquerydata);
									if (defrespdata !== undefined && defrespdata.data.result.content.definition.length > 0) {
										// The macro definition was found
										const parts = defrespdata.data.result.content.definition[0].trim().split(/[ ]+/);
										var defstr = "";
										if (parts[0].charAt(0) === "#") {
											defstr = parts.slice(2).join(" ");
										}
										else {
											defstr = parts.slice(1).join(" ");
										}
										return {
											contents: defstr,
											range: macrorange
										};
									}
								}
								else {
									// The expansion was generated successfully
									return {
										contents: exprespdata.data.result.content.expansion.join("  \n"),
										range: macrorange
									};
								}
							}
						}
						// If the argument list is incomplete, get the non-expanded definition
						else {
							// Get the macro definition from the server
							const inputdata = {
								docname: maccon.docname,
								macroname: macrotext,
								superclasses: maccon.superclasses,
								includes: maccon.includes,
								includegenerators: maccon.includegenerators,
								imports: maccon.imports,
								mode: maccon.mode
							};
							const respdata = await makeRESTRequest("POST",2,"/action/getmacrodefinition",server,inputdata);
							if (respdata !== undefined && respdata.data.result.content.definition.length > 0) {
								// The macro definition was found
								const parts = respdata.data.result.content.definition[0].trim().split(/[ ]+/);
								var defstr = "";
								if (parts[0].charAt(0) === "#") {
									defstr = parts.slice(2).join(" ");
								}
								else {
									defstr = parts.slice(1).join(" ");
								}
								return {
									contents: defstr,
									range: macrorange
								};
							}
						}
					}
				}
				else if (parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_sysf_attrindex && settings.hover.system) {
					// This is a system function
					const sysfrange = Range.create(Position.create(params.position.line,symbolstart),Position.create(params.position.line,symbolend));
					const sysftext = doc.getText(sysfrange).toUpperCase();
					const sysfdoc = systemFunctions.find((el) => el.label === sysftext || el.alias.includes(sysftext));
					if (sysfdoc !== undefined) {
						if (sysfdoc.link !== undefined) {
							if (sysfdoc.link.charAt(0) === "h") {
								return {
									contents: [sysfdoc.documentation.join(""),`[Online documentation](${sysfdoc.link})`],
									range: sysfrange
								};
							}
							else {
								return {
									contents: [sysfdoc.documentation.join(""),`[Online documentation](${"https://docs.intersystems.com/irislatest"}${sysfdoc.link})`],
									range: sysfrange
								};
							}
						}
						else {
							return {
								contents: sysfdoc.documentation.join(""),
								range: sysfrange
							};
						}
					}
				}
				else if (parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_ssysv_attrindex && settings.hover.system) {
					// This is a structured system variable
					var ssysvrange = Range.create(Position.create(params.position.line,symbolstart),Position.create(params.position.line,symbolend));
					var ssysvtext = doc.getText(ssysvrange).toUpperCase();
					if (ssysvtext === "^$") {
						// This is the first half, before the namespace

						// Continue looping on the line to find the second half
						var secondhalf = "";
						var secondhalfend = -1;
						for (let j = i+1; j < parsed[params.position.line].length; j++) {
							if (parsed[params.position.line][j].l == ld.cos_langindex && parsed[params.position.line][j].s == ld.cos_ssysv_attrindex) {
								secondhalf = doc.getText(Range.create(
									Position.create(params.position.line,parsed[params.position.line][j].p),
									Position.create(params.position.line,parsed[params.position.line][j].p+parsed[params.position.line][j].c)
								)).toUpperCase();
								secondhalfend = parsed[params.position.line][j].p+parsed[params.position.line][j].c;
								break;
							}
						}
						if (secondhalf === "") {
							// Couldn't find the rest of the structured system variable
							return null;
						}
						ssysvtext = ssysvtext + secondhalf;
						ssysvrange = Range.create(ssysvrange.start,Position.create(params.position.line,secondhalfend));
					}
					else if (ssysvtext.indexOf("^$") === -1) {
						// This is the second half, after the namespace

						// Loop backwards on the line to find the first half
						var firsthalfstart = -1;
						for (let j = i-1; j >= 0; j--) {
							if (parsed[params.position.line][j].l == ld.cos_langindex && parsed[params.position.line][j].s == ld.cos_ssysv_attrindex) {
								const firsthalf = doc.getText(Range.create(
									Position.create(params.position.line,parsed[params.position.line][j].p),
									Position.create(params.position.line,parsed[params.position.line][j].p+parsed[params.position.line][j].c)
								));
								if (firsthalf === "^$") {
									firsthalfstart = parsed[params.position.line][j].p;
								}
								break;
							}
						}
						if (firsthalfstart === -1) {
							// Couldn't find the rest of the structured system variable
							return null;
						}
						ssysvtext = "^$" + ssysvtext;
						ssysvrange = Range.create(Position.create(params.position.line,firsthalfstart),ssysvrange.end);
					}
					const ssysvdoc = structuredSystemVariables.find((el) => el.label === ssysvtext || el.alias.includes(ssysvtext));
					if (ssysvdoc !== undefined) {
						return {
							contents: [ssysvdoc.documentation.join(""),`[Online documentation](${"https://docs.intersystems.com/irislatest"}${ssysvdoc.link})`],
							range: ssysvrange
						};
					}
				}
				else if (parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_sysv_attrindex && settings.hover.system) {
					// This is a system variable
					const sysvrange = Range.create(Position.create(params.position.line,symbolstart),Position.create(params.position.line,symbolend));
					const sysvtext = doc.getText(sysvrange).toUpperCase();
					const sysvdoc = systemVariables.find((el) => el.label === sysvtext || el.alias.includes(sysvtext));
					if (sysvdoc !== undefined) {
						return {
							contents: [sysvdoc.documentation.join(""),`[Online documentation](${"https://docs.intersystems.com/irislatest"}${sysvdoc.link})`],
							range: sysvrange
						};
					}
				}
				else if (parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_command_attrindex && settings.hover.commands) {
					// This is a command
					const commandrange = Range.create(Position.create(params.position.line,symbolstart),Position.create(params.position.line,symbolend));
					const commandtext = doc.getText(commandrange).toUpperCase();
					var commanddoc: CommandDoc | undefined;
					if (commandtext === "H") {
						// This is "halt" or "hang"
						commanddoc = haltOrHang(doc,parsed,params.position.line,i);
					}
					else {
						commanddoc = commands.find((el) => el.label === commandtext|| el.alias.includes(commandtext));
					}
					if (commanddoc !== undefined) {
						return {
							contents: [commanddoc.documentation.join(""),`[Online documentation](${"https://docs.intersystems.com/irislatest"}${commanddoc.link})`],
							range: commandrange
						};
					}
				}
				else if (
					parsed[params.position.line][i].l == ld.cos_langindex && (
					parsed[params.position.line][i].s == ld.cos_prop_attrindex ||
					parsed[params.position.line][i].s == ld.cos_method_attrindex ||
					parsed[params.position.line][i].s == ld.cos_attr_attrindex ||
					parsed[params.position.line][i].s == ld.cos_mem_attrindex)
				) {
					// This is a class member (property/parameter/method)

					// Get the full text of the selection
					const memberrange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
					var member = doc.getText(memberrange);
					if (member.charAt(0) === "#") {
						member = member.slice(1);
					}
					const unquotedname = quoteUDLIdentifier(member,0);

					// Find the dot token
					var dottkn = 0;
					for (let tkn = 0; tkn < parsed[params.position.line].length; tkn++) {
						if (parsed[params.position.line][tkn].p >= memberrange.start.character) {
							break;
						}
						dottkn = tkn;
					}

					// Get the base class that this member is in
					const membercontext = await getClassMemberContext(doc,parsed,dottkn,params.position.line,server);
					if (membercontext.baseclass === "") {
						// If we couldn't determine the class, don't return anything
						return null;
					}
					
					// Query the server to get the description of this member using its base class, text and token type
					var data: QueryData = {
						query: "",
						parameters: []
					};
					if (parsed[params.position.line][i].s == ld.cos_prop_attrindex) {
						// This is a parameter
						data.query = "SELECT Description FROM %Dictionary.CompiledParameter WHERE parent->ID = ? AND name = ?";
						data.parameters = [membercontext.baseclass,unquotedname];
					}
					else if (parsed[params.position.line][i].s == ld.cos_method_attrindex) {
						// This is a method
						data.query = "SELECT Description FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND name = ?";
						data.parameters = [membercontext.baseclass,unquotedname];
					}
					else if (parsed[params.position.line][i].s == ld.cos_attr_attrindex) {
						// This is a property
						data.query = "SELECT Description FROM %Dictionary.CompiledProperty WHERE parent->ID = ? AND name = ?";
						data.parameters = [membercontext.baseclass,unquotedname];
					}
					else {
						// This is a generic member
						if (membercontext.baseclass.substr(0,7) === "%SYSTEM") {
							// This is always a method
							data.query = "SELECT Description FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND name = ?";
							data.parameters = [membercontext.baseclass,unquotedname];
						}
						else {
							// This can be a method or property
							data.query = "SELECT Description FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND name = ? UNION ALL ";
							data.query = data.query.concat("SELECT Description FROM %Dictionary.CompiledProperty WHERE parent->ID = ? AND name = ?");
							data.parameters = [membercontext.baseclass,unquotedname,membercontext.baseclass,unquotedname];
						}
					}
					const respdata = await makeRESTRequest("POST",1,"/action/query",server,data);
					if (respdata !== undefined) {
						if ("content" in respdata.data.result && respdata.data.result.content.length > 0) {
							// We got data back
							var header = membercontext.baseclass.concat("::",member);
							const nextchar = doc.getText(Range.create(Position.create(params.position.line,memberrange.end.character),Position.create(params.position.line,memberrange.end.character+1)));
							if (nextchar === "(") {
								header = header.concat("()");
							}
							return {
								contents: [header,respdata.data.result.content[0].Description],
								range: memberrange
							};
						}
						else {
							// Query completed successfully but we got back no data.
							// This likely means that the base class hasn't been compiled yet or the member had the wrong token type.
							return null;
						}
					}
				}
				else if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_keyword_attrindex) {
					// This is a UDL keyword
					
					// Scan left on the line to see if we're in a set of square brackets
					var foundopenbracket = false;
					for (let j = i-1; j >= 0; j--) {
						if (parsed[params.position.line][j].l == ld.cls_langindex && parsed[params.position.line][j].s == ld.cls_delim_attrindex) {
							// This is a UDL delimiter
							const delim = doc.getText(
								Range.create(
									Position.create(params.position.line,parsed[params.position.line][j].p),
									Position.create(params.position.line,parsed[params.position.line][j].p+1)
								)
							);
							if (delim === "[") {
								foundopenbracket = true;
								break;
							}
						}
					}
					if (foundopenbracket) {
						// This is a trailing keyword
						const thiskeyrange = Range.create(Position.create(params.position.line,symbolstart),Position.create(params.position.line,symbolend));
						const thiskeytext = doc.getText(thiskeyrange).toLowerCase();
						const firstkey = doc.getText(
							Range.create(
								Position.create(params.position.line,parsed[params.position.line][0].p),
								Position.create(params.position.line,parsed[params.position.line][0].p+parsed[params.position.line][0].c)
							)
						).toLowerCase();
						var thiskeydoc: KeywordDoc | undefined;
						if (firstkey === "class") {
							// This is a class keyword
							thiskeydoc = <KeywordDoc>classKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
						}
						else if (firstkey === "constraint") {
							// This is a constraint keyword
							thiskeydoc = <KeywordDoc>constraintKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
						}
						else if (firstkey === "foreignkey") {
							// This is a ForeignKey keyword
							thiskeydoc = <KeywordDoc>foreignkeyKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
						}
						else if (firstkey === "index") {
							// This is a index keyword
							thiskeydoc = <KeywordDoc>indexKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
						}
						else if (firstkey === "method" || firstkey === "classmethod") {
							// This is a method keyword
							thiskeydoc = <KeywordDoc>methodKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
						}
						else if (firstkey === "parameter") {
							// This is a parameter keyword
							thiskeydoc = <KeywordDoc>parameterKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
						}
						else if (firstkey === "projection") {
							// This is a projection keyword
							thiskeydoc = <KeywordDoc>projectionKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
						}
						else if (firstkey === "property") {
							// This is a property keyword
							thiskeydoc = <KeywordDoc>propertyKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
						}
						else if (firstkey === "query") {
							// This is a query keyword
							thiskeydoc = <KeywordDoc>queryKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
						}
						else if (firstkey === "trigger") {
							// This is a trigger keyword
							thiskeydoc = <KeywordDoc>triggerKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
						}
						else if (firstkey === "xdata") {
							// This is an XData keyword
							thiskeydoc = <KeywordDoc>xdataKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
						}
						if (thiskeydoc !== undefined) {
							if ("constraint" in thiskeydoc && thiskeydoc.constraint instanceof Array) {
								return {
									contents: [thiskeydoc.description,"Permitted values: "+thiskeydoc.constraint.join(", ")],
									range: thiskeyrange
								};
							}
							else {
								return {
									contents: thiskeydoc.description,
									range: thiskeyrange
								};
							}
						}
					}
				}
				else if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_iden_attrindex) {
					// This is a UDL identifier
					
					const prevtokentext = doc.getText(Range.create(
						Position.create(params.position.line,parsed[params.position.line][i-1].p),
						Position.create(params.position.line,parsed[params.position.line][i-1].p+parsed[params.position.line][i-1].c)
					)).toLowerCase();
					if (parsed[params.position.line][i-1].l == ld.cls_langindex && parsed[params.position.line][i-1].s == ld.cls_keyword_attrindex && prevtokentext === "as") {
						// This is a parameter type
						
						const tokenrange = Range.create(
							Position.create(params.position.line,parsed[params.position.line][i].p),
							Position.create(params.position.line,parsed[params.position.line][i].p+parsed[params.position.line][i].c)
						);
						const tokentext = doc.getText(tokenrange).toUpperCase();
						const thistypedoc = parameterTypes.find((typedoc) => typedoc.name === tokentext);
						if (thistypedoc !== undefined) {
							return {
								contents: thistypedoc.documentation,
								range: tokenrange
							};
						}
					}
				}
				else if (parsed[params.position.line][i].l == ld.sql_langindex && parsed[params.position.line][i].s == ld.sql_iden_attrindex) {
					// This is a SQL identifier
					
					// Get the full text of the selection
					const idenrange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
					const iden = doc.getText(idenrange);
					
					// Find the preceding keyword (other than 'AS')
					var keytext: string = "";
					for (let ln = params.position.line; ln >= 0; ln--) {
						for (let tk = parsed[ln].length-1; tk >= 0; tk--) {
							if (ln === params.position.line && parsed[ln][tk].p >= idenrange.start.character) {
								// Start looking when we pass the full range of the selected identifier
								continue;
							}
							if (
								parsed[ln][tk].l == ld.sql_langindex &&
								(parsed[ln][tk].s == ld.sql_skey_attrindex || parsed[ln][tk].s == ld.sql_qkey_attrindex || parsed[ln][tk].s == ld.sql_ekey_attrindex)
							) {
								// This is a keyword
								const tmpkeytext = doc.getText(Range.create(
									Position.create(ln,parsed[ln][tk].p),
									Position.create(ln,parsed[ln][tk].p+parsed[ln][tk].c)
								)).toLowerCase();
								if (tmpkeytext !== "as") {
									// Found the correct keyword
									keytext = tmpkeytext;
									break;
								}
							}
						}
						if (keytext !== "") {
							// Found the correct keyword
							break;
						}
					}
					
					if (
						(keytext === "join" || keytext === "from" || keytext === "into" ||
						keytext=== "lock" || keytext === "unlock" || keytext === "table" ||
						keytext === "update")
					) {
						// This identifier is a table name

						if (iden.lastIndexOf("_") > iden.lastIndexOf(".")) {
							// This table is projected from a multi-dimensional property

							// Split the identifier into the class and property
							const clsname = iden.slice(0,iden.lastIndexOf("_")).replace(/_/g,".");
							const propname = iden.slice(iden.lastIndexOf("_")+1);

							// Normalize the class name if there are imports
							const normalizedname = await normalizeClassname(doc,parsed,clsname,server,params.position.line);
							if (normalizedname !== "") {
								// Query the server to get the description of this property
								const data: QueryData = {
									query: "SELECT Description FROM %Dictionary.CompiledProperty WHERE parent->ID = ? AND name = ?",
									parameters: [normalizedname,propname]
								};
								const respdata = await makeRESTRequest("POST",1,"/action/query",server,data);
								if (respdata !== undefined && "content" in respdata.data.result && respdata.data.result.content.length > 0) {
									// We got data back
									return {
										contents: [normalizedname.concat("::",propname),respdata.data.result.content[0].Description],
										range: idenrange
									};
								}
							}
						}
						else {
							// This table is a class

							// Normalize the class name if there are imports
							const normalizedname = await normalizeClassname(doc,parsed,iden.replace(/_/g,"."),server,params.position.line);
							if (normalizedname !== "") {
								// Get the description for this class from the server
								const respdata = await makeRESTRequest("POST",1,"/action/index",server,[normalizedname.concat(".cls")]);
								if (respdata !== undefined && respdata.data.result.content.length === 1 && respdata.data.result.content[0].status === "") {
									// The class was found
									return {
										contents: [normalizedname,respdata.data.result.content[0].content.desc.join(" ")],
										range: idenrange
									};
								}
							}
						}
					}
					else if (keytext === "call" && iden.indexOf("_") !== -1) {
						// This identifier is a Query or ClassMethod being invoked as a SqlProc

						const clsname = iden.slice(0,iden.lastIndexOf("_")).replace(/_/g,".");
						const procname = iden.slice(iden.lastIndexOf("_")+1);
						
						// Normalize the class name if there are imports
						const normalizedname = await normalizeClassname(doc,parsed,clsname,server,params.position.line);
						if (normalizedname !== "") {
							// Query the server to get the description
							var querystr = "SELECT Description FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND name = ? UNION ALL ";
							querystr = querystr.concat("SELECT Description FROM %Dictionary.CompiledQuery WHERE parent->ID = ? AND name = ?");
							const data: QueryData = {
								query: querystr,
								parameters: [normalizedname,procname,normalizedname,procname]
							};
							const respdata = await makeRESTRequest("POST",1,"/action/query",server,data);
							if (respdata !== undefined && "content" in respdata.data.result && respdata.data.result.content.length > 0) {
								// We got data back
								return {
									contents: [normalizedname.concat("::",procname),respdata.data.result.content[0].Description],
									range: idenrange
								};
							}
						}
					}
					else {
						// This identifier is a property
						if ((iden.split(".").length - 1) > 0) {
							// We won't resolve properties that don't contain the table name
							const tblname = iden.slice(0,iden.lastIndexOf("."));
							const propname = iden.slice(iden.lastIndexOf(".")+1);

							if (tblname.lastIndexOf("_") > tblname.lastIndexOf(".")) {
								// This table is projected from a multi-dimensional property, so we can't provide any info
							}
							else {
								// Normalize the class name if there are imports
								const normalizedname = await normalizeClassname(doc,parsed,tblname.replace(/_/g,"."),server,params.position.line);
								if (normalizedname !== "") {
									// Query the server to get the description of this property
									const data: QueryData = {
										query: "SELECT Description FROM %Dictionary.CompiledProperty WHERE parent->ID = ? AND name = ?",
										parameters: [normalizedname,propname]
									};
									const respdata = await makeRESTRequest("POST",1,"/action/query",server,data);
									if (respdata !== undefined && "content" in respdata.data.result && respdata.data.result.content.length > 0) {
										// We got data back
										return {
											contents: [normalizedname.concat("::",propname),respdata.data.result.content[0].Description],
											range: idenrange
										};
									}
								}
							}
						}
					}
				}
				else if (parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_ppc_attrindex && settings.hover.preprocessor) {
					// This is a preprocessor directive

					// Get the full text of the selection
					const pprange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
					const pp = doc.getText(pprange);

					// Find the correct directive
					const ppobj = preprocessorDirectives.find((el) => el.label.toLowerCase().replace(/\s+/g,'') === pp.toLowerCase());
					if (ppobj !== undefined) {
						return {
							contents: [ppobj.documentation,`[Online documentation](${"https://docs.intersystems.com/irislatest"}${ppobj.link})`],
							range: pprange
						};
					}
				}
				break;
			}
		}
	}
);

// This handler provides 'go to definition' functionality.
connection.onDefinition(
	async (params: TextDocumentPositionParams) => {
		const parsed = parsedDocuments.get(params.textDocument.uri);
		if (parsed === undefined) {return null;}
		const doc = documents.get(params.textDocument.uri);
		if (doc === undefined) {return null;}
		const server: ServerSpec = await getServerSpec(params.textDocument.uri);

		for (let i = 0; i < parsed[params.position.line].length; i++) {
			const symbolstart: number = parsed[params.position.line][i].p;
			const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
			if (params.position.character >= symbolstart && params.position.character <= symbolend) {
				// We found the right symbol in the line
				
				if (((parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_clsname_attrindex) ||
				(parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_clsname_attrindex))
				&& doc.getText(Range.create(Position.create(params.position.line,0),Position.create(params.position.line,6))).toLowerCase() !== "import") {
					// This is a class name
					
					// Get the full text of the selection
					let wordrange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
					let word = doc.getText(wordrange);
					if (word.charAt(0) === ".") {
						// This might be $SYSTEM.ClassName
						const prevseven = doc.getText(Range.create(
							Position.create(params.position.line,wordrange.start.character-7),
							Position.create(params.position.line,wordrange.start.character)
						));
						if (prevseven.toUpperCase() === "$SYSTEM") {
							// This is $SYSTEM.ClassName
							word = "%SYSTEM" + word;
						}
						else {
							// This classname is invalid
							return null;
						}
					}
					if (word.charAt(0) === '"') {
						// This classname is delimited with ", so strip them
						word = word.slice(1,-1);
					}

					// Normalize the class name if there are imports
					let normalizedname = await normalizeClassname(doc,parsed,word,server,params.position.line);

					// Get the full text of this class
					const respdata = await makeRESTRequest("GET",1,"/doc/".concat(normalizedname,".cls"),server);
					if (respdata !== undefined && respdata.data.result.status === "") {
						// The class was found

						// Loop through the file contents to find this member
						var resultrange = Range.create(Position.create(0,0),Position.create(0,0));
						for (let j = 0; j < respdata.data.result.content.length; j++) {
							if (respdata.data.result.content[j].substr(0,5).toLowerCase() === "class") {
								// This line is the class definition
								resultrange = Range.create(Position.create(j,0),Position.create(j,0));
								break;
							}
						}
						const newuri = await createDefinitionUri(params.textDocument.uri,normalizedname,".cls");
						if (newuri !== "") {
							return {
								uri: newuri,
								range: resultrange
							};
						}
					}
				}
				else if (parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_macro_attrindex ) {
					// This is a macro

					// Get the details of this class
					const maccon = getMacroContext(doc,parsed,params.position.line);

					// Get the full range of the macro
					const macrorange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
					var macrotext = doc.getText(macrorange);
					if (macrotext.slice(0,3) === "$$$") {
						macrotext = macrotext.slice(3);
					}

					// Check if the macro definition appears in the current file
					const macrodefline = isMacroDefinedAbove(doc,parsed,params.position.line,macrotext);

					if (macrodefline !== -1) {
						// The macro definition is in the current file

						return {
							uri: params.textDocument.uri,
							range: Range.create(Position.create(macrodefline,0),Position.create(macrodefline,0))
						};
					}
					else {
						// The macro is defined in another file

						// Get the macro location from the server
						const inputdata = {
							docname: maccon.docname,
							macroname: macrotext,
							superclasses: maccon.superclasses,
							includes: maccon.includes,
							includegenerators: maccon.includegenerators,
							imports: maccon.imports,
							mode: maccon.mode
						};
						const respdata = await makeRESTRequest("POST",2,"/action/getmacrolocation",server,inputdata);
						if (respdata !== undefined && respdata.data.result.content.document !== "") {
							// The macro was found in a document
							const lastdot = respdata.data.result.content.document.lastIndexOf(".");
							const filename = respdata.data.result.content.document.substring(0,lastdot);
							const ext = respdata.data.result.content.document.substring(lastdot);
							const newuri = await createDefinitionUri(params.textDocument.uri,filename,ext);
							if (newuri !== "") {
								return {
									uri: newuri,
									range: Range.create(Position.create(respdata.data.result.content.line,0),Position.create(respdata.data.result.content.line,0))
								};
							}
						}
					}
				}
				else if (
					parsed[params.position.line][i].l == ld.cos_langindex && (
					parsed[params.position.line][i].s == ld.cos_prop_attrindex ||
					parsed[params.position.line][i].s == ld.cos_method_attrindex ||
					parsed[params.position.line][i].s == ld.cos_attr_attrindex ||
					parsed[params.position.line][i].s == ld.cos_mem_attrindex)
				) {
					// This is a class member (property/parameter/method)

					// Get the full text of the selection
					const memberrange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
					var member = doc.getText(memberrange);
					if (member.charAt(0) === "#") {
						member = member.slice(1);
					}
					const unquotedname = quoteUDLIdentifier(member,0);

					// Find the dot token
					var dottkn = 0;
					for (let tkn = 0; tkn < parsed[params.position.line].length; tkn ++) {
						if (parsed[params.position.line][tkn].p >= memberrange.start.character) {
							break;
						}
						dottkn = tkn;
					}

					// Get the base class that this member is in
					const membercontext = await getClassMemberContext(doc,parsed,dottkn,params.position.line,server);
					if (membercontext.baseclass === "") {
						// If we couldn't determine the class, don't return anything
						return null;
					}

					// If this is a class file, determine what class we're in
					var thisclass = "";
					if (doc.languageId === "objectscript-class") {
						for (let ln = 0; ln < parsed.length; ln++) {
							if (parsed[ln].length === 0) {
								continue;
							}
							else if (parsed[ln][0].l == ld.cls_langindex && parsed[ln][0].s == ld.cls_keyword_attrindex) {
								// This line starts with a UDL keyword
					
								var keyword = doc.getText(Range.create(Position.create(ln,parsed[ln][0].p),Position.create(ln,parsed[ln][0].p+parsed[ln][0].c))).toLowerCase();
								if (keyword === "class") {
									thisclass = doc.getText(findFullRange(ln,parsed,1,parsed[ln][1].p,parsed[ln][1].p+parsed[ln][1].c));
									break;
								}
							}
						}
					}

					var targetrange = Range.create(Position.create(0,0),Position.create(0,0));
					if (thisclass === membercontext.baseclass) {
						// The member may be defined in this class

						// Loop through the file contents to find this member
						for (let dln = 0; dln < parsed.length; dln++) {
							if (parsed[dln].length === 0) {
								continue;
							}
							else if (parsed[dln][0].l == ld.cls_langindex && parsed[dln][0].s == ld.cls_keyword_attrindex) {
								// This line starts with a UDL keyword
					
								var keyword = doc.getText(Range.create(Position.create(dln,parsed[dln][0].p),Position.create(dln,parsed[dln][0].p+parsed[dln][0].c))).toLowerCase();
								if (keyword.indexOf("method") !== -1 || keyword.indexOf("property") !== -1 || keyword.indexOf("parameter") !== -1) {
									const thismemberrange = findFullRange(dln,parsed,1,parsed[dln][1].p,parsed[dln][1].p+parsed[dln][1].c);
									const thismember = doc.getText(thismemberrange);
									if (thismember === member) {
										// We found the member
										targetrange = thismemberrange;
										break;
									}
								}
							}
						}
						if (targetrange.start.line !== 0) {
							return {
								uri: params.textDocument.uri,
								range: targetrange
							};
						}
					}
					// The member is defined in another class

					// Query the server to get the origin class of this member using its base class, text and token type
					var data: QueryData = {
						query: "",
						parameters: []
					};
					if (parsed[params.position.line][i].s == ld.cos_prop_attrindex) {
						// This is a parameter
						data.query = "SELECT Origin FROM %Dictionary.CompiledParameter WHERE parent->ID = ? AND name = ?";
						data.parameters = [membercontext.baseclass,unquotedname];
					}
					else if (parsed[params.position.line][i].s == ld.cos_method_attrindex) {
						// This is a method
						data.query = "SELECT Origin FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND name = ?";
						data.parameters = [membercontext.baseclass,unquotedname];
					}
					else if (parsed[params.position.line][i].s == ld.cos_attr_attrindex) {
						// This is a property
						data.query = "SELECT Origin FROM %Dictionary.CompiledProperty WHERE parent->ID = ? AND name = ?";
						data.parameters = [membercontext.baseclass,unquotedname];
					}
					else {
						// This is a generic member
						if (membercontext.baseclass.substr(0,7) === "%SYSTEM") {
							// This is always a method
							data.query = "SELECT Origin FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND name = ?";
							data.parameters = [membercontext.baseclass,unquotedname];
						}
						else {
							// This can be a method or property
							data.query = "SELECT Origin FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND name = ? UNION ALL ";
							data.query = data.query.concat("SELECT Origin FROM %Dictionary.CompiledProperty WHERE parent->ID = ? AND name = ?");
							data.parameters = [membercontext.baseclass,unquotedname,membercontext.baseclass,unquotedname];
						}
					}
					const queryrespdata = await makeRESTRequest("POST",1,"/action/query",server,data);
					if (queryrespdata !== undefined) {
						if ("content" in queryrespdata.data.result && queryrespdata.data.result.content.length > 0) {
							// We got data back

							// Get the full text of the origin class
							const originclass = queryrespdata.data.result.content[0].Origin;
							const docrespdata = await makeRESTRequest("GET",1,"/doc/".concat(originclass,".cls"),server);
							if (docrespdata !== undefined && docrespdata.data.result.status === "") {
								// The class was found
	
								// Loop through the file contents to find this member
								for (let j = 0; j < docrespdata.data.result.content.length; j++) {
									if (
										(docrespdata.data.result.content[j].split(" ",1)[0].toLowerCase().indexOf("method") !== -1) ||
										(docrespdata.data.result.content[j].split(" ",1)[0].toLowerCase().indexOf("property") !== -1) ||
										(docrespdata.data.result.content[j].split(" ",1)[0].toLowerCase().indexOf("parameter") !== -1)
									) {
										// This is the right type of class member
										const searchstr = docrespdata.data.result.content[j].slice(docrespdata.data.result.content[j].indexOf(" ")+1).trim();
										if (searchstr.indexOf(member) === 0) {
											// This is the right member
											const memberlineidx = docrespdata.data.result.content[j].indexOf(searchstr);
											targetrange = Range.create(Position.create(j,memberlineidx),Position.create(j,memberlineidx+member.length-1));
											break;
										}
									}
								}
								const newuri = await createDefinitionUri(params.textDocument.uri,originclass,".cls");
								if (newuri !== "") {
									return {
										uri: newuri,
										range: targetrange
									};
								}
							}
						}
						else {
							// Query completed successfully but we got back no data.
							// This likely means that the base class hasn't been compiled yet or the member had the wrong token type.
							return null;
						}
					}
				}
				else if ((parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_rtnname_attrindex) ||
				(parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_rtnname_attrindex)) {
					// This is a routine name

					// Get the full text of the selection
					let word = doc.getText(findFullRange(params.position.line,parsed,i,symbolstart,symbolend));

					// Determine if this is an include file
					var isinc = false;
					if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_rtnname_attrindex) {
						isinc = true;
					}
					else {
						if (
							parsed[params.position.line][i-1].l == ld.cos_langindex &&
							parsed[params.position.line][i-1].s == ld.cos_ppc_attrindex &&
							doc.getText(
								Range.create(
									Position.create(params.position.line,parsed[params.position.line][i-1].p),
									Position.create(params.position.line,parsed[params.position.line][i-1].p+parsed[params.position.line][i-1].c)
								)
							).toLowerCase() === "include"
						) {
							isinc = true
						}
					}
					if (isinc) {
						const newuri = await createDefinitionUri(params.textDocument.uri,word,".inc");
						if (newuri !== "") {
							return {
								uri: newuri,
								range: Range.create(Position.create(0,0),Position.create(0,0))
							};
						}
					}
					else {
						// Check if this routine is a MAC or INT
						const respdata = await makeRESTRequest("POST",1,"/action/index",server,[word+".int"]);
						if (respdata !== undefined && respdata.data.result.content.length > 0 && respdata.data.result.content[0].status === "") {
							if (respdata.data.result.content[0].others.length > 0 && respdata.data.result.content[0].others[0].slice(-3) === "mac") {
								// This is a MAC routine
								const newuri = await createDefinitionUri(params.textDocument.uri,word,".mac");
								if (newuri !== "") {
									return {
										uri: newuri,
										range: Range.create(Position.create(0,0),Position.create(0,0))
									};
								}
							}
							else {
								// This is an INT routine
								const newuri = await createDefinitionUri(params.textDocument.uri,word,".int");
								if (newuri !== "") {
									return {
										uri: newuri,
										range: Range.create(Position.create(0,0),Position.create(0,0))
									};
								}
							}
						}
					}
				}
				else if ((parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_label_attrindex) ||
				(parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_extrfn_attrindex)) {
					// This is a routine label

					// Get the text of the label
					var label: string;
					if (parsed[params.position.line][i].s == ld.cos_extrfn_attrindex) {
						// This is the $$ before the label
						label = doc.getText(findFullRange(params.position.line,parsed,i+1,parsed[params.position.line][i+1].p,parsed[params.position.line][i+1].p+parsed[params.position.line][i+1].c));
					}
					else {
						// This is the label
						label = doc.getText(findFullRange(params.position.line,parsed,i,symbolstart,symbolend));
					}

					// Get the text of the routine name
					var routine = "";
					for (let j = i+1; j < parsed[params.position.line].length; j++) {
						if (parsed[params.position.line][j].l == ld.cos_langindex && parsed[params.position.line][j].s == ld.cos_rtnname_attrindex) {
							// This is the routine name
							routine = doc.getText(
								Range.create(
									Position.create(params.position.line,parsed[params.position.line][j].p),
									Position.create(params.position.line,parsed[params.position.line][j].p+parsed[params.position.line][j].c)
								)
							);
							break;
						}
					}

					if (routine !== "") {
						// This label is in another routine

						// Check if this routine is a MAC or INT
						const indexrespdata = await makeRESTRequest("POST",1,"/action/index",server,[routine+".int"]);
						if (indexrespdata !== undefined && indexrespdata.data.result.content.length > 0 && indexrespdata.data.result.content[0].status === "") {
							var ext = ".int";
							if (indexrespdata.data.result.content[0].others.length > 0 && indexrespdata.data.result.content[0].others[0].slice(-3) === "mac") {
								// This is a MAC routine
								ext = ".mac";
							}

							// Get the full text of the other routine
							const respdata = await makeRESTRequest("GET",1,"/doc/".concat(routine,ext),server);
							if (respdata !== undefined && respdata.data.result.status === "") {
								// The routine was found

								// Loop through the file contents to find this label
								var resultrange = Range.create(Position.create(0,0),Position.create(0,0));
								for (let k = 0; k < respdata.data.result.content.length; k++) {
									if (respdata.data.result.content[k].substr(0,label.length).toLowerCase() === label.toLowerCase()) {
										// This is the label definition
										resultrange = Range.create(Position.create(k,0),Position.create(k,label.length));
										break;
									}
								}
								const newuri = await createDefinitionUri(params.textDocument.uri,routine,ext);
								if (newuri !== "") {
									return {
										uri: newuri,
										range: resultrange
									};
								}
							}
						}
					}
					else {
						// This label is in the current routine

						var resultrange = Range.create(Position.create(0,0),Position.create(0,0));
						for (let line = 0; line < parsed.length; line++) {
							if (parsed[line].length > 0 && parsed[line][0].l == ld.cos_langindex && parsed[line][0].s == ld.cos_label_attrindex) {
								// This is a label
								const firstwordrange = Range.create(Position.create(line,parsed[line][0].p),Position.create(line,parsed[line][0].p+parsed[line][0].c));
								const firstwordtext = doc.getText(firstwordrange);
								if (firstwordtext.toLowerCase() === label.toLowerCase()) {
									// This is the correct label
									resultrange = firstwordrange;
									break;
								}
							}
						}
						return {
							uri: params.textDocument.uri,
							range: resultrange
						};
					}
				}
				else if (parsed[params.position.line][i].l == ld.sql_langindex && parsed[params.position.line][i].s == ld.sql_iden_attrindex) {
					// This is a SQL identifier
					
					// Get the full text of the selection
					const idenrange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
					const iden = doc.getText(idenrange);
					
					// Find the preceding keyword (other than 'AS')
					var keytext: string = "";
					for (let ln = params.position.line; ln >= 0; ln--) {
						for (let tk = i; tk >= 0; tk--) {
							if (ln === params.position.line && parsed[ln][tk].p >= idenrange.start.character) {
								// Start looking when we pass the full range of the selected identifier
								continue;
							}
							if (
								parsed[ln][tk].l == ld.sql_langindex &&
								(parsed[ln][tk].s == ld.sql_skey_attrindex || parsed[ln][tk].s == ld.sql_qkey_attrindex || parsed[ln][tk].s == ld.sql_ekey_attrindex)
							) {
								// This is a keyword
								const tmpkeytext = doc.getText(Range.create(
									Position.create(ln,parsed[ln][tk].p),
									Position.create(ln,parsed[ln][tk].p+parsed[ln][tk].c)
								)).toLowerCase();
								if (tmpkeytext !== "as") {
									// Found the correct keyword
									keytext = tmpkeytext;
									break;
								}
							}
						}
						if (keytext !== "") {
							// Found the correct keyword
							break;
						}
					}
					
					if (
						(keytext === "join" || keytext === "from" || keytext === "into" ||
						keytext=== "lock" || keytext === "unlock" || keytext === "table" ||
						keytext === "update")
					) {
						// This identifier is a table name

						if (iden.lastIndexOf("_") > iden.lastIndexOf(".")) {
							// This table is projected from a multi-dimensional property

							// Split the identifier into the class and property
							const clsname = iden.slice(0,iden.lastIndexOf("_")).replace(/_/g,".");
							const propname = iden.slice(iden.lastIndexOf("_")+1);

							// Normalize the class name if there are imports
							const normalizedname = await normalizeClassname(doc,parsed,clsname,server,params.position.line);
							if (normalizedname !== "") {
								// Query the server to get the origin class of this property
								const data: QueryData = {
									query: "SELECT Origin FROM %Dictionary.CompiledProperty WHERE parent->ID = ? AND name = ?",
									parameters: [normalizedname,propname]
								};
								const queryrespdata = await makeRESTRequest("POST",1,"/action/query",server,data);
								if (queryrespdata !== undefined) {
									if ("content" in queryrespdata.data.result && queryrespdata.data.result.content.length > 0) {
										// We got data back

										// Get the full text of the origin class
										const originclass = queryrespdata.data.result.content[0].Origin;
										const docrespdata = await makeRESTRequest("GET",1,"/doc/".concat(originclass,".cls"),server);
										if (docrespdata !== undefined && docrespdata.data.result.status === "") {
											// The class was found
				
											// Loop through the file contents to find this member
											var targetrange = Range.create(Position.create(0,0),Position.create(0,0));
											for (let j = 0; j < docrespdata.data.result.content.length; j++) {
												if (docrespdata.data.result.content[j].split(" ",1)[0].toLowerCase().indexOf("property") !== -1) {
													// This is the right type of class member
													var memberlineidx = docrespdata.data.result.content[j].indexOf(propname);
													if (memberlineidx !==  -1) {
														// This is the right member
														targetrange = Range.create(Position.create(j,memberlineidx),Position.create(j,memberlineidx+propname.length-1));
														break;
													}
												}
											}
											const newuri = await createDefinitionUri(params.textDocument.uri,originclass,".cls");
											if (newuri !== "") {
												return {
													uri: newuri,
													range: targetrange
												};
											}
										}
									}
									else {
										// Query completed successfully but we got back no data.
										// This likely means that the base class hasn't been compiled yet or the member had the wrong token type.
										return null;
									}
								}
							}
						}
						else {
							// This table is a class

							// Normalize the class name if there are imports
							const normalizedname = await normalizeClassname(doc,parsed,iden.replace(/_/g,"."),server,params.position.line);
							if (normalizedname !== "") {
								// Get the full text of this class
								const respdata = await makeRESTRequest("GET",1,"/doc/".concat(normalizedname,".cls"),server);
								if (respdata !== undefined && respdata.data.result.status === "") {
									// The class was found

									// Loop through the file contents to find this member
									var resultrange = Range.create(Position.create(0,0),Position.create(0,0));
									for (let j = 0; j < respdata.data.result.content.length; j++) {
										if (respdata.data.result.content[j].substr(0,5).toLowerCase() === "class") {
											// This line is the class definition
											resultrange = Range.create(Position.create(j,0),Position.create(j,0));
											break;
										}
									}
									const newuri = await createDefinitionUri(params.textDocument.uri,normalizedname,".cls");
									if (newuri !== "") {
										return {
											uri: newuri,
											range: resultrange
										};
									}
								}
							}
						}
					}
					else if (keytext === "call" && iden.indexOf("_") !== -1) {
						// This identifier is a Query or ClassMethod being invoked as a SqlProc

						const clsname = iden.slice(0,iden.lastIndexOf("_")).replace(/_/g,".");
						const procname = iden.slice(iden.lastIndexOf("_")+1);

						// Normalize the class name if there are imports
						const normalizedname = await normalizeClassname(doc,parsed,clsname,server,params.position.line);
						if (normalizedname !== "") {
							// Query the server to get the origin class
							var querystr = "SELECT Origin FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND name = ? UNION ALL ";
							querystr = querystr.concat("SELECT Origin FROM %Dictionary.CompiledQuery WHERE parent->ID = ? AND name = ?");
							const data: QueryData = {
								query: querystr,
								parameters: [normalizedname,procname,normalizedname,procname]
							};
							const queryrespdata = await makeRESTRequest("POST",1,"/action/query",server,data);
							if (queryrespdata !== undefined && "content" in queryrespdata.data.result && queryrespdata.data.result.content.length > 0) {
								// We got data back

								// Get the full text of the origin class
								const originclass = queryrespdata.data.result.content[0].Origin;
								const docrespdata = await makeRESTRequest("GET",1,"/doc/".concat(originclass,".cls"),server);
								if (docrespdata !== undefined && docrespdata.data.result.status === "") {
									// The class was found
		
									// Loop through the file contents to find this member
									var targetrange = Range.create(Position.create(0,0),Position.create(0,0));
									for (let j = 0; j < docrespdata.data.result.content.length; j++) {
										if (
											(docrespdata.data.result.content[j].split(" ",1)[0].toLowerCase().indexOf("property") !== -1) ||
											(docrespdata.data.result.content[j].split(" ",1)[0].toLowerCase().indexOf("query") !== -1)
										) {
											// This is the right type of class member
											var memberlineidx = docrespdata.data.result.content[j].indexOf(procname);
											if (memberlineidx !==  -1) {
												// This is the right member
												targetrange = Range.create(Position.create(j,memberlineidx),Position.create(j,memberlineidx+procname.length-1));
												break;
											}
										}
									}
									const newuri = await createDefinitionUri(params.textDocument.uri,originclass,".cls");
									if (newuri !== "") {
										return {
											uri: newuri,
											range: targetrange
										};
									}
								}
							}
						}
					}
					else {
						// This identifier is a property
						if ((iden.split(".").length - 1) > 0) {
							// We won't resolve properties that don't contain the table name
							const tblname = iden.slice(0,iden.lastIndexOf("."));
							const propname = iden.slice(iden.lastIndexOf(".")+1);

							if (tblname.lastIndexOf("_") > tblname.lastIndexOf(".")) {
								// This table is projected from a multi-dimensional property, so we can't provide any info
							}
							else {
								// Normalize the class name if there are imports
								const normalizedname = await normalizeClassname(doc,parsed,tblname.replace(/_/g,"."),server,params.position.line);
								if (normalizedname !== "") {
									// Query the server to get the origin class of this property
									const data: QueryData = {
										query: "SELECT Origin FROM %Dictionary.CompiledProperty WHERE parent->ID = ? AND name = ?",
										parameters: [normalizedname,propname]
									};
									const queryrespdata = await makeRESTRequest("POST",1,"/action/query",server,data);
									if (queryrespdata !== undefined) {
										if ("content" in queryrespdata.data.result && queryrespdata.data.result.content.length > 0) {
											// We got data back

											// Get the full text of the origin class
											const originclass = queryrespdata.data.result.content[0].Origin;
											const docrespdata = await makeRESTRequest("GET",1,"/doc/".concat(originclass,".cls"),server);
											if (docrespdata !== undefined && docrespdata.data.result.status === "") {
												// The class was found
					
												// Loop through the file contents to find this member
												var targetrange = Range.create(Position.create(0,0),Position.create(0,0));
												for (let j = 0; j < docrespdata.data.result.content.length; j++) {
													if (docrespdata.data.result.content[j].split(" ",1)[0].toLowerCase().indexOf("property") !== -1) {
														// This is the right type of class member
														var memberlineidx = docrespdata.data.result.content[j].indexOf(propname);
														if (memberlineidx !==  -1) {
															// This is the right member
															targetrange = Range.create(Position.create(j,memberlineidx),Position.create(j,memberlineidx+propname.length-1));
															break;
														}
													}
												}
												const newuri = await createDefinitionUri(params.textDocument.uri,originclass,".cls");
												if (newuri !== "") {
													return {
														uri: newuri,
														range: targetrange
													};
												}
											}
										}
										else {
											// Query completed successfully but we got back no data.
											// This likely means that the base class hasn't been compiled yet or the member had the wrong token type.
											return null;
										}
									}
								}
							}
						}
					}
				}
				break;
			}
		}
		return null;
	}
);

connection.languages.semanticTokens.on(
	(params: Proposed.SemanticTokensParams) => {
		try {
			const doc = documents.get(params.textDocument.uri);
			if (doc === undefined) {return { data: [] };}

			// generate the moniker
			var moninfo: monikerinfo | undefined = undefined;
			if (doc.languageId === "objectscript-class") {
				moninfo = {'moniker': "CLS", 'monikeropt': monikeropttype.NONE};
			}
			else if (doc.languageId === "objectscript" || doc.languageId === "objectscript-macros") {
				moninfo = {'moniker': "COS", 'monikeropt': monikeropttype.NONE};
			}
			else if (doc.languageId === "objectscript-csp") {
				moninfo = {'moniker': "HTML", 'monikeropt': monikeropttype.NONE};
			}
			
			// the (builder of the) result of this function
			const builder = getTokenBuilder(doc);
	
			// unless we didn't recognize the moniker ..
			if (typeof moninfo !== 'undefined') {
	
				// parse the text and add entries to the builder
				parseText(doc.getText(), moninfo, builder);
			}
			
			return builder.build();
		}
		catch (e) {
			console.error('exception in sem.provideDocumentSemanticTokens: ' + e);
			return { data: [] };
		}
	}
);

connection.languages.semanticTokens.onEdits(
	(params: Proposed.SemanticTokensEditsParams) => {
		try {
			const doc = documents.get(params.textDocument.uri);
			if (doc === undefined) {return { data: [] };}

			// generate the moniker
			var moninfo: monikerinfo | undefined = undefined;
			if (doc.languageId === "objectscript-class") {
				moninfo = {'moniker': "CLS", 'monikeropt': monikeropttype.NONE};
			}
			else if (doc.languageId === "objectscript" || doc.languageId === "objectscript-macros") {
				moninfo = {'moniker': "COS", 'monikeropt': monikeropttype.NONE};
			}
			else if (doc.languageId === "objectscript-csp") {
				moninfo = {'moniker': "HTML", 'monikeropt': monikeropttype.NONE};
			}
			
			// the (builder of the) result of this function
			const builder = getTokenBuilder(doc);

			// Load the previous results
			builder.previousResult(params.previousResultId);

			// unless we didn't recognize the moniker ..
			if (typeof moninfo !== 'undefined') {

				// parse the text and add entries to the builder
				parseText(doc.getText(), moninfo, builder);
			}
			
			return builder.buildEdits();
		}
		catch (e) {
			console.error('exception in sem.provideDocumentSemanticTokens: ' + e);
			return { data: [] };
		}
	}
);

connection.onNotification("intersystems/server/passwordChange",
	(serverName: string) => {
		var invalid: string[] = [];
		for (let [uri, server] of serverSpecs.entries()) {
			if (server.serverName = serverName) {
				invalid.push(uri);
			}
		}
		for (let uri of invalid) {
			serverSpecs.delete(uri);
		}
		var toRemove: ServerSpec | undefined = undefined;
		for (let server of schemaCaches.keys()) {
			if (server.serverName = serverName) {
				toRemove = server;
				break;
			}
		}
		if (toRemove !== undefined) {
			schemaCaches.delete(toRemove);
		}
	}
);

connection.onNotification("intersystems/server/connectionChange",() => {
	// Clear all cached server connection info
	serverSpecs.clear();
	schemaCaches.clear();
});

connection.onDocumentSymbol(
	(params: DocumentSymbolParams) => {
		const parsed = parsedDocuments.get(params.textDocument.uri);
		if (parsed === undefined) {return null;}
		const doc = documents.get(params.textDocument.uri);
		if (doc === undefined) {return null;}
		var result: DocumentSymbol[] = [];

		if (doc.languageId === "objectscript-class") {
			// Loop through the file and look for the class definition and class members

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
					if (keywordtext.toLowerCase() === "class") {
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
					else if (keywordtext.toLowerCase() !== "import" && keywordtext.toLowerCase().indexOf("include") === -1) {
						// This is a class member definition

						// Loop through the file from this line to find the next class member
						var lastnonempty = line;
						for (let nl = line+1; nl < parsed.length; nl++) {
							if (parsed[nl].length === 0) {
								continue;
							}
							if (parsed[nl][0].l === ld.cls_langindex && (parsed[nl][0].s === ld.cls_keyword_attrindex || parsed[nl][0].s === ld.cls_desc_attrindex)) {
								break;
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
						if (keywordtext.toLowerCase().indexOf("method") !== -1 || keywordtext.toLowerCase() === "query") {
							kind = SymbolKind.Method;
						}
						else if (keywordtext.toLowerCase() === "parameter") {
							kind = SymbolKind.Constant;
						}
						else if (keywordtext.toLowerCase() === "index") {
							kind = SymbolKind.Key;
						}
						else if (keywordtext.toLowerCase() === "xdata" || keywordtext.toLowerCase() === "storage") {
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
		else if (doc.languageId === "objectscript") {
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

		return result;
	}
);

connection.onFoldingRanges(
	(params: FoldingRangeParams) => {
		const parsed = parsedDocuments.get(params.textDocument.uri);
		if (parsed === undefined) {return null;}
		const doc = documents.get(params.textDocument.uri);
		if (doc === undefined) {return null;}
		var result: FoldingRange[] = [];

		var openranges: FoldingRange[] = [];
		var inmultilinemacro: boolean = false;
		var dotteddolevel: number = 0;
		var injsonxdata: boolean = false;
		var routinename = "";
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
						dotteddolevel--;
					}
				}
				continue;
			}
			const firsttokentext = doc.getText(Range.create(Position.create(line,parsed[line][0].p),Position.create(line,parsed[line][0].p+parsed[line][0].c)));
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
				if (inmultilinemacro) {
					// Check if the last token is a ##Continue
					if (
						parsed[line][parsed[line].length-1].l !== ld.cos_langindex || parsed[line][parsed[line].length-1].s !== ld.cos_ppf_attrindex ||
						doc.getText(Range.create(
							Position.create(line,parsed[line][parsed[line].length-1].p),
							Position.create(line,parsed[line][parsed[line].length-1].p+parsed[line][parsed[line].length-1].c)
						)).toLowerCase() !== "continue"
					) {
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
						inmultilinemacro = false;
					}
				}
				if (
					parsed[line][parsed[line].length-1].l == ld.cls_langindex && parsed[line][parsed[line].length-1].s == ld.cls_delim_attrindex &&
					doc.getText(Range.create(
						Position.create(line,parsed[line][parsed[line].length-1].p),
						Position.create(line,parsed[line][parsed[line].length-1].p+parsed[line][parsed[line].length-1].c)
					)) === "{"
				) {
					// This line ends with a UDL open curly

					if (
						(parsed[line].length === 1 && parsed[line-1][0].l == ld.cls_langindex && parsed[line-1][0].s == ld.cls_keyword_attrindex &&
						doc.getText(Range.create(Position.create(line-1,parsed[line-1][0].p),Position.create(line-1,parsed[line-1][0].p+parsed[line-1][0].c))).toLowerCase() === "class")
						||
						(parsed[line].length > 1 && parsed[line][0].l == ld.cls_langindex && parsed[line][0].s == ld.cls_keyword_attrindex &&
						doc.getText(Range.create(Position.create(line,parsed[line][0].p),Position.create(line,parsed[line][0].p+parsed[line][0].c))).toLowerCase() === "class")
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
								Position.create(nl,parsed[nl][0].p),
								Position.create(nl,parsed[nl][0].p+parsed[nl][0].c)
							)) === "}"))
						) {
							// Close the member range
							if (
								parsed[nl][0].s === ld.cls_delim_attrindex && 
								doc.getText(Range.create(
									Position.create(nl,parsed[nl][0].p),
									Position.create(nl,parsed[nl][0].p+parsed[nl][0].c)
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
					parsed[line][0].l === ld.cos_langindex && parsed[line][0].s === ld.cos_label_attrindex &&
					firsttokentext !== routinename
				) {
					// This line starts with a routine label

					// Scan through the line to look for an open curly
					var foundopencurly =  false;
					for (let tkn = 1; tkn < parsed[line].length; tkn++) {
						if (parsed[line][tkn].l === ld.cos_langindex && parsed[line][tkn].s === ld.cos_brace_attrindex) {
							const bracetext = doc.getText(Range.create(Position.create(line,parsed[line][tkn].p),Position.create(line,parsed[line][tkn].p+parsed[line][tkn].c)));
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
							else if (parsed[nl][0].l === ld.cos_langindex && parsed[nl][0].s === ld.cos_label_attrindex) {
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
					routinename = doc.getText(Range.create(Position.create(line,parsed[line][1].p),Position.create(line,parsed[line][1].p+parsed[line][1].c)));
				}
				if (
					parsed[line].length >= 2 &&
					(parsed[line][0].l == ld.cos_langindex && parsed[line][0].s == ld.cos_ppc_attrindex) &&
					(parsed[line][1].l == ld.cos_langindex && parsed[line][1].s == ld.cos_ppc_attrindex)
				) {
					// This line starts with a COS preprocessor command

					const ppc = doc.getText(Range.create(Position.create(line,parsed[line][0].p),Position.create(line,parsed[line][1].p+parsed[line][1].c))).toLowerCase();
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
							doc.getText(Range.create(
								Position.create(line,parsed[line][parsed[line].length-1].p),
								Position.create(line,parsed[line][parsed[line].length-1].p+parsed[line][parsed[line].length-1].c)
							)).toLowerCase() === "continue"
						) {
							// This is the start of a multi-line macro definition
							openranges.push({
								startLine: line,
								endLine: line,
								kind: "isc-mlmacro"
							});
							inmultilinemacro = true;
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
								Position.create(line,parsed[line][xmltkn].p),
								Position.create(line,parsed[line][xmltkn].p+parsed[line][xmltkn].c)
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

					const firsttwochars = doc.getText(Range.create(Position.create(line,0),Position.create(line,2)));
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
								doc.getText(Range.create(Position.create(line,parsed[line][stkn].p),Position.create(line,parsed[line][stkn+1].p+parsed[line][stkn+1].c))) === "</"
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
					parsed[line].length === 1 && parsed[line][0].l === ld.cos_langindex && parsed[line][0].s === ld.cos_comment_attrindex &&
					(firsttokentext.slice(0,2) === "//" || firsttokentext.slice(0,2) === "#;") &&
					(firsttokentext.toLowerCase().slice(2).trim() === "#region" || firsttokentext.toLowerCase().slice(2).trim() === "#endregion")
				) {
					// This line contains a region marker

					if (firsttokentext.toLowerCase().slice(2).trim() === "#region") {
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

					const keytext = doc.getText(Range.create(Position.create(line,parsed[line][0].p),Position.create(line,parsed[line][0].p+parsed[line][0].c))).toLowerCase();
					if (keytext === "xdata") {
						// This line is that start of an XData block
						for (let k = 3; k < parsed[line].length; k++) {
							if (parsed[line][k].l == ld.cls_langindex && parsed[line][k].s == ld.cls_keyword_attrindex) {
								// This is a UDL trailing keyword
								const keytext = doc.getText(Range.create(
									Position.create(line,parsed[line][k].p),
									Position.create(line,parsed[line][k].p+parsed[line][k].c)
								)).toLowerCase();
								if (keytext === "mimetype") {
									// The MimeType keyword is present
									if (parsed[line][k+2] !== undefined) {
										// An MimeType is specified
										const mimetype = doc.getText(Range.create(
											Position.create(line,parsed[line][k+2].p+1),
											Position.create(line,parsed[line][k+2].p+parsed[line][k+2].c-1)
										));
										if (mimetype === "application/json") {
											// This is the start of an XData block containing JSON
											injsonxdata = true;
										}
									}
									break;
								}
							}
						}
					}
					else if (injsonxdata && keytext !== "xdata") {
						// We've reached the next class member
						injsonxdata = false;
					}
				}
				else if (injsonxdata) {
					// We're in a JSON XData block so look for opening/closing curly braces and brackets

					for (let tkn = 0; tkn < parsed[line].length; tkn++) {
						if (parsed[line][tkn].l === ld.javascript_langindex && parsed[line][tkn].s === ld.javascript_delim_attrindex) {
							// This is a JSON bracket
							const jb = doc.getText(Range.create(Position.create(line,parsed[line][tkn].p),Position.create(line,parsed[line][tkn].p+parsed[line][tkn].c)));
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
							const jb = doc.getText(Range.create(Position.create(line,parsed[line][tkn].p),Position.create(line,parsed[line][tkn].p+parsed[line][tkn].c)));
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
						if (tkn+1 > dotteddolevel && parsed[line][tkn].l === ld.cos_langindex && parsed[line][tkn].s === ld.cos_dots_attrindex) {
							// This is the start of a dotted Do
							dotteddolevel++;
							openranges.push({
								startLine: line-1,
								endLine: line-1,
								kind: "isc-dotteddo"
							});
						}
						if (tkn === 0 && dotteddolevel > 0) {
							// We're in a dotted Do, so check if the line begins with the correct number of dots

							if (parsed[line].length >= dotteddolevel) {
								for (let level = dotteddolevel-1; level >= 0; level--) {
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
										dotteddolevel--;
									}
								}
							}
							else {
								// At least one dotted Do level is closed
								for (let level = dotteddolevel-1; level >= 0; level--) {
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
										dotteddolevel--;
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
										dotteddolevel--;
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
				// Done with special processing, so loop again to find all ObjectScript braces
				for (let tkn = 0; tkn < parsed[line].length; tkn++) {
					if (parsed[line][tkn].l === ld.cos_langindex && parsed[line][tkn].s === ld.cos_brace_attrindex) {
						const bracetext = doc.getText(Range.create(Position.create(line,parsed[line][tkn].p),Position.create(line,parsed[line][tkn].p+parsed[line][tkn].c)));
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
				}
			}
		}

		return result;
	}
);

connection.onPrepareRename(
	(params: TextDocumentPositionParams) => {
		const parsed = parsedDocuments.get(params.textDocument.uri);
		if (parsed === undefined) {return null;}
		const doc = documents.get(params.textDocument.uri);
		if (doc === undefined) {return null;}

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
);

connection.onRenameRequest(
	(params: RenameParams) => {
		const parsed = parsedDocuments.get(params.textDocument.uri);
		if (parsed === undefined) {return null;}
		const doc = documents.get(params.textDocument.uri);
		if (doc === undefined) {return null;}

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
);

// Make the text document manager listen on the connection for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
