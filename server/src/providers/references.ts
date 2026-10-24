import { Location, ReferenceParams } from "vscode-languageserver/node";
import { documents } from "../utils/variables";
import { getReferences } from "../ascot";

export async function onReferences(params: ReferenceParams): Promise<Location[]> {
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {
		return [];
	}
	return getReferences(params.textDocument.uri, params.position, params.context.includeDeclaration);
}
