import { 
	Diagnostic,
	Position,
	Range,
	DiagnosticSeverity,
	DiagnosticTag,
	DocumentDiagnosticParams,
	DocumentDiagnosticReport,
	DocumentDiagnosticReportKind
} from 'vscode-languageserver';

import {
	findFullRange,
	getClassMemberContext,
	getLanguageServerSettings,
	getParsedDocument,
	getServerSpec,
	makeRESTRequest,
	normalizeClassname,
	quoteUDLIdentifier,
	isClassMember
} from '../utils/functions';
import { zutilFunctions, lexerLanguages, documents } from '../utils/variables';
import { ServerSpec, StudioOpenDialogFile, QueryData } from '../utils/types';
import * as ld from '../utils/languageDefinitions';
import parameterTypes = require("../documentation/parameterTypes.json");
import sqlReservedWords = require("../documentation/sqlReservedWords.json");

/**
 * Helper method  that appends `range` to value of `key` in `map`
 * if it exists, or creates a new entry for `key` in `map` if it doesn't.
 * 
 * @param map Map between ClassMember objects and Ranges in a document.
 * @param key The key in `map`.
 * @param range The Range to add to `map`.get(`key`).
 */
function addRangeToMapVal(map: Map<string, Range[]>, key: string, range: Range) {
	let ranges = map.get(key);
	if (ranges === undefined) {
		ranges = [range];
	}
	else {
		ranges.push(range);
	}
	map.set(key,ranges);
};

const syntaxError = "Syntax error";

/** Normalize the description for this error token */
function normalizeErrorDesc(e?: string): string {
	return !e || e.includes("HRESULT") ? syntaxError : e[0].toUpperCase() + e.slice(1).replace(/'/g,"\"");
}

/**
 * Handler function for the `textDocument/diagnostic` request.
 */
export async function onDiagnostics(params: DocumentDiagnosticParams): Promise<DocumentDiagnosticReport> {
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) throw new Error("Unknown document");
	const parsed = await getParsedDocument(params.textDocument.uri);
	if (parsed === undefined) throw new Error("Document not parsed");

	const server: ServerSpec = await getServerSpec(doc.uri);
	const settings = await getLanguageServerSettings(doc.uri);
	let diagnostics: Diagnostic[] = [];

	/** Check if syntax errors should be reported for `language`. */
	const reportSyntaxErrors = (language: number): boolean => {
		return !(<string[]>settings.diagnostics.suppressSyntaxErrors).includes(<string>lexerLanguages.find(ll => ll.index == language)?.moniker);
	};

	var files: StudioOpenDialogFile[] = [];
	var inheritedpackages: string[] = [];
	var querydata: QueryData;
	let isPersistent: boolean = false;
	if (settings.diagnostics.routines || settings.diagnostics.classes || settings.diagnostics.deprecation) {
		if (settings.diagnostics.routines && (settings.diagnostics.classes || settings.diagnostics.deprecation)) {
			// Get all classes and routines
			querydata = {
				query: "SELECT Name||'.cls' AS Name FROM %Dictionary.ClassDefinition UNION ALL %PARALLEL " +
					"SELECT DISTINCT BY ($PIECE(Name,'.',1,$LENGTH(Name,'.')-1)) Name FROM %Library.RoutineMgr_StudioOpenDialog(?,?,?,?,?,?,?,?) " +
					"UNION ALL %PARALLEL SELECT Name FROM %Library.RoutineMgr_StudioOpenDialog(?,?,?,?,?,?,?)",
				parameters: ["*.mac,*.int,*.obj",1,1,1,1,1,0,"NOT (Name %PATTERN '.E1\".\"0.1\"G\"1N1\".obj\"' AND $LENGTH(Name,'.') > 3)","*.inc",1,1,1,1,0,0]
			};
		}
		else if (!settings.diagnostics.routines && (settings.diagnostics.classes || settings.diagnostics.deprecation)) {
			// Get all classes
			querydata = {
				query: "SELECT Name||'.cls' AS Name FROM %Dictionary.ClassDefinition",
				parameters: []
			};
		}
		else {
			// Get all routines
			querydata = {
				query: "SELECT DISTINCT BY ($PIECE(Name,'.',1,$LENGTH(Name,'.')-1)) Name FROM %Library.RoutineMgr_StudioOpenDialog(?,?,?,?,?,?,?,?) " +
					"UNION ALL %PARALLEL SELECT Name FROM %Library.RoutineMgr_StudioOpenDialog(?,?,?,?,?,?,?)",
				parameters: ["*.mac,*.int,*.obj",1,1,1,1,1,0,"NOT (Name %PATTERN '.E1\".\"0.1\"G\"1N1\".obj\"' AND $LENGTH(Name,'.') > 3)","*.inc",1,1,1,1,0,0]
			};
		}

		const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
		if (Array.isArray(respdata?.data?.result?.content)) {
			files = respdata.data.result.content;
		}
	}
	if (doc.languageId == "objectscript-class" && (
		settings.diagnostics.classes || settings.diagnostics.deprecation || settings.diagnostics.sqlReserved
	)) {
		var clsname = "";
		var hassupers = false;
		let supers: string[] = [""];

		// Find the class name and if the class has supers
		for (let i = 0; i < parsed.length; i++) {
			if (parsed[i].length === 0) {
				continue;
			}
			else if (parsed[i][0].l == ld.cls_langindex && parsed[i][0].s == ld.cls_keyword_attrindex) {
				// This line starts with a UDL keyword

				var keyword = doc.getText(Range.create(Position.create(i,parsed[i][0].p),Position.create(i,parsed[i][0].p+parsed[i][0].c))).toLowerCase();
				if (keyword === "class") {
					clsname = doc.getText(findFullRange(i,parsed,1,parsed[i][1].p,parsed[i][1].p+parsed[i][1].c));
					for (let j = 1; j < parsed[i].length; j++) {
						if (
							parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_keyword_attrindex &&
							doc.getText(Range.create(i,parsed[i][j].p,i,parsed[i][j].p+parsed[i][j].c)).toLowerCase() == "extends"
						) {
							// The 'Extends' keyword is present
							hassupers = true;
							if (!settings.diagnostics.sqlReserved) break;
						} else if (parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_clsname_attrindex && hassupers) {
							supers.push(supers.pop() + doc.getText(Range.create(i,parsed[i][j].p,i,parsed[i][j].p+parsed[i][j].c)));
						} else if (
							parsed[i][j].l == ld.cls_langindex &&
							parsed[i][j].s == ld.cls_delim_attrindex &&
							[")","[","{"].includes(doc.getText(Range.create(i,parsed[i][j].p,i,parsed[i][j].p+parsed[i][j].c)))
						) {
							// This is the end of the superclass list
							break;
						}
					}
					break;
				}
			}
		}
		isPersistent = supers.includes("%Persistent") || supers.includes("%Library.Persistent");
		if (hassupers) {
			const pkgquerydata = {
				query: "SELECT $LISTTOSTRING(Importall) AS Importall, $FIND(PrimarySuper,'~%Library.Persistent~') AS IsPersistent FROM %Dictionary.CompiledClass WHERE Name = ?",
				parameters: [clsname]
			};
			const pkgrespdata = await makeRESTRequest("POST",1,"/action/query",server,pkgquerydata);
			if (pkgrespdata?.data?.result?.content?.length == 1) {
				// We got data back
				inheritedpackages = pkgrespdata.data.result.content[0].Importall != "" ?
					pkgrespdata.data.result.content[0].Importall.replace(/[^\x20-\x7E]/g,'').split(',') : [];
				isPersistent = isPersistent || pkgrespdata.data.result.content[0].IsPersistent > 0;
			}
		}
		if (!settings.diagnostics.sqlReserved) isPersistent = false;
	}
	
	const firstlineisroutine: boolean =

		// The document is not empty and the first line is not empty
		parsed.length > 0 && parsed[0].length > 0 &&

		// The first character was parsed as a COS command
		parsed[0][0].l == ld.cos_langindex && parsed[0][0].s == ld.cos_command_attrindex &&

		// The document begins with "ROUTINE" (case-insensitive)
		doc.getText(Range.create(Position.create(0,parsed[0][0].p),Position.create(0,parsed[0][0].p+parsed[0][0].c))).toLowerCase() === "routine";

	if (!firstlineisroutine && ["objectscript","objectscript-int","objectscript-macros"].includes(doc.languageId)) {
		// The ROUTINE header is required
		diagnostics.push({
			severity: DiagnosticSeverity.Error,
			range: Range.create(0,0,0,0),
			message: "ROUTINE header is required",
			source: "InterSystems Language Server"
		});
	} else if (firstlineisroutine) {
		// Check for a syntax error in the ROUTINE line
		for (let t = 0; t < parsed[0].length; t++) {
			if (parsed[0][t].s == 0) {
				const errorDesc = normalizeErrorDesc(parsed[0][t].e);
				if (
					t > 0 && parsed[0][t-1].s == 0 &&
					diagnostics.length &&
					[syntaxError,diagnostics[diagnostics.length-1].message].includes(errorDesc)
				) {
					// This error token is a continuation of the same underlying error
					diagnostics[diagnostics.length-1].range.end = Position.create(0,parsed[0][t].p+parsed[0][t].c);
				}
				else {
					// This is a token for a new error
					diagnostics.push({
						severity: DiagnosticSeverity.Error,
						range: Range.create(0,parsed[0][t].p,0,parsed[0][t].p+parsed[0][t].c),
						message: errorDesc,
						source: 'InterSystems Language Server'
					});
				}
			}
		}
	}

	const startline: number = (firstlineisroutine) ? 1 : 0;

	// Store the name, class and ranges for all class members that we see if settings.diagnostics.deprecation is true
	// Map keys are of the form "class:::member", except for classes
	const methods: Map<string, Range[]> = new Map();
	const parameters: Map<string, Range[]> = new Map();
	const properties: Map<string, Range[]> = new Map();
	const classes: Map<string, Range[]> = new Map();

	// Keep track of current namespace for class/routine existence checks
	const baseNs = server.namespace.toUpperCase();
	let currentNs = baseNs;
	let nsNestedBlockLevel = 0;
	const validNsRegex = /^"[A-Za-z%]?[A-Za-z0-9-_]+"$/;

	// Store the ns, name and ranges of all classes and routines from other namespaces that we see
	// Keys are of the form "ns:::doc.ext"
	const otherNsDocs: Map<string, Range[]> = new Map();

	// Loop through the parsed document to find errors and warnings
	for (let i = startline; i < parsed.length; i++) {

		// Loop through the line's tokens
		for (let j = 0; j < parsed[i].length; j++) {
			const symbolstart: number = parsed[i][j].p;
			const symbolend: number = parsed[i][j].p + parsed[i][j].c;

			if (j > 0 && parsed[i][j].l === parsed[i][j-1].l && parsed[i][j].s === parsed[i][j-1].s) {
				// This token is the same as the last

				const errorDesc = normalizeErrorDesc(parsed[i][j].e);
				if (parsed[i][j].s === ld.error_attrindex && reportSyntaxErrors(parsed[i][j].l)) {
					if (
						parsed[i][j].l == parsed[i][j-1].l &&
						diagnostics.length &&
						[syntaxError,diagnostics[diagnostics.length-1].message].includes(errorDesc)
					) {
						// This error token is a continuation of the same underlying error
						diagnostics[diagnostics.length-1].range.end = Position.create(i,symbolend);
					}
					else {
						// This is a token for a new error
						diagnostics.push({
							severity: DiagnosticSeverity.Error,
							range: {
								start: Position.create(i,symbolstart),
								end: Position.create(i,symbolend)
							},
							message: errorDesc,
							source: 'InterSystems Language Server'
						});
					}
				}
			}
			else {
				if (parsed[i][j].s === ld.error_attrindex && reportSyntaxErrors(parsed[i][j].l)) {
					// This is an error token
					let diagnostic: Diagnostic = {
						severity: DiagnosticSeverity.Error,
						range: {
							start: Position.create(i,symbolstart),
							end: Position.create(i,symbolend)
						},
						message: normalizeErrorDesc(parsed[i][j].e),
						source: 'InterSystems Language Server'
					};
					diagnostics.push(diagnostic);
				}
				else if (
					parsed[i][j].l == ld.cos_langindex &&
					parsed[i][j].s == ld.cos_otw_attrindex &&
					settings.diagnostics.undefinedVariables
				) {
					// This is an OptionTrackWarning (unset local variable)
					const varrange = Range.create(Position.create(i,symbolstart),Position.create(i,symbolend));
					let diagnostic: Diagnostic = {
						severity: DiagnosticSeverity.Warning,
						range: varrange,
						message: `Local variable "${doc.getText(varrange)}" may be undefined`,
						source: 'InterSystems Language Server'
					};
					diagnostics.push(diagnostic);
				}
				else if (
					parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_clsname_attrindex &&
					j !== 0 && parsed[i][j-1].l == ld.cls_langindex && parsed[i][j-1].s == ld.cls_keyword_attrindex &&
					doc.getText(Range.create(
						Position.create(i,parsed[i][j-1].p),
						Position.create(i,parsed[i][j-1].p+parsed[i][j-1].c)
					)).toLowerCase() === "class"
				) {
					// This is the class name in the class definition line

					// Check if the class name has a package
					const wordrange = findFullRange(i,parsed,j,symbolstart,symbolend);
					const word = doc.getText(wordrange);
					if (!word.includes(".")) {
						// The class name doesn't have a package, so report an error diagnostic here
						diagnostics.push({
							severity: DiagnosticSeverity.Error,
							range: wordrange,
							message: "A package must be specified",
							source: 'InterSystems Language Server'
						});
					} else if (isPersistent) {
						// Check if a SqlTableName is present
						let sqlTableName: Range, hasSqlTableName = false;
						for (let k = j + 1; k < parsed[i].length; k++) {
							if (hasSqlTableName) {
								if (parsed[i][k].l == ld.cls_langindex && (
									parsed[i][k].s == ld.cls_sqliden_attrindex || 
									parsed[i][k].s == ld.error_attrindex || (
										parsed[i][k].s == ld.cls_delim_attrindex &&
										[",","]"].includes(doc.getText(Range.create(i,parsed[i][k].p,i,parsed[i][k].p+parsed[i][k].c)))
									)
								)) {
									if (parsed[i][k].s == ld.cls_sqliden_attrindex) {
										sqlTableName = Range.create(i,parsed[i][k].p,i,parsed[i][k].p+parsed[i][k].c);
									}
									break;
								}
							} else if (
								parsed[i][k].l == ld.cls_langindex &&
								parsed[i][k].s == ld.cls_keyword_attrindex &&
								doc.getText(Range.create(i,parsed[i][k].p,i,parsed[i][k].p+parsed[i][k].c)).toLowerCase() == "sqltablename"
							) {
								hasSqlTableName = true;
							}
						}
						if (hasSqlTableName) {
							if (sqlTableName && sqlReservedWords.includes(doc.getText(sqlTableName).toUpperCase())) {
								// The SqlTableName is a reserved word
								diagnostics.push({
									severity: DiagnosticSeverity.Warning,
									range: sqlTableName,
									message: "SqlTableName is a SQL reserved word",
									source: 'InterSystems Language Server'
								});
							}
						} else if (sqlReservedWords.includes(word.split(".").pop().toUpperCase())) {
							// The short class name is a reserved word, and it's not corrected by a SqlTableName
							wordrange.start.character = wordrange.end.character - word.split(".").pop().length;
							diagnostics.push({
								severity: DiagnosticSeverity.Warning,
								range: wordrange,
								message: "Class name is a SQL reserved word",
								source: 'InterSystems Language Server'
							});
						}
					}
				}
				else if (
					j === 0 && parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_keyword_attrindex &&
					doc.getText(Range.create(Position.create(i,0),Position.create(i,9))).toLowerCase() === "parameter" &&
					settings.diagnostics.parameters
				) {
					// This line is a UDL Parameter definition
					if (
						parsed[i].length > 3 &&
						parsed[i][2].l == ld.cls_langindex && parsed[i][2].s === ld.cls_keyword_attrindex &&
						doc.getText(Range.create(Position.create(i,parsed[i][2].p),Position.create(i,parsed[i][2].p+parsed[i][2].c))).toLowerCase() === "as"
					) {
						// This Parameter has a type
						const tokenrange = Range.create(Position.create(i,parsed[i][3].p),Position.create(i,parsed[i][3].p+parsed[i][3].c));
						const tokentext = doc.getText(tokenrange).toUpperCase();
						const thistypedoc = parameterTypes.find((typedoc) => typedoc.name === tokentext);
						if (thistypedoc === undefined) {
							// The type is invalid
							let diagnostic: Diagnostic = {
								severity: DiagnosticSeverity.Warning,
								range: tokenrange,
								message: "Invalid parameter type",
								source: 'InterSystems Language Server'
							};
							diagnostics.push(diagnostic);
						}
						else {
							// The type is valid

							// See if this Parameter has a value
							if (parsed[i].length <= 4) {
								continue;
							}
							var valuetkn = -1;
							const delimtext = doc.getText(Range.create(Position.create(i,parsed[i][4].p),Position.create(i,parsed[i][4].p+parsed[i][4].c)));
							if (delimtext === "[") {
								// Loop through the line to find the closing brace

								var closingtkn = -1;
								for (let ptkn = 5; ptkn < parsed[i].length; ptkn++) {
									if (
										parsed[i][ptkn].l == ld.cls_langindex && parsed[i][ptkn].s === ld.cls_delim_attrindex &&
										doc.getText(Range.create(
											Position.create(i,parsed[i][ptkn].p),
											Position.create(i,parsed[i][ptkn].p+parsed[i][ptkn].c)
										)) === "]"
									) {
										closingtkn = ptkn;
										break;
									}
								}

								// Check if the token following the closing brace is =
								if (
									closingtkn !== -1 && parsed[i].length > closingtkn &&
									doc.getText(Range.create(
										Position.create(i,parsed[i][closingtkn+1].p),
										Position.create(i,parsed[i][closingtkn+1].p+parsed[i][closingtkn+1].c)
									)) === "="
								) {
									// There is a value following the =
									valuetkn = closingtkn + 2;
								}
							}
							else if (delimtext === "=") {
								// The value follows this delimiter
								valuetkn = 5;
							}
							else {
								// Delimiter is a ; so there isn't a value to evaluate
							}

							if (valuetkn !== -1 && parsed[i].length > valuetkn+1) {
								const valtext = doc.getText(Range.create(Position.create(i,parsed[i][valuetkn].p),Position.create(i,parsed[i][valuetkn].p+parsed[i][valuetkn].c)));
								const valrange = Range.create(Position.create(i,parsed[i][valuetkn].p),Position.create(i,parsed[i][parsed[i].length-2].p+parsed[i][parsed[i].length-2].c));
								if (
									(thistypedoc.name === "STRING" && (parsed[i][valuetkn].l !== ld.cls_langindex || parsed[i][valuetkn].s !== ld.cls_str_attrindex)) ||
									(thistypedoc.name === "COSEXPRESSION" && (parsed[i][valuetkn].l !== ld.cls_langindex || parsed[i][valuetkn].s !== ld.cls_str_attrindex)) ||
									(thistypedoc.name === "CLASSNAME" && (parsed[i][valuetkn].l !== ld.cls_langindex || parsed[i][valuetkn].s !== ld.cls_str_attrindex)) ||
									(thistypedoc.name === "INTEGER" && (parsed[i][valuetkn].l !== ld.cls_langindex || parsed[i][valuetkn].s !== ld.cls_num_attrindex)) ||
									(thistypedoc.name === "BOOLEAN" && (parsed[i][valuetkn].l !== ld.cls_langindex || parsed[i][valuetkn].s !== ld.cls_num_attrindex || (valtext !== "1" && valtext !== "0")))
								) {
									// Allow curly brace syntax for all types but COSEXPRESSION
									if (thistypedoc.name == "COSEXPRESSION" || !valtext.startsWith("{")) {
										diagnostics.push({
											severity: DiagnosticSeverity.Warning,
											range: valrange,
											message: "Parameter value and type do not match",
											source: 'InterSystems Language Server'
										});
									}
								}
								else if (thistypedoc.name === "CLASSNAME" && settings.diagnostics.classes) {
									// Validate the class name in the string
									let classname: string = valtext.slice(1,-1);
									if (classname.startsWith("%") && !classname.includes(".")) {
										classname = `%Library.${classname.slice(1)}`;
									}
									// Check if class exists
									const filtered = files.filter(file => file.Name === classname+".cls");
									if (filtered.length !== 1 && !classname.startsWith("%SYSTEM.")) {
										diagnostics.push({
											severity: DiagnosticSeverity.Warning,
											range: valrange,
											message: `Class "${classname}" does not exist in namespace "${baseNs}"`,
											source: 'InterSystems Language Server'
										});
									}
								}
							}
						}
					}

					// Loop through the line to capture any syntax errors
					for (let ptkn = 1; ptkn < parsed[i].length; ptkn++) {
						if (parsed[i][ptkn].s == ld.error_attrindex && reportSyntaxErrors(parsed[i][j].l)) {
							const errorDesc = normalizeErrorDesc(parsed[i][j].e);
							if (
								parsed[i][ptkn].l == parsed[i][ptkn-1].l &&
								parsed[i][ptkn-1].s == 0 &&
								diagnostics.length &&
								[syntaxError,diagnostics[diagnostics.length-1].message].includes(errorDesc)
							) {
								// This error token is a continuation of the same underlying error
								diagnostics[diagnostics.length-1].range.end = Position.create(i,parsed[i][ptkn].p+parsed[i][ptkn].c);
							}
							else {
								diagnostics.push({
									severity: DiagnosticSeverity.Error,
									range: {
										start: Position.create(i,parsed[i][ptkn].p),
										end: Position.create(i,parsed[i][ptkn].p+parsed[i][ptkn].c)
									},
									message: errorDesc,
									source: 'InterSystems Language Server'
								});
							}
						}
					}

					break;
				}
				else if (
					j === 0 && parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_keyword_attrindex &&
					doc.getText(Range.create(Position.create(i,0),Position.create(i,6))).toLowerCase() === "import"
				) {
					// This is the UDL Import line

					// Loop through the line and update the inheritedpackages list
					let lastpkgend: number = 0;
					for (let imptkn = 1; imptkn < parsed[i].length; imptkn++) {
						if (parsed[i][imptkn].s == ld.error_attrindex && reportSyntaxErrors(parsed[i][j].l)) {
							if (
								parsed[i][imptkn-1].s == ld.error_attrindex && !doc.getText(Range.create(
									Position.create(i,parsed[i][imptkn].p-1),
									Position.create(i,parsed[i][imptkn].p)
								)).trim()
							) {
								// The previous token is an error without a space in between, so extend the existing syntax error Diagnostic to cover this token
								diagnostics[diagnostics.length-1].range.end = Position.create(i,parsed[i][imptkn].p+parsed[i][imptkn].c);
							}
							else {
								diagnostics.push({
									severity: DiagnosticSeverity.Error,
									range: {
										start: Position.create(i,parsed[i][imptkn].p),
										end: Position.create(i,parsed[i][imptkn].p+parsed[i][imptkn].c)
									},
									message: syntaxError,
									source: 'InterSystems Language Server'
								});
							}
						}
						if (parsed[i][imptkn].l == ld.cls_langindex && parsed[i][imptkn].s == ld.cls_clsname_attrindex) {
							const pkgrange = findFullRange(i,parsed,imptkn,parsed[i][imptkn].p,parsed[i][imptkn].p + parsed[i][imptkn].c);
							const pkg = doc.getText(pkgrange);
							if (!inheritedpackages.includes(pkg)) {
								inheritedpackages.push(pkg);
							}
							if (
								files.length > 0 && settings.diagnostics.classes && lastpkgend != pkgrange.end.character &&
								!files.some(f => f.Name.startsWith(pkg+".") && f.Name.endsWith(".cls"))
							) {
								// This package does not exist
								diagnostics.push({
									severity: DiagnosticSeverity.Error,
									range: pkgrange,
									message: `No classes with package "${pkg}" exist in namespace "${baseNs}"`,
									source: 'InterSystems Language Server'
								});
							}
							lastpkgend = pkgrange.end.character;
						}
					}

					break;
				}
				else if (
					files.length > 0 &&
					((parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_clsname_attrindex) ||
					(parsed[i][j].l == ld.cos_langindex && parsed[i][j].s == ld.cos_clsname_attrindex)) &&
					(settings.diagnostics.classes || settings.diagnostics.deprecation)
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
							if (settings.diagnostics.classes) {
								let diagnostic: Diagnostic = {
									severity: DiagnosticSeverity.Error,
									range: wordrange,
									message: "Invalid class name",
									source: 'InterSystems Language Server'
								};
								diagnostics.push(diagnostic);
							}
							continue;
						}
						else {
							word = "%SYSTEM" + word;
						}
					}
					if (word.charAt(0) === '"') {
						// This classname is delimited with ", so strip them
						word = word.slice(1,-1);
					}

					if (currentNs == baseNs) {
						// Normalize the class name if there are imports
						var possiblecls = {num: 0};
						let normalizedname = await normalizeClassname(doc,parsed,word,server,i,files,possiblecls,inheritedpackages);

						if (normalizedname === "" && possiblecls.num > 0) {
							// The class couldn't be resolved with the imports
							if (settings.diagnostics.classes) {
								let diagnostic: Diagnostic = {
									severity: DiagnosticSeverity.Error,
									range: wordrange,
									message: `Class name "${word}" is ambiguous`,
									source: 'InterSystems Language Server'
								};
								diagnostics.push(diagnostic);
							}
						}
						else {
							// Check if class exists
							const filtered = files.filter(file => file.Name === normalizedname+".cls");
							if (filtered.length !== 1) {
								// Exempt %SYSTEM classes because some of them don't have ^oddDEF entries
								if (settings.diagnostics.classes && !word.startsWith("%SYSTEM.")) {
									let diagnostic: Diagnostic = {
										severity: DiagnosticSeverity.Error,
										range: wordrange,
										message: `Class "${word}" does not exist in namespace "${baseNs}"`,
										source: 'InterSystems Language Server'
									};
									diagnostics.push(diagnostic);
								}
							}
							else if (settings.diagnostics.deprecation) {
								// The class exists, so add it to the map
								addRangeToMapVal(classes,normalizedname,wordrange);
							}
						}
					} else if (currentNs != "" && settings.diagnostics.classes && !word.startsWith("%SYSTEM.")) {
						if (!word.includes(".") && !word.startsWith("%")) {
							// Using a short class name when you may be in another namespace is bad
							diagnostics.push({
								severity: DiagnosticSeverity.Error,
								range: wordrange,
								message: "Short class name used after a namespace switch",
								source: 'InterSystems Language Server'
							});
						}
						else {
							// Add this class to the map
							addRangeToMapVal(otherNsDocs,`${currentNs}:::${
								!word.includes(".") && word.startsWith("%") ? `%Library.${word.slice(1)}` : word
							}.cls`,wordrange);
						}
					}
				}
				else if (
					files.length > 0 &&
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

					if (currentNs == baseNs) {
						// Check if the routine exists
						if (isinc) {
							if (!files.some(file => file.Name == (word+".inc"))) {
								let diagnostic: Diagnostic = {
									severity: DiagnosticSeverity.Error,
									range: wordrange,
									message: `Include file "${word}" does not exist in namespace "${baseNs}"`,
									source: 'InterSystems Language Server'
								};
								diagnostics.push(diagnostic);
							}
						}
						else {
							const regex = new RegExp(`^${word}\.(mac|int|obj)$`);
							if (!files.some(file => regex.test(file.Name))) {
								let diagnostic: Diagnostic = {
									severity: DiagnosticSeverity.Error,
									range: wordrange,
									message: `Routine "${word}" does not exist in namespace "${baseNs}"`,
									source: 'InterSystems Language Server'
								};
								diagnostics.push(diagnostic);
							}
						}
					}
					else if (currentNs != "") {
						// Add this document to the map
						addRangeToMapVal(otherNsDocs,`${currentNs}:::${word}${isinc ? ".inc" : ".mac"}`,wordrange);
					}
				}
				else if (
					files.length > 0 &&
					parsed[i][j].l == ld.cos_langindex && (
					parsed[i][j].s == ld.cos_prop_attrindex || parsed[i][j].s == ld.cos_method_attrindex ||
					parsed[i][j].s == ld.cos_attr_attrindex || parsed[i][j].s == ld.cos_mem_attrindex) &&
					settings.diagnostics.deprecation
				) {
					// This is a class member (property/parameter/method)

					// Get the full text of the member
					const memberrange = findFullRange(i,parsed,j,symbolstart,symbolend);
					var member = doc.getText(memberrange);
					if (member.charAt(0) === "#") {
						member = member.slice(1);
					}
					const unquotedname = quoteUDLIdentifier(member,0);

					// Find the dot token
					var dottkn = 0;
					for (let tkn = 0; tkn < parsed[i].length; tkn++) {
						if (parsed[i][tkn].p >= memberrange.start.character) {
							break;
						}
						dottkn = tkn;
					}

					// Get the base class that this member is in
					const membercontext = await getClassMemberContext(doc,parsed,dottkn,i,server,files,inheritedpackages);
					if (membercontext.baseclass !== "") {
						// We could determine the class, so add the member to the correct map

						const memberstr: string = membercontext.baseclass + ":::" + unquotedname;
						if (parsed[i][j].s == ld.cos_prop_attrindex) {
							// This is a parameter
							addRangeToMapVal(parameters,memberstr,memberrange);
						}
						else if (parsed[i][j].s == ld.cos_method_attrindex) {
							// This is a method
							addRangeToMapVal(methods,memberstr,memberrange);
						}
						else if (
							parsed[i][j].s == ld.cos_attr_attrindex &&
							membercontext.baseclass !== "%Library.DynamicArray" &&
							membercontext.baseclass !== "%Library.DynamicObject"
						) {
							// This is a non-JSON property
							addRangeToMapVal(properties,memberstr,memberrange);
						}
						else if (parsed[i][j].s == ld.cos_mem_attrindex) {
							// This is a generic member

							if (membercontext.baseclass.substr(0,7) === "%SYSTEM") {
								// This is always a method
								addRangeToMapVal(methods,memberstr,memberrange);
							}
							else {
								// This can be a method or property
								addRangeToMapVal(methods,memberstr,memberrange);
								addRangeToMapVal(properties,memberstr,memberrange);
							}
						}
					}
				}
				else if (
					settings.diagnostics.zutil && parsed[i][j].l == ld.cos_langindex && parsed[i][j].s == ld.cos_sysf_attrindex &&
					/^\$zu(til)?$/i.test(doc.getText(Range.create(i,parsed[i][j].p,i,parsed[i][j].p+parsed[i][j].c))) && j < parsed[i].length - 1
				) {
					// This is a $ZUTIL call

					// Determine if this is a known function
					let brk = false;
					let nums: string[] = [];
					for (let ln = i; ln < parsed.length; ln++) {
						if (parsed[ln] == undefined || parsed[ln].length == 0) {
							continue;
						}
						for (let tkn = (ln == i ? j + 2 : 0); tkn < parsed[ln].length; tkn++) {
							if (parsed[ln][tkn].l != ld.cos_langindex) {
								// We hit another language, so exit
								brk = true;
								break;
							}
							const tknText = doc.getText(Range.create(ln,parsed[ln][tkn].p,ln,parsed[ln][tkn].p+parsed[ln][tkn].c));
							if (parsed[ln][tkn].s == ld.cos_delim_attrindex) {
								if (nums.length) {
									const argList = nums.join(",") + tknText;
									if (
										zutilFunctions.deprecated.includes(argList) ||
										zutilFunctions.replace[argList] != undefined ||
										zutilFunctions.noReplace.includes(argList)
									) {
										// This is a known function, so create a Diagnostic
										const diag: Diagnostic = {
											range: Range.create(i,parsed[i][j].p,ln,parsed[ln][tkn].p+parsed[ln][tkn].c),
											severity: DiagnosticSeverity.Warning,
											source: 'InterSystems Language Server',
											message: ""
										};
										if (zutilFunctions.deprecated.includes(argList)) {
											diag.message = "Deprecated function";
											diag.tags = [DiagnosticTag.Deprecated];
										}
										else {
											diag.message = "Function has been superseded";
											if (zutilFunctions.replace[argList] != undefined) {
												diag.data = argList;
											}
											if (argList == "5,") {
												// This is a namespace switch
												const nsTkn = tkn == parsed[ln].length - 1 ? 0 : tkn + 1;
												const nsLn = nsTkn == 0 ? ln + 1 : ln;
												const nsText = doc.getText(Range.create(nsLn,parsed[nsLn][nsTkn].p,nsLn,parsed[nsLn][nsTkn].p+parsed[nsLn][nsTkn].c));
												if (parsed[nsLn][nsTkn].s == ld.cos_str_attrindex && validNsRegex.test(nsText)) {
													currentNs = nsText.slice(1,-1).toUpperCase();
													if (currentNs != baseNs) {
														nsNestedBlockLevel = 1;
													}
													else {
														nsNestedBlockLevel = 0;
													}
												}
												else {
													// We can't determine what namespace we are in
													currentNs = "";
													nsNestedBlockLevel = 1;
												}
											}
										}
										diagnostics.push(diag);
										brk = true;
										break;
									}
									else if (tknText == ")") {
										// Hit the end of the arg list, so exit
										brk = true;
										break;
									}
								}
								else {
									// Delimiter is first token after open parenthesis, so exit
									brk = true;
									break;
								}
							}
							else if (parsed[ln][tkn].s == ld.cos_number_attrindex) {
								nums.push(tknText);
							}
							else {
								// We hit another token, so exit
								brk = true;
								break;
							}
						}
						if (brk) {
							break;
						}
					}
				}
				else if (
					parsed[i][j].l == ld.cos_langindex && parsed[i][j].s == ld.cos_sysv_attrindex &&
					["$namespace","$znspace"].includes(doc.getText(Range.create(i,parsed[i][j].p,i,parsed[i][j].p+parsed[i][j].c)).toLowerCase())
				) {
					// This is a potential namespace switch

					// Check if this is in a Set command
					let isSet = false;
					let hasPc = false;
					let brk = false;
					for (let ln = i; ln >= 0; ln--) {
						if (parsed[ln] == undefined || parsed[ln].length == 0) {
							continue;
						}
						for (let tkn = (ln == i ? j : parsed[ln].length - 1); tkn >= 0; tkn--) {
							if (parsed[ln][tkn].l != ld.cos_langindex || parsed[ln][tkn].s == ld.cos_zcom_attrindex) {
								brk = true;
								break;
							}
							if (parsed[ln][tkn].s == ld.cos_command_attrindex) {
								if (["s","set"].includes(doc.getText(Range.create(ln,parsed[ln][tkn].p,ln,parsed[ln][tkn].p+parsed[ln][tkn].c)).toLowerCase())) {
									isSet = true;
									if (
										tkn < parsed[ln].length - 1 && parsed[ln][tkn+1].l == ld.cos_langindex && parsed[ln][tkn+1].s === ld.cos_delim_attrindex &&
										doc.getText(Range.create(ln,parsed[ln][tkn+1].p,ln,parsed[ln][tkn+1].p+parsed[ln][tkn+1].c)) == ":"
									) {
										hasPc = true;
									}
								}
								brk = true;
								break;
							}
						}
						if (brk) {
							break;
						}
					}
					if (isSet) {
						if (hasPc) {
							// We can't determine what namespace we are in
							currentNs = "";
							nsNestedBlockLevel = 1;
						}
						else {
							// Check what we are being Set to
							let brk = false;
							let foundOp = false;
							for (let ln = i; ln < parsed.length; ln++) {
								if (parsed[ln] == undefined || parsed[ln].length == 0) {
									continue;
								}
								for (let tkn = (ln == i ? j : 0); tkn < parsed[ln].length; tkn++) {
									if (
										parsed[ln][tkn].l != ld.cos_langindex ||
										parsed[ln][tkn].s == ld.cos_zcom_attrindex ||
										parsed[ln][tkn].s == ld.cos_command_attrindex
									) {
										brk = true;
										break;
									}
									if (foundOp) {
										const nsText = doc.getText(Range.create(ln,parsed[ln][tkn].p,ln,parsed[ln][tkn].p+parsed[ln][tkn].c));
										if (parsed[ln][tkn].s == ld.cos_str_attrindex && validNsRegex.test(nsText)) {
											currentNs = nsText.slice(1,-1).toUpperCase();
											if (currentNs != baseNs) {
												nsNestedBlockLevel = 1;
											}
											else {
												nsNestedBlockLevel = 0;
											}
										}
										else {
											// We can't determine what namespace we are in
											currentNs = "";
											nsNestedBlockLevel = 1;
										}
										brk = true;
										break;
									}
									if (
										parsed[ln][tkn].s == ld.cos_oper_attrindex &&
										doc.getText(Range.create(ln,parsed[ln][tkn].p,ln,parsed[ln][tkn].p+parsed[ln][tkn].c)) == "="
									) {
										foundOp = true;
									}
								}
								if (brk) {
									break;
								}
							}
						}
					}
				}
				else if (
					parsed[i][j].l == ld.cos_langindex && parsed[i][j].s == ld.cos_command_attrindex &&
					/^zn(space)?$/i.test((doc.getText(Range.create(i,parsed[i][j].p,i,parsed[i][j].p+parsed[i][j].c))))
				) {
					// This is a potential namespace switch

					if (j < parsed[i].length - 1) {
						const nextTknText = doc.getText(Range.create(i,parsed[i][j+1].p,i,parsed[i][j+1].p+parsed[i][j+1].c));
						if (
							parsed[i][j+1].l == ld.cos_langindex &&
							parsed[i][j+1].s == ld.cos_str_attrindex &&
							validNsRegex.test(nextTknText)
						) {
							currentNs = nextTknText.slice(1,-1).toUpperCase();
							if (currentNs != baseNs) {
								nsNestedBlockLevel = 1;
							}
							else {
								nsNestedBlockLevel = 0;
							}
						}
						else {
							// We can't determine what namespace we are in
							currentNs = "";
							nsNestedBlockLevel = 1;
						}
					}
				}
				else if (
					j == 0 && parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_keyword_attrindex &&
					isPersistent && parsed[i].length > 2 && (
						doc.getText(Range.create(i,0,i,8)).toLowerCase() == "property" ||
						doc.getText(Range.create(i,0,i,12)).toLowerCase() == "relationship"
					)
				) {
					// This is the start of a UDL Property definition

					const propRange = Range.create(i,parsed[i][1].p,i,parsed[i][1].p+parsed[i][1].c);
					const propName = quoteUDLIdentifier(doc.getText(propRange),0);

					// Check if a SqlFieldName is present
					let sqlFieldName: Range, hasSqlFieldName = false, inKeywords = false, brk = false;
					for (let ln = i; ln < parsed.length; ln++) {
						if (
							ln != i && parsed[ln]?.length && parsed[ln][0].l == ld.cls_langindex && (
								parsed[ln][0].s == ld.cls_desc_attrindex || (
									parsed[ln][0].s == ld.cls_keyword_attrindex &&
									isClassMember(doc.getText(Range.create(ln,parsed[ln][0].p,ln,parsed[ln][0].p+parsed[ln][0].c)))
								)
							)
						) {
							// This is the start of the next class member
							break;
						}
						for (let k = 0; k < parsed[ln].length; k++) {
							if (hasSqlFieldName) {
								if (parsed[ln][k].l == ld.cls_langindex && (
									parsed[ln][k].s == ld.cls_sqliden_attrindex || 
									parsed[ln][k].s == ld.error_attrindex || (
										parsed[ln][k].s == ld.cls_delim_attrindex &&
										inKeywords &&
										[",","]"].includes(doc.getText(Range.create(ln,parsed[ln][k].p,ln,parsed[ln][k].p+parsed[ln][k].c)))
									)
								)) {
									if (parsed[ln][k].s == ld.cls_sqliden_attrindex) {
										sqlFieldName = Range.create(ln,parsed[ln][k].p,ln,parsed[ln][k].p+parsed[ln][k].c);
									}
									brk = true;
									break;
								}
							} else if (
								parsed[ln][k].l == ld.cls_langindex &&
								parsed[ln][k].s == ld.cls_keyword_attrindex &&
								doc.getText(Range.create(ln,parsed[ln][k].p,ln,parsed[ln][k].p+parsed[ln][k].c)).toLowerCase() == "sqlfieldname"
							) {
								hasSqlFieldName = true;
							} else if (
								parsed[ln][k].l == ld.cls_langindex &&
								parsed[ln][k].s == ld.cls_delim_attrindex &&
								doc.getText(Range.create(ln,parsed[ln][k].p,ln,parsed[ln][k].p+parsed[ln][k].c)) == "["
							) {
								inKeywords = true;
							}
						}
						if (brk) break;
					}
					if (hasSqlFieldName) {
						if (sqlFieldName && sqlReservedWords.includes(doc.getText(sqlFieldName).toUpperCase())) {
							// The SqlFieldName is a reserved word
							diagnostics.push({
								severity: DiagnosticSeverity.Warning,
								range: sqlFieldName,
								message: "SqlFieldName is a SQL reserved word",
								source: 'InterSystems Language Server'
							});
						}
					} else if (sqlReservedWords.includes(propName.toUpperCase())) {
						// The property name is a reserved word, and it's not corrected by a SqlFieldName
						diagnostics.push({
							severity: DiagnosticSeverity.Warning,
							range: propRange,
							message: "Property name is a SQL reserved word",
							source: 'InterSystems Language Server'
						});
					}
				}
				if (nsNestedBlockLevel > 0) {
					// Determine if we're still in the different namespace

					if (parsed[i][j].l == ld.cos_langindex && parsed[i][j].s == ld.cos_brace_attrindex) {
						const brace = doc.getText(Range.create(i,parsed[i][j].p,i,parsed[i][j].p+parsed[i][j].c));
						if (brace == "{") {
							nsNestedBlockLevel++;
						}
						else {
							nsNestedBlockLevel--;
							if (nsNestedBlockLevel == 0) {
								// Ran off the end of that stack
								currentNs = baseNs;
							}
						}
					}
					else if (
						// Ran off the end of the implementation
						(parsed[i][j].l == ld.cls_langindex) ||
						// Ran off the end of the method
						(/^objectscript(-int)?$/.test(doc.languageId) && parsed[i][j].l == ld.cos_langindex && parsed[i][j].s == ld.cos_label_attrindex) ||
						// Exited the script
						(doc.languageId == "objectscript-csp" && parsed[i][j].l == ld.html_langindex)
					) {
						currentNs = baseNs;
						nsNestedBlockLevel = 0;
					}
				}
			}
		}
	}

	if (settings.diagnostics.deprecation && (methods.size > 0 || parameters.size > 0 || properties.size > 0 || classes.size > 0)) {
		// Query the database for all Deprecated members or classes that we're referencing

		// Build the query
		const querydata: QueryData = {
			query: "SELECT Name, Parent->ID AS Class, 'method' AS MemberType FROM %Dictionary.CompiledMethod WHERE Deprecated = 1 AND Parent->ID %INLIST $LISTFROMSTRING(?) UNION ALL %PARALLEL " +
				"SELECT Name, Parent->ID AS Class, 'parameter' AS MemberType FROM %Dictionary.CompiledParameter WHERE Deprecated = 1 AND Parent->ID %INLIST $LISTFROMSTRING(?) UNION ALL %PARALLEL " +
				"SELECT Name, Parent->ID AS Class, 'property' AS MemberType FROM %Dictionary.CompiledProperty WHERE Deprecated = 1 AND Parent->ID %INLIST $LISTFROMSTRING(?) UNION ALL %PARALLEL " +
				"SELECT Name, NULL AS Class, 'class' AS MemberType FROM %Dictionary.CompiledClass WHERE Deprecated = 1 AND Name %INLIST $LISTFROMSTRING(?)",
			parameters: [
				[...new Set([...methods.keys()].map(elem => {return elem.split(":::")[0]}))].join(","),
				[...new Set([...parameters.keys()].map(elem => {return elem.split(":::")[0]}))].join(","),
				[...new Set([...properties.keys()].map(elem => {return elem.split(":::")[0]}))].join(","),
				[...classes.keys()].join(",")
			]
		};

		// Make the request
		const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
		if (Array.isArray(respdata?.data?.result?.content) && respdata.data.result.content.length > 0) {
			// We got data back

			for (const row of respdata.data.result.content) {
				// Create a Diagnostic for each Range that this class or member appears in the document

				const memberstr: string = row.Class + ":::" + row.Name;
				let ranges: Range[] | undefined = undefined;
				if (row.MemberType === "method") {
					ranges = methods.get(memberstr);
				}
				else if (row.MemberType === "parameter") {
					ranges = parameters.get(memberstr);
				}
				else if (row.MemberType === "class") {
					ranges = classes.get(row.Name);
				}
				else {
					ranges = properties.get(memberstr);
				}
				if (ranges !== undefined) {
					for (const range of ranges) {
						diagnostics.push({
							range: range,
							severity: DiagnosticSeverity.Warning,
							source: 'InterSystems Language Server',
							tags: [DiagnosticTag.Deprecated],
							message: "Deprecated " + row.MemberType
						});
					}
				}
			}
		}
	}
	if ((settings.diagnostics.classes || settings.diagnostics.routines) && otherNsDocs.size > 0) {
		// Query the database for the existence of documents in other namespaces

		const namespaces = new Set<string>();
		otherNsDocs.forEach((v,k) => namespaces.add(k.split(":::")[0]));
		for (const namespace of namespaces) {
			// Build the query
			let querydata: QueryData;
			const otherClasses: string[] = [];
			const otherRtns: string[] = [];
			otherNsDocs.forEach((v,k) => {
				const [ns, doc] = k.split(":::");
				if (ns == namespace) {
					switch (doc.slice(-3)) {
						case "cls":
							otherClasses.push(doc.slice(0,-4));
							break;
						case "inc":
							otherRtns.push(doc);
							break;
						default:
							otherRtns.push(doc);
							otherRtns.push(`${doc.slice(0,-3)}int`);
							otherRtns.push(`${doc.slice(0,-3)}obj`);
					}
				}
			});
			if (otherClasses.length && otherRtns.length) {
				// Check for both classes and routines
				querydata = {
					query: "SELECT Name||'.cls' AS Name FROM %Dictionary.ClassDefinition WHERE Name %INLIST $LISTFROMSTRING(?) " +
						"UNION ALL %PARALLEL " +
						"SELECT Name FROM %Library.RoutineMgr_StudioOpenDialog(?,?,?,?,?,?,?) WHERE Name %INLIST $LISTFROMSTRING(?)",
					parameters: [otherClasses.join(","),"*.mac,*.inc,*.int,*.obj",1,1,1,1,1,0,otherRtns.join(",")]
				};
			}
			else if (otherClasses.length) {
				// Check for just classes
				querydata = {
					query: "SELECT Name||'.cls' AS Name FROM %Dictionary.ClassDefinition WHERE Name %INLIST $LISTFROMSTRING(?)",
					parameters: [otherClasses.join(",")]
				};
			}
			else {
				// Check for just routines
				querydata = {
					query: "SELECT Name FROM %Library.RoutineMgr_StudioOpenDialog(?,?,?,?,?,?,?) WHERE Name %INLIST $LISTFROMSTRING(?)",
					parameters: ["*.mac,*.inc,*.int,*.obj",1,1,1,1,1,0,otherRtns.join(",")]
				};
			}

			// Make the request
			const respdata = await makeRESTRequest("POST",1,"/action/query",{ ...server, namespace },querydata);
			if (Array.isArray(respdata?.data?.result?.content) && respdata.data.result.content.length > 0) {
				// We got data back

				// Report Diagnostics for files that aren't in the returned data
				respdata.data.result.content.forEach((e) => otherNsDocs.delete(`${namespace}:::${(e.Name.endsWith(".int") || e.Name.endsWith(".obj")) ? `${e.Name.slice(0,-3)}mac` : e.Name}`));
				otherNsDocs.forEach((v,k) => {
					const [ns, doc] = k.split(":::");
					if (ns == namespace) {
						v.forEach((range) => diagnostics.push({
							severity: DiagnosticSeverity.Error,
							range,
							message: `${doc.endsWith("cls") ? "Class" : doc.endsWith("inc") ? "Include file" : "Routine"} "${doc.slice(0,-4)}" does not exist in namespace "${ns}"`,
							source: 'InterSystems Language Server'
						}));
					}
				});
			}
		}
	}

	// Send computed diagnostics to the client
	return {
		kind: DocumentDiagnosticReportKind.Full,
		items: diagnostics
	};
};
