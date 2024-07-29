import { TextDocumentPositionParams, Position, Range } from 'vscode-languageserver';
import { getServerSpec, findFullRange, quoteUDLIdentifier, makeRESTRequest, createDefinitionUri, determineVariableClass, getClassMemberContext, getParsedDocument, getTextForUri, currentClass, getMemberType } from '../utils/functions';
import { ServerSpec, QueryData } from '../utils/types';
import { documents } from '../utils/variables';
import * as ld from '../utils/languageDefinitions';

export async function onTypeDefinition(params: TextDocumentPositionParams) {
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {return null;}
	const parsed = await getParsedDocument(params.textDocument.uri);
	if (parsed === undefined) {return null;}
	const server: ServerSpec = await getServerSpec(params.textDocument.uri);

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
			if (
				parsed[params.position.line][i].l == ld.cos_langindex && (
					parsed[params.position.line][i].s == ld.cos_method_attrindex ||
					parsed[params.position.line][i].s == ld.cos_attr_attrindex ||
					parsed[params.position.line][i].s == ld.cos_mem_attrindex ||
					parsed[params.position.line][i].s == ld.cos_instvar_attrindex
				)
			) {
				// This token is a method or property

				// Get the full text of the member
				originrange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
				const member = quoteUDLIdentifier(doc.getText(originrange).slice(parsed[params.position.line][i].s == ld.cos_instvar_attrindex ? 2 : 0),0);

				let membercontext = {
					baseclass: "",
					context: ""
				};
				if (parsed[params.position.line][i].s != ld.cos_instvar_attrindex) {
					// Find the dot token
					var dottkn = 0;
					for (let tkn = 0; tkn < parsed[params.position.line].length; tkn ++) {
						if (parsed[params.position.line][tkn].p >= originrange.start.character) {
							break;
						}
						dottkn = tkn;
					}

					// Get the base class that this member is in
					membercontext = await getClassMemberContext(doc,parsed,dottkn,params.position.line,server);
				} else {
					membercontext = {
						baseclass: currentClass(doc,parsed),
						context: ""
					};
				}
				if (membercontext.baseclass === "") {
					// If we couldn't determine the class, don't return anything
					return null;
				}

				targetcls = await getMemberType(parsed,params.position.line,i,membercontext.baseclass,member,server);
			}
			else {
				// This token is an ObjectScript variable
				targetcls = await determineVariableClass(doc,parsed,params.position.line,i,server);
			}

			if (targetcls !== "") {
				// Get the uri of the target class
				const newuri = await createDefinitionUri(params.textDocument.uri,targetcls,".cls");
				if (newuri != "") {
					// Get the full text of the target class
					const classText: string[] = await getTextForUri(newuri,server);
					if (classText.length) {
						// Loop through the file contents to find the class definition
						let targetrange = Range.create(Position.create(0,0),Position.create(0,0));
						let targetselrange = Range.create(Position.create(0,0),Position.create(0,0));
						for (let j = 0; j < classText.length; j++) {
							if (classText[j].slice(0,5).toLowerCase() === "class") {
								// This line is the class definition
								const namestart = classText[j].indexOf(targetcls);
								targetrange = Range.create(Position.create(j,0),Position.create(j+1,0));
								targetselrange = Range.create(Position.create(j,namestart),Position.create(j,namestart+targetcls.length));
								break;
							}
						}
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
