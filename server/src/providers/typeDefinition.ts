import { TextDocumentPositionParams, Position, Range } from 'vscode-languageserver';
import { getServerSpec, findFullRange, quoteUDLIdentifier, makeRESTRequest, createDefinitionUri, getGetDocFormatParam, determineDeclaredLocalVarClass, determineParameterClass, getClassMemberContext } from '../utils/functions';
import { ServerSpec, QueryData } from '../utils/types';
import { documents, parsedDocuments } from '../utils/variables';
import * as ld from '../utils/languageDefinitions';

export async function onTypeDefinition(params: TextDocumentPositionParams) {
	const parsed = parsedDocuments.get(params.textDocument.uri);
	if (parsed === undefined) {return null;}
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {return null;}
	const server: ServerSpec = await getServerSpec(params.textDocument.uri);
	const getDocParams = await getGetDocFormatParam(params.textDocument.uri,server.apiVersion);

	if (parsed[params.position.line] === undefined) {
		// This is the blank last line of the file
		return null;
	}
	for (let i = 0; i < parsed[params.position.line].length; i++) {
		const symbolstart: number = parsed[params.position.line][i].p;
		const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
		if (params.position.character >= symbolstart && params.position.character <= symbolend) {
			// We found the right symbol in the line

			let targetcls = "";
			let originrange = Range.create(params.position.line,symbolstart,params.position.line,symbolend);
			if (parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_param_attrindex) {
				// This token is a parameter

				// Determine the class of the parameter
				const paramcon = await determineParameterClass(doc,parsed,params.position.line,i,server);
				if (paramcon !== undefined) {
					// The parameter has a class
					targetcls = paramcon.baseclass;
				}
			}
			else if (
				parsed[params.position.line][i].l == ld.cos_langindex &&
				(parsed[params.position.line][i].s == ld.cos_localdec_attrindex || parsed[params.position.line][i].s == ld.cos_localvar_attrindex)
			) {
				// This token is a declared local variable or public variable

				// Determine the class of the declared local variable
				const localdeccon = await determineDeclaredLocalVarClass(doc,parsed,params.position.line,i,server);
				if (localdeccon !== undefined) {
					// The declared local variable has a class
					targetcls = localdeccon.baseclass;
				}
			}
			else if (
				parsed[params.position.line][i].l == ld.cos_langindex && (
					parsed[params.position.line][i].s == ld.cos_method_attrindex ||
					parsed[params.position.line][i].s == ld.cos_attr_attrindex ||
					parsed[params.position.line][i].s == ld.cos_mem_attrindex 
				)
			) {
				// This token is a method or property

				// Get the full text of the member
				originrange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
				let member = quoteUDLIdentifier(doc.getText(originrange),0);

				// Find the dot token
				let dottkn = 0;
				for (let tkn = 0; tkn < parsed[params.position.line].length; tkn ++) {
					if (parsed[params.position.line][tkn].p >= originrange.start.character) {
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

				let data: QueryData = {
					query: "",
					parameters: []
				};
				if (parsed[params.position.line][i].s == ld.cos_method_attrindex) {
					// This is a method
					data.query = "SELECT ReturnType AS Type, Stub FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND name = ?";
					data.parameters = [membercontext.baseclass,member];
				}
				else if (parsed[params.position.line][i].s == ld.cos_attr_attrindex) {
					// This is a property
					data.query = "SELECT RuntimeType AS Type, NULL AS Stub FROM %Dictionary.CompiledProperty WHERE parent->ID = ? AND name = ?";
					data.parameters = [membercontext.baseclass,member];
				}
				else {
					// This is a generic member
					if (membercontext.baseclass.substr(0,7) === "%SYSTEM") {
						// This is always a method
						data.query = "SELECT ReturnType AS Type, Stub FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND name = ?";
						data.parameters = [membercontext.baseclass,member];
					}
					else {
						// This can be a method or property
						data.query = "SELECT ReturnType AS Type, Stub FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND name = ? UNION ALL ";
						data.query = data.query.concat("SELECT RuntimeType AS Type, NULL AS Stub FROM %Dictionary.CompiledProperty WHERE parent->ID = ? AND name = ?");
						data.parameters = [membercontext.baseclass,member,membercontext.baseclass,member];
					}
				}
				const respdata = await makeRESTRequest("POST",1,"/action/query",server,data);
				if (respdata !== undefined && "content" in respdata.data.result && respdata.data.result.content.length > 0) {
					// We got data back

					let memobj = respdata.data.result.content[0];
					if (respdata.data.result.content[0].Stub !== "") {
						// This is a method generated by member inheritance, so we need to get its type from the proper subtable

						const stubarr = respdata.data.result.content[0].Stub.split(".");
						let stubquery = "";
						if (stubarr[2] === "i") {
							// This is a method generated from an index
							stubquery = "SELECT ReturnType AS Type FROM %Dictionary.CompiledIndexMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
						}
						if (stubarr[2] === "q") {
							// This is a method generated from a query
							stubquery = "SELECT ReturnType AS Type FROM %Dictionary.CompiledQueryMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
						}
						if (stubarr[2] === "a") {
							// This is a method generated from a property
							stubquery = "SELECT ReturnType AS Type FROM %Dictionary.CompiledPropertyMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
						}
						if (stubarr[2] === "n") {
							// This is a method generated from a constraint
							stubquery = "SELECT ReturnType AS Type FROM %Dictionary.CompiledConstraintMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
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

					if (memobj.Type !== "") {
						targetcls = memobj.Type;
					}
				}
			}

			if (targetcls !== "") {
				// Get the full text of the target class
				const respdata = await makeRESTRequest("GET",1,"/doc/".concat(targetcls,".cls"),server,undefined,undefined,getDocParams);
				if (respdata !== undefined && respdata.data.result.status === "") {
					// The class was found

					// Loop through the file contents to find the class definition
					var targetrange = Range.create(Position.create(0,0),Position.create(0,0));
					var targetselrange = Range.create(Position.create(0,0),Position.create(0,0));
					for (let j = 0; j < respdata.data.result.content.length; j++) {
						if (respdata.data.result.content[j].substr(0,5).toLowerCase() === "class") {
							// This line is the class definition
							const namestart = respdata.data.result.content[j].indexOf(targetcls);
							targetrange = Range.create(Position.create(j,0),Position.create(j+1,0));
							targetselrange = Range.create(Position.create(j,namestart),Position.create(j,namestart+targetcls.length));
							break;
						}
					}
					const newuri = await createDefinitionUri(params.textDocument.uri,targetcls,".cls");
					if (newuri !== "") {
						return [{
							targetUri: newuri,
							targetRange: targetrange,
							originSelectionRange: originrange,
							targetSelectionRange: targetselrange
						}];
					}
				}
			}
			break;
		}
	}
}
