import * as fs from "fs";
import * as path from "path";
import { instantiate, Root } from "./generated/analyzer.js";
import type * as wit from "./generated/interfaces/iris-objectscript-analyzer-common.js";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { connection } from '../utils/variables';
import {
	getServerSpec,
	makeRESTRequest,
	buildMemberMetadataQuery,
	buildSuperclassesQuery,
	resolveStubbedMethod,
	MemberMetadataRow,
} from '../utils/functions';
import { URI } from 'vscode-uri';

const libDir = path.resolve(__dirname, "../lib");

function getCoreModule(name: string): WebAssembly.Module {
	return new WebAssembly.Module(fs.readFileSync(path.join(libDir, name)));
}

const ORIGIN: wit.Position = { line: 0, character: 0 };
const ZERO_RANGE: wit.Range = { start: ORIGIN, end: ORIGIN };
const CACHE_TTL_MS = 60 * 60 * 1000;

class IrisConnection {
	constructor(
		private readonly folderURI: string,
		private readonly memCache = new Map<string, [number, MemberInfo]>(),
		private readonly superCache = new Map<string, [number, string[]]>(),
	) { }

	// getMem is declared synchronous in the WIT, but jco's --async-mode jspi wraps
	// it in WebAssembly.Suspending so this async body can await a REST request and
	// the analyzer still sees a plain synchronous return. It resolves members of
	// classes outside the workspace (library/system); workspace classes are served
	// from the analyzer's own memory and never reach here.
	public async getMem(cls: string, mem: string): Promise<MemberInfo | undefined> {
		const key = `${cls}||${mem}`;
		const cached = this.memCache.get(key);
		if (cached && Date.now() - cached[0] < CACHE_TTL_MS) return cached[1];
		const server = await getServerSpec(this.folderURI);
		if (server === undefined) return undefined;
		const data = buildMemberMetadataQuery(cls, mem, "any");
		const respdata = await makeRESTRequest("POST", 1, "/action/query", server, data);
		const rows: MemberMetadataRow[] | undefined = respdata?.data?.result?.content;
		if (!Array.isArray(rows) || rows.length === 0) return undefined;
		let row = rows[0];
		if (row.MemberType === "method" && row.Stub) {
			row = (await resolveStubbedMethod(server, cls, row.Stub)) ?? row;
		}
		const info = rowToMemberInfo(mem, row);
		this.memCache.set(key, [Date.now(), info]);
		return info;
	}

	// Direct superclasses of a class outside the workspace, nearest first.
	public async getSupers(cls: string): Promise<string[]> {
		const cached = this.superCache.get(cls);
		if (cached && Date.now() - cached[0] < CACHE_TTL_MS) return cached[1];
		const server = await getServerSpec(this.folderURI);
		if (server === undefined) return [];
		const respdata = await makeRESTRequest("POST", 1, "/action/query", server, buildSuperclassesQuery(cls));
		const rows = respdata?.data?.result?.content;
		const supers: string[] =
			Array.isArray(rows) && typeof rows[0]?.Super === "string" && rows[0].Super.length
				? rows[0].Super.split(",").map((s: string) => s.trim()).filter(Boolean)
				: [];
		this.superCache.set(cls, [Date.now(), supers]);
		return supers;
	}
}

function rowToMemberInfo(mem: string, row: MemberMetadataRow): MemberInfo {
	return {
		doc: row.Description ?? "",
		before: ORIGIN,
		name: { before: ORIGIN, content: mem, after: ORIGIN },
		deprecated: row.Deprecated === "1",
		kind: rowToMemberKind(row),
		after: ORIGIN,
	};
}

function rowToMemberKind(row: MemberMetadataRow): MemberKind {
	const type = row.ReturnType || undefined;
	switch (row.MemberType) {
		case "property":
			return { tag: "property", val: type };
		case "parameter":
			return { tag: "parameter", val: { t: type } };
		default: {
			const { normal, variadic } = parseFormalSpec(row.FormalSpec ?? "");
			const val: wit.MethodInfo = { normal, variadic, t: type, body: ZERO_RANGE };
			return { tag: row.ClassMethod === "1" ? "class-method" : "method", val };
		}
	}
}

// Parse IRIS's minified FormalSpec (e.g. `*out:%String,&ref:%Integer,x...`) into the
// structured args the WIT expects. Prefixes: `*` output, `&` by-ref; `:` starts the
// type, `=` the default; a trailing `...` marks the variadic arg. Types and defaults
// may contain commas/parens/quotes, so split respecting quote and paren nesting.
function parseFormalSpec(spec: string): { normal: wit.NormalArg[]; variadic?: wit.VariadicArg } {
	const normal: wit.NormalArg[] = [];
	let variadic: wit.VariadicArg | undefined;
	for (const raw of splitTopLevel(spec)) {
		let s = raw.trim();
		if (s === "") continue;
		let mode: wit.ArgMode = "default";
		if (s.startsWith("*")) { mode = "output"; s = s.slice(1); }
		else if (s.startsWith("&")) { mode = "by-ref"; s = s.slice(1); }

		let name = "", type = "", def = "";
		let stage: "name" | "type" | "default" = "name";
		let depth = 0, inQuote = false;
		for (const c of s) {
			if (inQuote) {
				if (c === '"') inQuote = false;
			} else if (c === '"') {
				inQuote = true;
			} else if (c === "(") {
				depth++;
			} else if (c === ")") {
				depth--;
			} else if (depth === 0 && stage === "name" && c === ":") {
				stage = "type"; continue;
			} else if (depth === 0 && stage !== "default" && c === "=") {
				stage = "default"; continue;
			}
			if (stage === "name") name += c;
			else if (stage === "type") type += c;
			else def += c;
		}

		const t = type || undefined;
		if (name.endsWith("...")) {
			variadic = { name: name.slice(0, -3), t };
		} else {
			normal.push({ mode, name, t, default: def || undefined });
		}
	}
	return { normal, variadic };
}

function splitTopLevel(spec: string): string[] {
	const out: string[] = [];
	let cur = "", depth = 0, inQuote = false;
	for (const c of spec) {
		if (inQuote) {
			cur += c;
			if (c === '"') inQuote = false;
		} else if (c === '"') {
			inQuote = true; cur += c;
		} else if (c === "(") {
			depth++; cur += c;
		} else if (c === ")") {
			depth--; cur += c;
		} else if (c === "," && depth === 0) {
			out.push(cur); cur = "";
		} else {
			cur += c;
		}
	}
	if (cur.trim() !== "") out.push(cur);
	return out;
}

async function loadAnalyzer(): Promise<Root> {
	const imports = {
		"iris:objectscript-analyzer/common": {},
		"iris:objectscript-analyzer/imported": { IrisConnection },
	};
	return instantiate(getCoreModule, imports as never);
}

export type MethodInfo = wit.MethodInfo;
export type ParameterInfo = wit.ParameterInfo;
export type MemberKind = wit.MemberKind;
export type MemberInfo = wit.MemberInfo;
export type ClassInfo = wit.ClassInfo;
export type AnalysisErr = wit.AnalysisErr;
export type NormalArg = wit.NormalArg;
export type ArgMode = wit.ArgMode;

const wasm = loadAnalyzer();

export type AnalyzeResult = ClassInfo | { error: Diagnostic[] };

type WorkspaceInstance = InstanceType<Root["exported"]["Workspace"]>;

const analyzedFolders = new Map<string, WorkspaceInstance>();

function convertDiagnosticSeverity(severity: wit.DiagnosticSeverity): DiagnosticSeverity {
	switch (severity) {
		case "error":
			return DiagnosticSeverity.Error;
		case "warning":
			return DiagnosticSeverity.Warning;
		case "information":
			return DiagnosticSeverity.Information;
		case "hint":
			return DiagnosticSeverity.Hint;
		default:
			return DiagnosticSeverity.Error;
	}
}

function convertDiagnostic(d: wit.Diagnostic): Diagnostic {
	return {
		message: d.message,
		range: d.range,
		severity: convertDiagnosticSeverity(d.severity),
		source: "InterSystems Language Server - ObjectScript Analyzer",
	};
}

export async function analyzeCls(docURI: string, src: string, folderURI?: string): Promise<AnalyzeResult> {
	try {
		const workspace = typeof folderURI === "string" ? await rootURIToAnalyzerWorkspace(folderURI) : await filePathToAnalyzerWorkspace(docURI);
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
		return await workspace.insertCls(docURI, src);
	} catch (rawError) {
		console.log(rawError);
		return { error: [] }
	}
}

export async function removeCls(docURI: string): Promise<void> {
	try {
		const workspace = await filePathToAnalyzerWorkspace(docURI);
		workspace?.remove(docURI);
	} catch (rawError) {
		console.log(rawError);
	}
}

export async function completeMethod(src: string) {
	try {
		return await (await wasm).exported.completeMethod(src);
	} catch (rawError) {
		console.log(rawError);
		return undefined;
	}
}

export async function completeClass(src: string) {
	try {
		return await (await wasm).exported.completeClass(src);
	} catch (rawError) {
		console.log(rawError);
		return undefined;
	}
}

export async function check(docURI: string): Promise<Diagnostic[]> {
	try {
		const workspace = await filePathToAnalyzerWorkspace(docURI);
		if (!workspace) {
			return [];
		}
		return (await workspace.check(docURI)).map(convertDiagnostic);
	} catch (rawError) {
		console.log(rawError);
		return [];
	}
}

export async function inlayHint(docURI: string, range: wit.Range): Promise<wit.InlayHint[]> {
	try {
		const workspace = await filePathToAnalyzerWorkspace(docURI);
		if (!workspace) {
			return [];
		}
		return await workspace.inlayHint(docURI, range);
	} catch (rawError) {
		console.log(rawError);
		return [];
	}
}

export async function filePathToAnalyzerWorkspace(docURI: string): Promise<WorkspaceInstance> {
	const folders = await connection.workspace.getWorkspaceFolders();
	const folder = folders?.find((folder) => docURI.startsWith(folder.uri));
	return (
		(folder && rootURIToAnalyzerWorkspace(folder.uri)) ||
		rootURIToAnalyzerWorkspace(docURI)
	);
}

async function rootURIToAnalyzerWorkspace(folderURI: string): Promise<WorkspaceInstance> {
	let analyzedFolder = analyzedFolders.get(folderURI);
	if (!analyzedFolder) {
		analyzedFolder = new (await wasm).exported.Workspace(new IrisConnection(folderURI));
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
	const workspace = await filePathToAnalyzerWorkspace(context.toString());
	const classes = await workspace.queryCls("");
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
	const workspace = await filePathToAnalyzerWorkspace(context.toString());
	for (const x of await workspace.queryMem(clsName, memQuery)) {
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
