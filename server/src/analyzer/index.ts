import * as fs from "fs";
import * as path from "path";
import { analyzer, AnalyzerInterface } from "./bind";
import { Diagnostic } from "vscode-languageserver";
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

export type MethodInfo = AnalyzerInterface.MethodInfo;
export type ParameterInfo = AnalyzerInterface.ParameterInfo;
export type MemberKind = AnalyzerInterface.MemberKind;
export type MemberInfo = AnalyzerInterface.MemberInfo;
export type ClassInfo = AnalyzerInterface.ClassInfo;
export type AnalysisErr = AnalyzerInterface.AnalysisErr;
export type NormalArg = AnalyzerInterface.NormalArg;
export type ArgMode = AnalyzerInterface.ArgMode;
export const ArgMode = AnalyzerInterface.ArgMode;

const wasm = loadAnalyzer();

export type AnalyzeResult = ClassInfo | { error: Diagnostic[] };

const analyzedFolders = new Map<string, AnalyzerInterface.Workspace>();

export async function analyzeCls(filePath: string, src: string, folderURI?: string): Promise<AnalyzeResult> {
	try {
		const workspace = typeof folderURI === "string" ? await rootURIToAnalyzerWorkspace(folderURI) : await filePathToAnalyzerWorkspace(filePath);
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

export async function check(fileFsPath: string): Promise<Diagnostic[]> {
	try {
		const workspace = await filePathToAnalyzerWorkspace(fileFsPath);
		if (!workspace) {
			return [];
		}
		return workspace.check(fileFsPath);
	} catch (rawError) {
		console.log(rawError);
		return [];
	}
}

export async function filePathToAnalyzerWorkspace(filePath: string): Promise<AnalyzerInterface.Workspace.Interface> {
	const folders = await connection.workspace.getWorkspaceFolders();
	const folder = folders?.find((folder) => {
		const folderPath = URI.parse(folder.uri).fsPath;
		const rel = path.relative(folderPath, filePath);
		return !rel.startsWith("..") && !path.isAbsolute(rel);
	});
	return (
		(folder && rootURIToAnalyzerWorkspace(folder.uri)) ||
		rootURIToAnalyzerWorkspace(filePath)
	);
}

async function rootURIToAnalyzerWorkspace(folderURI: string): Promise<AnalyzerInterface.Workspace.Interface> {
	let analyzedFolder = analyzedFolders.get(folderURI);
	if (!analyzedFolder) {
		analyzedFolder = new (await wasm).analyzerInterface.Workspace();
		analyzedFolders.set(folderURI, analyzedFolder);
	}
	return analyzedFolder
}

export async function getAnalyzedClass(context: URI, name: string): Promise<[string, ClassInfo] | null> {
	for await (const [uri, cls] of getAnalyzedClasses(context)) {
		if (cls.name.content === name) {
			return [uri, cls];
		}
	}
	return null;
}

export async function* getAnalyzedClasses(context: URI): AsyncGenerator<[string, ClassInfo]> {
	const workspace = await filePathToAnalyzerWorkspace(context.path);
	const classes = workspace.queryCls("");
	for (const x of classes) {
		yield x;
	}
}

export async function getAnalyzedClassMember(
	context: URI,
	clsName: string,
	memName: string
): Promise<[string, MemberInfo] | null> {
	for await (const [uri, mem] of getAnalyzedClassMembers(context, clsName, memName)) {
		if (mem.name.content === memName) {
			return [uri, mem];
		}
	}
	return null;
}

export async function* getAnalyzedClassMembers(
	context: URI,
	clsName: string,
	memQuery: string = "",
	includeExtends: boolean = true
): AsyncGenerator<[string, MemberInfo]> {
	const workspace = await filePathToAnalyzerWorkspace(context.fsPath);
	for (const x of workspace.queryMem(clsName, memQuery)) {
		yield x;
	}
	if (includeExtends) {
		const result = await getAnalyzedClass(context, clsName);
		if (result) {
			const cls = result[1];
			for (const sup of cls.extends) {
				yield* getAnalyzedClassMembers(context, sup, memQuery);
			}
		}
	}
}


