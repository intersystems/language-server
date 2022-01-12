import * as path from 'path';
import {
	ExtensionContext,
	extensions,
	Uri,
	window,
	ColorThemeKind,
	workspace,
	commands,
	languages,
	authentication
} from 'vscode';

import {
	DocumentSelector,
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
} from 'vscode-languageclient/node';
import { TypeHierarchyFeature } from 'vscode-languageclient/lib/common/proposed.typeHierarchy';

import { lte } from "semver";

import { ObjectScriptEvaluatableExpressionProvider } from './evaluatableExpressionProvider';
import {
	extractMethod,
	showSymbolInClass,
	overrideClassMembers,
	selectImportPackage,
	selectParameterType
} from './commands';

export let client: LanguageClient;

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

	// The languages we handle
	const targetLanguages = [
		'objectscript',
		'objectscript-class',
		'objectscript-csp',
		'objectscript-macros',
	];

	// The uri schemes we handle those languages for
	const targetSchemes = [
		'isfs',
		'isfs-readonly',
		'objectscript',
		'objectscriptxml',
		'file',
		'vscode-remote',
		'vscode-notebook-cell'
	];

	// A document selector to target the right {language, scheme} tuples
	const documentSelector: DocumentSelector = [];
	targetLanguages.forEach(language => {
		targetSchemes.forEach(scheme => {
			documentSelector.push({ language, scheme });
		});
	});

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for InterSystems files handled by vscode-objectscript extension
		documentSelector: documentSelector
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'intersystems.language-server',
		'InterSystems Language Server',
		serverOptions,
		clientOptions
	);

	client.onReady().then(() => {
		client.onRequest("intersystems/server/resolveFromUri", async (uri: string) => {
			let serverSpec = objectScriptApi.serverForUri(Uri.parse(uri));
			if (serverSpec.host !== "" && typeof serverSpec.password === "undefined") {
				// The main extension didn't provide a password, so we must 
				// get it from the server manager's authentication provider.
				const AUTHENTICATION_PROVIDER = "intersystems-server-credentials";
				const scopes = [serverSpec.serverName, serverSpec.username || ""];
				let session = await authentication.getSession(AUTHENTICATION_PROVIDER, scopes, { silent: true });
				if (!session) {
					session = await authentication.getSession(AUTHENTICATION_PROVIDER, scopes, { createIfNone: true });
				}
				if (session) {
					serverSpec.username = session.scopes[1];
					serverSpec.password = session.accessToken;
				}
			}
			return serverSpec;
		});
		client.onRequest("intersystems/uri/localToVirtual", (uri: string): string => {
			const newuri: Uri = objectScriptApi.serverDocumentUriForUri(Uri.parse(uri));
			return newuri.toString();
		});
		client.onRequest("intersystems/uri/forDocument", (document: string): string => {
			if (lte(objectScriptExt.packageJSON.version,"1.0.10")) {
				// If the active version of vscode-objectscript doesn't expose
				// DocumentContentProvider.getUri(), just return the empty string.
				return "";
			}
			const uri: Uri = objectScriptApi.getUriForDocument(document);
			return uri.toString();
		});
		client.onRequest("intersystems/uri/forTypeHierarchyClasses", (classes: string[]): string[] => {
			// vscode-objectscript version 1.0.11+ has been available for long enough that
			// it's safe to assume that users have upgraded to at least 1.0.11
			return classes.map(
				(cls: string) => {
					const uri: Uri = objectScriptApi.getUriForDocument(`${cls}.cls`);
					return uri.toString();
				}
			);
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

	if (
		workspace.getConfiguration("intersystems.language-server").get("suggestTheme") === true &&
		workspace.getConfiguration("workbench").get("colorTheme") !== "InterSystems Default Light" &&
		workspace.getConfiguration("workbench").get("colorTheme") !== "InterSystems Default Dark"
	) {
		// Suggest an InterSystems default theme depending on the current active theme type
		if (window.activeColorTheme.kind === ColorThemeKind.Light) {
			if (workspace.name === undefined) {
				const answer = await window.showInformationMessage(
					`For the best user experience, InterSystems recommends that you activate the default light theme included with the [InterSystems Language Server extension](https://marketplace.visualstudio.com/items?itemName=intersystems.language-server). Activate now?`,
					"Yes",
					"Don't Ask Again"
				);
				if (answer === "Yes") {
					workspace.getConfiguration("workbench").update("colorTheme","InterSystems Default Light",true);
				}
				else if (answer === "Don't Ask Again") {
					workspace.getConfiguration("intersystems.language-server").update("suggestTheme",false,true);
				}
				else {
					// Do nothing
				}
			}
			else {
				// Only give the "Only This Workspace" option if a workspace is open
				const answer = await window.showInformationMessage(
					`For the best user experience, InterSystems recommends that you activate the default light theme included with the [InterSystems Language Server extension](https://marketplace.visualstudio.com/items?itemName=intersystems.language-server). Activate now?`,
					"Globally",
					"Only This Workspace",
					"Don't Ask Again"
				);
				if (answer === "Globally") {
					workspace.getConfiguration("workbench").update("colorTheme","InterSystems Default Light",true);
				}
				else if (answer === "Only This Workspace") {
					workspace.getConfiguration("workbench").update("colorTheme","InterSystems Default Light",false);
				}
				else if (answer === "Don't Ask Again") {
					workspace.getConfiguration("intersystems.language-server").update("suggestTheme",false,true);
				}
				else {
					// Do nothing
				}
			}
		}
		else if (window.activeColorTheme.kind === ColorThemeKind.Dark) {
			if (workspace.name === undefined) {
				const answer = await window.showInformationMessage(
					`For the best user experience, InterSystems recommends that you activate the default dark theme included with the [InterSystems Language Server extension](https://marketplace.visualstudio.com/items?itemName=intersystems.language-server). Activate now?`,
					"Yes",
					"Don't Ask Again"
				);
				if (answer === "Yes") {
					workspace.getConfiguration("workbench").update("colorTheme","InterSystems Default Dark",true);
				}
				else if (answer === "Don't Ask Again") {
					workspace.getConfiguration("intersystems.language-server").update("suggestTheme",false,true);
				}
				else {
					// Do nothing
				}
			}
			else {
				// Only give the "Only This Workspace" option if a workspace is open
				const answer = await window.showInformationMessage(
					`For the best user experience, InterSystems recommends that you activate the default dark theme included with the [InterSystems Language Server extension](https://marketplace.visualstudio.com/items?itemName=intersystems.language-server). Activate now?`,
					"Globally",
					"Only This Workspace",
					"Don't Ask Again"
				);
				if (answer === "Globally") {
					workspace.getConfiguration("workbench").update("colorTheme","InterSystems Default Dark",true);
				}
				else if (answer === "Only This Workspace") {
					workspace.getConfiguration("workbench").update("colorTheme","InterSystems Default Dark",false);
				}
				else if (answer === "Don't Ask Again") {
					workspace.getConfiguration("intersystems.language-server").update("suggestTheme",false,true);
				}
				else {
					// Do nothing
				}
			}
		}
	}

	// Initialize the EvaluatableExpressionProvider
	const evaluatableExpressionProvider = new ObjectScriptEvaluatableExpressionProvider();

	context.subscriptions.push(
		// Register commands
		commands.registerCommand("intersystems.language-server.overrideClassMembers",overrideClassMembers),
		commands.registerCommand("intersystems.language-server.selectParameterType",selectParameterType),
		commands.registerCommand("intersystems.language-server.selectImportPackage",selectImportPackage),
		commands.registerCommand("intersystems.language-server.extractMethod",extractMethod),
		commands.registerCommand("intersystems.language-server.showSymbolInClass",showSymbolInClass),

		// Register EvaluatableExpressionProvider
		languages.registerEvaluatableExpressionProvider(documentSelector,evaluatableExpressionProvider)
	);

	// Register proposed TypeHierarchy feature
	client.registerFeature(new TypeHierarchyFeature(client));

	// Start the client. This will also launch the server
	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
