import { DidChangeConfigurationNotification, TextDocumentSyncKind, CodeActionKind } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';

import { onPrepare, onSubtypes, onSupertypes } from './providers/typeHierarchy';
import { evaluatableExpression } from './providers/evaluatableExpression';
import {
	addImportPackage,
	addMethod,
	addOverridableMembers,
	listImportPackages,
	listOverridableMembers,
	listParameterTypes,
	onCodeAction,
	onCodeActionResolve,
	validateOverrideCursor
} from './providers/refactoring';
import { onDocumentLinkResolve, onDocumentLinks } from './providers/documentLink';
import { onDeclaration } from './providers/declaration';
import { onTypeDefinition } from './providers/typeDefinition';
import { onPrepareRename, onRenameRequest } from './providers/rename';
import { onFoldingRanges } from './providers/foldingRange';
import { onDocumentSymbol } from './providers/documentSymbol';
import { onDefinition } from './providers/definition';
import { onHover } from './providers/hover';
import { onCompletion, onCompletionResolve, schemaCaches } from './providers/completion';
import { onSignatureHelp } from './providers/signatureHelp';
import { onDocumentFormatting, onDocumentRangeFormatting } from './providers/formatting';
import { onDiagnostics } from './providers/diagnostic';
import { onSemanticTokens, onSemanticTokensDelta } from './providers/semanticTokens';

import { LanguageServerConfiguration, ServerSpec } from './utils/types';
import { connection, documents, languageServerSettings, parsedDocuments, serverSpecs, tokenBuilders } from './utils/variables';
import { parseDocument, getLegend } from './parse/parse';
import { isolateEmbeddedLanguage, languageAtPosition } from './providers/requestForwarding';

connection.onInitialize(() => {
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Full,
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: [".","$","("," ","<",'"',"#","^"]
			},
			hoverProvider: true,
			definitionProvider: true,
			signatureHelpProvider: {
				triggerCharacters: ["(",","],
				retriggerCharacters: [","]
			},
			documentFormattingProvider: true,
			documentRangeFormattingProvider: true,
			semanticTokensProvider: {
				legend: getLegend(),
				full: {
					delta: true
				}
			},
			documentSymbolProvider: true,
			foldingRangeProvider: true,
			renameProvider: {
				prepareProvider: true
			},
			typeDefinitionProvider: true,
			declarationProvider: true,
			codeActionProvider: {
				codeActionKinds: [
					CodeActionKind.Refactor,
					CodeActionKind.QuickFix
				],
				resolveProvider: true
			},
			documentLinkProvider: {
				resolveProvider: true
			},
			typeHierarchyProvider: true,
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false
			}
		}
	};
});

connection.onInitialized(() => {
	// Register for relevant configuration changes.
	connection.client.register(DidChangeConfigurationNotification.type, {section: ["intersystems.language-server","intersystems.servers","objectscript.conn"]});
});

connection.onExit(() => {
	process.exit();
});

connection.onDidChangeConfiguration(async () => {
	// Clear our caches
	languageServerSettings.clear();
	serverSpecs.clear();
	schemaCaches.clear();

	// Refresh the cached configuration settings for all open documents
	// This is done here because it's more efficient to pack everything into one request to the client
	const uris: string[] = documents.keys();
	const configs: LanguageServerConfiguration[] = await connection.workspace.getConfiguration(
		uris.map((uri) => { return { scopeUri: uri, section: "intersystems.language-server" }; })
	);
	configs.forEach((config, index) => languageServerSettings.set(uris[index], config));

	// Update diagnostics for all open documents
	connection.languages.diagnostics.refresh();
});

documents.onDidClose(e => {
	parsedDocuments.delete(e.document.uri);
	tokenBuilders.delete(e.document.uri);
	serverSpecs.delete(e.document.uri);
	languageServerSettings.delete(e.document.uri);
	connection.sendDiagnostics({uri: e.document.uri, diagnostics: []});
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(async change => {
	// Clear the parsedDocuments value so we know to wait for an update elsewhere
	parsedDocuments.set(change.document.uri,undefined);
	const path = URI.parse(change.document.uri).path;
	parsedDocuments.set(
		change.document.uri,
		parseDocument(
			change.document.languageId,
			path.slice(path.lastIndexOf(".")+1).toLowerCase(),
			change.document.getText()
		).compressedlinearray
	);
});

connection.onDocumentFormatting(onDocumentFormatting);

connection.onDocumentRangeFormatting(onDocumentRangeFormatting);

connection.onSignatureHelp(onSignatureHelp);

connection.onCompletion(onCompletion);

connection.onCompletionResolve(onCompletionResolve);

connection.onHover(onHover);

connection.onDefinition(onDefinition);

connection.languages.semanticTokens.on(onSemanticTokens);

connection.languages.semanticTokens.onDelta(onSemanticTokensDelta);

connection.onNotification("intersystems/server/passwordChange",
	(serverName: string) => {
		var invalid: string[] = [];
		for (let [uri, server] of serverSpecs.entries()) {
			if (server.serverName = serverName) {
				invalid.push(uri);
			}
		}
		for (let uri of invalid) {
			serverSpecs.delete(uri);
		}
		var toRemove: ServerSpec | undefined = undefined;
		for (let server of schemaCaches.keys()) {
			if (server.serverName = serverName) {
				toRemove = server;
				break;
			}
		}
		if (toRemove !== undefined) {
			schemaCaches.delete(toRemove);
		}
	}
);

connection.onNotification("intersystems/server/connectionChange",() => {
	// Clear all cached server connection info
	serverSpecs.clear();
	schemaCaches.clear();
});

connection.onDocumentSymbol(onDocumentSymbol);

connection.onFoldingRanges(onFoldingRanges);

connection.onPrepareRename(onPrepareRename);

connection.onRenameRequest(onRenameRequest);

connection.onTypeDefinition(onTypeDefinition);

connection.onDeclaration(onDeclaration);

connection.onRequest("intersystems/debugger/evaluatableExpression",evaluatableExpression);

connection.onRequest("intersystems/refactor/listOverridableMembers",listOverridableMembers);

connection.onRequest("intersystems/refactor/addOverridableMembers",addOverridableMembers);

connection.onRequest("intersystems/refactor/validateOverrideCursor",validateOverrideCursor);

connection.onRequest("intersystems/refactor/listParameterTypes",listParameterTypes);

connection.onRequest("intersystems/refactor/listImportPackages",listImportPackages);

connection.onRequest("intersystems/refactor/addImportPackage",addImportPackage);

connection.onRequest("intersystems/refactor/addMethod",addMethod);

connection.onCodeAction(onCodeAction);

connection.onCodeActionResolve(onCodeActionResolve);

connection.onDocumentLinks(onDocumentLinks);

connection.onDocumentLinkResolve(onDocumentLinkResolve);

connection.languages.typeHierarchy.onPrepare(onPrepare);

connection.languages.typeHierarchy.onSubtypes(onSubtypes);

connection.languages.typeHierarchy.onSupertypes(onSupertypes);

connection.onRequest("intersystems/embedded/languageAtPosition",languageAtPosition);

connection.onRequest("intersystems/embedded/isolateEmbeddedLanguage",isolateEmbeddedLanguage);

connection.languages.diagnostics.on(onDiagnostics);

documents.listen(connection);

connection.listen();
