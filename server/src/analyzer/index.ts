import * as fs from "fs";
import * as path from "path";
import * as $wcm from "@vscode/wasm-component-model";
import { analyzer, Common, Exported, Imported } from "./bind";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { connection } from '../utils/variables';
import { URI } from 'vscode-uri';

const filename = path.resolve(__dirname, "../lib/analyzer.wasm");

class IrisConnection extends $wcm.Resource.Default implements Imported.IrisConnection.Interface {
	static $resources = new $wcm.ResourceManager.Default<IrisConnection>();

	constructor() {
		super(IrisConnection.$resources);
	}

	public getMem(cls: string, mem: string): MemberInfo | undefined {
		console.log("getMem", cls, mem)
		return;
	}
}

async function loadAnalyzer() {
	try {
		const bits = fs.readFileSync(filename);
		const module = await WebAssembly.compile(bits);

		const service: analyzer.Imports = {
			imported: {
				IrisConnection
			}
		};
		const exports = await analyzer._.bind(service, module);

		return exports;
	} catch (rawError) {
		console.log(rawError);
		throw rawError;
	}
}

export type MethodInfo = Common.MethodInfo;
export type ParameterInfo = Common.ParameterInfo;
export type MemberKind = Common.MemberKind;
export type MemberInfo = Common.MemberInfo;
export type ClassInfo = Common.ClassInfo;
export type AnalysisErr = Common.AnalysisErr;
export type NormalArg = Common.NormalArg;
export type ArgMode = Common.ArgMode;
export const ArgMode = Common.ArgMode;

const wasm = loadAnalyzer();

export type AnalyzeResult = ClassInfo | { error: Diagnostic[] };

const analyzedFolders = new Map<string, Exported.Workspace>();

function convertDiagnosticSeverity(severity: Common.DiagnosticSeverity): DiagnosticSeverity {
	switch (severity) {
		case Common.DiagnosticSeverity.error:
			return DiagnosticSeverity.Error;
		case Common.DiagnosticSeverity.warning:
			return DiagnosticSeverity.Warning;
		case Common.DiagnosticSeverity.information:
			return DiagnosticSeverity.Information;
		case Common.DiagnosticSeverity.hint:
			return DiagnosticSeverity.Hint;
		default:
			return DiagnosticSeverity.Error;
	}
}

function convertDiagnostic(d: Exported.Diagnostic): Diagnostic {
	return {
		message: d.message,
		range: d.range,
		severity: convertDiagnosticSeverity(d.severity),
		source: "InterSystems Language Server - ObjectScript Analyzer",
	};
}

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
					severity: DiagnosticSeverity.Error,
					source: "InterSystems Language Server - ObjectScript Analyzer",
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
		return (await wasm).exported.completeMethod(src);
	} catch (rawError) {
		console.log(rawError);
		return undefined;
	}
}

export async function completeClass(src: string) {
	try {
		return (await wasm).exported.completeClass(src);
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
		return workspace.check(fileFsPath).map(convertDiagnostic);
	} catch (rawError) {
		console.log(rawError);
		return [];
	}
}

export async function inlayHint(fileFsPath: string, range: Exported.Range): Promise<Exported.InlayHint[]> {
	try {
		const workspace = await filePathToAnalyzerWorkspace(fileFsPath);
		if (!workspace) {
			return [];
		}
		return workspace.inlayHint(fileFsPath, range);
	} catch (rawError) {
		console.log(rawError);
		return [];
	}
}

export async function filePathToAnalyzerWorkspace(filePath: string): Promise<Exported.Workspace.Interface> {
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

async function rootURIToAnalyzerWorkspace(folderURI: string): Promise<Exported.Workspace.Interface> {
	let analyzedFolder = analyzedFolders.get(folderURI);
	if (!analyzedFolder) {
		analyzedFolder = new (await wasm).exported.Workspace(new IrisConnection());
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


