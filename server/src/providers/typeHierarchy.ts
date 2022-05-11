import {
	Range,
	Position,
	TypeHierarchyItem,
	SymbolKind,
	TypeHierarchyPrepareParams,
	TypeHierarchySubtypesParams,
	TypeHierarchySupertypesParams
} from 'vscode-languageserver/node';

import {
	QueryData,
	ServerSpec
} from '../utils/types';

import * as ld from '../utils/languageDefinitions';
import { getServerSpec, findFullRange, normalizeClassname, makeRESTRequest } from '../utils/functions';
import { parsedDocuments, documents, connection } from '../utils/variables';

/**
 * Handler function for the `textDocument/prepareTypeHierarchy` request.
 */
export async function onPrepare(params: TypeHierarchyPrepareParams): Promise<TypeHierarchyItem[] | null> {
	const parsed = parsedDocuments.get(params.textDocument.uri);
	if (parsed === undefined) {return null;}
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {return null;}
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

			if (
				((parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_clsname_attrindex) ||
				(parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_clsname_attrindex)) &&
				doc.getText(Range.create(
					Position.create(params.position.line,0),
					Position.create(params.position.line,6)
				)).toLowerCase() !== "import"
			) {
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

				// Get the uri for this class
				const uri: string[] = await connection.sendRequest("intersystems/uri/forTypeHierarchyClasses",[normalizedname]);

				// Create and return the TypeHierarchyItem
				return [{
					name: normalizedname,
					kind: SymbolKind.Class,
					range: Range.create(Position.create(0,0),Position.create(0,0)),
					selectionRange: Range.create(Position.create(0,0),Position.create(0,0)),
					uri: uri[0],
					data: server
				}];
			}
			break;
		}
	}
	return null;
}

/**
 * Get all sub/superclasses for to `item.name` using `query` and convert them to `TypeHierarchyItem`s.
 * Helper function for `onSubtypes` and `onSupertypes`.
 * 
 * @param item The base class.
 * @param query The query string.
 * @returns Array of `TypeHierarchyItem`s for all sub/superclasses.
 */
async function classesToTHItems(item: TypeHierarchyItem, query: string): Promise<TypeHierarchyItem[]> {
	const result: TypeHierarchyItem[] = [];
	const querydata: QueryData = {
		query: query,
		parameters: [item.name]
	};
	const respdata = await makeRESTRequest("POST",1,"/action/query",<ServerSpec>item.data,querydata);
	if (respdata !== undefined && respdata.data.result.content !== undefined && respdata.data.result.content.length > 0) {
		const classes: string[] = respdata.data.result.content.map((clsobj) => clsobj.Name);
		const uris: string[] = await connection.sendRequest("intersystems/uri/forTypeHierarchyClasses",classes);
		for (let i = 0; i < classes.length; i++) {
			result.push({
				name: classes[i],
				kind: SymbolKind.Class,
				range: Range.create(Position.create(0,0),Position.create(0,0)),
				selectionRange: Range.create(Position.create(0,0),Position.create(0,0)),
				uri: uris[i],
				data: item.data
			});
		}
	}
	return result;
}

/**
 * Handler function for the `typeHierarchy/subtypes` request.
 */
export async function onSubtypes(params: TypeHierarchySubtypesParams): Promise<TypeHierarchyItem[]> {
	return classesToTHItems(
		params.item,
		"SELECT Name FROM %Dictionary.CompiledClass WHERE ? %INLIST $LISTFROMSTRING(Super)"
	);
}

/**
 * Handler function for the `typeHierarchy/supertypes` request.
 */
export async function onSupertypes(params: TypeHierarchySupertypesParams): Promise<TypeHierarchyItem[]> {
	return classesToTHItems(
		params.item,
		"SELECT Name FROM %Dictionary.CompiledClass WHERE Name %INLIST (SELECT $LISTFROMSTRING(Super) FROM %Dictionary.CompiledClass WHERE Name = ?)"
	);
}
