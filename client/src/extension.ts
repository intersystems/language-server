import * as path from 'path';
import {
	ExtensionContext,
	extensions,
	Uri,
	window,
	ColorThemeKind,
	workspace,
	commands,
	QuickPickItem,
	languages,
	Range,
} from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
	WorkspaceEdit,
	TextEdit,
} from 'vscode-languageclient/node';

import { ObjectScriptEvaluatableExpressionProvider } from './evaluatableExpressionProvider';

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

	const documentSelector = [
		{language: 'objectscript'},
		{language: 'objectscript-class'},
		{language: 'objectscript-csp'},
		{language: 'objectscript-macros'}
	];

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for InterSystems files
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

	// Register the override class member command
	let overrideCommandDisposable = commands.registerCommand("intersystems.language-server.overrideClassMembers",
		async () => {

			// Get the open document and check that it's an ObjectScript class
			const openDoc = window.activeTextEditor.document;
			if (openDoc.languageId !== "objectscript-class") {
				// Can only override members in a class
				return;
			}

			// Check that this class has a superclass
			var seenextends = false;
			for (let linenum = 0; linenum < openDoc.lineCount; linenum++) {
				const linetxt = openDoc.lineAt(linenum).text;
				if (linetxt.slice(0,5).toLowerCase() === "class") {
					// This is the class definition line
					const linewords = linetxt.replace(/\s{2,}/g," ").split(" ");
					if (linewords.length > 2 && linewords[2].toLowerCase() === "extends") {
						seenextends = true;
					}
					break;
				}
			}
			if (!seenextends) {
				// This class has no superclasses, so tell the user and exit
				window.showInformationMessage("The current class has no superclasses.","Dismiss");
				return;
			}

			// Check that we can insert new class members at the cursor position
			const selection = window.activeTextEditor.selection;
			var cursorvalid = false;
			var docposvalid = false;
			if (openDoc.lineAt(selection.active.line).isEmptyOrWhitespace && selection.isEmpty) {
				cursorvalid = true;
			}
			if (cursorvalid) {
				docposvalid = await client.sendRequest("intersystems/refactor/validateOverrideCursor",{
					uri: openDoc.uri.toString(),
					line: selection.active.line
				});
			}
			if (!cursorvalid || !docposvalid) {
				// We can't insert new class members at the cursor position, so tell the user and exit
				window.showInformationMessage("Cursor must be in the class definition body and with nothing selected.","Dismiss");
				return;
			}

			// Ask the user to select the type of member that they want to override
			const selectedType = await window.showQuickPick(["Method","Parameter","Property","Query","Trigger","XData"],{
				placeHolder: "Select the class member type to override"
			});
			if (!selectedType) {
				// No member type was selected, so exit
				return;
			}

			var plural = selectedType+"s";
			if (selectedType === "Query") {
				plural = "Queries";
			}
			else if (selectedType === "XData") {
				plural = "XData blocks";
			}
			else if (selectedType === "Property") {
				plural = "Properties";
			}

			// Ask the server for all overridable members of the selected type
			const overridableMembers: QuickPickItem[] = await client.sendRequest("intersystems/refactor/listOverridableMembers",{
				uri: openDoc.uri.toString(),
				memberType: selectedType
			});
			if (overridableMembers.length === 0) {
				// There are no members of this type to override, so tell the user and exit
				window.showInformationMessage("There are no inherited "+plural+" that are overridable.","Dismiss");
				return;
			}

			// Ask the user to select which members they want to override
			const selectedMembers = await window.showQuickPick(overridableMembers,{
				placeHolder: "Select the "+plural+" to override",
				canPickMany: true
			});
			if (!selectedMembers || selectedMembers.length === 0) {
				// No members were selected, so exit
				return;
			}

			// Ask the server to compute the workspace edit that the client should apply
			const lspWorkspaceEdit: WorkspaceEdit = await client.sendRequest("intersystems/refactor/addOverridableMembers",{
				uri: openDoc.uri.toString(),
				members: selectedMembers,
				cursor: selection.active
			});

			// Apply the workspace edit
			workspace.applyEdit(client.protocol2CodeConverter.asWorkspaceEdit(lspWorkspaceEdit));
		}
	);

	// Register the select parameter type
	let selectParameterTypeCommandDisposable = commands.registerCommand("intersystems.language-server.selectParameterType",
		async (uri:string,parameterRange:Range) => {
			// Ask for all parameter types
			const allparametertypes: QuickPickItem[] = await client.sendRequest("intersystems/refactor/listParameterTypes");

			// Ask the user to select a parameter type
			const selectedParameter = await window.showQuickPick(allparametertypes,{
				placeHolder: "Select the parameter type",
				canPickMany: false
			});
			if (!selectedParameter ) {
				// No parameter was selected
				return;
			}
			// Compute the workspace edit on the client side
			const change:TextEdit={
				range:parameterRange,
				newText:selectedParameter.label
			}
			const edit:WorkspaceEdit={
				changes: {
					[uri]: [change]
				}
			}
			// Apply the workspace edit
			workspace.applyEdit(client.protocol2CodeConverter.asWorkspaceEdit(edit));	
		}
	);

	// Register the select parameter type
	let selectImportPackageDisposable = commands.registerCommand("intersystems.language-server.selectImportPackage",
		async (uri:string,classname:string) => {
			// Ask for all import packages
			const allimportpackages: QuickPickItem[] = await client.sendRequest("intersystems/refactor/listImportPackages",{
				uri:uri,
				classmame:classname
			});
			// Ask the user to select a import package
			const selectedPackage = await window.showQuickPick(allimportpackages,{
				placeHolder: "Select the package to import",
				canPickMany: false 
			});
			if (!selectedPackage ) {
				// No parameter was selected
				return;
			}
			// Ask the server to compute the workspace edit that the client should apply
			const lspWorkspaceEdit: WorkspaceEdit = await client.sendRequest("intersystems/refactor/addImportPackages",{
				uri: uri,
				packagename: selectedPackage.label,
			});
			// Apply the workspace edit
			workspace.applyEdit(client.protocol2CodeConverter.asWorkspaceEdit(lspWorkspaceEdit));	
		}
	);

	// Add the commands to the subscriptions array
	context.subscriptions.push(overrideCommandDisposable,selectParameterTypeCommandDisposable,selectImportPackageDisposable);

	// Initialize the EvaluatableExpressionProvider
	const evaluatableExpressionProvider = new ObjectScriptEvaluatableExpressionProvider(client);
	let evaluatableExpressionDisposable = languages.registerEvaluatableExpressionProvider(documentSelector,evaluatableExpressionProvider);

	// Add the EvaluatableExpressionProvider to the subscriptions array
	context.subscriptions.push(evaluatableExpressionDisposable);

	// Start the client. This will also launch the server
	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
