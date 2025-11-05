import { Position, TextDocumentPositionParams, Range, MarkupKind, Hover } from 'vscode-languageserver/node';
import { getServerSpec, getLanguageServerSettings, findFullRange, normalizeClassname, makeRESTRequest, documaticHtmlToMarkdown, getMacroContext, isMacroDefinedAbove, haltOrHang, quoteUDLIdentifier, getClassMemberContext, beautifyFormalSpec, determineClassNameParameterClass, storageKeywordsKeyForToken, getParsedDocument, currentClass, determineVariableClass, macroDefToDoc, urlMapAttribute } from '../utils/functions';
import { ServerSpec, QueryData, CommandDoc, KeywordDoc } from '../utils/types';
import { documents, corePropertyParams, mppContinue } from '../utils/variables';
import * as ld from '../utils/languageDefinitions';
import { getClassMethodHover } from '../ccs/hover/classSupport';
import { getRoutineHover } from '../ccs/hover/routineSupport';

import commands = require("../documentation/commands.json");
import structuredSystemVariables = require("../documentation/structuredSystemVariables.json");
import systemFunctions = require("../documentation/systemFunctions.json");
import systemVariables = require("../documentation/systemVariables.json");
import parameterTypes = require("../documentation/parameterTypes.json");
import preprocessorDirectives = require("../documentation/preprocessor.json");

import classKeywords = require("../documentation/keywords/Class.json");
import constraintKeywords = require("../documentation/keywords/Constraint.json");
import foreignkeyKeywords = require("../documentation/keywords/ForeignKey.json");
import indexKeywords = require("../documentation/keywords/Index.json");
import methodKeywords = require("../documentation/keywords/Method.json");
import parameterKeywords = require("../documentation/keywords/Parameter.json");
import projectionKeywords = require("../documentation/keywords/Projection.json");
import propertyKeywords = require("../documentation/keywords/Property.json");
import queryKeywords = require("../documentation/keywords/Query.json");
import storageKeywords = require("../documentation/keywords/Storage.json");
import triggerKeywords = require("../documentation/keywords/Trigger.json");
import xdataKeywords = require("../documentation/keywords/XData.json");

function documaticLink(server: ServerSpec, cls: string): string {
	return `[${cls}](${server.scheme}://${server.host}:${server.port}${server.pathPrefix}/csp/documatic/%25CSP.Documatic.cls?LIBRARY=${encodeURIComponent(server.namespace.toUpperCase())
		}&CLASSNAME=${encodeURIComponent(cls)})`;
}

function markupValue(header: string, body?: string): string {
	return body?.trim().length ? [header, "***", body].join("\n") : header;
}

export async function onHover(params: TextDocumentPositionParams): Promise<Hover> {
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) { return null; }
	const parsed = await getParsedDocument(params.textDocument.uri);
	if (parsed === undefined) { return null; }
	const server: ServerSpec = await getServerSpec(params.textDocument.uri);
	const settings = await getLanguageServerSettings(params.textDocument.uri);

	if (parsed[params.position.line] === undefined) {
		// This is the blank last line of the file
		return null;
	}
	for (let i = 0; i < parsed[params.position.line].length; i++) {
		const symbolstart: number = parsed[params.position.line][i].p;
		const symbolend: number = parsed[params.position.line][i].p + parsed[params.position.line][i].c;
		if (params.position.character >= symbolstart && params.position.character <= symbolend) {
			// We found the right symbol in the line

			const routineHover = await getRoutineHover(
				doc,
				parsed,
				params.position,
				i,
				params.textDocument.uri,
				server
			);
			if (routineHover !== null) {
				return routineHover;
			}

			const methodHover = await getClassMethodHover(
				doc,
				parsed,
				params.position,
				i,
				server
			);
			if (methodHover !== null) {
				return methodHover;
			}

			if ((
				(parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_clsname_attrindex) ||
				(parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_clsname_attrindex)
			) && doc.getText(Range.create(params.position.line, 0, params.position.line, 6)).toLowerCase() !== "import"
			) {
				// This is a class name

				// Get the full text of the selection
				let wordrange = findFullRange(params.position.line, parsed, i, symbolstart, symbolend);
				let word = doc.getText(wordrange);
				if (word.charAt(0) === ".") {
					// This might be $SYSTEM.ClassName
					const prevseven = doc.getText(Range.create(
						params.position.line, wordrange.start.character - 7,
						params.position.line, wordrange.start.character
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
					word = word.slice(1, -1);
				}

				// Normalize the class name if there are imports
				let normalizedname = await normalizeClassname(doc, parsed, word, server, params.position.line);

				// Get the description for this class from the server
				const querydata: QueryData = {
					query: "SELECT Description FROM %Dictionary.CompiledClass WHERE Name = ?",
					parameters: [normalizedname]
				};
				const respdata = await makeRESTRequest("POST", 1, "/action/query", server, querydata);
				if (Array.isArray(respdata?.data?.result?.content) && respdata.data.result.content.length == 1) {
					// The class was found
					return {
						contents: {
							kind: MarkupKind.Markdown,
							value: markupValue(
								documaticLink(server, normalizedname),
								documaticHtmlToMarkdown(respdata.data.result.content[0].Description)
							)
						},
						range: wordrange
					};
				}
			}
			else if (
				parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_macro_attrindex || (
					parsed[params.position.line][i].l == ld.sql_langindex &&
					parsed[params.position.line][i].s == ld.sql_iden_attrindex &&
					doc.getText(Range.create(params.position.line, symbolstart, params.position.line, symbolstart + 3)) == "$$$"
				)
			) {
				// This is a macro

				// Get the details of this class
				const isSql = parsed[params.position.line][i].l == ld.sql_langindex;
				const maccon = getMacroContext(doc, parsed, params.position.line, isSql);

				// Get the full range of the macro
				const macrorange = findFullRange(params.position.line, parsed, i, symbolstart, symbolend);
				let macrotext = doc.getText(macrorange);
				let sqlMacroArgs = "";
				if (isSql && macrotext.includes("(")) {
					// SQL macros with arguments have the arguments as part of the same token
					const parenIdx = macrotext.indexOf("(");
					sqlMacroArgs = macrotext.slice(parenIdx).replace(/\s+/g, "");
					macrotext = macrotext.slice(0, parenIdx);
					macrorange.end = Position.create(params.position.line, symbolstart + macrotext.length);
				}
				if (macrotext.slice(0, 3) == "$$$") {
					macrotext = macrotext.slice(3);
				}

				/** Helper function for getting the arguments passed to this macro. */
				const getMacroArgs = (): string => {
					if (isSql) return sqlMacroArgs;
					// Get the rest of the line following the macro
					const restofline = doc.getText(Range.create(
						params.position.line, macrorange.end.character,
						params.position.line, parsed[params.position.line][parsed[params.position.line].length - 1].p + parsed[params.position.line][parsed[params.position.line].length - 1].c
					));

					// If this macro takes arguments, send them in the request body
					let macroargs = "";
					if (restofline.charAt(0) === "(") {
						let opencount: number = 1;
						let closeidx: number = -1;
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
							macroargs = restofline.slice(0, closeidx + 1).replace(/\s+(?=([^"]*"[^"]*")*[^"]*$)/g, "");
						}
						else {
							// The argument list is incomplete
							macroargs = "incomplete";
						}
					}
					return macroargs;
				};

				// Check if the macro definition appears in the current file
				const macrodefline = isMacroDefinedAbove(doc, parsed, params.position.line, macrotext);

				if (macrodefline != -1) {
					// The macro definition is in the current file

					let definition = "";
					let formalspec = "";
					let onearg = false;
					let definitionendtkn = 2;
					for (let ln = macrodefline; ln < parsed.length; ln++) {
						if (ln == macrodefline) {
							// Capture the formal spec (if present) and if this is a #Def1arg macro

							onearg = doc.getText(Range.create(ln, parsed[ln][1].p, ln, parsed[ln][1].p + parsed[ln][1].c)).toLowerCase() == "def1arg";
							if (
								parsed[ln].length > 3 && parsed[ln][3].s == ld.cos_delim_attrindex &&
								doc.getText(Range.create(ln, parsed[ln][3].p, ln, parsed[ln][3].p + parsed[ln][3].c)) == "("
							) {
								// Capture the formal spec

								for (let tkn = 3; tkn < parsed[ln].length; tkn++) {
									formalspec += doc.getText(Range.create(ln, parsed[ln][tkn].p, ln, parsed[ln][tkn].p + parsed[ln][tkn].c));
									if (parsed[ln][tkn].s == ld.cos_delim_attrindex && formalspec.endsWith(")")) {
										definitionendtkn = tkn;
										break;
									}
								}
							}
							if (definitionendtkn == (parsed[ln].length - 1)) {
								// This is an empty macro definition
								break;
							}
						}

						if (
							parsed[ln][parsed[ln].length - 1].l == ld.cos_langindex &&
							parsed[ln][parsed[ln].length - 1].s == ld.cos_ppf_attrindex &&
							mppContinue.test(doc.getText(Range.create(
								ln, parsed[ln][parsed[ln].length - 1].p,
								ln, parsed[ln][parsed[ln].length - 1].p + parsed[ln][parsed[ln].length - 1].c
							)))
						) {
							// This is one line of a multi-line macro definition
							const endTkn = parsed[ln].length - (doc.getText(Range.create(
								ln, parsed[ln][parsed[ln].length - 1].p,
								ln, parsed[ln][parsed[ln].length - 1].p + parsed[ln][parsed[ln].length - 1].c
							)).startsWith("##") ? 2 : 3);
							if (ln == macrodefline) {
								// This is the first line of a multi-line macro definition
								definition = doc.getText(Range.create(ln, parsed[ln][definitionendtkn + 1].p, ln, parsed[ln][endTkn].p + parsed[ln][endTkn].c)).trimEnd() + "\n";
								if (!definition.trim()) definition = "";
							}
							else {
								definition += doc.getText(Range.create(ln, 0, ln, parsed[ln][endTkn].p + parsed[ln][endTkn].c)).trimEnd() + "\n";
							}
						}
						else {
							if (ln == macrodefline) {
								// This is a one line macro definition
								definition = doc.getText(Range.create(ln, parsed[ln][definitionendtkn + 1].p, ln, parsed[ln][parsed[ln].length - 1].p + parsed[ln][parsed[ln].length - 1].c)).trimEnd();
							}
							else {
								// This is the last line of a multi-line macro definition
								definition += doc.getText(Range.create(ln, 0, ln, parsed[ln][parsed[ln].length - 1].p + parsed[ln][parsed[ln].length - 1].c)).trimEnd();
							}
							// We've captured all the lines of this macro definition
							break;
						}
					}

					if (definition == "") return null;

					// If this macro has a formal spec, attempt to replace the parameters with the arguments from the usage
					if (formalspec.endsWith(")")) {
						let macroargs = getMacroArgs();
						if (!["", "incomplete"].includes(macroargs)) {
							formalspec = formalspec.slice(1, -1).replace(/\s+/g, "");
							macroargs = macroargs.slice(1, -1);
							if (onearg) {
								// This is a #Def1arg macro, so perform the single replacement
								definition = definition.replace(new RegExp(formalspec, "g"), macroargs);
							}
							else {
								// Build lists for the parameters and passed arguments
								const paramslist = formalspec.split(",");
								const argslist = [""];
								let doublequotes = 0;
								let parenlevel = 0;
								for (const char of macroargs) {
									if (char == '"') {
										doublequotes++;
									}
									if (char == "(") {
										parenlevel++;
									}
									if (char == ")") {
										parenlevel--;
									}
									if (char == "," && doublequotes % 2 == 0 && parenlevel == 0) {
										argslist.push("");
									}
									else {
										argslist[argslist.length - 1] += char;
									}
								}
								if (paramslist.length == argslist.length) {
									// Perform the replacement for each argument
									for (let argidx = 0; argidx < paramslist.length; argidx++) {
										definition = definition.replace(new RegExp(paramslist[argidx].trim(), "g"), () => argslist[argidx]);
									}
								}
							}
						}
					}

					return {
						contents: {
							kind: MarkupKind.Markdown,
							value: `\`\`\`\n${definition}\n\`\`\``
						},
						range: macrorange
					};
				}
				else {
					// The macro is defined in another file

					// If this macro takes arguments, send them in the request body
					const macroargs = getMacroArgs();

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
						const exprespdata = await makeRESTRequest("POST", 2, "/action/getmacroexpansion", server, expquerydata);
						if (Array.isArray(exprespdata?.data?.result?.content?.expansion) && exprespdata.data.result.content.expansion.length > 0) {
							// We got data back
							const exptext = exprespdata.data.result.content.expansion.join("  \n");
							if (exptext.slice(0, 5) === "ERROR") {
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
								const defrespdata = await makeRESTRequest("POST", 2, "/action/getmacrodefinition", server, defquerydata);
								if (Array.isArray(defrespdata?.data?.result?.content?.definition) && defrespdata.data.result.content.definition.length > 0) {
									// The macro definition was found
									return {
										contents: macroDefToDoc(defrespdata.data.result.content.definition),
										range: macrorange
									};
								}
							}
							else {
								// The expansion was generated successfully
								return {
									contents: {
										kind: MarkupKind.Markdown,
										value: `\`\`\`\n${exprespdata.data.result.content.expansion.join("\n")}\n\`\`\``
									},
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
						const respdata = await makeRESTRequest("POST", 2, "/action/getmacrodefinition", server, inputdata);
						if (Array.isArray(respdata?.data?.result?.content?.definition) && respdata.data.result.content.definition.length > 0) {
							// The macro definition was found
							return {
								contents: macroDefToDoc(respdata.data.result.content.definition),
								range: macrorange
							};
						}
					}
				}
			}
			else if (parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_sysf_attrindex && settings.hover.system) {
				// This is a system function
				const sysfrange = Range.create(params.position.line, symbolstart, params.position.line, symbolend);
				const sysftext = doc.getText(sysfrange).toUpperCase();
				const sysfdoc = systemFunctions.find((el) => el.label === sysftext || el.alias.includes(sysftext));
				if (sysfdoc && sysftext != "$PREPROCESS") {
					return {
						contents: {
							kind: MarkupKind.Markdown,
							value: ["$ZUTIL", "$ZU"].includes(sysftext) ?
								markupValue(`[Online documentation](${sysfdoc.link})`) :
								markupValue(sysfdoc.documentation.join(""), sysfdoc.link ? `[Online documentation](${sysfdoc.link[0] == "h" ? sysfdoc.link : `https://docs.intersystems.com/irislatest/csp/docbook/Doc.View.cls?KEY=RCOS_${sysfdoc.link}`
									})` : "")
						},
						range: sysfrange
					};
				}
			}
			else if (parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_ssysv_attrindex && settings.hover.system) {
				// This is a structured system variable
				var ssysvrange = Range.create(params.position.line, symbolstart, params.position.line, symbolend);
				var ssysvtext = doc.getText(ssysvrange).toUpperCase();
				if (ssysvtext === "^$") {
					// This is the first half, before the namespace

					// Continue looping on the line to find the second half
					var secondhalf = "";
					var secondhalfend = -1;
					for (let j = i + 1; j < parsed[params.position.line].length; j++) {
						if (parsed[params.position.line][j].l == ld.cos_langindex && parsed[params.position.line][j].s == ld.cos_ssysv_attrindex) {
							secondhalf = doc.getText(Range.create(
								params.position.line, parsed[params.position.line][j].p,
								params.position.line, parsed[params.position.line][j].p + parsed[params.position.line][j].c
							)).toUpperCase();
							secondhalfend = parsed[params.position.line][j].p + parsed[params.position.line][j].c;
							break;
						}
					}
					if (secondhalf === "") {
						// Couldn't find the rest of the structured system variable
						return null;
					}
					ssysvtext = ssysvtext + secondhalf;
					ssysvrange = Range.create(ssysvrange.start, Position.create(params.position.line, secondhalfend));
				}
				else if (ssysvtext.indexOf("^$") === -1) {
					// This is the second half, after the namespace

					// Loop backwards on the line to find the first half
					var firsthalfstart = -1;
					for (let j = i - 1; j >= 0; j--) {
						if (parsed[params.position.line][j].l == ld.cos_langindex && parsed[params.position.line][j].s == ld.cos_ssysv_attrindex) {
							const firsthalf = doc.getText(Range.create(
								params.position.line, parsed[params.position.line][j].p,
								params.position.line, parsed[params.position.line][j].p + parsed[params.position.line][j].c
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
					ssysvrange = Range.create(Position.create(params.position.line, firsthalfstart), ssysvrange.end);
				}
				const ssysvdoc = structuredSystemVariables.find((el) => el.label === ssysvtext || el.alias.includes(ssysvtext));
				if (ssysvdoc !== undefined) {
					return {
						contents: {
							kind: MarkupKind.Markdown,
							value: markupValue(
								ssysvdoc.documentation.join(""),
								`[Online documentation](https://docs.intersystems.com/irislatest/csp/docbook/Doc.View.cls?KEY=RCOS_${ssysvdoc.link})`
							),
						},
						range: ssysvrange
					};
				}
			}
			else if (parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_sysv_attrindex && settings.hover.system) {
				// This is a system variable
				const sysvrange = Range.create(params.position.line, symbolstart, params.position.line, symbolend);
				const sysvtext = doc.getText(sysvrange).toUpperCase();
				const sysvdoc = systemVariables.find((el) => el.label === sysvtext || el.alias.includes(sysvtext));
				if (sysvdoc !== undefined) {
					return {
						contents: {
							kind: MarkupKind.Markdown,
							value: markupValue(
								sysvdoc.documentation.join(""),
								`[Online documentation](https://docs.intersystems.com/irislatest/csp/docbook/Doc.View.cls?KEY=RCOS_${sysvdoc.link})`
							),
						},
						range: sysvrange
					};
				}
			}
			else if (parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_command_attrindex && settings.hover.commands) {
				// This is a command
				const commandrange = Range.create(params.position.line, symbolstart, params.position.line, symbolend);
				const commandtext = doc.getText(commandrange).toUpperCase();
				var commanddoc: CommandDoc | undefined;
				if (commandtext === "H") {
					// This is "halt" or "hang"
					commanddoc = haltOrHang(doc, parsed, params.position.line, i);
				}
				else {
					commanddoc = commands.find((el) => el.label === commandtext || el.alias.includes(commandtext));
				}
				if (commanddoc !== undefined) {
					return {
						contents: {
							kind: MarkupKind.Markdown,
							value: markupValue(
								commanddoc.documentation.join(""),
								`[Online documentation](https://docs.intersystems.com/irislatest/csp/docbook/Doc.View.cls?KEY=RCOS_${commanddoc.link})`
							),
						},
						range: commandrange
					};
				}
			}
			else if (
				parsed[params.position.line][i].l == ld.cos_langindex && (
					parsed[params.position.line][i].s == ld.cos_prop_attrindex ||
					parsed[params.position.line][i].s == ld.cos_method_attrindex ||
					parsed[params.position.line][i].s == ld.cos_attr_attrindex ||
					parsed[params.position.line][i].s == ld.cos_mem_attrindex ||
					parsed[params.position.line][i].s == ld.cos_instvar_attrindex)
			) {
				// This is a class member (property/parameter/method)

				// Get the full text of the selection
				const memberrange = findFullRange(params.position.line, parsed, i, symbolstart, symbolend);
				var member = doc.getText(memberrange);
				if (member.charAt(0) === "#") {
					member = member.slice(1);
				} else if (parsed[params.position.line][i].s == ld.cos_instvar_attrindex) {
					member = member.slice(2);
				}
				const unquotedname = quoteUDLIdentifier(member, 0);

				let membercontext = {
					baseclass: "",
					context: ""
				};
				if (parsed[params.position.line][i].s != ld.cos_instvar_attrindex) {
					// Find the dot token
					var dottkn = 0;
					for (let tkn = 0; tkn < parsed[params.position.line].length; tkn++) {
						if (parsed[params.position.line][tkn].p >= memberrange.start.character) {
							break;
						}
						dottkn = tkn;
					}

					// Get the base class that this member is in
					membercontext = await getClassMemberContext(doc, parsed, dottkn, params.position.line, server);
				} else {
					membercontext = {
						baseclass: currentClass(doc, parsed),
						context: ""
					};
				}
				if (membercontext.baseclass === "") {
					// If we couldn't determine the class, don't return anything
					return null;
				}

				// Query the server to get the description of this member using its base class, text and token type
				var data: QueryData = {
					query: "",
					parameters: []
				};
				if (unquotedname == "%New") {
					// Get the information for both %New and %OnNew
					data.query = "SELECT Description, FormalSpec, ReturnType, Stub, Origin FROM %Dictionary.CompiledMethod WHERE Parent = ? AND (name = ? OR name = ?)";
					data.parameters = [membercontext.baseclass, unquotedname, "%OnNew"];
				}
				else if (parsed[params.position.line][i].s == ld.cos_prop_attrindex) {
					// This is a parameter
					data.query = "SELECT Description, NULL AS FormalSpec, Type AS ReturnType, NULL AS Stub FROM %Dictionary.CompiledParameter WHERE Parent = ? AND name = ?";
					data.parameters = [membercontext.baseclass, unquotedname];
				}
				else if (parsed[params.position.line][i].s == ld.cos_method_attrindex) {
					// This is a method
					data.query = "SELECT Description, FormalSpec, ReturnType, Stub FROM %Dictionary.CompiledMethod WHERE Parent = ? AND name = ?";
					data.parameters = [membercontext.baseclass, unquotedname];
				}
				else if (parsed[params.position.line][i].s == ld.cos_attr_attrindex || parsed[params.position.line][i].s == ld.cos_instvar_attrindex) {
					// This is a property
					data.query =
						"SELECT Description, NULL AS FormalSpec, CASE WHEN Collection IS NOT NULL THEN Collection||' Of '||Type ELSE Type END AS ReturnType, NULL AS Stub " +
						"FROM %Dictionary.CompiledProperty WHERE Parent = ? AND (Name = ? OR ? %INLIST $LISTFROMSTRING($TRANSLATE(Aliases,' ')))";
					data.parameters = [membercontext.baseclass, unquotedname, unquotedname.replace(/\s+/g, "")];
				}
				else {
					// This is a generic member
					if (membercontext.baseclass.startsWith("%SYSTEM")) {
						// This is always a method
						data.query = "SELECT Description, FormalSpec, ReturnType, Stub FROM %Dictionary.CompiledMethod WHERE Parent = ? AND name = ?";
						data.parameters = [membercontext.baseclass, unquotedname];
					}
					else {
						// This can be a method or property
						data.query =
							"SELECT Description, FormalSpec, ReturnType, Stub FROM %Dictionary.CompiledMethod WHERE Parent = ? AND name = ? UNION ALL " +
							"SELECT Description, NULL AS FormalSpec, CASE WHEN Collection IS NOT NULL THEN Collection||' Of '||Type ELSE Type END AS ReturnType, NULL AS Stub " +
							"FROM %Dictionary.CompiledProperty WHERE Parent = ? AND (Name = ? OR ? %INLIST $LISTFROMSTRING($TRANSLATE(Aliases,' ')))";
						data.parameters = [membercontext.baseclass, unquotedname, membercontext.baseclass, unquotedname, unquotedname.replace(/\s+/g, "")];
					}
				}
				const respdata = await makeRESTRequest("POST", 1, "/action/query", server, data);
				if (Array.isArray(respdata?.data?.result?.content) && respdata.data.result.content.length > 0) {
					// We got data back

					let header = `(**${membercontext.baseclass}**) <u>**${member}**</u>`;
					const nextchar = doc.getText(Range.create(params.position.line, memberrange.end.character, params.position.line, memberrange.end.character + 1));
					if (member == "%New" && respdata.data.result.content.length == 2 && respdata.data.result.content[1].Origin != "%Library.RegisteredObject") {
						// %OnNew has been overridden for this class
						header += beautifyFormalSpec(respdata.data.result.content[1].FormalSpec, true);
						header += ` As **${membercontext.baseclass}**`;
						return {
							contents: {
								kind: MarkupKind.Markdown,
								value: markupValue(header, documaticHtmlToMarkdown(respdata.data.result.content[
									respdata.data.result.content[1].Description.trim().length ? 1 : 0
								].Description))
							},
							range: memberrange
						};
					}
					else if (respdata.data.result.content[0].Stub !== "") {
						// This is a method generated by member inheritance, so we need to get its metadata from the proper subtable

						const stubarr = respdata.data.result.content[0].Stub.split(".");
						var stubquery = "";
						if (stubarr[2] === "i") {
							// This is a method generated from an index
							stubquery = "SELECT Description, FormalSpec, ReturnType FROM %Dictionary.CompiledIndexMethod WHERE Name = ? AND parent->Parent = ? AND parent->Name = ?";
						}
						if (stubarr[2] === "q") {
							// This is a method generated from a query
							stubquery = "SELECT Description, FormalSpec, ReturnType FROM %Dictionary.CompiledQueryMethod WHERE Name = ? AND parent->Parent = ? AND parent->Name = ?";
						}
						if (stubarr[2] === "a") {
							// This is a method generated from a property
							stubquery = "SELECT Description, FormalSpec, ReturnType FROM %Dictionary.CompiledPropertyMethod WHERE Name = ? AND parent->Parent = ? AND parent->Name = ?";
						}
						if (stubarr[2] === "n") {
							// This is a method generated from a constraint
							stubquery = "SELECT Description, FormalSpec, ReturnType FROM %Dictionary.CompiledConstraintMethod WHERE Name = ? AND parent->Parent = ? AND parent->Name = ?";
						}
						if (stubquery !== "") {
							const stubrespdata = await makeRESTRequest("POST", 1, "/action/query", server, {
								query: stubquery,
								parameters: [stubarr[1], membercontext.baseclass, stubarr[0]]
							});
							if (Array.isArray(stubrespdata?.data?.result?.content) && stubrespdata.data.result.content.length > 0) {
								// We got data back
								if (nextchar === "(") {
									header = header + beautifyFormalSpec(stubrespdata.data.result.content[0].FormalSpec, true);
									if (stubrespdata.data.result.content[0].ReturnType !== "") {
										header = `${header} As **${stubrespdata.data.result.content[0].ReturnType}**`;
									}
								}
								return {
									contents: {
										kind: MarkupKind.Markdown,
										value: markupValue(header, documaticHtmlToMarkdown(stubrespdata.data.result.content[0].Description))
									},
									range: memberrange
								};
							}
						}
					}
					else {
						// This is a regular member

						if (nextchar === "(") {
							header += beautifyFormalSpec(member == "%New" ? "" : respdata.data.result.content[0].FormalSpec, true);
						}
						if (["%New", "%Open", "%OpenId"].includes(member)) {
							header += ` As **${membercontext.baseclass}**`;
						}
						else if (respdata.data.result.content[0].ReturnType !== "") {
							let type: string = respdata.data.result.content[0].ReturnType;
							type = type.includes(" ") ? type.charAt(0).toUpperCase() + type.slice(1) : type;
							header += ` As **${type}**`;
						}
						return {
							contents: {
								kind: MarkupKind.Markdown,
								value: markupValue(header, documaticHtmlToMarkdown(respdata.data.result.content[0].Description))
							},
							range: memberrange
						};
					}
				}
			}
			else if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_keyword_attrindex) {
				// This is a UDL keyword

				// Scan left on the line to see if we're in a set of square brackets
				var foundopenbracket = false;
				for (let j = i - 1; j >= 0; j--) {
					if (parsed[params.position.line][j].l == ld.cls_langindex && parsed[params.position.line][j].s == ld.cls_delim_attrindex) {
						// This is a UDL delimiter
						const delim = doc.getText(
							Range.create(
								params.position.line, parsed[params.position.line][j].p,
								params.position.line, parsed[params.position.line][j].p + 1
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
					const thiskeyrange = Range.create(params.position.line, symbolstart, params.position.line, symbolend);
					const thiskeytext = doc.getText(thiskeyrange).toLowerCase();

					// Find the type of this member
					var firstkey = doc.getText(Range.create(
						params.position.line, parsed[params.position.line][0].p,
						params.position.line, parsed[params.position.line][0].p + parsed[params.position.line][0].c
					)).toLowerCase();
					if (parsed[params.position.line][0].l !== ld.cls_langindex || parsed[params.position.line][0].s !== ld.cls_keyword_attrindex) {
						// This member definition spans multiple lines
						for (let k = params.position.line - 1; k >= 0; k--) {
							if (parsed[k].length === 0) {
								continue;
							}
							if (parsed[k][0].l == ld.cls_langindex && parsed[k][0].s == ld.cls_keyword_attrindex) {
								firstkey = doc.getText(Range.create(
									k, parsed[k][0].p,
									k, parsed[k][0].p + parsed[k][0].c
								)).toLowerCase();
								break;
							}
						}
					}

					var keydoc: KeywordDoc | undefined;
					if (firstkey === "class") {
						// This is a class keyword
						keydoc = <KeywordDoc>classKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
					}
					else if (firstkey === "constraint") {
						// This is a constraint keyword
						keydoc = <KeywordDoc>constraintKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
					}
					else if (firstkey === "foreignkey") {
						// This is a ForeignKey keyword
						keydoc = <KeywordDoc>foreignkeyKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
					}
					else if (firstkey === "index") {
						// This is a index keyword
						keydoc = <KeywordDoc>indexKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
					}
					else if (firstkey === "method" || firstkey === "classmethod" || firstkey === "clientmethod") {
						// This is a method keyword
						keydoc = <KeywordDoc>methodKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
					}
					else if (firstkey === "parameter") {
						// This is a parameter keyword
						keydoc = <KeywordDoc>parameterKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
					}
					else if (firstkey === "projection") {
						// This is a projection keyword
						keydoc = <KeywordDoc>projectionKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
					}
					else if (firstkey === "property" || firstkey === "relationship") {
						// This is a property keyword
						keydoc = <KeywordDoc>propertyKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
					}
					else if (firstkey === "query") {
						// This is a query keyword
						keydoc = <KeywordDoc>queryKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
					}
					else if (firstkey === "trigger") {
						// This is a trigger keyword
						keydoc = <KeywordDoc>triggerKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
					}
					else if (firstkey === "xdata") {
						// This is an XData keyword
						keydoc = <KeywordDoc>xdataKeywords.find((keydoc) => keydoc.name.toLowerCase() === thiskeytext);
					}
					if (keydoc !== undefined) {
						var hoverdocstr = keydoc.description;
						if (hoverdocstr === undefined) {
							hoverdocstr = "";
						}
						return {
							contents: {
								kind: MarkupKind.Markdown,
								value: Array.isArray(keydoc?.constraint) ?
									hoverdocstr != "" ?
										markupValue(keydoc.description, "Permitted values: " + keydoc.constraint.join(", ")) :
										"Permitted values: " + keydoc.constraint.join(", ")
									: keydoc.description
							},
							range: thiskeyrange
						};
					}
				}
			}
			else if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_iden_attrindex) {
				// This is a UDL identifier

				const prevtokentext = doc.getText(Range.create(
					params.position.line, parsed[params.position.line][i - 1].p,
					params.position.line, parsed[params.position.line][i - 1].p + parsed[params.position.line][i - 1].c
				)).toLowerCase();
				if (parsed[params.position.line][i - 1].l == ld.cls_langindex && parsed[params.position.line][i - 1].s == ld.cls_keyword_attrindex && prevtokentext === "as") {
					// This is a parameter type

					const tokenrange = Range.create(
						params.position.line, parsed[params.position.line][i].p,
						params.position.line, parsed[params.position.line][i].p + parsed[params.position.line][i].c
					);
					const tokentext = doc.getText(tokenrange).toUpperCase();
					const thistypedoc = parameterTypes.find((typedoc) => typedoc.name === tokentext);
					if (thistypedoc !== undefined) {
						return {
							contents: {
								kind: MarkupKind.PlainText,
								value: thistypedoc.documentation
							},
							range: tokenrange
						};
					}
				}
			}
			else if (parsed[params.position.line][i].l == ld.sql_langindex && parsed[params.position.line][i].s == ld.sql_iden_attrindex) {
				// This is a SQL identifier

				// Get the full text of the selection
				const idenrange = findFullRange(params.position.line, parsed, i, symbolstart, symbolend);
				const iden = doc.getText(idenrange);

				// Find the preceding keyword (other than 'AS')
				var keytext: string = "";
				for (let ln = params.position.line; ln >= 0; ln--) {
					for (let tk = parsed[ln].length - 1; tk >= 0; tk--) {
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
								ln, parsed[ln][tk].p,
								ln, parsed[ln][tk].p + parsed[ln][tk].c
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
						keytext === "lock" || keytext === "unlock" || keytext === "table" ||
						keytext === "update")
				) {
					// This identifier is a table name

					if (iden.lastIndexOf("_") > iden.lastIndexOf(".")) {
						// This table is projected from a multi-dimensional property

						// Split the identifier into the class and property
						const clsname = iden.slice(0, iden.lastIndexOf("_")).replace(/_/g, ".");
						const propname = iden.slice(iden.lastIndexOf("_") + 1);

						// Normalize the class name if there are imports
						const normalizedname = await normalizeClassname(doc, parsed, clsname, server, params.position.line);
						if (normalizedname !== "") {
							// Query the server to get the description of this property
							const data: QueryData = {
								query: "SELECT Description, CASE WHEN Collection IS NOT NULL THEN Collection||' Of '||Type ELSE Type END AS DisplayType FROM %Dictionary.CompiledProperty WHERE Parent = ? AND name = ?",
								parameters: [normalizedname, propname]
							};
							const respdata = await makeRESTRequest("POST", 1, "/action/query", server, data);
							if (Array.isArray(respdata?.data?.result?.content) && respdata.data.result.content.length > 0) {
								// We got data back

								let type: string = respdata.data.result.content[0].DisplayType;
								type = type.includes(" ") ? type.charAt(0).toUpperCase() + type.slice(1) : type;
								const header = `(**${normalizedname}**) <u>**${propname}**</u>${type != "" ? ` As **${type}**` : ""}`;
								return {
									contents: {
										kind: MarkupKind.Markdown,
										value: markupValue(header, documaticHtmlToMarkdown(respdata.data.result.content[0].Description))
									},
									range: idenrange
								};
							}
						}
					}
					else {
						// This table is a class

						// Normalize the class name if there are imports
						const normalizedname = await normalizeClassname(doc, parsed, iden.replace(/_/g, "."), server, params.position.line);
						if (normalizedname !== "") {
							// Get the description for this class from the server
							const querydata: QueryData = {
								query: "SELECT Description FROM %Dictionary.CompiledClass WHERE Name = ?",
								parameters: [normalizedname]
							};
							const respdata = await makeRESTRequest("POST", 1, "/action/query", server, querydata);
							if (Array.isArray(respdata?.data?.result?.content) && respdata.data.result.content.length == 1) {
								// The class was found
								return {
									contents: {
										kind: MarkupKind.Markdown,
										value: markupValue(
											documaticLink(server, normalizedname),
											documaticHtmlToMarkdown(respdata.data.result.content[0].Description)
										)
									},
									range: idenrange
								};
							}
						}
					}
				}
				else if (keytext === "call" && iden.indexOf("_") !== -1) {
					// This identifier is a Query or ClassMethod being invoked as a SqlProc

					const clsname = iden.slice(0, iden.lastIndexOf("_")).replace(/_/g, ".");
					const procname = iden.slice(iden.lastIndexOf("_") + 1);

					// Normalize the class name if there are imports
					const normalizedname = await normalizeClassname(doc, parsed, clsname, server, params.position.line);
					if (normalizedname !== "") {
						// Query the server to get the description
						var querystr = "SELECT Description, FormalSpec, ReturnType FROM %Dictionary.CompiledMethod WHERE Parent = ? AND name = ? UNION ALL ";
						querystr = querystr.concat("SELECT Description, FormalSpec, Type AS ReturnType FROM %Dictionary.CompiledQuery WHERE Parent = ? AND name = ?");
						const data: QueryData = {
							query: querystr,
							parameters: [normalizedname, procname, normalizedname, procname]
						};
						const respdata = await makeRESTRequest("POST", 1, "/action/query", server, data);
						if (Array.isArray(respdata?.data?.result?.content) && respdata.data.result.content.length > 0) {
							// We got data back
							let header = `(**${normalizedname}**) <u>**${procname}**</u>`;
							const nextchar = doc.getText(Range.create(params.position.line, idenrange.end.character, params.position.line, idenrange.end.character + 1));
							if (nextchar === "(") {
								header = header + beautifyFormalSpec(respdata.data.result.content[0].FormalSpec, true);
								if (respdata.data.result.content[0].ReturnType !== "") {
									header = `${header} As **${respdata.data.result.content[0].ReturnType}**`;
								}
							}
							return {
								contents: {
									kind: MarkupKind.Markdown,
									value: markupValue(header, documaticHtmlToMarkdown(respdata.data.result.content[0].Description))
								},
								range: idenrange
							};
						}
					}
				}
				else {
					// This identifier is a property
					if ((iden.split(".").length - 1) > 0) {
						// We won't resolve properties that don't contain the table name
						const tblname = iden.slice(0, iden.lastIndexOf("."));
						const propname = iden.slice(iden.lastIndexOf(".") + 1);

						if (tblname.lastIndexOf("_") > tblname.lastIndexOf(".")) {
							// This table is projected from a multi-dimensional property, so we can't provide any info
						}
						else {
							// Normalize the class name if there are imports
							const normalizedname = await normalizeClassname(doc, parsed, tblname.replace(/_/g, "."), server, params.position.line);
							if (normalizedname !== "") {
								// Query the server to get the description of this property
								const data: QueryData = {
									query: "SELECT Description, CASE WHEN Collection IS NOT NULL THEN Collection||' Of '||Type ELSE Type END AS DisplayType FROM %Dictionary.CompiledProperty WHERE Parent = ? AND name = ?",
									parameters: [normalizedname, propname]
								};
								const respdata = await makeRESTRequest("POST", 1, "/action/query", server, data);
								if (Array.isArray(respdata?.data?.result?.content) && respdata.data.result.content.length > 0) {
									// We got data back

									let type: string = respdata.data.result.content[0].DisplayType;
									type = type.includes(" ") ? type.charAt(0).toUpperCase() + type.slice(1) : type;
									const header = `(**${normalizedname}**) <u>**${propname}**</u>${type != "" ? ` As **${type}**` : ""}`;
									return {
										contents: {
											kind: MarkupKind.Markdown,
											value: markupValue(header, documaticHtmlToMarkdown(respdata.data.result.content[0].Description))
										},
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
				const pprange = findFullRange(params.position.line, parsed, i, symbolstart, symbolend);
				const pp = doc.getText(pprange);

				// Find the correct directive
				const ppobj = preprocessorDirectives.find((el) => el.label.toLowerCase().replace(/\s+/g, '') === pp.toLowerCase());
				if (ppobj !== undefined) {
					return {
						contents: {
							kind: MarkupKind.Markdown,
							value: markupValue(
								ppobj.documentation,
								`[Online documentation](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=RCOS_macros_${ppobj.link})`
							)
						},
						range: pprange
					};
				}
			}
			else if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_cparam_attrindex) {
				// This is a class name parameter

				// Verify that is is a parameter for a class name and not a method argument
				const clsName = determineClassNameParameterClass(doc, parsed, params.position.line, i);
				if (clsName == "") return;

				// Get the full text of the selection
				const paramrange = findFullRange(params.position.line, parsed, i, symbolstart, symbolend);
				const param = doc.getText(paramrange);

				// If this is a core Property data type parameter, return the static description
				const coreParam = corePropertyParams.find(e => e.name === param);
				if (coreParam !== undefined) {
					return {
						contents: {
							kind: MarkupKind.PlainText,
							value: coreParam.desc
						},
						range: paramrange
					};
				}

				// Determine the normalized class name
				const normalizedcls = await normalizeClassname(doc, parsed, clsName, server, params.position.line);
				if (normalizedcls !== "") {
					const respdata = await makeRESTRequest("POST", 1, "/action/query", server, {
						query: "SELECT Description, Type FROM %Dictionary.CompiledParameter WHERE Name = ? AND (Parent = ? OR " +
							"Parent %INLIST (SELECT $LISTFROMSTRING(PropertyClass) FROM %Dictionary.CompiledClass WHERE Name = ?))",
						parameters: [param, normalizedcls, currentClass(doc, parsed)]
					});
					if (respdata !== undefined) {
						if (Array.isArray(respdata?.data?.result?.content) && respdata.data.result.content.length > 0) {
							// We got data back

							const header = `(**${normalizedcls}**) <u>**${param}**</u>${respdata.data.result.content[0].Type != "" ? ` As **${respdata.data.result.content[0].Type}**` : ""
								}`;
							return {
								contents: {
									kind: MarkupKind.Markdown,
									value: markupValue(header, documaticHtmlToMarkdown(respdata.data.result.content[0].Description))
								},
								range: paramrange
							};
						}
					}
				}
			}
			else if (
				parsed[params.position.line][i].l == ld.cls_langindex && (
					parsed[params.position.line][i].s == ld.cls_xmlelemname_attrindex ||
					parsed[params.position.line][i].s == ld.cls_xmlattrname_attrindex)
			) {
				// This is a Storage XML element or attribute name

				// Get the full text of the selection
				const elemrange = findFullRange(params.position.line, parsed, i, symbolstart, symbolend);
				const elem = doc.getText(elemrange);

				const storageObjKey = storageKeywordsKeyForToken(doc, parsed, params.position.line, i);
				if (storageObjKey != "") {
					// Get the list of all possible elements at this nesting level
					const keywords: KeywordDoc[] = storageKeywords[storageObjKey];
					if (keywords) {
						const keydoc = keywords.find((keyword) => keyword.name.toLowerCase() == elem.toLowerCase());
						if (keydoc !== undefined) {
							let hoverdocstr = keydoc.description;
							if (hoverdocstr === undefined) {
								hoverdocstr = "";
							}
							return {
								contents: {
									kind: MarkupKind.Markdown,
									value: Array.isArray(keydoc?.constraint) ?
										hoverdocstr != "" ?
											markupValue(keydoc.description, "Permitted values: " + keydoc.constraint.join(", ")) :
											"Permitted values: " + keydoc.constraint.join(", ")
										: keydoc.description
								},
								range: elemrange
							};
						}
					}
				}
			}
			else if (
				parsed[params.position.line][i].l == ld.cos_langindex && (
					parsed[params.position.line][i].s == ld.cos_param_attrindex ||
					parsed[params.position.line][i].s == ld.cos_localdec_attrindex ||
					parsed[params.position.line][i].s == ld.cos_localvar_attrindex ||
					parsed[params.position.line][i].s == ld.cos_otw_attrindex ||
					parsed[params.position.line][i].s == ld.cos_localundec_attrindex
				)
			) {
				// This is an ObjectScript variable

				const varClass = await determineVariableClass(doc, parsed, params.position.line, i, server);
				if (varClass) {
					const varRange = Range.create(params.position.line, symbolstart, params.position.line, symbolend);
					const varType = parsed[params.position.line][i].s == ld.cos_param_attrindex ? "parameter" :
						parsed[params.position.line][i].s == ld.cos_localvar_attrindex ? "public" : "private";
					// Get the description for this class from the server
					const querydata: QueryData = {
						query: "SELECT Description FROM %Dictionary.CompiledClass WHERE Name = ?",
						parameters: [varClass]
					};
					const respdata = await makeRESTRequest("POST", 1, "/action/query", server, querydata);
					if (Array.isArray(respdata?.data?.result?.content) && respdata.data.result.content.length == 1) {
						// The class was found
						return {
							contents: {
								kind: MarkupKind.Markdown,
								value: markupValue(
									`(${varType}) *${doc.getText(varRange)}* As **${varClass}**`,
									documaticHtmlToMarkdown(respdata.data.result.content[0].Description)
								)
							},
							range: varRange
						};
					}
				}
			}
			else if (
				parsed[params.position.line][i].l == ld.xml_langindex &&
				parsed[params.position.line][i].s == ld.xml_str_attrindex &&
				doc.languageId == "objectscript-class"
			) {
				// This is an XML string

				const thisClass = currentClass(doc, parsed);
				if (thisClass == "") return null; // Class definition is malformed
				// Determine if this is the value of a Call or
				// Forward attribute in a UrlMap XData block
				const attr = urlMapAttribute(doc, parsed, params.position.line, i);
				if (attr == "") return null;

				const strRange = Range.create(params.position.line, symbolstart, params.position.line, symbolend);
				const strText = doc.getText(strRange).slice(1, -1);
				if (attr == "Forward") {
					// This is a class name. Assume it's a full class name, with package.
					const respdata = await makeRESTRequest("POST", 1, "/action/query", server, {
						query: "SELECT Description FROM %Dictionary.CompiledClass WHERE Name = ?",
						parameters: [strText]
					});
					if (Array.isArray(respdata?.data?.result?.content) && respdata.data.result.content.length == 1) {
						// The class was found
						return {
							contents: {
								kind: MarkupKind.Markdown,
								value: markupValue(
									documaticLink(server, strText),
									documaticHtmlToMarkdown(respdata.data.result.content[0].Description)
								)
							},
							range: strRange
						};
					}
				} else {
					// This is a method name with an optional class name prepended
					let [cls, method] = strText.includes(":") ? strText.split(":") : ["", strText];
					if (cls == "") cls = thisClass;
					const respdata = await makeRESTRequest("POST", 1, "/action/query", server, {
						// Use the same query as above even though we don't
						// need Stub so we don't create another cached query
						query: "SELECT Description, FormalSpec, ReturnType, Stub FROM %Dictionary.CompiledMethod WHERE Parent = ? AND name = ?",
						parameters: [cls, method]
					});
					if (Array.isArray(respdata?.data?.result?.content) && respdata.data.result.content.length == 1) {
						let header = `(**${cls}**) <u>**${method}**</u>${beautifyFormalSpec(respdata.data.result.content[0].FormalSpec, true)}`;
						if (respdata.data.result.content[0].ReturnType != "") {
							let type: string = respdata.data.result.content[0].ReturnType;
							type = type.includes(" ") ? type.charAt(0).toUpperCase() + type.slice(1) : type;
							header += ` As **${type}**`;
						}
						return {
							contents: {
								kind: MarkupKind.Markdown,
								value: markupValue(header, documaticHtmlToMarkdown(respdata.data.result.content[0].Description))
							},
							range: strRange
						};
					}
				}
			}
			break;
		}
	}
}
