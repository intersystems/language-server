/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from "vscode";
import * as path from "path";

export let doc: vscode.TextDocument;
export let editor: vscode.TextEditor;
export let documentEol: string;
export let platformEol: string;

import { fail } from "assert";

/**
 * Activates the extension
 */
export async function activate(docUri: vscode.Uri): Promise<void> {
  try {
    doc = await vscode.workspace.openTextDocument(docUri);
    editor = await vscode.window.showTextDocument(doc);
    console.log(editor.document.getText());
    await sleep(5000);
  } catch (e) {
    console.log("ERROR", e);
    fail(e);
  }
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const getDocPath = (p: string): string => {
  const dirname = vscode.workspace.workspaceFolders[0].uri.fsPath;
  return path.resolve(dirname, p);
};
export const getDocUri = (p: string): vscode.Uri => {
  return vscode.Uri.file(getDocPath(p));
};

export async function setTestContent(content: string): Promise<boolean> {
  const all = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
  return editor.edit((eb) => eb.replace(all, content));
}
