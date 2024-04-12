import { DocumentLink, DocumentLinkParams, Range } from 'vscode-languageserver/node';
import { documents } from '../utils/variables';
import * as ld from '../utils/languageDefinitions';
import { createDefinitionUri, getParsedDocument, getServerSpec, normalizeClassname } from '../utils/functions';
import { ServerSpec } from '../utils/types';

export async function onDocumentLinks(params: DocumentLinkParams): Promise<DocumentLink[] | null> {
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {return null;}
	if (doc.languageId !== "objectscript-class") {return null;}
	const parsed = await getParsedDocument(params.textDocument.uri);
	if (parsed === undefined) {return null;}
	let result: DocumentLink[] = [];

	// Loop through the class and look for documentation comments
	const classregex = /(?:<class>([^<>/#]+)<\/class>)|(?:##class\(([^<>()]+)\))/gi;
	const memberregex = new RegExp("(?:<method>([^<>\/]+)<\/method>)|(?:<property>([^<>\/]+)<\/property>)|(?:<query>([^<>\/]+)<\/query>)","gi");
	for (let line = 0; line < parsed.length; line++) {
		if (
			parsed[line].length > 0 &&
			parsed[line][0].l === ld.cls_langindex &&
			parsed[line][0].s === ld.cls_desc_attrindex
		) {
			// This is a UDL documentation line
			const linetext = doc.getText(Range.create(line,0,line+1,0));
			let matcharr: RegExpExecArray | null;
			while ((matcharr = classregex.exec(linetext)) !== null) {
				// This is a <CLASS> HTML tag or ##class()
				const clsName = matcharr[1] ?? matcharr[2];
				const offset = matcharr[1] ? 7 : 8;
				result.push({
					range: Range.create(line,matcharr.index+offset,line,matcharr.index+offset+clsName.length),
					tooltip: "Open this class in a new editor tab",
					data: {
						uri: params.textDocument.uri,
						clsName
					}
				});
			}
			while ((matcharr = memberregex.exec(linetext)) !== null) {
				let linkRange = Range.create(0,0,0,0);
				let commandArgs: string[] = [params.textDocument.uri];
				if (matcharr[1] !== undefined) {
					// This is a <METHOD> HTML tag
					linkRange = Range.create(line,matcharr.index+8,line,matcharr.index+8+matcharr[1].length);
					commandArgs[1] = "method";
					commandArgs[2] = matcharr[1];
				}
				else if (matcharr[2] !== undefined) {
					// This is a <PROPERTY> HTML tag
					linkRange = Range.create(line,matcharr.index+10,line,matcharr.index+10+matcharr[2].length);
					commandArgs[1] = "property";
					commandArgs[2] = matcharr[2];
				}
				else {
					// This is a <QUERY> HTML tag
					linkRange = Range.create(line,matcharr.index+7,line,matcharr.index+7+matcharr[3].length);
					commandArgs[1] = "query";
					commandArgs[2] = matcharr[3];
				}
				result.push({
					range: linkRange,
					tooltip: `Go to this ${commandArgs[1]} definition`,
					target: `command:intersystems.language-server.showSymbolInClass?${encodeURIComponent(JSON.stringify(commandArgs))}`
				});
			}
		}
	}

	return result;
}

export async function onDocumentLinkResolve(link: DocumentLink): Promise<DocumentLink> {
	const doc = documents.get(link.data.uri);
	if (doc === undefined) {return link;}
	const parsed = await getParsedDocument(link.data.uri);
	if (parsed === undefined) {return link;}
	const server: ServerSpec = await getServerSpec(link.data.uri);

	// Normalize the class name if there are imports
	let normalizedname = await normalizeClassname(doc,parsed,link.data.clsName,server,link.range.start.line);
	if (normalizedname !== "") {
		// Get the uri for this class
		link.target = await createDefinitionUri(link.data.uri,normalizedname,".cls");
	}

	return link;
}
