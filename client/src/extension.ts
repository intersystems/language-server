export const extensionId = "intersystems.language-server";
import * as path from 'path';
import {
	ExtensionContext,
	extensions,
	Uri,
	window,
	ColorThemeKind,
	workspace
} from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient';

let client: LanguageClient;

let serverManagerExt = extensions.getExtension("intersystems-community.servermanager");
let objectScriptExt = extensions.getExtension("intersystems-community.vscode-objectscript");
const objectScriptApi = objectScriptExt.exports;

export async function activate(context: ExtensionContext) {
	// The server is implemented in node
	let serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);
	// The debug options for the server
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
	let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for InterSystems files
		documentSelector: [
			{language: 'objectscript'},
			{language: 'objectscript-class'},
			{language: 'objectscript-csp'},
			{language: 'objectscript-macros'}
		]
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'intersystems.language-server',
		'InterSystems Language Server',
		serverOptions,
		clientOptions
	);

	client.onReady().then(() => {
		client.onRequest("intersystems/server/resolveFromUri", (uri: string) => {
			return objectScriptApi.serverForUri(Uri.parse(uri));
		});
		client.onRequest("intersystems/uri/localToVirtual", (uri: string): string => {
			const newuri: Uri = objectScriptApi.serverDocumentUriForUri(Uri.parse(uri));
			return newuri.toString();
		});
		objectScriptApi.onDidChangeConnection()(() => {
			client.sendNotification("intersystems/server/connectionChange");
		});
		if (serverManagerExt !== undefined) {
			// The server manager extension is installed
			const serverManagerApi = serverManagerExt.exports;
			serverManagerApi.onDidChangePassword()((serverName: string) => {
				client.sendNotification("intersystems/server/passwordChange",serverName);
			});
		}
	});

	// Register for proposed features becuase semantic token support is still in a proposed state
	client.registerProposedFeatures();

	if (
		workspace.getConfiguration("intersystems.language-server").get("suggestTheme") === true &&
		workspace.getConfiguration("workbench").get("colorTheme") !== "InterSystems Default Light" &&
		workspace.getConfiguration("workbench").get("colorTheme") !== "InterSystems Default Dark"
	) {
		// Suggest an InterSystems default theme depending on the current active theme type
		if (window.activeColorTheme.kind === ColorThemeKind.Light) {
			const answer = await window.showInformationMessage(
				`You currently have a light theme active. InterSystems recommends that you use the default light theme included with the [Language Server extension](https://marketplace.visualstudio.com/items?itemName=intersystems.language-server).`,
				"Activate",
				"Ask Me Later",
				"Don't Ask Me Again"
			);
			if (answer === "Activate") {
				workspace.getConfiguration("workbench").update("colorTheme","InterSystems Default Light",true);
			}
			else if (answer === "Don't Ask Me Again") {
				workspace.getConfiguration("intersystems.language-server").update("suggestTheme",false,true);
			}
			else {
				// Do nothing
			}
		}
		else if (window.activeColorTheme.kind === ColorThemeKind.Dark) {
			const answer = await window.showInformationMessage(
				`You currently have a dark theme active. InterSystems recommends that you use the default dark theme included with the [Language Server extension](https://marketplace.visualstudio.com/items?itemName=intersystems.language-server).`,
				"Activate",
				"Ask Me Later",
				"Don't Ask Me Again"
			);
			if (answer === "Activate") {
				workspace.getConfiguration("workbench").update("colorTheme","InterSystems Default Dark",true);
			}
			else if (answer === "Don't Ask Me Again") {
				workspace.getConfiguration("intersystems.language-server").update("suggestTheme",false,true);
			}
			else {
				// Do nothing
			}
		}
	}

	// Start the client. This will also launch the server
	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
