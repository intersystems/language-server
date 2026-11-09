import { WorkspaceSymbolParams, SymbolInformation } from "vscode-languageserver";
import { connection } from "../utils/variables";
import { getWorkspaceSymbol } from "../ascot";

export const onWorkspaceSymbol = async (params: WorkspaceSymbolParams): Promise<SymbolInformation[]> => {
	const output: SymbolInformation[] = [];
	for (const folder of (await connection.workspace.getWorkspaceFolders()) ?? []) {
		output.push(...(await getWorkspaceSymbol(folder.uri, params.query)));
	}
	return output;
};
