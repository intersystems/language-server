import {
	InlayHint,
	InlayHintParams,
} from "vscode-languageserver/node";
import { URI } from "vscode-uri";
import * as analyzer from "../analyzer";

/**
 * Handler function for the `textDocument/inlayHint` request.
 */
export async function onInlayHint(params: InlayHintParams): Promise<InlayHint[]> {
	const uri = URI.parse(params.textDocument.uri);
	const hints = await analyzer.inlayHint(uri.fsPath, params.range);

	return hints.map(hint => ({
		position: hint.position,
		label: hint.label,
		paddingLeft: hint.paddingLeft,
		paddingRight: hint.paddingRight,
	}));
}
