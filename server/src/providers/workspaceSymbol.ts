import { WorkspaceSymbolParams, WorkspaceSymbol, SymbolKind, SymbolTag, Range } from "vscode-languageserver";
import { MemberInfo } from "../analyzer";
import { connection } from "../utils/variables";
import { getAnalyzedClasses } from '../analyzer';
import { localInfoPrefix } from "./hover";
import { URI } from 'vscode-uri';

export const onWorkspaceSymbol = async (params: WorkspaceSymbolParams): Promise<WorkspaceSymbol[]> => {
	const output: WorkspaceSymbol[] = [];
	const query = params.query.toLowerCase();
	for (const folder of await connection.workspace.getWorkspaceFolders()) {
		for await (const [uri, cls] of getAnalyzedClasses(URI.parse(folder.uri))) {
			const clsMatch = cls.name.content.toLowerCase().startsWith(query);
			if (clsMatch) {
				output.push({
					location: { uri, range: Range.create(cls.name.before, cls.name.after) },
					name: localInfoPrefix + cls.name.content,
					kind: SymbolKind.Class,
					tags: cls.deprecated ? [SymbolTag.Deprecated] : [],
				});
			}
			for (const mem of cls.members) {
				const kind = memberKindToSymbolKind(mem.kind.tag);
				if (kind !== null && (clsMatch || mem.name.content.toLowerCase().startsWith(query))) {
					output.push({
						location: { uri, range: Range.create(mem.name.before, mem.name.after) },
						name: localInfoPrefix + mem.name.content,
						kind,
						tags: cls.deprecated || mem.deprecated ? [SymbolTag.Deprecated] : [],
					});
				}
			}
		}
	}
	return output;
};

export function memberKindToSymbolKind(kind: MemberInfo["kind"]["tag"]): SymbolKind | null {
	switch (kind) {
		case "method":
		case "class-method":
		case "client-method":
			return SymbolKind.Method;
		case "query":
			return SymbolKind.Function;
		case "trigger":
			return SymbolKind.Event;
		case "parameter":
			return SymbolKind.Constant;
		case "index":
			return SymbolKind.Array;
		case "foreign-key":
			return SymbolKind.Key;
		case "x-data":
			return SymbolKind.Struct;
		case "storage":
			return SymbolKind.Object;
		case "projection":
			return SymbolKind.Interface;
		case "property":
		case "relationship":
			return SymbolKind.Property;
		default:
			throw new Error(`Unexpected keyword: ${kind}`);
	}
}
