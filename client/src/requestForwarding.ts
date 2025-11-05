import { commands, CompletionList, Hover, Position, SignatureHelp, TextDocumentContentProvider, Uri } from 'vscode';
import { Middleware } from 'vscode-languageclient';
import { client } from './extension';
import { consumeFormatSkip } from './ccs/formattingControl';

export const requestForwardingMiddleware: Middleware = {
	provideCompletionItem: async (document, position, context, token, next) => {
		// If not in a class or CSP file, do not attempt request forwarding
		if (!["objectscript-class", "objectscript-csp"].includes(document.languageId)) {
			return await next(document, position, context, token);
		}

		const originalUri = document.uri.toString(true);
		const language: number = await client.sendRequest("intersystems/embedded/languageAtPosition", {
			textDocument: {
				uri: originalUri
			},
			position: position
		});

		let vdocExt: string = "";
		if (language == 5) {
			// The position is in HTML
			vdocExt = "html";
		} else if (language == 15) {
			// The position is in CSS
			vdocExt = "css";
		} else if (language == 11 && context.triggerCharacter != "(") {
			// The position is in JavaScript
			// Don't forward on open parenthesis completions to avoid clashes with the SignatureHelp tooltip
			vdocExt = "js";
		}
		if (vdocExt != "") {
			// Forward the request
			const vdocUriString = `isc-embedded-content://${language}:${position.line}-${position.character}/${encodeURIComponent(
				originalUri
			)}.${vdocExt}`;
			const vdocUri = Uri.parse(vdocUriString);
			return await commands.executeCommand<CompletionList>(
				"vscode.executeCompletionItemProvider",
				vdocUri,
				position,
				context.triggerCharacter
			);
		} else {
			// Do not forward the request
			return await next(document, position, context, token);
		}
	},
	resolveCompletionItem: async (item, token, next) => {
		if (item.documentation != undefined || item.detail != undefined) {
			// No need to resolve if we already have documentation
			return item;
		}
		return await next(item, token);
	},
	provideHover: async (document, position, token, next) => {
		// If not in a class or CSP file, do not attempt request forwarding
		if (!["objectscript-class", "objectscript-csp"].includes(document.languageId)) {
			return await next(document, position, token);
		}

		const originalUri = document.uri.toString(true);
		const language: number = await client.sendRequest("intersystems/embedded/languageAtPosition", {
			textDocument: {
				uri: originalUri
			},
			position: position
		});

		let vdocExt: string = "";
		if (language == 5) {
			// The position is in HTML
			vdocExt = "html";
		} else if (language == 15) {
			// The position is in CSS
			vdocExt = "css";
		} else if (language == 11) {
			// The position is in JavaScript
			vdocExt = "js";
		}
		if (vdocExt != "") {
			// Forward the request
			const vdocUriString = `isc-embedded-content://${language}:${position.line}-${position.character}/${encodeURIComponent(
				originalUri
			)}.${vdocExt}`;
			const vdocUri = Uri.parse(vdocUriString);
			return await commands.executeCommand<Hover[]>(
				"vscode.executeHoverProvider",
				vdocUri,
				position
			).then((hovers) => Array.isArray(hovers) && hovers.length ? hovers[0] : undefined);
		} else {
			// Do not forward the request
			return await next(document, position, token);
		}
	},
	provideSignatureHelp: async (document, position, context, token, next) => {
		// If not in a class or CSP file, do not attempt request forwarding
		if (!["objectscript-class", "objectscript-csp"].includes(document.languageId)) {
			return await next(document, position, context, token);
		}

		const originalUri = document.uri.toString(true);
		const language: number = await client.sendRequest("intersystems/embedded/languageAtPosition", {
			textDocument: {
				uri: originalUri
			},
			position: position
		});

		let vdocExt: string = "";
		if (language == 11) {
			// The position is in JavaScript
			vdocExt = "js";
		}
		if (vdocExt != "") {
			// Forward the request
			const vdocUriString = `isc-embedded-content://${language}:${position.line}-${position.character}/${encodeURIComponent(
				originalUri
			)}.${vdocExt}`;
			const vdocUri = Uri.parse(vdocUriString);
			return await commands.executeCommand<SignatureHelp>(
				"vscode.executeSignatureHelpProvider",
				vdocUri,
				position,
				context.triggerCharacter
			);
		} else {
			// Do not forward the request
			return await next(document, position, context, token);
		}
	},
	provideDocumentFormattingEdits: async (document, options, token, next) => {
		if (consumeFormatSkip(document.uri.toString(true))) {
			return [];
		}
		return await next(document, options, token);
	},
	provideDocumentRangeFormattingEdits: async (document, range, options, token, next) => {
		if (consumeFormatSkip(document.uri.toString(true))) {
			return [];
		}
		return await next(document, range, options, token);
	}
};

export class ISCEmbeddedContentProvider implements TextDocumentContentProvider {

	constructor() { }

	provideTextDocumentContent(uri: Uri): Promise<string> {
		// Get the isclexer language number and position from the URI authority
		const language: number = Number(uri.authority.split(":")[0]);
		const positionText = uri.authority.split(":")[1];
		const position = new Position(Number(positionText.split("-")[0]), Number(positionText.split("-")[1]));
		// Use the language number to isolate the original URI
		let originalUri: string;
		if (language == 11) {
			// Language is JavaScript so the extension is .js
			originalUri = uri.path.slice(1).slice(0, -3);
		} else if (language == 5) {
			// Language is HTML so the extension is .html
			originalUri = uri.path.slice(1).slice(0, -5);
		} else if (language == 15) {
			// Language is CSS so the extension is .css
			originalUri = uri.path.slice(1).slice(0, -4);
		}
		if (originalUri) {
			// Ask the server to isolate the embedded language
			return client.sendRequest("intersystems/embedded/isolateEmbeddedLanguage", {
				uri: decodeURIComponent(originalUri),
				language: language,
				position: position
			});
		}
	}

}
