import {
	Range,
	Position,
	TextEdit,
	WorkspaceEdit,
	CodeActionKind,
	CodeActionParams,
	CodeAction,
	Command
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

import parameterTypes = require("../documentation/parameterTypes.json");

import * as ld from '../utils/languageDefinitions';
import { compressedline, QueryData, ServerSpec } from '../utils/types';
import { getServerSpec, findFullRange, makeRESTRequest, quoteUDLIdentifier, parseDimLine, getLanguageServerSettings, getParsedDocument, memberRegex, showInternalForServer } from '../utils/functions';
import { documents, connection, zutilFunctions } from '../utils/variables';

/**
 * Represents an item that can be selected from a list of items.
 */
type QuickPickItem = {
	description?: string,
	detail?: string,
	label: string
};

/**
 * The parameter literal for the `intersystems/refactor/addOverridableMembers` request.
 */
type AddOverridableMembersParams = {
	uri: string,
	members: QuickPickItem[],
	cursor: Position,
	memberType: string
};

/**
 * The parameter literal for the `intersystems/refactor/validateOverrideCursor` request.
 */
type ValidateOverrideCursorParams = {
	uri: string,
	line: number
};

/**
 * The parameter literal for the `intersystems/refactor/listOverridableMembers` request.
 */
type ListOverridableMembersParams = {
	uri: string,
	memberType: string
};

/**
 * The parameter literal for the `intersystems/refactor/listImportPackages` request.
 */
type ListImportPackagesParams = {
	uri: string,
	classmame: string
};

/**
 * The parameter literal for the `intersystems/refactor/listImportPackage` request.
 */
type AddImportPackageParams = {
	uri: string,
	packagename: string
};

/**
 * The parameter literal for the `intersystems/refactor/addMethod` request.
 */
type AddMethodParams = {
	uri: string,
	newmethodname: string,
	lnstart: number,
	lnend: number,
	lnmethod: number,
	newmethodtype: string
};

/**
 * Parse lines of ObjectScript code that contains Set and look to see if it contains selector.
 * 
 * @param doc The TextDocument that the line is in.
 * @param parsed The tokenized representation of doc.
 * @param line The line to parse.
 * @param token The starting token to parse.
 * @param selector The variable that we're looking for.
 */
function parseSet(doc: TextDocument, parsed: compressedline[], line: number, token: number,selector: string): boolean {
	var ispostconditional: boolean = false;
	var countparen: number = 0;
	for (let ln = line; ln < parsed.length; ln++) {
		if (parsed[ln].length === 0) { // Empty line
			continue;
		}
		for (let tkn = 0; tkn < parsed[ln].length;tkn++) { 
			if (ln === line && tkn < token) { // Skip all tokens before Set token
				continue ;
			}
			if (ln === line && tkn === token) { // This is the Set token
				const nexttkntext: string = doc.getText(Range.create(
					Position.create(ln, parsed[ln][tkn+1].p),
					Position.create(ln, parsed[ln][tkn+1].p+parsed[ln][tkn+1].c)
				));
				if (nexttkntext === ":") {
					// This is a postconditional
					ispostconditional = true;
				}
				continue;
			}

			if (!ispostconditional) {
				// This is the setting part of the Set command 
				if (
					parsed[ln][tkn].s === ld.cos_localvar_attrindex ||	// Public variable
					parsed[ln][tkn].s === ld.cos_param_attrindex 	||	// Parameter variable
					parsed[ln][tkn].s === ld.cos_localdec_attrindex ||	// Local declared
					parsed[ln][tkn].s === ld.cos_localundec_attrindex	// Local undeclared
				) { 
					// This is a variable that can be Set
					const thisvar = doc.getText(Range.create(
						Position.create(ln,parsed[ln][tkn].p),
						Position.create(ln,parsed[ln][tkn].p+parsed[ln][tkn].c)
					));
					if (thisvar === selector) {
						// This is the Set for the selector
						return true;
					}
				} else if (parsed[ln][tkn].s === ld.cos_command_attrindex) {
					// This is a command, we have reached the end of the Set command
					return false;
				}
			} else {
				// This is the conditional part of the Set command
				if (parsed[ln][tkn].s === ld.cos_delim_attrindex) {
					const delimtext: string = doc.getText(Range.create(
						Position.create(ln, parsed[ln][tkn].p),
						Position.create(ln, parsed[ln][tkn].p+parsed[ln][tkn].c)
					));
					if (delimtext === "(") {
						countparen++;
					} else if (delimtext === ")") {
						countparen--;
					}
				} else if (
					parsed[ln][tkn].s === ld.cos_localvar_attrindex ||	// Public variable
					parsed[ln][tkn].s === ld.cos_param_attrindex 	||	// Parameter variable
					parsed[ln][tkn].s === ld.cos_localdec_attrindex ||	// Local declared
					parsed[ln][tkn].s === ld.cos_localundec_attrindex	// Local undeclared
				) { 
					// This variable is in the condition
					const thisvar = doc.getText(Range.create(
						Position.create(ln,parsed[ln][tkn].p),
						Position.create(ln,parsed[ln][tkn].p+parsed[ln][tkn].c)
					));
					if (thisvar === selector) {
						// The selector is used in the condition first, it is not set
						return false;
					}
				}

				// First charater after the current token
				const btwtkntext: string = doc.getText(Range.create(
					Position.create(ln, parsed[ln][tkn].p+parsed[ln][tkn].c),
					Position.create(ln, parsed[ln][tkn].p+parsed[ln][tkn].c+1)
				));

				if (countparen === 0 && btwtkntext === " ") {
					ispostconditional = false;
				}
			}
		}
	}
	return false;
};

/**
 * Add an argument to the signature (method definition) and the method arguments (method call)
 * 
 * @param argName Argument name to add to the signature and method arguments
 * @param isByRef Determine whether the argument is a ByRef argument
 * @param argType Argument type to add to the signature and method arguments
 * @param signature Method signature
 * @param methodArguments Method arguments
 * @param comma Delimiter between arguments
 */
function prepareExtractMethodSignature(argName: string, isByRef: boolean, argType: string, signature: string, methodArguments: string, comma: string): string[] {
	if (signature !== "") {
		signature += comma;
		methodArguments += ", ";
	}
	if (isByRef) {
		signature += "ByRef ";
		methodArguments += ".";
	}
	signature += argName + argType;
	methodArguments += argName;

	return [signature,methodArguments];
}

/**
 * Handler function for the `intersystems/refactor/listOverridableMembers` request.
 */
export async function listOverridableMembers(params: ListOverridableMembersParams): Promise<QuickPickItem[]> {
	const doc = documents.get(params.uri);
	if (doc === undefined) {return [];}
	if (doc.languageId !== "objectscript-class") {
		// Can't override class members if the document isn't a class
		return [];
	}
	const parsed = await getParsedDocument(params.uri);
	if (parsed === undefined) {return [];}
	const server: ServerSpec = await getServerSpec(params.uri);
	const result: QuickPickItem[] = [];

	// Determine what class this is
	let thisclass = "";
	for (let ln = 0; ln < parsed.length; ln++) {
		if (!parsed[ln]?.length) continue;
		if (
			parsed[ln][0].l == ld.cls_langindex && parsed[ln][0].s == ld.cls_keyword_attrindex &&
			doc.getText(Range.create(ln,parsed[ln][0].p,ln,parsed[ln][0].p+parsed[ln][0].c)).toLowerCase() == "class"
		) {
			thisclass = doc.getText(findFullRange(ln,parsed,1,parsed[ln][1].p,parsed[ln][1].p+parsed[ln][1].c));
			break;
		}
	}

	if (thisclass !== "") {
		// We found the name of this class

		const showInternalStr = await showInternalForServer(server) ? "" : " AND Internal = 0";
		// Build the list of QuickPickItems
		if (params.memberType === "Method") {
			const querydata: QueryData = {
				query: `SELECT Name, Origin, ClassMethod, ReturnType FROM %Dictionary.CompiledMethod WHERE Parent = ? AND Stub IS NULL AND Origin != ? AND Final = 0 AND NotInheritable = 0${showInternalStr}`,
				parameters: [thisclass,thisclass]
			};
			const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
			if (respdata !== undefined && respdata.data.result.content.length > 0) {
				for (let memobj of respdata.data.result.content) {
					if (memobj.ClassMethod) {
						result.push({
							label: memobj.Name,
							description: memobj.ReturnType,
							detail: "ClassMethod, Origin class: "+memobj.Origin
						});
					}
					else {
						result.push({
							label: memobj.Name,
							description: memobj.ReturnType,
							detail: "Method, Origin class: "+memobj.Origin
						});
					}
				}
			}
		}
		else if (params.memberType === "Parameter") {
			const querydata: QueryData = {
				query: `SELECT Name, Origin, Type FROM %Dictionary.CompiledParameter WHERE Parent = ? AND Origin != ? AND Final = 0${showInternalStr}`,
				parameters: [thisclass,thisclass]
			};
			const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
			if (respdata !== undefined && respdata.data.result.content.length > 0) {
				for (let memobj of respdata.data.result.content) {
					result.push({
						label: memobj.Name,
						description: memobj.Type,
						detail: "Origin class: "+memobj.Origin
					});
				}
			}
		}
		else if (params.memberType === "Projection") {
			const querydata: QueryData = {
				query: `SELECT Name, Origin, Type FROM %Dictionary.CompiledProjection WHERE Parent = ? AND Origin != ?${showInternalStr}`,
				parameters: [thisclass,thisclass]
			};
			const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
			if (respdata !== undefined && respdata.data.result.content.length > 0) {
				for (let memobj of respdata.data.result.content) {
					result.push({
						label: memobj.Name,
						description: memobj.Type,
						detail: "Origin class: "+memobj.Origin
					});
				}
			}
		}
		else if (params.memberType === "Property") {
			const querydata: QueryData = {
				query: `SELECT Name, Origin, Type FROM %Dictionary.CompiledProperty WHERE Parent = ? AND Origin != ? AND Final = 0${showInternalStr}`,
				parameters: [thisclass,thisclass]
			};
			const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
			if (respdata !== undefined && respdata.data.result.content.length > 0) {
				for (let memobj of respdata.data.result.content) {
					result.push({
						label: memobj.Name,
						description: memobj.Type,
						detail: "Origin class: "+memobj.Origin
					});
				}
			}
		}
		else if (params.memberType === "Query") {
			const querydata: QueryData = {
				query: `SELECT Name, Origin, Type FROM %Dictionary.CompiledQuery WHERE Parent = ? AND Origin != ? AND Final = 0${showInternalStr}`,
				parameters: [thisclass,thisclass]
			};
			const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
			if (respdata !== undefined && respdata.data.result.content.length > 0) {
				for (let memobj of respdata.data.result.content) {
					result.push({
						label: memobj.Name,
						description: memobj.Type,
						detail: "Origin class: "+memobj.Origin
					});
				}
			}
		}
		else if (params.memberType === "Trigger") {
			const querydata: QueryData = {
				query: `SELECT Name, Origin, Event FROM %Dictionary.CompiledTrigger WHERE Parent = ? AND Origin != ? AND Final = 0${showInternalStr}`,
				parameters: [thisclass,thisclass]
			};
			const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
			if (respdata !== undefined && respdata.data.result.content.length > 0) {
				for (let memobj of respdata.data.result.content) {
					result.push({
						label: memobj.Name,
						description: memobj.Event,
						detail: "Origin class: "+memobj.Origin
					});
				}
			}
		}
		else if (params.memberType === "XData") {
			const querydata: QueryData = {
				query: `SELECT Name, Origin, MimeType FROM %Dictionary.CompiledXData WHERE Parent = ? AND Origin != ?${showInternalStr}`,
				parameters: [thisclass,thisclass]
			};
			const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
			if (respdata !== undefined && respdata.data.result.content.length > 0) {
				for (let memobj of respdata.data.result.content) {
					result.push({
						label: memobj.Name,
						description: memobj.MimeType,
						detail: "Origin class: "+memobj.Origin
					});
				}
			}
		}
	}

	return result;
}

/**
 * Handler function for the `intersystems/refactor/addOverridableMembers` request.
 */
export async function addOverridableMembers(params: AddOverridableMembersParams): Promise<WorkspaceEdit> {
	const doc = documents.get(params.uri);
	if (doc === undefined) {return {};}
	if (doc.languageId !== "objectscript-class") {
		// Can't override class members if the document isn't a class
		return {};
	}
	const parsed = await getParsedDocument(params.uri);
	if (parsed === undefined) {return {};}
	const server: ServerSpec = await getServerSpec(params.uri);

	// Insert the new members at the cursor position (offset by one line)
	var insertpos = params.cursor;
	insertpos.line++;
	var change: TextEdit = {
		range: Range.create(insertpos,insertpos),
		newText: ""
	};

	// Loop through the QuickPickItem array and map all origin classes to the members
	var membersPerOrigin: Map<string, string[]> = new Map();
	for (let member of params.members) {
		const origin = member.detail.split(" ")[member.detail.split(" ").length - 1] + ".cls";
		if (membersPerOrigin.has(origin)) {
			// Add this member to the array of members for this origin class
			var membersarr = membersPerOrigin.get(origin);
			if (membersarr !== undefined) {
				membersarr.push(quoteUDLIdentifier(member.label,1));
				membersPerOrigin.set(origin,membersarr);
			}
		}
		else {
			// Add this origin class to the map with this member in the members array
			membersPerOrigin.set(origin,[quoteUDLIdentifier(member.label,1)]);
		}
	}

	const memberKeywords = 
		params.memberType == "Method" ? "Method|ClassMethod|ClientMethod" :
		params.memberType == "Property" ? "Property|Relationship" :
		params.memberType;

	// Get the text of all origin classes that we need
	const respdata = await makeRESTRequest("POST",1,"/docs",server,[...membersPerOrigin.keys()]);
	if (respdata !== undefined && respdata.data.result.content.length > 0) {
		for (let cls of respdata.data.result.content) {

			// For each member in this class, add it to the 'newText' string
			const members = membersPerOrigin.get(cls.name);
			if (members !== undefined) {
				for (let member of members) {
					// Find this member in the document contents

					var desclinect = 0;
					const regex = memberRegex(memberKeywords,member);
					for (let ln = 0; ln < cls.content.length; ln++) {
						const firstword = cls.content[ln].split(" ",1)[0].toLowerCase();
						if (cls.content[ln].slice(0,3) === "///") {
							desclinect++;
						}
						else if (regex.test(cls.content[ln])) {
							// This is the right member
								
							// Add the description lines to the 'newtText' string if there are any
							if (desclinect > 0) {
								change.newText = change.newText + cls.content.slice(ln-desclinect,ln).join("\n") + "\n";
							}

							// Continue looping until you hit the end of the member or the start of its implementation
							for (let mln = ln; mln < cls.content.length; mln++) {
								var line = cls.content[mln];

								// Remove the Abstract keyword if it appears on this line
								line = line.replace(" [ Abstract ]","").replace("[ Abstract,","[");

								// Add this line to the 'newText' string
								change.newText = change.newText + line + "\n";

								if (
									(firstword.indexOf("property") !== -1) || (firstword.indexOf("relationship") !== -1) ||
									(firstword.indexOf("parameter") !== -1) || (firstword.indexOf("projection") !== -1)
								) {
									// Look for the end of the member
									if (cls.content[mln].trim().slice(-1) === ";") {
										break;
									}
								}
								else {
									// Look for the start of the member's implementation
									if (cls.content[mln].trim() === "{") {
										// Add a blank line and closing curly brace
										change.newText = change.newText + "\t\n";
										change.newText = change.newText + "}\n";

										break;
									}
								}
							}

							// Add a trailing newline
							change.newText = change.newText + "\n";
						}
						else {
							desclinect = 0;
						}
					}
				}
			}
		}
	}

	return {
		changes: {
			[params.uri]: [change]
		}
	};
}

/**
 * Handler function for the `intersystems/refactor/validateOverrideCursor` request.
 */
export async function validateOverrideCursor(params: ValidateOverrideCursorParams): Promise<boolean> {
	const doc = documents.get(params.uri);
	if (doc === undefined) {return false;}
	if (doc.languageId !== "objectscript-class") {
		// Can't override class members if the document isn't a class
		return false;
	}
	const parsed = await getParsedDocument(params.uri);
	if (parsed === undefined) {return false;}

	// Check that the first non-empty line above the cursor ends with a UDL token
	var abovevalid = false;
	for (let ln = params.line-1; ln >=0; ln--) {
		if (parsed[ln].length > 0) {
			if (parsed[ln][parsed[ln].length-1].l === ld.cls_langindex) {
				if (parsed[ln].length === 1 && doc.getText(Range.create(
					Position.create(ln,parsed[ln][0].p),
					Position.create(ln,parsed[ln][0].p+parsed[ln][0].c))) === "{"
				) {
					// This line only contains a UDL open curly brace, so check that the preceding line is the class definition
					if (parsed[ln-1][0].l === ld.cls_langindex && parsed[ln-1][0].s === ld.cls_keyword_attrindex && doc.getText(Range.create(
						Position.create(ln-1,parsed[ln-1][0].p),
						Position.create(ln-1,parsed[ln-1][0].p+parsed[ln-1][0].c))).toLowerCase() === "class"
					) {
						abovevalid = true;
					}
				}
				else {
					abovevalid = true;
				}
			}
			break;
		}
	}

	// Check that the first non-empty line below the cursor starts with a UDL token
	var belowvalid = false;
	if (abovevalid) {
		for (let ln = params.line+1; ln < parsed.length; ln++) {
			if (parsed[ln].length > 0) {
				if (parsed[ln][0].l === ld.cls_langindex) {
					belowvalid = true;
				}
				break;
			}
		}
	}

	return (abovevalid && belowvalid);
}

/**
 * Handler function for the `intersystems/refactor/listParameterTypes` request.
 */
export function listParameterTypes(): QuickPickItem[] {
	var result: QuickPickItem[] = [];
	// Fetch the list of parameter types
	for (let i = 0; i < parameterTypes.length; i++) { 
		result.push({
			label: parameterTypes[i].name,
			description: parameterTypes[i].documentation
		});
	}
	return result;
}

/**
 * Handler function for the `intersystems/refactor/listImportPackages` request.
 */
export async function listImportPackages(params: ListImportPackagesParams): Promise<QuickPickItem[]> {
	const server: ServerSpec = await getServerSpec(params.uri);
	var result: QuickPickItem[] = [];
	const classname: string = params.classmame;

	// Fetch the list of import packages
	const querydata: QueryData = {
		query: "SELECT $PIECE(Name,'.',1,$LENGTH(Name,'.')-2) AS Package FROM %Library.RoutineMgr_StudioOpenDialog(?,?,?,?,?,?,?) WHERE $PIECE(Name,'.',$LENGTH(Name,'.')-1) = ?",
		parameters: ["*.cls",1,1,1,1,0,0,classname]
	};
	const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
	if (respdata !== undefined && respdata.data.result.content.length > 0) {
		for (let packobj of respdata.data.result.content) {
			result.push({
				label: packobj.Package
			});
		}
	}
	return result;
}

/**
 * Handler function for the `intersystems/refactor/addImportPackage` request.
 */
export async function addImportPackage(params: AddImportPackageParams): Promise<WorkspaceEdit> {
	const doc = documents.get(params.uri);
	if (doc === undefined) {return {};}
	const parsed = await getParsedDocument(params.uri);
	if (parsed === undefined) {return {};}

	// Compute the TextEdits
	var edits: TextEdit[] = [];
	for (let ln = 0; ln < parsed.length; ln++) {
		if (parsed[ln].length === 0) {
			continue;
		}
		if (parsed[ln][0].l === ld.cls_langindex && parsed[ln][0].s === ld.cls_keyword_attrindex) { 
			const keyword: string = doc.getText(Range.create(
				Position.create(ln,parsed[ln][0].p),
				Position.create(ln,parsed[ln][0].p+parsed[ln][0].c)
			)).toLowerCase();
			if (keyword === "import") {
				if (
					parsed[ln][1].l === ld.cls_langindex && 
					parsed[ln][1].s === ld.cls_delim_attrindex && 
					doc.getText(Range.create(Position.create(ln,parsed[ln][1].p),Position.create(ln,parsed[ln][1].p+parsed[ln][1].c))) === "("
				) {
					// There are several imported packages already
					const lastparentkn = parsed[ln][parsed[ln].length-1];
					edits.push({
						range: Range.create(Position.create(ln,lastparentkn.p),Position.create(ln,lastparentkn.p)),
						newText: ", " + params.packagename
					});
				} else { 
					// There is only one imported package 
					const startcurrentpackagetkn = parsed[ln][1];
					const endcurrentpackagetkn = parsed[ln][parsed[ln].length-1];
					edits.push({
						range: Range.create(Position.create(ln,startcurrentpackagetkn.p),Position.create(ln,startcurrentpackagetkn.p)),
						newText: "("
					});
					edits.push({
						range: Range.create(
							Position.create(ln,endcurrentpackagetkn.p+endcurrentpackagetkn.c),
							Position.create(ln,endcurrentpackagetkn.p+endcurrentpackagetkn.c)
						),
						newText: ", " + params.packagename + ")"
					});
				}
				break;
			} else if (keyword === "class") {
				// There is no "Import" keyword
				edits.push({
					range: Range.create(Position.create(0,0),Position.create(0,0)),
					newText: "Import " + params.packagename + "\n\n"
				});
				break;
			}
		}
	}
	
	return {
		changes: {
			[params.uri]: edits
		}
	};
}

/**
 * Handler function for the `intersystems/refactor/addMethod` request.
 */
export async function addMethod(params: AddMethodParams): Promise<WorkspaceEdit | null> {
	const doc = documents.get(params.uri);
	if (doc === undefined) {return null;}
	const parsed = await getParsedDocument(params.uri);
	if (parsed === undefined) {return null;}
	const lnstart  = params.lnstart;	// First non-empty line of the selection
	const lnend = params.lnend;			// Last non-empty line of the selection

	// Compute the TextEdits
	var edits: TextEdit[] = [];

	// Adapt to VSCode Workspace settings 
	const vscodesettings = await connection.workspace.getConfiguration([
		{scopeUri:params.uri,section: "editor.tabSize"},
		{scopeUri:params.uri,section: "editor.insertSpaces"},
		{scopeUri:params.uri,section: "objectscript.multilineMethodArgs"}
	]);
	const tabSize = vscodesettings[0];
	const insertSpaces = vscodesettings[1];
	const multilinearg = vscodesettings[2];
	var tab: string = "\t";
	var comma: string = ", ";
	if (insertSpaces === true) {
		tab = " ".repeat(tabSize);
	}
	const server: ServerSpec = await getServerSpec(params.uri);
	if (multilinearg === true && server.apiVersion >= 4) {
		comma = ", \n"+tab;
	}
	var countarg: number = 0;
	
	// Find the location of the method insertion above the donor method
	var insertpos: Position = Position.create(0,0);
	for (let ln = params.lnmethod-1; ln > 0; ln--) {
		if (parsed[ln].length === 0) { // Empty line
			insertpos = Position.create(ln,0);
			break;
		} else if (parsed[ln][0].l === ld.cls_langindex && parsed[ln][0].s === ld.cls_desc_attrindex) {
			continue;
		} else {
			insertpos = Position.create(ln,parsed[ln][parsed[ln].length-1].p+parsed[ln][parsed[ln].length-1].c);
			break;
		}
	} 

	// Scan for ProcedureBlock method keyword and Record method arguments
	var countbrace: number = 0;
	var countparen: number = 0;
	var foundprocedureblock: boolean = false;
	var endprocedureblocksearch: boolean = false;
	var nexttkn: number = 0;
	var methodprocedureblock: boolean | undefined = undefined;
	var donorargs: [string,boolean,string][] = []; 				// List of arguments of the donor method
	var donorarg: [string,boolean,string] = ["", false, ""]; 	// Argument properties: Name, ByRef/Output, Type/Parameters) 
	var previoustknln = params.lnmethod;
	var previoustkn = 0;
	for (let ln = params.lnmethod; ln < lnstart; ln++) {
		if (parsed[ln].length === 0) { // Empty line
			continue;
		}
		for (let tkn = 0; tkn < parsed[ln].length; tkn++) {
			if (foundprocedureblock) {
				nexttkn++;
				if (nexttkn === 2 && parsed[ln][tkn].l === ld.cls_langindex && parsed[ln][tkn].s === ld.cls_num_attrindex) {
					// This is the value of the procedureblock (0 or 1)
					const procedureblockvalue = doc.getText(Range.create(
						Position.create(ln,parsed[ln][tkn].p),
						Position.create(ln,parsed[ln][tkn].p+parsed[ln][tkn].c))
					);
					if (procedureblockvalue === "0") {
						methodprocedureblock = false;	
					} else if (procedureblockvalue === "1") {
						methodprocedureblock = true;
					}
					endprocedureblocksearch = true;
					break;
				}
			}
			if (parsed[ln][tkn].l === ld.cls_langindex && parsed[ln][tkn].s === ld.cls_delim_attrindex) {
				const delimtext = doc.getText(Range.create(
					Position.create(ln,parsed[ln][tkn].p),
					Position.create(ln,parsed[ln][tkn].p+parsed[ln][tkn].c))
				); 
				if (delimtext === "(") {
					countparen++;
				} else if (delimtext === ")") {
					countparen--;
					if (donorarg[0] !== ""  && countparen === 0) {
						// This is the end of the last method argument 
						donorargs.push(donorarg);	// Record Name, ByRef/Output, and Type/Parameters of the argument 
						donorarg = ["", false, ""];	// Re-initialize the argument information array
					}
				} else if (delimtext === "{") {
					countbrace++;
					if (countbrace === 1 && countparen === 0) {
						// This is the brace opening the method block
						endprocedureblocksearch = true;
						break;
					}
				} else if (delimtext === "}") {
					countbrace--;
				} else if (donorarg[0] !== ""  && (delimtext === "," || delimtext === "=" ) && countparen === 1) { 
					// This is the end of the argument or the start of the default value (to skip)
					donorargs.push(donorarg);	// Record Name, ByRef/Output, and Type/Parameters of the argument 
					donorarg = ["", false, ""];	// Re-initialize the argument information array
				}
			} else if (parsed[ln][tkn].l === ld.cls_langindex && parsed[ln][tkn].s === ld.cls_keyword_attrindex) {
				const keywordtext: string = doc.getText(Range.create(
					Position.create(ln,parsed[ln][tkn].p),
					Position.create(ln,parsed[ln][tkn].p+parsed[ln][tkn].c)
				)).toLowerCase();
				if (keywordtext === "procedureblock") {
					foundprocedureblock = true;
				}
			}
			if (donorarg[0] === "" && parsed[ln][tkn].l === ld.cls_langindex && parsed[ln][tkn].s === ld.cls_param_attrindex) {
				// This is a cls parameter 

				// Record parameter variable name
				donorarg[0] = doc.getText(Range.create(
					Position.create(ln,parsed[ln][tkn].p),
					Position.create(ln,parsed[ln][tkn].p+parsed[ln][tkn].c)
				));

				// Check Prefix
				if (parsed[previoustknln][previoustkn].l === ld.cls_langindex && 
					parsed[previoustknln][previoustkn].s === ld.cls_keyword_attrindex
				) {
					// There is a "Output" or "ByRef" prefix -> add keyword "ByRef" to the signature and "." in argument (Ignore ByVal)
					const keywordtext: string = doc.getText(Range.create(
						Position.create(previoustknln,parsed[previoustknln][previoustkn].p),
						Position.create(previoustknln,parsed[previoustknln][previoustkn].p+parsed[previoustknln][previoustkn].c)
					)).toLowerCase();
					if (keywordtext === "output" || keywordtext === "byref") {
						donorarg[1] = true;
					}
				}
			} else if (donorarg[0] !== ""  && parsed[ln][tkn].l === ld.cls_langindex) {
				// This is the text after the cls parameter
				const tkntext: string = doc.getText(Range.create(
					Position.create(ln,parsed[ln][tkn].p),
					Position.create(ln,parsed[ln][tkn].p+parsed[ln][tkn].c))
				);
				if (tkntext.charAt(0) === "." || tkntext === ")" || countparen>1) {
					// This is a class type or parameter text (in parenthesis) - no space
					donorarg[2] += tkntext;
				} else {
					donorarg[2] += " " + tkntext;
				}
			}
			previoustkn = tkn;	
			previoustknln = ln;
		}
		if (endprocedureblocksearch) {
			break;
		}
	}

	var procedurekeyword: string = "";	// This is the ProcedureBlock keyword to add to methodkeywords
	var isprocedureblock: boolean = true;
	if (methodprocedureblock === undefined) { 
		// Scan for ProcedureBlock Class Keyword 
		for (let ln = 0; ln < params.lnmethod; ln++) {
			if (parsed[ln].length === 0) { // Empty line
				continue;
			}
			if (parsed[ln][0].l === ld.cls_langindex && parsed[ln][0].s === ld.cls_keyword_attrindex) {
				const keywordtext: string = doc.getText(Range.create(
					Position.create(ln,parsed[ln][0].p),
					Position.create(ln,parsed[ln][0].p+parsed[ln][0].c)
				)).toLowerCase();
				if (keywordtext === "class") {
					// This is the line of Class definition
					for (let tkn = 1; tkn < parsed[ln].length; tkn++) {
						if (parsed[ln][tkn].l === ld.cls_langindex && parsed[ln][tkn].s === ld.cls_keyword_attrindex) {
							const keywordtext: string = doc.getText(Range.create(
								Position.create(ln,parsed[ln][tkn].p),
								Position.create(ln,parsed[ln][tkn].p+parsed[ln][tkn].c)
							)).toLowerCase();
							if (keywordtext === "procedureblock") {
								const previoustkn=doc.getText(Range.create(
									Position.create(ln,parsed[ln][tkn-1].p),
									Position.create(ln,parsed[ln][tkn-1].p+parsed[ln][tkn-1].c)
								)).toLowerCase();
								if (previoustkn === "not") {
									isprocedureblock = false;
								}
							}
						}
					}
					break;
				}
			}
		}
	} else { 
		// The method has a ProcedureBlock Keyword
		if (methodprocedureblock) {
			procedurekeyword = "ProcedureBlock = 1";
		} else {
			isprocedureblock = false;
			procedurekeyword = "ProcedureBlock = 0";
		}
	}

	// Extract Method variables
	var signature: string = "";
	var methodarguments: string = "";
	var methodkeywords: string = "";

	// #Dim manipulation variables
	var dimadd: string[] = [];			// List of #Dim to add in the extracted method
	var todellinevar: number[] = [];	// #Dim lines where variables will need to be removed
	var todelvar: string[] = [];		// Variables to remove from the #Dim declaration
	
	if (isprocedureblock) {
		// The method is a procedure block 
		var publicvar: string[] = [];		// List of public variables 
		var parametervar: string[]  =[];	// List of cos parameters (arguments of the donor method)
		
		var dimvar: string[] = [];			// List of variables that can be declared by a #Dim: local declared variables and public variables
		var dimlocation: number[] = [];		// List of locations (line) of the #Dim in the code selection

		var undeclaredvar: string[] = [];			// List of undeclared variables
		var undeclaredlocation: number[][] = [];	// List of locations (line, token) of the undeclared variable in the code selection
		var setlocation: number[][] = [];			// List of locations (line, token) of the Set command in the code selection
		var undeclaredbyrefvar: string[] = [];		// List of undeclared variables ByRef or Output

		var declaredvar: string[] = [];				// List of declared variables
		var declaredlocation: number[][] = [];		// List of locations (line, token) of the declared variable in the code selection
		var declaredbyrefvar: string[] = [];		// List of declared variables ByRef or Output
		var setdim: string[] = [];					// List of declared variables that are Set by default by #Dim
		
		var initializeddeclaredvar: string[] = []	// List of declared variables initialize by a for loop
		var initializedundeclaredvar: string[] = []	// List of undeclared variables initialize by a for loop

		// Scan through the selection: look for variables, #Dim, and Set
		for (let ln = lnstart; ln <= lnend; ln++) {
			if (parsed[ln].length === 0) { // Empty line
				continue;
			}
			for (let tkn = 0; tkn < parsed[ln].length; tkn++) {
				if (parsed[ln][tkn].l === ld.cos_langindex && parsed[ln][tkn].s === ld.cos_localvar_attrindex) {
					// This is a public variable 
					const localvar: string = doc.getText(Range.create(
						Position.create(ln,parsed[ln][tkn].p),
						Position.create(ln,parsed[ln][tkn].p+parsed[ln][tkn].c)
					));
					if (!publicvar.includes(localvar) && localvar.charAt(0) !== "%") { 
						// Only add public variables that do not start with %
						publicvar.push(localvar);
					} 
					if (!dimvar.includes(localvar)) { 
						// Add all public variables to the list of variables that can be declared by #Dim
						dimvar.push(localvar);
					}
				} else if (parsed[ln][tkn].l === ld.cos_langindex && parsed[ln][tkn].s === ld.cos_param_attrindex) {
					// This is parameter variable 
					const param: string = doc.getText(Range.create(
						Position.create(ln,parsed[ln][tkn].p),
						Position.create(ln,parsed[ln][tkn].p+parsed[ln][tkn].c)
					));
					if(!parametervar.includes(param)){
						parametervar.push(param);
					} 
				} else if (parsed[ln][tkn].l===ld.cos_langindex && parsed[ln][tkn].s===ld.cos_localdec_attrindex){
					// This is local declared variable 
					const thisvar: string = doc.getText(Range.create(
						Position.create(ln,parsed[ln][tkn].p),
						Position.create(ln,parsed[ln][tkn].p+parsed[ln][tkn].c)
					));
					if (!dimvar.includes(thisvar)) { 
						// Add the local declared variables to the list of variables that can be declared by #Dim
						dimvar.push(thisvar);
					} 
					if (
						tkn>0 &&
						parsed[ln][tkn-1].s === ld.cos_oper_attrindex &&
						doc.getText(Range.create(
							Position.create(ln,parsed[ln][tkn-1].p),
							Position.create(ln,parsed[ln][tkn-1].p+parsed[ln][tkn-1].c)
						)) === "."
					) {
						// The declared variable is ByRef or Output of a method
						if (!declaredbyrefvar.includes(thisvar)) {
							declaredbyrefvar.push(thisvar);
						}
					}
					if (!declaredvar.includes(thisvar)) {  
						var skip: boolean = false;

						// Check if the first call of the variable is a #Dim, and check if the variable is set by #Dim's default value
						if (
							parsed[ln].length > 1 &&
							parsed[ln][0].l === ld.cos_langindex && parsed[ln][0].s === ld.cos_ppc_attrindex && 
							parsed[ln][1].l === ld.cos_langindex && parsed[ln][1].s === ld.cos_ppc_attrindex
						) {
							// This is 2 preprocessor command
							const thisdim: string = doc.getText(Range.create(
								Position.create(ln,parsed[ln][0].p),
								Position.create(ln,parsed[ln][1].p+parsed[ln][1].c)
							));
							if (thisdim.toLowerCase() === "#dim") {
								// The first call of the variable is a #Dim -> skip
								skip = true; 

								// Check whether declared variable is Set by #Dim's default value
								for (let k = parsed[ln].length-1; k >= 0; k--) {
									if (parsed[ln][k].s === ld.cos_command_attrindex) {
										// This is "As" command
										break;
									} else if (parsed[ln][k].s === ld.cos_oper_attrindex) {
										// This is "=" operator -> there is a default value
										setdim.push(thisvar);
										break;
									}
								}
							}		
						} 

						if (!skip) {
							// First call of the variable is not a #Dim
							declaredvar.push(thisvar);
							declaredlocation.push([ln,tkn]);

							// Check if the first call of the variable has been initialized by a For loop
							if (
								tkn > 0 && 
								parsed[ln][tkn-1].l === ld.cos_langindex &&
								parsed[ln][tkn-1].s === ld.cos_command_attrindex 
							) {
								const commandtext: string = doc.getText(Range.create(
									Position.create(ln, parsed[ln][tkn-1].p),
									Position.create(ln, parsed[ln][tkn-1].p+parsed[ln][tkn-1].c)
								)).toLowerCase();
								if (commandtext === "for" || commandtext === "f") {
									// This variable has been initialized by a For loop
									initializeddeclaredvar.push(thisvar);
								}
							}
						}

						
					} 
				} else if (parsed[ln][tkn].l === ld.cos_langindex && parsed[ln][tkn].s === ld.cos_localundec_attrindex) {
					// This is local undeclared variable 
					const thisvar: string = doc.getText(Range.create(
						Position.create(ln,parsed[ln][tkn].p),
						Position.create(ln,parsed[ln][tkn].p+parsed[ln][tkn].c)
					));
					if (!undeclaredvar.includes(thisvar)) { 
						undeclaredvar.push(thisvar);
						undeclaredlocation.push([ln,tkn]);

						// Check if the first call of the variable has been initialized by a For loop
						if (
							tkn > 0 && 
							parsed[ln][tkn-1].l === ld.cos_langindex &&
							parsed[ln][tkn-1].s === ld.cos_command_attrindex 
						) {
							const commandtext: string = doc.getText(Range.create(
								Position.create(ln, parsed[ln][tkn-1].p),
								Position.create(ln, parsed[ln][tkn-1].p+parsed[ln][tkn-1].c)
							)).toLowerCase();
							if (commandtext === "for" || commandtext === "f") {
								// This variable has been initialized by a For loop
								initializedundeclaredvar.push(thisvar);
							}
						}
					} 
					if (
						tkn>0 &&
						parsed[ln][tkn-1].s === ld.cos_oper_attrindex &&
						doc.getText(Range.create(
							Position.create(ln,parsed[ln][tkn-1].p),
							Position.create(ln,parsed[ln][tkn-1].p+parsed[ln][tkn-1].c)
						)) === "."
					) {
						// The undeclared variable is ByRef or Output of a method
						if (!undeclaredbyrefvar.includes(thisvar)) {
							undeclaredbyrefvar.push(thisvar);
						}
					}
				} else if (parsed[ln][tkn].l === ld.cos_langindex && parsed[ln][tkn].s === ld.cos_command_attrindex) {
					const thisvar: string = doc.getText(Range.create(
						Position.create(ln,parsed[ln][tkn].p),
						Position.create(ln,parsed[ln][tkn].p+parsed[ln][tkn].c)
					)).toLowerCase();
					if (thisvar === "set" || thisvar === "s") {
						// This is a set command
						setlocation.push([ln,tkn]); // save location
					} 
				}
			}

			// Save the line number if the line contains a #Dim
			if (
				parsed[ln].length > 1 &&
				parsed[ln][0].l === ld.cos_langindex && parsed[ln][0].s === ld.cos_ppc_attrindex && 
				parsed[ln][1].l === ld.cos_langindex && parsed[ln][1].s === ld.cos_ppc_attrindex
			) {
				// This is 2 preprocessor command
				const thisvar: string = doc.getText(Range.create(
					Position.create(ln,parsed[ln][0].p),
					Position.create(ln,parsed[ln][1].p+parsed[ln][1].c)
				));
				if (thisvar.toLowerCase() === "#dim") {
					dimlocation.push(ln);
				}		
			}
		}

		// Prepare method keywords : add public list and procedure keywords
		if (publicvar.length > 0) {
			var publiclist: string = "";
			publiclist = "PublicList = ";
			if (publicvar.length > 1) {
				publiclist += "(" + publicvar[0];
				for (let i = 1; i < publicvar.length; i++) {
					publiclist += ", " + publicvar[i];
				}
				publiclist += ")";
			} else {
				publiclist += publicvar[0];
			}
			if (procedurekeyword === "") {
				methodkeywords = "[ " + publiclist + " ]";
			} else {
				methodkeywords = "[ " + procedurekeyword + ", " + publiclist + " ]";
			}
		} else {
			if (procedurekeyword !== "") {
				methodkeywords = "[ " + procedurekeyword + " ]";
			}
		}
		
		// Add cos parameters to method signature and method arguments
		if (parametervar.length > 0 && donorargs.length > 0) { 
			for (let arg = 0; arg < donorargs.length; arg++) {
				if (parametervar.includes(donorargs[arg][0])) {
					[signature,methodarguments] = prepareExtractMethodSignature(donorargs[arg][0], donorargs[arg][1], donorargs[arg][2], signature, methodarguments, comma);
					countarg++;
				}
			}
		}

		// Update "undeclaredvar" array: delete the variables that are ByRef/Output of a method 
		undeclaredvar = undeclaredvar.filter(undeclared => !undeclaredbyrefvar.includes(undeclared));

		// Add the undeclared variable ByRef to the signature
		if (undeclaredbyrefvar.length > 0) { 
			for (let ivar = 0; ivar < undeclaredbyrefvar.length; ivar++) {
				[signature,methodarguments] = prepareExtractMethodSignature(undeclaredbyrefvar[ivar], true, "", signature, methodarguments, comma);
				countarg++;
			}
		}

		// Check if the undeclared variable has been initialized by a For loop in in the selection block
		if (undeclaredvar.length > 0 && initializedundeclaredvar.length > 0) { 
			// Update "undeclaredvar" array: delete the variables that already have been initialized by the For loop of the selection
			undeclaredvar = undeclaredvar.filter(undeclared => !initializedundeclaredvar.includes(undeclared));
		}
		// Check if the undeclared variable has been set in the selection block
		var foundsetundeclaredvar: string[] = [];	// List of undeclared variables that have been Set in the selection block 
													// (before the undeclared variable)
		if (undeclaredvar.length > 0 && setlocation.length > 0) { 		 
			for (let ivar = 0; ivar < undeclaredvar.length; ivar++) {
				const ln = undeclaredlocation[ivar][0];
				const tkn = undeclaredlocation[ivar][1];
				for (let iloc = 0; iloc < setlocation.length; iloc++) {
					if (
						setlocation[iloc][0] < ln ||								// Line of Set is above the undeclared variable
						(setlocation[iloc][0] == ln && setlocation[iloc][1] < tkn)	// Set and the undeclared variable are on the same line, but Set is before
					){ 
						// The Set is before the variable
						var foundset: boolean = parseSet(doc,parsed,setlocation[iloc][0],setlocation[iloc][1],undeclaredvar[ivar]);
						if (foundset) {
							// The undeclared variable is Set in the code selection
							foundsetundeclaredvar.push(undeclaredvar[ivar]);
							break;
						}
					}
				}
			}
			// Update "undeclaredvar" array: delete the variables that already have been Set before the variable and within the code selection
			undeclaredvar = undeclaredvar.filter(undeclared => !foundsetundeclaredvar.includes(undeclared));
		}

		// Add the undeclared variable (not Set in the selection) to the signature
		if (undeclaredvar.length > 0) { 
			for (let ivar = 0; ivar < undeclaredvar.length; ivar++) {
				[signature,methodarguments] = prepareExtractMethodSignature(undeclaredvar[ivar], false, "", signature, methodarguments, comma);
				countarg++;
			}
		}

		// Check if the declared variable has been initialized by a For loop in in the selection block
		if (declaredvar.length > 0 && initializeddeclaredvar.length > 0) { 
			// Update "declaredvar" array: delete the variables that already have been initialized by the For loop of the selection
			declaredvar = declaredvar.filter(declared => !initializeddeclaredvar.includes(declared));
		}
		// Check if the declared variable has been set by #Dim default value in in the selection block
		if (declaredvar.length > 0 && setdim.length > 0) { 
			// Update "declaredvar" array: delete the variables that already have been Set as a default value in the #Dim of the selection 
			declaredvar = declaredvar.filter(declared => !setdim.includes(declared));
		}
		// Check if the declared variable has been set by Set in in the selection block
		var foundsetdeclaredvar: string[] = [];	// List of declared variables that have been Set in the selection block 
												// (before the declared variable)
		if (declaredvar.length > 0 && setlocation.length > 0) { 		 
			for (let ivar = 0;ivar < declaredvar.length; ivar++) {
				const ln = declaredlocation[ivar][0];
				const tkn = declaredlocation[ivar][1];
				for (let iloc = 0; iloc < setlocation.length; iloc++) {
					if(
						setlocation[iloc][0] < ln ||								// Line of Set is above the ueclared variable
						(setlocation[iloc][0] == ln && setlocation[iloc][1] < tkn)	// Set and the declared variable are on the same line, but Set is before
					) { 
						// The Set is before the variable
						const foundset: boolean = parseSet(doc,parsed,setlocation[iloc][0],setlocation[iloc][1],declaredvar[ivar]);
						if (foundset) {
							// The declared variable is Set in the code selection
							foundsetdeclaredvar.push(declaredvar[ivar]);
							break;
						}
					}
				}
			}
			// Update "declaredvar" array: delete the variables that already have been set before the variable and within code selection
			declaredvar = declaredvar.filter(declared => !foundsetdeclaredvar.includes(declared));
		}
		
		// Check if the public variable or the local declared variable (dimvar) is declared (dimlocation) in the selection block
		var founddimvar: string[] = []; // List of variables that have been declared (#Dim) in the selection block
		if (dimvar.length > 0 && dimlocation.length > 0) {
			for (let idimvar = 0; idimvar < dimvar.length; idimvar++) {
				for (var ln of dimlocation) {
					const dimresult = parseDimLine(doc,parsed,ln,dimvar[idimvar]);
					if (dimresult.founddim) { 
						// The variable has been declared by a #Dim in the selection block
						founddimvar.push(dimvar[idimvar]);
						if (declaredvar.includes(dimvar[idimvar]) || declaredbyrefvar.includes(dimvar[idimvar])) { 
							// This is a variable that is not Set or a variable that is ByRef/Output
							
							// Add variable and type to the signature
							var isByRef: boolean = false;
							if (declaredbyrefvar.includes(dimvar[idimvar])) {
								isByRef = true;
							}
							[signature,methodarguments] = prepareExtractMethodSignature(dimvar[idimvar], isByRef, " As " + dimresult.class, signature, methodarguments, comma);
							countarg++;

							// Record the variables to be removed from the #Dim declarations
							todelvar.push(dimvar[idimvar]); // Variable to remove from the #dim declaration
							todellinevar.push(ln); // Line of the #Dim
						}
						break;
					}
				}
			}
			// Update "dimvar" array: delete the variables that already have been declared in the code selection
			dimvar = dimvar.filter(dim => !founddimvar.includes(dim));
		}

		// Scan for #Dim above selection block 
		for (let ln = lnstart-1; ln > params.lnmethod; ln--) { 
			if (parsed[ln].length === 0) {// Empty line
				continue;
			}
			if (dimvar.length > 0) {
				var todel: string[] = []; // List of variables that have been declared at line ln
				if (
					parsed[ln].length > 1 && 
					parsed[ln][0].l === ld.cos_langindex && parsed[ln][0].s === ld.cos_ppc_attrindex && 
					parsed[ln][1].l === ld.cos_langindex && parsed[ln][1].s === ld.cos_ppc_attrindex
				) {
					// This is 2 preprocessor command
					const thisvar: string = doc.getText(Range.create(
						Position.create(ln,parsed[ln][0].p),
						Position.create(ln,parsed[ln][1].p+parsed[ln][1].c)
					));
					if (thisvar.toLowerCase() === "#dim") { // This is a #Dim declaration
						var dimaddtext: string = ""; 
						var dimtype: string = "";
						// Check whether the variables have been declared by this #Dim
						for (let idimvar = 0; idimvar < dimvar.length; idimvar++) {
							const dimresult = parseDimLine(doc,parsed,ln,dimvar[idimvar]);
							if (dimresult.founddim) { // The variable has been declared by a #Dim. 
								dimtype = dimresult.class;
								todel.push(dimvar[idimvar]); 
								if (declaredvar.includes(dimvar[idimvar]) || declaredbyrefvar.includes(dimvar[idimvar])) {
									// This is a variable that is not Set or a variable that is ByRef/Output

									// Add variable and type to the signature
									var isByRef: boolean = false;
									if (declaredbyrefvar.includes(dimvar[idimvar])) {
										isByRef = true;
									}
									[signature,methodarguments] = prepareExtractMethodSignature(dimvar[idimvar], isByRef, " As " + dimtype, signature, methodarguments, comma);
									countarg++;
								} else {
									// There is a #Dim above the selection and 
									// the public variable or the declared variable has been set in the selection
									if (dimaddtext === "") {
										dimaddtext += "#Dim " + dimvar[idimvar];
									}else{
										dimaddtext += ", " + dimvar[idimvar];
									}
								}
							}
						}
						if (dimaddtext !== "") {
							dimaddtext += " As " + dimtype;
							dimadd.push(dimaddtext);
						}
					}		
				}
				// Update "dimvar" array: delete the variables that already have been declared above code selection, at line ln
				dimvar = dimvar.filter(dim => !todel.includes(dim));
			} else {
				// All the #Dim have been found
				break;
			}
		}

		// Update Signature Format
		if (multilinearg === true && server.apiVersion >= 4 && countarg > 1 ) {
			signature = "\n" + tab + signature;
		}

	} else {
		// The method is a not procedure block 
		if (procedurekeyword !== "") {
			methodkeywords = "[ " + procedurekeyword + " ]";
		}
	}
	
	// Adapt to InterSystems Language Server Settings
	const settings = await getLanguageServerSettings(params.uri);
	var docommandtext: string = "Do";
	if (settings.formatting.commands.length === "short") {
		docommandtext = "D";
	}
	if (settings.formatting.commands.case === "lower") {
		docommandtext = docommandtext.toLowerCase();
	} else if (settings.formatting.commands.case === "upper") {
		docommandtext = docommandtext.toUpperCase();
	}
	
	edits.push({ // Open the method
		range: Range.create(insertpos,insertpos),
		newText: "\n/// \n" + params.newmethodtype + " " + params.newmethodname + "(" + signature + ") " + methodkeywords + "\n{\n"
	});

	// Add #Dim variable declaration for local declared variables and public variables
	if (dimadd.length > 0) {
		for (let dimln = dimadd.length-1; dimln >= 0; dimln--) {
			edits.push({ 
				range: Range.create(insertpos,insertpos),
				newText: tab + dimadd[dimln] + "\n"
			});
		}
		edits.push({ 
			range: Range.create(insertpos,insertpos),
			newText: "\n"
		});
	}

	var foundfirstindent: boolean = false;
	var firstwhitespace: string = ""; 
	for (let ln = lnstart; ln <= lnend; ln++) { // Add the selection block in the method
		if (parsed[ln].length === 0) {
			edits.push({ 
				range: Range.create(insertpos,insertpos),
				newText: "\n"
			});
		} else { 
			var whitespace = doc.getText(Range.create(
				Position.create(ln,0),
				Position.create(ln,parsed[ln][0].p)
			)).replace(/\t/g, " ".repeat(tabSize));
			if (!foundfirstindent) {
				if (!(parsed[ln][0].l === ld.cos_langindex && parsed[ln][0].s === ld.cos_label_attrindex)) {
					// This is the first non-label line, record the indent
					foundfirstindent = true;
					firstwhitespace = whitespace;
				}
			}
			var gapspace = " ".repeat(Math.max(whitespace.length - firstwhitespace.length,0));
			if (!insertSpaces) {
				gapspace = gapspace.replace("/ {" + tabSize + "}/g", "\t");
			}
			if (!(parsed[ln][0].l === ld.cos_langindex && parsed[ln][0].s === ld.cos_label_attrindex)) {
				// This is a non-label line - add tab to the indent
				gapspace = tab + gapspace;
			}
			if (todellinevar.includes(ln)) {
				// This a #Dim line with a declared variable that is already declared in the signature
				var dimtext = "";
				var dimtype = "";				
				for (let tkn = 2; tkn < parsed[ln].length; tkn++) {
					if (parsed[ln][tkn].s === ld.cos_localdec_attrindex || parsed[ln][tkn].s === ld.cos_localvar_attrindex) {
						// This is a declared variable or a public variable
						const thisvar: string = doc.getText(Range.create(
							Position.create(ln,parsed[ln][tkn].p),
							Position.create(ln,parsed[ln][tkn].p+parsed[ln][tkn].c)
						));
						if (todelvar.includes(thisvar)) {
							// This is a declared variable that has been declard in the signature, it needs to be removed
							if (
								doc.getText(Range.create(
									Position.create(ln,parsed[ln][3].p),
									Position.create(ln,parsed[ln][3].p+parsed[ln][3].c)
								)).toLowerCase() === "as"
							) {
								// Only the variable that needs to be removed is declared in the #Dim line -> delete the entire line
								dimtext = "";
								break;
							}
						} else {
							if (dimtext !== "") {
								dimtext += ", ";
							}
							dimtext += thisvar;
						}
					} else if (parsed[ln][tkn].s === ld.cos_command_attrindex) {
						// This is the "As" keyword
						// Add the type and default values
						dimtype =" As " + doc.getText(Range.create(
							Position.create(ln,parsed[ln][tkn+1].p),
							Position.create(ln,parsed[ln][parsed[ln].length-1].p+parsed[ln][parsed[ln].length-1].c)
						));
						break;
					}
				}
				if (dimtext !== "") {
					// Replace the #Dim line with the correct #Dim line
					dimtext = "#Dim " + dimtext + dimtype;
					edits.push({ 
						range: Range.create(insertpos,insertpos),
						newText: gapspace + dimtext + "\n"
					});
				}
			} else {
				edits.push({ 
					range: Range.create(insertpos,insertpos),
					newText: gapspace + doc.getText(Range.create(
						Position.create(ln,parsed[ln][0].p),
						Position.create(ln,parsed[ln][parsed[ln].length-1].p+parsed[ln][parsed[ln].length-1].c)
					)) + "\n"
				});
			}
		}
	}
	edits.push({ // Close method
		range: Range.create(insertpos,insertpos),
		newText: "}\n"
	});
	if (firstwhitespace === "") {
		firstwhitespace = tab;
	} 
	edits.push({ // Replace code selection with do.. command
		range: Range.create(
			Position.create(lnstart,0),
			Position.create(lnend,parsed[lnend][parsed[lnend].length-1].p+parsed[lnend][parsed[lnend].length-1].c)),
		newText: firstwhitespace + docommandtext + " .." + params.newmethodname + "(" + methodarguments + ")"
	});
	return {
		changes: {
			[params.uri]: edits
		}
	};
}

/**
 * Handler function for the `textDocument/codeAction` request.
 */
export async function onCodeAction(params: CodeActionParams): Promise<CodeAction[] | null> {
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {return null;}
	const parsed = await getParsedDocument(params.textDocument.uri);
	if (parsed === undefined) {return null;}
	const settings = await getLanguageServerSettings(doc.uri);

	const result: CodeAction[] = [];
	if (!Array.isArray(params.context.only) || params.context.only.includes(CodeActionKind.Refactor)) {
		result.push({
			title: 'Wrap in Try/Catch',
			kind: CodeActionKind.Refactor
		})
		result.push({
			title: 'Extract to method',
			kind: CodeActionKind.Refactor,
		})

		if (doc.languageId === "objectscript-macros") {
			// Can't wrap macro definitions in try/catch, so return disabled CodeAction
			result[0].disabled = {
				reason: "Can't wrap macro definitions in a Try/Catch block"
			};
			result[1].disabled = {
				reason: "Can't extract macro definitions into a new method"
			};
			return result;
		}

		// Validate the selection range
		var checkedstart: boolean = false;
		var startiscos: boolean = false;
		var endiscos: boolean = false;
		var foundcls: boolean = false;

		var firstbraceisopen: boolean = true;
		var countopenbraces: number = 0;

		var lnstart: number = 0	// First non-empty line
		var lnend: number = 0	// Last non-empty line

		for (let ln = params.range.start.line; ln <= params.range.end.line; ln++) {	// Loop through each line of the selection
			try {
				if (parsed[ln].length === 0) {	// Empty line
					continue;
				}
			} catch {
				// Return disabled CodeAction
				result[0].disabled = {
					reason: "Cannot select empty last line of document"
				};
				result[1].disabled = result[0].disabled;
				return result;
			}
			lnend = ln;
			if (lnstart === 0) {
				lnstart = ln;
			}
			if (!checkedstart && parsed[ln][0].l == ld.cos_langindex) { // Check that first token of the selection is objectscript
				startiscos = true;
				checkedstart = true;
			}
			else if (!checkedstart && parsed[ln][0].l !== ld.cos_langindex) {
				break;
			}
			for (let tkn = 0; tkn < parsed[ln].length; tkn++) { // Loop through each token on the line
				if (parsed[ln][tkn].l == ld.cls_langindex) { // Break if token is cls
					foundcls = true;
					break;
				}
				if (tkn === parsed[ln].length - 1) { // Check that last token of the selection is objectscript
					if (parsed[ln][tkn].l == ld.cos_langindex) { 
						endiscos = true;
					} else {
						endiscos = false;
					}
				}

				// Check if token is a brace
				if ( parsed[ln][tkn].s === ld.cos_brace_attrindex && parsed[ln][tkn].l === ld.cos_langindex) {
					const bracetext = doc.getText(Range.create(
						Position.create(ln,parsed[ln][tkn].p),
						Position.create(ln,parsed[ln][tkn].p+parsed[ln][tkn].c)
					)); 
					if (bracetext === "{") { // Count number of open and close brackets
						countopenbraces++;				
					} else {
						if (countopenbraces === 0) { 
							firstbraceisopen = false; // The first brace is an closing brace "}" -> break
							break;
						}
						countopenbraces--;
					}
				}
			}
			if (foundcls || !firstbraceisopen) {
				break;
			}
		}
		if (foundcls) {
			// Selection range contains UDL code, so return disabled CodeAction
			result[0].disabled = {
				reason: "Code block can't contain class definition code"
			};
			result[1].disabled = result[0].disabled;
			return result;
		}
		if (firstbraceisopen === false) {
			// The first brace is a close brace "}", return disabled CodeAction
			result[0].disabled = {
				reason: "Must select full code block -- First brace not open"
			};
			result[1].disabled = result[0].disabled;
			return result;
		}
		if (!startiscos || !endiscos) {
			// Selection range begins or ends with a non-COS token, so return disabled CodeAction
			result[0].disabled = {
				reason: "Must select full ObjectScript code block"
			};
			result[1].disabled = result[0].disabled;
			return result;
		}
		if (countopenbraces !== 0) {
			// The braces are not paired, return disabled CodeAction
			result[0].disabled = {
				reason: "Must select full code block -- Brace mismatch"
			};
			result[1].disabled = result[0].disabled;
			return result;
		}

		if (doc.languageId === "objectscript-class") {
			// Find type of donor method
			var newmethodtype: string = "";
			var lnmethod : number = -1;
			for (let ln = params.range.start.line-1; ln >= 0; ln--) { 
				if (parsed[ln].length === 0) { // Empty line
					continue;
				}
				if (parsed[ln][0].l === ld.cls_langindex && parsed[ln][0].s === ld.cls_keyword_attrindex) {
					const keyword = doc.getText(Range.create(
						Position.create(ln,parsed[ln][0].p),
						Position.create(ln,parsed[ln][0].p+parsed[ln][0].c)
					)).toLowerCase();
					if (
						keyword === "classmethod" || keyword === "method" || keyword === "query" || 
						keyword === "trigger" || keyword === "clientmethod"
					) { 
						if (keyword === "method") {
							newmethodtype = "Method";
							lnmethod = ln;
						} else if (keyword === "classmethod" || keyword === "clientmethod") {
							newmethodtype = "ClassMethod";
							lnmethod = ln;
						}
						break;
					}
				}
			}
			if (newmethodtype === "") {
				result[1].disabled = {
					reason: "Selection must be in a method definition"
				};
			} else {
				result[1].command = Command.create("Extract Method","intersystems.language-server.extractMethod",params.textDocument.uri,lnstart,lnend,lnmethod,newmethodtype);
			}
		} else {
			result[1].disabled = {
				reason: "Selection must be in an ObjectScript class"
			};
		}
		result[0].data = [doc.uri,lnstart,lnend];
	}
	if (!Array.isArray(params.context.only) || params.context.only.includes(CodeActionKind.QuickFix)) {
		for (const diagnostic of params.context.diagnostics) {
			if (
				diagnostic.message === "Invalid parameter type" || 
				diagnostic.message === "Parameter value and type do not match"
			) {
				result.push({
					title: 'Remove incorrect type',
					kind: CodeActionKind.QuickFix,
					diagnostics: [diagnostic]
				});
				result[result.length-1].data = [doc.uri,params.range];

				const ln = params.range.start.line;
				const range: Range = Range.create(
					Position.create(ln,parsed[ln][3].p),
					Position.create(ln,parsed[ln][3].p+parsed[ln][3].c)
				);
				result.push({
					title: 'Select correct type',
					kind: CodeActionKind.QuickFix,
					command: Command.create("Select Parameter Type","intersystems.language-server.selectParameterType",params.textDocument.uri,range),
					diagnostics: [diagnostic]
				});
			} else if (diagnostic.message === "Class '" + diagnostic.message.split('\'')[1] + "' does not exist.") {
				const classname = diagnostic.message.split('\'')[1];
				result.push({
					title: 'Select package to import',
					kind: CodeActionKind.QuickFix,
					command: Command.create("Select Import Package","intersystems.language-server.selectImportPackage",params.textDocument.uri,classname),
					diagnostics: [diagnostic] 
				});
				if (classname.includes('.')) {
					result[result.length-1].disabled = {
						reason: "The class name from the Diagnostic contains a dot"
					};
				}
			} else if (diagnostic.message == "Function has been superseded" && typeof diagnostic.data == "string") {
				// This is a replaceable $ZUTIL function diagnostic
				const classMethod = zutilFunctions.replace[diagnostic.data];
				if (classMethod != undefined) {
					// Convert the string into a ##class or $SYSTEM.Class call
					let newText: string;
					if (classMethod.startsWith("%SYSTEM.")) {
						newText = "$";
						newText += settings.formatting.system.case == "upper" ? "SYSTEM" : settings.formatting.system.case == "lower" ? "system" : "System";
						newText += `${classMethod.slice(7,classMethod.indexOf("_"))}.${classMethod.slice(classMethod.indexOf("_") + 1)}(`;
					} else {
						newText = `##class(${classMethod.slice(0,classMethod.indexOf("_"))}).${classMethod.slice(classMethod.indexOf("_") + 1)}(`;
					}
					if (diagnostic.data.endsWith(")")) {
						newText += ")";
					}
					result.push({
						title: "Replace with ClassMethod",
						kind: CodeActionKind.QuickFix,
						edit: {
							changes: {
								[params.textDocument.uri]: [{
									range: diagnostic.range,
									newText
								}]
							}
						},
						isPreferred: true,
						diagnostics: [diagnostic] 
					});
				}
			} else if (diagnostic.message == "ROUTINE header is required") {
				const rtnType = doc.languageId == "objectscript-int" ? "Type=INT" : doc.languageId == "objectscript-macros" ? "Type=INC" : "";
				const rtnName = doc.uri.slice(doc.uri.lastIndexOf("/") + 1).split(".").slice(0,-1).join(".");
				const rtnGenerated = doc.languageId == "objectscript-int" && /\.G?\d$/.test(rtnName) ? ",Generated" : "";
				result.push({
					title: "Add header",
					kind: CodeActionKind.QuickFix,
					edit: {
						changes: {
							[params.textDocument.uri]: [{
								range: diagnostic.range,
								newText: `ROUTINE ${rtnName}${rtnType != "" ? ` [${rtnType}${rtnGenerated}]` : ""}\n`
							}]
						}
					},
					command: {
						command: "intersystems.language-server.setSelection",
						arguments: [0, 8, 0, 8 + rtnName.length],
						title: "Set selection"
					},
					isPreferred: true,
					diagnostics: [diagnostic] 
				});
			}
		}
	}

	if (result.length > 0) {
		return result;
	} else {
		return null;
	}
}

/**
 * Handler function for the `codeAction/resolve` request.
 */
export async function onCodeActionResolve(codeAction: CodeAction): Promise<CodeAction> {
		
	// Compute the TextEdits
	var edits: TextEdit[] = [];

	if (codeAction.title === 'Wrap in Try/Catch') {
		const data: [string,number,number] = <[string,number,number]> codeAction.data; 
		const doc = documents.get(data[0]);
		if (doc === undefined) {return codeAction;}
		const parsed = await getParsedDocument(data[0]);
		if (parsed === undefined) {return codeAction;}

		const lnstart = data[1];	// First non-empty line of the selection
		const lnend = data[2];		// Last non-empty line of the selection

		// Adapt to VSCode Workspace settings (tabsize/insertspaces)
		const vscodesettings = await connection.workspace.getConfiguration([
			{scopeUri:data[0],section:"editor.tabSize"},
			{scopeUri:data[0],section:"editor.insertSpaces"}
		]);
		const tabSize = vscodesettings[0];
		const insertSpaces = vscodesettings[1];
		var tab: string = "\t";
		if (insertSpaces === true) {
			tab = " ".repeat(tabSize);
		}

		// Adapt to InterSystems Language Server Settings
		const settings = await getLanguageServerSettings(data[0]);
		var trycommandtext: string = "Try";
		var catchcommandtext: string = "Catch";
		if (settings.formatting.commands.case === "lower") {
			trycommandtext = trycommandtext.toLowerCase();
			catchcommandtext = catchcommandtext.toLowerCase();
		} else if (settings.formatting.commands.case === "upper"){
			trycommandtext = trycommandtext.toUpperCase();
			catchcommandtext = catchcommandtext.toUpperCase();
		}

		// Prepare Indentation
		var whitespace = doc.getText(Range.create(Position.create(lnstart,0),Position.create(lnstart,parsed[lnstart][0].p)));
		var addtab: string = tab;
		if (parsed[lnstart][0].l === ld.cos_langindex && parsed[lnstart][0].s === ld.cos_label_attrindex) {
			// The first line is a label, record indent of the first non-label line
			for (let ln = lnstart; ln <= lnend; ln++) {
				if (parsed[ln].length === 0) {
					continue;
				}
				if (!(parsed[lnstart][0].l === ld.cos_langindex && parsed[lnstart][0].s === ld.cos_label_attrindex)) {
					// This is a not a label
					whitespace = doc.getText(Range.create(Position.create(ln,0),Position.create(ln,parsed[ln][0].p)));
					break;
				}
			}
		}
		if (whitespace === "") {
			// The first non-label line is not indented. Shift whitespace and tab by 1 tab
			whitespace += tab;
			addtab += tab;
		}
		
		edits.push({ // Open try block
			range: Range.create(lnstart,0,lnstart,0),
			newText: whitespace  + trycommandtext + " {\n" 
		});
		for (let ln = lnstart; ln <= lnend; ln++) { // Indent the selection block
			if (parsed[ln].length === 0) {
				continue;
			}
			if (!(parsed[ln][0].l === ld.cos_langindex && parsed[ln][0].s === ld.cos_label_attrindex)) {
				// This is not a line with a label
				edits.push({
					range: Range.create(ln,parsed[ln][0].p,ln,parsed[ln][0].p),
					newText: addtab 
				});
			}
		}
		const insertposend = Position.create(lnend,parsed[lnend][parsed[lnend].length-1].p+parsed[lnend][parsed[lnend].length-1].c);
		edits.push({ // Close Try block and add Catch block
			range: Range.create(insertposend,insertposend), 
			newText: "\n" + whitespace + "} " + catchcommandtext + " " + settings.refactor.exceptionVariable + " {\n" + whitespace + "" + tab + "\n" + whitespace + "} "
		});	
		codeAction.edit = {
			changes: {
				[data[0]]: edits
			}
		};
	} else if (codeAction.title === 'Remove incorrect type') {
		const data: [string,Range] = <[string,Range]> codeAction.data;
		const parsed = await getParsedDocument(data[0]);
		if (parsed === undefined) {return codeAction;}

		const ln = data[1].start.line
		const range = Range.create(Position.create(ln,parsed[ln][1].p+parsed[ln][1].c),Position.create(ln,parsed[ln][3].p+parsed[ln][3].c));

		edits.push({ // Remove "As InvalidType"
			range: range, 
			newText: ""
		});
		codeAction.edit = {
			changes: {
				[data[0]]: edits
			}
		};
	}
	return codeAction;
}
