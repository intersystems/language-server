import { InlayHint, InlayHintParams } from "vscode-languageserver/node";
import * as ascot from "../ascot";

export async function onInlayHint(params: InlayHintParams): Promise<InlayHint[]> {
	return ascot.inlayHint(params.textDocument.uri, params.range);
}
