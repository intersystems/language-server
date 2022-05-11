import {
	Uri,
	window,
	workspace,
	commands,
	QuickPickItem,
	Range,
	Position,
	DocumentSymbol,
	TextEditorRevealType,
	Selection
} from 'vscode';

import { WorkspaceEdit, TextEdit } from 'vscode-languageclient/node';

import { client } from './extension';

/**
 * Callback function for the `intersystems.language-server.overrideClassMembers` command.
 */
export async function overrideClassMembers() {

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
	workspace.applyEdit(await client.protocol2CodeConverter.asWorkspaceEdit(lspWorkspaceEdit));
}

/**
 * Callback function for the `intersystems.language-server.selectParameterType` command.
 */
export async function selectParameterType(uri: string, parameterRange: Range) {
	// Ask for all parameter types
	const allparametertypes: QuickPickItem[] = await client.sendRequest("intersystems/refactor/listParameterTypes");

	// Ask the user to select a parameter type
	const selectedParameter = await window.showQuickPick(allparametertypes,{
		placeHolder: "Select the Parameter type",
		canPickMany: false
	});
	if (!selectedParameter) {
		// No parameter was selected
		return;
	}

	// Compute the workspace edit
	const change: TextEdit = {
		range: parameterRange,
		newText: selectedParameter.label
	};
	const edit: WorkspaceEdit = {
		changes: {
			[uri]: [change]
		}
	};

	// Apply the workspace edit
	workspace.applyEdit(await client.protocol2CodeConverter.asWorkspaceEdit(edit));	
}

/**
 * Callback function for the `intersystems.language-server.selectImportPackage` command.
 */
export async function selectImportPackage(uri: string, classname: string) {
	// Ask for all import packages
	const allimportpackages: QuickPickItem[] = await client.sendRequest("intersystems/refactor/listImportPackages",{
		uri: uri,
		classmame: classname
	});

	if (allimportpackages.length === 0) {
		// There are no packages of this class, so tell the user and exit
		window.showInformationMessage("There are no packages for \'" + classname + "\'","Dismiss");
		return;
	} else if (allimportpackages.length === 1) {
		// There is only one package, the user does not need to choose
		var selectedPackage = allimportpackages[0];
	} else {
		// Ask the user to select an import package
		var selectedPackage = await window.showQuickPick(allimportpackages,{
			placeHolder: "Select the package to import",
			canPickMany: false 
		});
		if (!selectedPackage) {
			// No package was selected
			return;
		}
	}

	// Ask the server to compute the workspace edit
	const lspWorkspaceEdit: WorkspaceEdit = await client.sendRequest("intersystems/refactor/addImportPackage",{
		uri: uri,
		packagename: selectedPackage.label,
	});

	// Apply the workspace edit
	workspace.applyEdit(await client.protocol2CodeConverter.asWorkspaceEdit(lspWorkspaceEdit));	
}

/**
 * Callback function for the `intersystems.language-server.extractMethod` command.
 */
export async function extractMethod(uri: string, lnstart: number, lnend: number, lnmethod: number, newmethodtype: string) {
	// Get the list of class member names
	const symbols =  await commands.executeCommand("vscode.executeDocumentSymbolProvider", Uri.parse(uri));
	var clsmembers: string[] = [];
	for (let clsmember = 0; clsmember < symbols[0].children.length; clsmember++) {
		clsmembers.push(symbols[0].children[clsmember].name);
	}

	var newmethodname = await window.showInputBox({
		placeHolder: "Enter the name of the new method",
		value: "newmethod",
		validateInput: (newmethodname: string) => {
			if (newmethodname === "") {
				return "Empty method name";
			}
			var testname: string = newmethodname;
			if (
				(newmethodname.charAt(0) !== '"' || newmethodname.charAt(newmethodname.length) !== '"') &&
				newmethodname.match(/(^([A-Za-z]|%)$)|(^([A-Za-z]|%)([A-Za-z]|\d|[^\x00-\x7F])+$)/g) === null
			) {
				// Input contains forbidden characters so double exisiting " and add leading and trailing "
				testname = '"' + newmethodname.replace(/\"/g,'""') + '"';
			}
			if (testname.length > 220) {
				return "Name is too long";
			}
			if (clsmembers.includes(testname)) {
				return "Name already in use";
			}
		}
	});

	if (!newmethodname) {
		// No name
		return;
	}
	// Format name 
	if (newmethodname.match(/(^([A-Za-z]|%)$)|(^([A-Za-z]|%)([A-Za-z]|\d|[^\x00-\x7F])+$)/g) === null) {
		// Add quotes if the name does not start with a letter or %, then followed by letter/number/ascii>128
		newmethodname = '"' + newmethodname.replace(/\"/g,'""') + '"';
	}

	// Ask the server to compute the workspace edit
	const lspWorkspaceEdit: WorkspaceEdit = await client.sendRequest("intersystems/refactor/addMethod",{
		uri: uri,
		newmethodname: newmethodname,
		lnstart: lnstart,
		lnend: lnend,
		lnmethod: lnmethod,
		newmethodtype: newmethodtype
	});

	// Apply the workspace edit
	await workspace.applyEdit(await client.protocol2CodeConverter.asWorkspaceEdit(lspWorkspaceEdit));	

	// Highlight and scroll to new extracted method
	const activeEditor = window.activeTextEditor;
	if (activeEditor.document.uri.toString() === uri) {
		// Selection of the extracted method
		const anchor = lspWorkspaceEdit.changes[uri][0].range.start;
		var methodstring: string = "";
		for (let edit = 0; edit < lspWorkspaceEdit.changes[uri].length-2; edit++) {
			methodstring += lspWorkspaceEdit.changes[uri][edit].newText;
		}
		const methodsize = methodstring.split("\n").length - 1;
		const range: Range = new Range(new Position(anchor.line+1,0),new Position(anchor.line+methodsize,1));
		
		// Selection of the method call
		const anchor2 = lspWorkspaceEdit.changes[uri][lspWorkspaceEdit.changes[uri].length-1].range.start;
		const linesize = lspWorkspaceEdit.changes[uri][lspWorkspaceEdit.changes[uri].length-1].newText.length;
		const range2: Range = new Range(
			new Position(anchor2.line+methodsize+1,anchor2.character),
			new Position(anchor2.line+methodsize+1,anchor2.character+linesize+1)
		);

		// Scroll to the extracted method
		activeEditor.revealRange(range);
		
		// Highlight extracted method and method call
		const color: string = "#ffff0020";	// Transparent yellow 
		const timeout: number = 2000; // Highlight disapears after 2 seconds
		const decoration = window.createTextEditorDecorationType({
			backgroundColor: color
		});
		activeEditor.setDecorations(decoration,[range,range2]);
		await new Promise(r => setTimeout(r, timeout)); 
		setTimeout(function(){decoration.dispose();}, 0); 
	}
}

/**
 * Callback function for the `intersystems.language-server.showSymbolInClass` command.
 */
export async function showSymbolInClass(uri: string, memberType: string, memberName: string) {
	const uriObj = Uri.parse(uri);
	if (!uriObj.path.toLowerCase().endsWith("cls")) {
		return;
	}
	// Find the document symbol for this class member
	const symbols: DocumentSymbol[] = await commands.executeCommand("vscode.executeDocumentSymbolProvider", uriObj);
	if (!symbols) {
		return;
	}
	const symbol = symbols[0].children.find(
		(symbol) => symbol.detail.toLowerCase().includes(memberType.toLowerCase()) && symbol.name === memberName
	);
	if (symbol !== undefined) {
		// Show the symbol in the editor
		let editor = window.visibleTextEditors.find((e) => e.document.uri.toString() === uri);
		if (editor === undefined) {
			editor = await window.showTextDocument(uriObj);
		}
		editor.selection = new Selection(symbol.selectionRange.start, symbol.selectionRange.end);
    	editor.revealRange(symbol.selectionRange, TextEditorRevealType.InCenter);
	}
}
