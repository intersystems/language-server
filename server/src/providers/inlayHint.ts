import { InlayHint, InlayHintParams } from "vscode-languageserver/node";
import * as ascot from "../ascot";

/**
 * Handler function for the `textDocument/inlayHint` request.
 */
export async function onInlayHint(params: InlayHintParams): Promise<InlayHint[]> {
	const hints = await ascot.inlayHint(params.textDocument.uri, params.range);

	return hints.map((hint) => ({
		position: hint.position,
		label: hint.label,
		paddingLeft: hint.paddingLeft,
		paddingRight: hint.paddingRight,
	}));
}
