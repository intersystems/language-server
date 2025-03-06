import { Position, SignatureHelp, SignatureHelpParams, SignatureHelpTriggerKind, SignatureInformation, Range, MarkupKind, ParameterInformation } from 'vscode-languageserver/node';
import { getServerSpec, getLanguageServerSettings, makeRESTRequest, getMacroContext, findFullRange, getClassMemberContext, beautifyFormalSpec, documaticHtmlToMarkdown, findOpenParen, getParsedDocument, quoteUDLIdentifier, determineActiveParam } from '../utils/functions';
import { ServerSpec, SignatureHelpDocCache, SignatureHelpMacroContext } from '../utils/types';
import { documents } from '../utils/variables';
import * as ld from '../utils/languageDefinitions';

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

/** Placeholder for the Markdown emphasis characters before an argument. */
const emphasizePrefix: string = "%%%%%";

/** Placeholder for the Markdown emphasis characters after an argument. */
const emphasizeSuffix: string = "@@@@@";

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
		return arglist.replace(/\s+/g,"");
	}

	var start: number = -1; // inclusive
	var end: number = -1; // exclusive
	var spacesfound: number = 0;
	var lastspace: number = 0;
	if (arg === numargs) {
		// The last argument always ends at the second-to-last position
		end = arglist.length - 1;
		if (numargs > 1) start = arglist.lastIndexOf(" ") + 1;
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
		return (arglist.slice(0,start) + emphasizePrefix + arglist.slice(start,end) + emphasizeSuffix + arglist.slice(end)).replace(/\s+/g,"");
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
				result = arglist.slice(0,start) + emphasizePrefix + arglist.slice(start,end) + emphasizeSuffix + arglist.slice(end);
				break;
			}
			lastspace = thisspace;
		}
		return result.replace(/\s+/g,"");
	}
};

/** Use HTML to display `exp` as a code block with the empasized argument rendered bold, italic and underlined. */
function markdownifyExpansion(exp: string[]): string {
	return "<pre>\n" + exp.map(e => e.trimEnd()).join("\n")
		.replace(new RegExp(emphasizePrefix,"g"),"<b><i><u>")
		.replace(new RegExp(emphasizeSuffix,"g"),"</u></i></b>") + "\n</pre>";
}

/** Returns the [start,end] tuples for all parameters in `formalSpec` */
function formalSpecToParamsArr(formalSpec: string): ParameterInformation[] {
	const result: ParameterInformation[] = [];
	if (formalSpec.replace(/\s+/g,"") == "()") return result; // No parameters
	let currentParamStart = 1, openParenCount = 0, openBraceCount = 0, inQuote = false;
	Array.from(formalSpec).forEach((char: string, idx: number) => {
		switch (char) {
			case "{":
				if (!inQuote) openBraceCount++;
				break;
			case "}":
				if (!inQuote) openBraceCount--;
				break;
			case "(":
				if (!inQuote) openParenCount++;
				break;
			case ")":
				if (!inQuote) openParenCount--;
				break;
			case "\"":
				inQuote = !inQuote;
				break;
			case ",":
				if (!inQuote && !openBraceCount && openParenCount == 1) {
					result.push(ParameterInformation.create([currentParamStart,idx]));
					currentParamStart = idx + 1;
				}
		}
	});
	result.push(ParameterInformation.create([currentParamStart,formalSpec.length - 1]));
	return result;
}

export async function onSignatureHelp(params: SignatureHelpParams): Promise<SignatureHelp | null> {
	if (params.context === undefined) {return null;}
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {return null;}
	const parsed = await getParsedDocument(params.textDocument.uri);
	if (parsed === undefined) {return null;}
	const server: ServerSpec = await getServerSpec(params.textDocument.uri);
	const settings = await getLanguageServerSettings(params.textDocument.uri);

	if (params.context.triggerKind == SignatureHelpTriggerKind.Invoked) {
		// We always base our return value on the triggerCharacter
		params.context.triggerCharacter = doc.getText(Range.create(Position.create(params.position.line,params.position.character-1),params.position));
	}

	let thistoken: number = -1;
	for (let i = 0; i < parsed[params.position.line].length; i++) {
		const symbolstart: number = parsed[params.position.line][i].p;
		const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
		thistoken = i;
		if (params.position.character >= symbolstart && params.position.character <= symbolend) {
			// We found the right symbol in the line
			break;
		}
	}
	if (thistoken == -1) return null;
	const triggerlang: number = parsed[params.position.line][thistoken].l;
	const triggerattr: number = parsed[params.position.line][thistoken].s;
	if (
		// Only compute signature help in ObjectScript
		(triggerlang != ld.cos_langindex) ||
		// Don't compute signature help inside of a string literal
		((doc.getText(Range.create(Position.create(params.position.line,0),params.position)).split("\"").length - 1) % 2 == 1)
	) {
		if (params.context.activeSignatureHelp) {
			params.context.activeSignatureHelp.signatures[0].documentation = signatureHelpDocumentationCache.doc;
			return params.context.activeSignatureHelp;
		} else {
			return null;
		}
	}

	if (params.context.isRetrigger && (params.context.triggerCharacter !== "(")) {
		if (params.context.activeSignatureHelp !== undefined && signatureHelpStartPosition !== undefined) {
			const prevchar = doc.getText(Range.create(Position.create(params.position.line,params.position.character-1),params.position));
			if (prevchar === ")") {
				// The user closed the signature
				signatureHelpDocumentationCache = undefined;
				signatureHelpStartPosition = undefined;
				return null;
			}

			// Determine the active parameter
			params.context.activeSignatureHelp.activeParameter = determineActiveParam(doc.getText(Range.create(signatureHelpStartPosition,params.position)));

			if (signatureHelpDocumentationCache !== undefined) {
				if (signatureHelpDocumentationCache.type === "macro" && params.context.activeSignatureHelp.activeParameter !== null) {
					// This is a macro with active parameter

					// Get the macro expansion with the next parameter emphasized
					var expinputdata = {...signatureHelpMacroCache};
					expinputdata.arguments = emphasizeArgument(expinputdata.arguments,params.context.activeSignatureHelp.activeParameter+1);
					const exprespdata = await makeRESTRequest("POST",2,"/action/getmacroexpansion",server,expinputdata)
					if (exprespdata !== undefined && exprespdata.data.result.content.expansion.length > 0) {
						signatureHelpDocumentationCache.doc = {
							kind: MarkupKind.Markdown,
							value: markdownifyExpansion(exprespdata.data.result.content.expansion)
						};
						params.context.activeSignatureHelp.signatures[0].documentation = signatureHelpDocumentationCache.doc;
					}
				}
				else {
					// This is a method or a macro without an active parameter
					params.context.activeSignatureHelp.signatures[0].documentation = signatureHelpDocumentationCache.doc;
				}
			}
			return params.context.activeSignatureHelp;
		}
		else {
			// Can't do anything with a retrigger that lacks an active signature
			return null;
		}
	}

	if (
		params.context.triggerCharacter == "(" && triggerlang === ld.cos_langindex &&
		![ld.cos_comment_attrindex,ld.cos_dcom_attrindex,ld.cos_str_attrindex].includes(triggerattr) &&
		thistoken > 0
	) {
		// This is potentially the start of a signature

		var newsignature: SignatureHelp | null = null;
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
				const sigtext = respdata.data.result.content.signature.replace(/\s+/g,"").replace(/,/g,", ");
				const sig: SignatureInformation = {
					label: sigtext,
					parameters: formalSpecToParamsArr(sigtext)
				};

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
							kind: MarkupKind.Markdown,
							value: markdownifyExpansion(exprespdata.data.result.content.expansion)
						}
					};
					sig.documentation = signatureHelpDocumentationCache.doc;
				}
				signatureHelpStartPosition = params.position;
				newsignature = {
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
				params.position.line,parsed[params.position.line][thistoken-1].p,
				params.position.line,parsed[params.position.line][thistoken-1].p+parsed[params.position.line][thistoken-1].c
			));
			const unquotedname = quoteUDLIdentifier(member,0);

			// Get the base class that this member is in
			const membercontext = await getClassMemberContext(doc,parsed,thistoken-2,params.position.line,server);
			if (membercontext.baseclass === "") {
				// If we couldn't determine the class, don't return anything
				return null;
			}

			// Get the method signature
			const querydata = member == "%New" ? {
				// Get the information for both %New and %OnNew
				query: "SELECT FormalSpec, ReturnType, Description, Stub, Origin FROM %Dictionary.CompiledMethod WHERE Parent = ? AND (Name = ? OR Name = ?)",
				parameters: [membercontext.baseclass,unquotedname,"%OnNew"]
			} : {
				query: "SELECT FormalSpec, ReturnType, Description, Stub FROM %Dictionary.CompiledMethod WHERE Parent = ? AND Name = ?",
				parameters: [membercontext.baseclass,unquotedname]
			};
			const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
			if (Array.isArray(respdata?.data?.result?.content) && respdata.data.result.content.length > 0) {
				// We got data back

				if (member == "%New") {
					if (respdata.data.result.content.length == 2 && respdata.data.result.content[1].Origin != "%Library.RegisteredObject") {
						// %OnNew has been overridden for this class
						const sig: SignatureInformation = {
							label: beautifyFormalSpec(respdata.data.result.content[1].FormalSpec),
							parameters: []
						};
						if (settings.signaturehelp.documentation) {
							signatureHelpDocumentationCache = {
								type: "method",
								doc: {
									kind: MarkupKind.Markdown,
									value: documaticHtmlToMarkdown(respdata.data.result.content[
										respdata.data.result.content[1].Description.trim().length ? 1 : 0
									].Description)
								}
							};
							sig.documentation = signatureHelpDocumentationCache.doc;
						}
						
						sig.parameters = formalSpecToParamsArr(sig.label);
						sig.label += ` As ${membercontext.baseclass}`;
						signatureHelpStartPosition = params.position;
						newsignature = {
							signatures: [sig],
							activeSignature: 0,
							activeParameter: 0
						};
					} else {
						// If there's no %OnNew, then %New shouldn't have arguments
					}
				} else {
					let memobj = respdata.data.result.content[0];
					if (respdata.data.result.content[0].Stub !== "") {
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
							const stubrespdata = await makeRESTRequest("POST",1,"/action/query",server,{
								query: stubquery,
								parameters: [stubarr[1],membercontext.baseclass,stubarr[0]]
							});
							if (Array.isArray(stubrespdata?.data?.result?.content) && stubrespdata.data.result.content.length > 0) {
								// We got data back
								memobj = stubrespdata.data.result.content[0];
							}
						}
					}

					if (memobj.FormalSpec !== "") {
						const sig: SignatureInformation = {
							label: beautifyFormalSpec(memobj.FormalSpec),
							parameters: []
						};
						if (settings.signaturehelp.documentation) {
							signatureHelpDocumentationCache = {
								type: "method",
								doc: {
									kind: MarkupKind.Markdown,
									value: documaticHtmlToMarkdown(memobj.Description)
								}
							};
							sig.documentation = signatureHelpDocumentationCache.doc;
						}
						
						sig.parameters = formalSpecToParamsArr(sig.label);
						if (["%Open","%OpenId"].includes(member)) {
							sig.label += ` As ${membercontext.baseclass}`;
						} else if (memobj.ReturnType != "") {
							sig.label += ` As ${memobj.ReturnType}`;
						}
						signatureHelpStartPosition = params.position;
						newsignature = {
							signatures: [sig],
							activeSignature: 0,
							activeParameter: 0
						};
					}
				}
			}
		}
		if (newsignature !== null) {
			return newsignature;
		}
		else if (newsignature === null && params.context.activeSignatureHelp !== undefined) {
			if (signatureHelpDocumentationCache !== undefined) {
				params.context.activeSignatureHelp.signatures[0].documentation = signatureHelpDocumentationCache.doc;
			}
			return params.context.activeSignatureHelp;
		}
	}
	else if (
		!params.context.isRetrigger &&
		params.context.triggerCharacter == "," && triggerlang === ld.cos_langindex &&
		![ld.cos_comment_attrindex,ld.cos_dcom_attrindex,ld.cos_str_attrindex].includes(triggerattr)
	) {
		// This is potentially the argument list for a signature

		// Loop backwards in the file and look for the first open parenthesis that isn't closed
		const [sigstartln, sigstarttkn] = findOpenParen(doc,parsed,params.position.line,thistoken);

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
					const sigtext = respdata.data.result.content.signature.replace(/\s+/g,"").replace(/,/g,", ");
					const sig: SignatureInformation = {
						label: sigtext,
						parameters: formalSpecToParamsArr(sigtext)
					};

					// Determine the active parameter
					var activeparam = determineActiveParam(doc.getText(Range.create(Position.create(sigstartln,parsed[sigstartln][sigstarttkn].p+1),params.position)));

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
								kind: MarkupKind.Markdown,
								value: markdownifyExpansion(exprespdata.data.result.content.expansion)
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
					sigstartln,parsed[sigstartln][sigstarttkn-1].p,
					sigstartln,parsed[sigstartln][sigstarttkn-1].p+parsed[sigstartln][sigstarttkn-1].c
				));
				const unquotedname = quoteUDLIdentifier(member,0);

				// Get the base class that this member is in
				const membercontext = await getClassMemberContext(doc,parsed,sigstarttkn-2,sigstartln,server);
				if (membercontext.baseclass === "") {
					// If we couldn't determine the class, don't return anything
					return null;
				}

				// Get the method signature
				const querydata = member == "%New" ? {
					// Get the information for both %New and %OnNew
					query: "SELECT FormalSpec, ReturnType, Description, Stub, Origin FROM %Dictionary.CompiledMethod WHERE Parent = ? AND (Name = ? OR Name = ?)",
					parameters: [membercontext.baseclass,unquotedname,"%OnNew"]
				} : {
					query: "SELECT FormalSpec, ReturnType, Description, Stub FROM %Dictionary.CompiledMethod WHERE Parent = ? AND Name = ?",
					parameters: [membercontext.baseclass,unquotedname]
				};
				const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
				if (Array.isArray(respdata?.data?.result?.content) && respdata.data.result.content.length > 0) {
					// We got data back

					if (member == "%New") {
						if (respdata.data.result.content.length == 2 && respdata.data.result.content[1].Origin != "%Library.RegisteredObject") {
							// %OnNew has been overridden for this class
							const sig: SignatureInformation = {
								label: beautifyFormalSpec(respdata.data.result.content[1].FormalSpec),
								parameters: []
							};
							if (settings.signaturehelp.documentation) {
								signatureHelpDocumentationCache = {
									type: "method",
									doc: {
										kind: MarkupKind.Markdown,
										value: documaticHtmlToMarkdown(respdata.data.result.content[
											respdata.data.result.content[1].Description.trim().length ? 1 : 0
										].Description)
									}
								};
								sig.documentation = signatureHelpDocumentationCache.doc;
							}
							
							sig.parameters = formalSpecToParamsArr(sig.label);
							sig.label += ` As ${membercontext.baseclass}`;
							signatureHelpStartPosition = Position.create(sigstartln,parsed[sigstartln][sigstarttkn].p+1);
							newsignature = {
								signatures: [sig],
								activeSignature: 0,
								activeParameter: determineActiveParam(doc.getText(Range.create(Position.create(sigstartln,parsed[sigstartln][sigstarttkn].p+1),params.position)))
							};
						} else {
							// If there's no %OnNew, then %New shouldn't have arguments
						}
					} else {
						let memobj = respdata.data.result.content[0];
						if (respdata.data.result.content[0].Stub !== "") {
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
								const stubrespdata = await makeRESTRequest("POST",1,"/action/query",server,{
									query: stubquery,
									parameters: [stubarr[1],membercontext.baseclass,stubarr[0]]
								});
								if (Array.isArray(stubrespdata?.data?.result?.content) && stubrespdata.data.result.content.length > 0) {
									// We got data back
									memobj = stubrespdata.data.result.content[0];
								}
							}
						}

						if (memobj.FormalSpec !== "") {
							const sig: SignatureInformation = {
								label: beautifyFormalSpec(memobj.FormalSpec),
								parameters: []
							};
							if (settings.signaturehelp.documentation) {
								signatureHelpDocumentationCache = {
									type: "method",
									doc: {
										kind: MarkupKind.Markdown,
										value: documaticHtmlToMarkdown(memobj.Description)
									}
								};
								sig.documentation = signatureHelpDocumentationCache.doc;
							}
							
							sig.parameters = formalSpecToParamsArr(sig.label);
							if (["%Open","%OpenId"].includes(member)) {
								sig.label += ` As ${membercontext.baseclass}`;
							} else if (memobj.ReturnType != "") {
								sig.label += ` As ${memobj.ReturnType}`;
							}

							signatureHelpStartPosition = Position.create(sigstartln,parsed[sigstartln][sigstarttkn].p+1);
							return {
								signatures: [sig],
								activeSignature: 0,
								activeParameter: determineActiveParam(doc.getText(Range.create(Position.create(sigstartln,parsed[sigstartln][sigstarttkn].p+1),params.position)))
							};
						}
					}
				}
			}
		}
	}
	return null;
}
