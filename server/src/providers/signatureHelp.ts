import { Position, SignatureHelp, SignatureHelpParams, SignatureHelpTriggerKind, SignatureInformation, Range } from 'vscode-languageserver/node';
import { getServerSpec, getLanguageServerSettings, emphasizeArgument, makeRESTRequest, getMacroContext, findFullRange, getClassMemberContext, beautifyFormalSpec, documaticHtmlToMarkdown, findOpenParen } from '../utils/functions';
import { ServerSpec, SignatureHelpDocCache, SignatureHelpMacroContext } from '../utils/types';
import { parsedDocuments, documents } from '../utils/variables';
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

/** Determine the active parameter number */
function determineActiveParam(text: string): number {
	let activeparam = 0;
	let openparencount = 0;
	let instring = false;
	let incomment = false;
	for (let i = 0; i < text.length; i++) {
		const char = text.charAt(i);
		if (char === "(") {
			openparencount++;
		}
		else if (char === ")") {
			openparencount--;
		}
		else if (char === '"') {
			instring = !instring;
		}
		else if (char === "/" && (i < text.length - 1) && text.charAt(i + 1) == "*" && !incomment) {
			incomment = true;
		}
		else if (char === "*" && (i < text.length - 1) && text.charAt(i + 1) == "/" && incomment) {
			incomment = false;
		}
		else if (char === "," && openparencount === 0 && !instring && !incomment) {
			// Only increment parameter number if comma isn't inside nested parentheses, a string literal or a multiline-style comment
			activeparam++;
		}
	}
	return activeparam;
}

export async function onSignatureHelp(params: SignatureHelpParams): Promise<SignatureHelp | null> {
	const parsed = parsedDocuments.get(params.textDocument.uri);
	if (parsed === undefined) {return null;}
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {return null;}
	if (params.context === undefined) {return null;}
	const server: ServerSpec = await getServerSpec(params.textDocument.uri);
	const settings = await getLanguageServerSettings();

	if (params.context.triggerKind == SignatureHelpTriggerKind.Invoked) {
		params.context.triggerCharacter = doc.getText(Range.create(Position.create(params.position.line,params.position.character-1),params.position));
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
							kind: "markdown",
							value: exprespdata.data.result.content.expansion.join("\n")
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
		params.context.triggerCharacter === "(" && triggerlang === ld.cos_langindex &&
		triggerattr !== ld.cos_comment_attrindex && triggerattr !== ld.cos_dcom_attrindex &&
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
				query: "SELECT FormalSpec, ReturnType, Description, Stub FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND Name = ?",
				parameters: [membercontext.baseclass,member]
			};
			const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
			if (respdata !== undefined && "content" in respdata.data.result && respdata.data.result.content.length > 0) {
				// We got data back

				var memobj = respdata.data.result.content[0];
				if (respdata.data.result.content[0].Stub !== "") {
					// This is a method generated by member inheritance, so we need to get its metadata from the proper subtable

					const stubarr = respdata.data.result.content[0].Stub.split(".");
					var stubquery = "";
					if (stubarr[2] === "i") {
						// This is a method generated from an index
						stubquery = "SELECT Description, FormalSpec, ReturnType FROM %Dictionary.CompiledIndexMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
					}
					if (stubarr[2] === "q") {
						// This is a method generated from a query
						stubquery = "SELECT Description, FormalSpec, ReturnType FROM %Dictionary.CompiledQueryMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
					}
					if (stubarr[2] === "a") {
						// This is a method generated from a property
						stubquery = "SELECT Description, FormalSpec, ReturnType FROM %Dictionary.CompiledPropertyMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
					}
					if (stubarr[2] === "n") {
						// This is a method generated from a constraint
						stubquery = "SELECT Description, FormalSpec, ReturnType FROM %Dictionary.CompiledConstraintMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
					}
					if (stubquery !== "") {
						const stubrespdata = await makeRESTRequest("POST",1,"/action/query",server,{
							query: stubquery,
							parameters: [stubarr[1],membercontext.baseclass,stubarr[0]]
						});
						if (stubrespdata !== undefined && "content" in stubrespdata.data.result && stubrespdata.data.result.content.length > 0) {
							// We got data back
							memobj = stubrespdata.data.result.content[0];
						}
					}
				}

				if (memobj.FormalSpec !== "") {
					var sig: SignatureInformation = {
						label: beautifyFormalSpec(memobj.FormalSpec),
						parameters: []
					};
					if (settings.signaturehelp.documentation) {
						signatureHelpDocumentationCache = {
							type: "method",
							doc: {
								kind: "markdown",
								value: documaticHtmlToMarkdown(memobj.Description)
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
					newsignature = {
						signatures: [sig],
						activeSignature: 0,
						activeParameter: 0
					};
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
		params.context.triggerCharacter === "," && triggerlang === ld.cos_langindex &&
		triggerattr !== ld.cos_comment_attrindex && triggerattr !== ld.cos_dcom_attrindex
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
					query: "SELECT FormalSpec, ReturnType, Description, Stub FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND Name = ?",
					parameters: [membercontext.baseclass,member]
				};
				const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
				if (respdata !== undefined && "content" in respdata.data.result && respdata.data.result.content.length > 0) {
					// We got data back

					var memobj = respdata.data.result.content[0];
					if (respdata.data.result.content[0].Stub !== "") {
						// This is a method generated by member inheritance, so we need to get its metadata from the proper subtable

						const stubarr = respdata.data.result.content[0].Stub.split(".");
						var stubquery = "";
						if (stubarr[2] === "i") {
							// This is a method generated from an index
							stubquery = "SELECT Description, FormalSpec, ReturnType FROM %Dictionary.CompiledIndexMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
						}
						if (stubarr[2] === "q") {
							// This is a method generated from a query
							stubquery = "SELECT Description, FormalSpec, ReturnType FROM %Dictionary.CompiledQueryMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
						}
						if (stubarr[2] === "a") {
							// This is a method generated from a property
							stubquery = "SELECT Description, FormalSpec, ReturnType FROM %Dictionary.CompiledPropertyMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
						}
						if (stubarr[2] === "n") {
							// This is a method generated from a constraint
							stubquery = "SELECT Description, FormalSpec, ReturnType FROM %Dictionary.CompiledConstraintMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
						}
						if (stubquery !== "") {
							const stubrespdata = await makeRESTRequest("POST",1,"/action/query",server,{
								query: stubquery,
								parameters: [stubarr[1],membercontext.baseclass,stubarr[0]]
							});
							if (stubrespdata !== undefined && "content" in stubrespdata.data.result && stubrespdata.data.result.content.length > 0) {
								// We got data back
								memobj = stubrespdata.data.result.content[0];
							}
						}
					}

					if (memobj.FormalSpec !== "") {
						var sig: SignatureInformation = {
							label: beautifyFormalSpec(memobj.FormalSpec),
							parameters: []
						};
						if (settings.signaturehelp.documentation) {
							signatureHelpDocumentationCache = {
								type: "method",
								doc: {
									kind: "markdown",
									value: documaticHtmlToMarkdown(memobj.Description)
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
						var activeparam = determineActiveParam(doc.getText(Range.create(Position.create(sigstartln,parsed[sigstartln][sigstarttkn].p+1),params.position)));

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
	}
	return null;
}
