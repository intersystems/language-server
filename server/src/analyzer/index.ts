import * as fs from "fs";
import * as path from "path";
import { analyzer, AnalyzerInterface } from "./bind";
import { Diagnostic, WorkspaceFolder } from "vscode-languageserver";
import { connection } from '../utils/variables';
import { URI } from 'vscode-uri';

const filename = path.resolve(__dirname, "../lib/analyzer.wasm");

async function loadAnalyzer() {
	try {
		const bits = fs.readFileSync(filename);
		const module = await WebAssembly.compile(bits);

		const service: analyzer.Imports = {};
		const exports = await analyzer._.bind(service, module);

		return exports;
	} catch (rawError) {
		console.log(rawError);
		throw rawError;
	}
}

export type Arg = AnalyzerInterface.Arg;
export type MethodInfo = AnalyzerInterface.MethodInfo;
export type ParameterInfo = AnalyzerInterface.ParameterInfo;
export type MemberKind = AnalyzerInterface.MemberKind;
export type MemberInfo = AnalyzerInterface.MemberInfo;
export type ClassInfo = AnalyzerInterface.ClassInfo;
export type AnalysisErr = AnalyzerInterface.AnalysisErr;

const wasm = loadAnalyzer();

export type AnalyzeResult = ClassInfo | { error: Diagnostic[] };

const analyzedFolders = new Map<string, AnalyzerInterface.Workspace>();

async function currentFolder(filePath: string): Promise<WorkspaceFolder | undefined> {
	try {
		const folders = await connection.workspace.getWorkspaceFolders();
		console.log("getWorkspaceFolders returned:", JSON.stringify(folders));
		console.log("Looking for folder containing:", filePath);
		const found = folders?.find((folder) => {
			const folderPath = URI.parse(folder.uri).fsPath;
			const rel = path.relative(folderPath, filePath);
			console.log(`  Checking folder ${folderPath}, rel=${rel}`);
			return !rel.startsWith("..") && !path.isAbsolute(rel);
		});
		console.log("Found folder:", JSON.stringify(found));
		return found;
	} catch (e) {
		console.log("getWorkspaceFolders error:", e);
		return undefined;
	}
}

async function currentWorkspace(folder: WorkspaceFolder): Promise<AnalyzerInterface.Workspace.Interface> {
	let analyzedFolder = analyzedFolders.get(folder.uri);
	if (!analyzedFolder) {
		analyzedFolder = new (await wasm).analyzerInterface.Workspace();
		analyzedFolders.set(folder.uri, analyzedFolder);
	}
	return analyzedFolder
}

export async function analyzeCls(filePath: string, src: string, folder?: WorkspaceFolder): Promise<AnalyzeResult> {
	console.log("Working on file", filePath);
	try {
		folder = folder ?? await currentFolder(filePath);
		const workspace = folder && await currentWorkspace(folder);
		if (!workspace) {
			return {
				error: [{
					message: "No workspace found",
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 0 }
					},
				}],
			};
		}
		return workspace.insertCls(filePath, src);
	} catch (rawError) {
		console.log(rawError);
		return { error: [] }
		// const error = rawError["cause"]["_value"] as AnalyzerInterface.ParseErr;
		// return {
		// 	error: [
		// 		{
		// 			...error,
		// 			severity: DiagnosticSeverity.Information,
		// 			source: "InterSystems Language Server",
		// 		},
		// 	],
		// };
	}
}

export async function completeMethod(src: string) {
	try {
		return (await wasm).analyzerInterface.completeMethod(src);
	} catch (rawError) {
		console.log(rawError);
		return undefined;
	}
}

export async function completeClass(src: string) {
	try {
		return (await wasm).analyzerInterface.completeClass(src);
	} catch (rawError) {
		console.log(rawError);
		return undefined;
	}
}

export async function check(fileURI: URI): Promise<Diagnostic[]> {
	console.log("Checking?")
	try {
		console.log("Checking?")
		const folder = await currentFolder(fileURI.fsPath);
		console.log("Checking?")
		const workspace = folder && await currentWorkspace(folder);
		if (!workspace) {
			return [];
		}
		return workspace.check(fileURI.fsPath);
	} catch (rawError) {
		console.log(rawError);
		return [];
	}
}
