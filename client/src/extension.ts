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
	Selection,
	Position,
} from 'vscode';

import {
	DocumentSelector,
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
	]

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

	// Register the select import package
	let selectImportPackageDisposable = commands.registerCommand("intersystems.language-server.selectImportPackage",
		async (uri:string,classname:string) => {
			// Ask for all import packages
			const allimportpackages: QuickPickItem[] = await client.sendRequest("intersystems/refactor/listImportPackages",{
				uri:uri,
				classmame:classname
			});

			if(allimportpackages.length===0){
				// There are no packages of this class, so tell the user and exit
				window.showInformationMessage("There are no packages for \'"+classname+"\'","Dismiss");
				return;
			}else if(allimportpackages.length===1){
				// There is only one package, the user does not need to choose
				var selectedPackage=allimportpackages[0]
			}else{
				// Ask the user to select an import package
				var selectedPackage = await window.showQuickPick(allimportpackages,{
					placeHolder: "Select the package to import",
					canPickMany: false 
				});
				if (!selectedPackage ) {
					// No package was selected
					return;
				}
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

	// Register the Extract Method command
	let extractMethodDisposable = commands.registerCommand("intersystems.language-server.extractMethod",
		async (uri:string,lnstart:number,lnend:number,lnmethod:number,newmethodtype:string) => {
			// Get the list of class member names
			const symbols =  await commands.executeCommand("vscode.executeDocumentSymbolProvider", Uri.parse(uri));
			var clsmembers:string[]=[]
			for(let clsmember =0; clsmember < symbols[0].children.length; clsmember++){
				clsmembers.push(symbols[0].children[clsmember].name)
			}
			var newmethodname = await window.showInputBox({
				placeHolder: "Choose the name of the new Method",
				value:"newmethod",
				validateInput:(newmethodname:string)=>{
					if(newmethodname===""){
						return "Empty method name"
					}
					var testname: string = newmethodname;
					if (
						(newmethodname.charAt(0) !== '"' || newmethodname.charAt(newmethodname.length) !== '"') &&
						newmethodname.match(/(^([A-Za-z]|%)$)|(^([A-Za-z]|%)([A-Za-z]|\d|[^\x00-\x7F])+$)/g) === null
					) {
						// Input contains forbidden characters so double exisiting " and add leading and trailing "
						testname = '"' + newmethodname.replace(/\"/g,'""') + '"';
					}

					if(testname.length>220){
						return "Not a valid name (too many characters)";
					}
					if(clsmembers.includes(testname)){
						return "Name already in use";
					}
				}
			});

			if (!newmethodname ) {
				// No name
				return;
			}
			// Format name 
			if(newmethodname.match(/(^([A-Za-z]|%)$)|(^([A-Za-z]|%)([A-Za-z]|\d|[^\x00-\x7F])+$)/g)===null){
				// add quotes if the name does not start with letter or %, then followed by letter/number/ascii>128
				newmethodname = '"' + newmethodname.replace(/\"/g,'""') + '"';
			}

			// Extract Method
			const lspWorkspaceEdit: WorkspaceEdit = await client.sendRequest("intersystems/refactor/addMethod",{
				uri: uri,
				newmethodname: newmethodname,
				lnstart:lnstart,
				lnend:lnend,
				lnmethod:lnmethod,
				newmethodtype:newmethodtype
				
			});
			// Apply the workspace edit
			await workspace.applyEdit(client.protocol2CodeConverter.asWorkspaceEdit(lspWorkspaceEdit));	

			// Highlight and scroll to new extracted method
			const activeEditor=window.activeTextEditor
			if(activeEditor.document.uri.toString()===uri){
				// Selection of the extracted method
				const anchor=lspWorkspaceEdit.changes[uri][0].range.start
				var methodstring:string=""
				for(let edit=0;edit<lspWorkspaceEdit.changes[uri].length-2;edit++){
					methodstring+=lspWorkspaceEdit.changes[uri][edit].newText
				}
				const methodsize= methodstring.split("\n").length - 1;
				const range:Range=new Range(new Position(anchor.line+1,0),new Position(anchor.line+methodsize,1))
				
				// Selection of the do command line
				const anchor2=lspWorkspaceEdit.changes[uri][lspWorkspaceEdit.changes[uri].length-1].range.start
				const linesize=lspWorkspaceEdit.changes[uri][lspWorkspaceEdit.changes[uri].length-1].newText.length;
				const range2:Range = new Range(new Position(anchor2.line+methodsize+1,anchor2.character),new Position(anchor2.line+methodsize+1,anchor2.character+linesize+1))

				// Scroll to the extracted method
				activeEditor.revealRange(range)
				
				// Highlight extracted method and method call
				const color:string="#ffff0020"// transparent yellow 
				const decoration = window.createTextEditorDecorationType({
					backgroundColor: color, 
				});
				activeEditor.setDecorations(decoration,[range,range2])
				await new Promise(r => setTimeout(r, 3000)); // Highlight disapear after 3 seconds
				setTimeout(function(){decoration.dispose();}, 0); 

			}
			
		}
	);
	// Add the commands to the subscriptions array
	context.subscriptions.push(overrideCommandDisposable,selectParameterTypeCommandDisposable,selectImportPackageDisposable,extractMethodDisposable);

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
