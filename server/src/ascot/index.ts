import * as fs from "fs";
import * as path from "path";
import { instantiate, Root } from "./generated/ascot.js";
import type * as wit from "./generated/interfaces/iris-ascot-common.js";
import {
	Diagnostic,
	DiagnosticSeverity,
	DocumentSymbol,
	SymbolInformation,
	SymbolKind as LspSymbolKind,
	SymbolTag,
} from "vscode-languageserver";
import { connection } from "../utils/variables";
import {
	getServerSpec,
	makeRESTRequest,
	buildMemberMetadataQuery,
	buildSuperclassesQuery,
	buildClassTypeQuery,
	resolveStubbedMethod,
	MemberMetadataRow,
} from "../utils/functions";
import { URI } from "vscode-uri";

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
		private readonly datatypeCache = new Map<string, [number, boolean | undefined]>(),
	) {}

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
				? rows[0].Super.split(",")
						.map((s: string) => s.trim())
						.filter(Boolean)
				: [];
		this.superCache.set(cls, [Date.now(), supers]);
		return supers;
	}

	// Whether a class outside the workspace is a datatype. IRIS's compiled
	// ClassType already resolves both the [ ClassType = datatype ] keyword and
	// inheritance from %Library.DataType. Returns undefined when unknown (no
	// server, or the class isn't found).
	public async isDatatype(cls: string): Promise<boolean | undefined> {
		const cached = this.datatypeCache.get(cls);
		if (cached && Date.now() - cached[0] < CACHE_TTL_MS) return cached[1];
		const server = await getServerSpec(this.folderURI);
		if (server === undefined) return undefined;
		const respdata = await makeRESTRequest("POST", 1, "/action/query", server, buildClassTypeQuery(cls));
		const rows = respdata?.data?.result?.content;
		const isDatatype = Array.isArray(rows) && rows.length > 0 ? rows[0]?.ClassType === "datatype" : undefined;
		this.datatypeCache.set(cls, [Date.now(), isDatatype]);
		return isDatatype;
	}
}

function rowToMemberInfo(mem: string, row: MemberMetadataRow): MemberInfo {
	return {
		doc: row.Description ?? "",
		before: ORIGIN,
		name: { before: ORIGIN, content: mem, after: ORIGIN },
		deprecated: row.Deprecated == "1",
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
			return { tag: row.ClassMethod == "1" ? "class-method" : "method", val };
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
		if (s.startsWith("*")) {
			mode = "output";
			s = s.slice(1);
		} else if (s.startsWith("&")) {
			mode = "by-ref";
			s = s.slice(1);
		}

		let name = "",
			type = "",
			def = "";
		let stage: "name" | "type" | "default" = "name";
		let depth = 0,
			inQuote = false;
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
				stage = "type";
				continue;
			} else if (depth === 0 && stage !== "default" && c === "=") {
				stage = "default";
				continue;
			}
			if (stage === "name") name += c;
			else if (stage === "type") type += c;
			else def += c;
		}

		const t = type || undefined;
		if (name.endsWith("...")) {
			variadic = { mode, name: name.slice(0, -3), t };
		} else {
			normal.push({ mode, name, t, default: def || undefined });
		}
	}
	return { normal, variadic };
}

function splitTopLevel(spec: string): string[] {
	const out: string[] = [];
	let cur = "",
		depth = 0,
		inQuote = false;
	for (const c of spec) {
		if (inQuote) {
			cur += c;
			if (c === '"') inQuote = false;
		} else if (c === '"') {
			inQuote = true;
			cur += c;
		} else if (c === "(") {
			depth++;
			cur += c;
		} else if (c === ")") {
			depth--;
			cur += c;
		} else if (c === "," && depth === 0) {
			out.push(cur);
			cur = "";
		} else {
			cur += c;
		}
	}
	if (cur.trim() !== "") out.push(cur);
	return out;
}

async function loadAnalyzer(): Promise<Root> {
	const imports = {
		"iris:ascot/common": {},
		"iris:ascot/imported": { IrisConnection },
	};
	return instantiate(getCoreModule, imports as never);
}

export type MethodInfo = wit.MethodInfo;
export type ParameterInfo = wit.ParameterInfo;
export type MemberKind = wit.MemberKind;
export type MemberInfo = wit.MemberInfo;
export type ClassInfo = wit.ClassInfo;
export type NormalArg = wit.NormalArg;
export type ArgMode = wit.ArgMode;

/** Prefix marking a hover/completion/symbol result as sourced from ascot rather than a REST query. */
export const ascot = `[🧣] `;

const wasm = loadAnalyzer();

type WorkspaceInstance = InstanceType<Root["exported"]["Workspace"]>;

// jco's jspi async-mode glue supports only one in-flight (possibly-suspended) call into
// a given component instance at a time -- a second call overlapping the first (e.g. a
// diagnostics() and an inlayHint() both mid-flight, each awaiting their own getMem REST
// round trip) trips its "component should have been exclusively locked" check. Every
// `Workspace` (one per folder) is a resource of the same single instantiated `wasm`
// component, so the queue below is shared module-wide, not per-instance -- otherwise two
// different folders' workspaces could still overlap and trip the same check.
let tail: Promise<void> = Promise.resolve();

function serialize(instance: WorkspaceInstance): WorkspaceInstance {
	return new Proxy(instance, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof value !== "function") return value;
			return async (...args: unknown[]) => {
				const prev = tail;
				let release!: () => void;
				tail = new Promise<void>((r) => (release = r));
				await prev;
				try {
					return await value.apply(target, args);
				} finally {
					release();
				}
			};
		},
	});
}

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
		source: "Ascot via InterSystems Language Server",
	};
}

function convertSymbolKind(kind: wit.SymbolKind): LspSymbolKind {
	switch (kind) {
		case "class":
			return LspSymbolKind.Class;
		case "method":
			return LspSymbolKind.Method;
		case "property":
			return LspSymbolKind.Property;
		case "interface":
			return LspSymbolKind.Interface;
		case "function":
			return LspSymbolKind.Function;
		case "constant":
			return LspSymbolKind.Constant;
		case "array":
			return LspSymbolKind.Array;
		case "object":
			return LspSymbolKind.Object;
		case "key":
			return LspSymbolKind.Key;
		case "struct":
			return LspSymbolKind.Struct;
		case "event":
			return LspSymbolKind.Event;
	}
}

function convertSymbolInfo(info: wit.SymbolInfo): DocumentSymbol {
	return {
		name: ascot + info.name,
		kind: convertSymbolKind(info.kind),
		tags: info.deprecated ? [SymbolTag.Deprecated] : [],
		range: info.range,
		selectionRange: info.selectionRange,
	};
}

// Stores the raw source; no parsing happens here (kind is inferred from `docURI`'s
// extension). Doubles as both open and edit.
export async function openDoc(docURI: string, src: string, folderURI?: string): Promise<void> {
	try {
		const workspace =
			typeof folderURI === "string"
				? await rootURIToAnalyzerWorkspace(folderURI)
				: await filePathToAnalyzerWorkspace(docURI);
		await workspace?.open(docURI, src);
	} catch (rawError) {
		console.log(rawError);
	}
}

export async function closeDoc(docURI: string): Promise<void> {
	try {
		const workspace = await filePathToAnalyzerWorkspace(docURI);
		await workspace?.close(docURI);
	} catch (rawError) {
		console.log(rawError);
	}
}

export async function getDiagnostics(docURI: string): Promise<Diagnostic[]> {
	try {
		const workspace = await filePathToAnalyzerWorkspace(docURI);
		if (!workspace) {
			return [];
		}
		return (await workspace.diagnostics(docURI)).map(convertDiagnostic);
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

export async function getDefinition(docURI: string, position: wit.Position): Promise<wit.Location | undefined> {
	try {
		const workspace = await filePathToAnalyzerWorkspace(docURI);
		return await workspace?.definition(docURI, position);
	} catch (rawError) {
		console.log(rawError);
		return undefined;
	}
}

export async function getReferences(
	docURI: string,
	position: wit.Position,
	includeDeclaration: boolean,
): Promise<wit.Location[]> {
	try {
		const workspace = await filePathToAnalyzerWorkspace(docURI);
		if (!workspace) {
			return [];
		}
		return await workspace.references(docURI, position, includeDeclaration);
	} catch (rawError) {
		console.log(rawError);
		return [];
	}
}

export async function filePathToAnalyzerWorkspace(docURI: string): Promise<WorkspaceInstance> {
	const folders = await connection.workspace.getWorkspaceFolders();
	const folder = folders?.find((folder) => docURI.startsWith(folder.uri));
	return (folder && rootURIToAnalyzerWorkspace(folder.uri)) || rootURIToAnalyzerWorkspace(docURI);
}

async function rootURIToAnalyzerWorkspace(folderURI: string): Promise<WorkspaceInstance> {
	let analyzedFolder = analyzedFolders.get(folderURI);
	if (!analyzedFolder) {
		analyzedFolder = serialize(new (await wasm).exported.Workspace(new IrisConnection(folderURI)));
		analyzedFolders.set(folderURI, analyzedFolder);
	}
	return analyzedFolder;
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
	memName: string,
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
	includeExtends: boolean = true,
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

// The class declared in `docURI`, and its members, as a `textDocument/documentSymbol` outline.
export async function getDocumentSymbol(docURI: string): Promise<DocumentSymbol[]> {
	try {
		const workspace = await filePathToAnalyzerWorkspace(docURI);
		const classSymbol = await workspace?.documentSymbol(docURI);
		if (!classSymbol) return [];
		return [
			{
				...convertSymbolInfo(classSymbol.class),
				children: classSymbol.members.map(convertSymbolInfo),
			},
		];
	} catch (rawError) {
		console.log(rawError);
		return [];
	}
}

// Classes and members in `context`'s workspace folder whose name starts with `query`, as a
// `workspace/symbol` result.
export async function getWorkspaceSymbol(context: URI, query: string): Promise<SymbolInformation[]> {
	try {
		const workspace = await filePathToAnalyzerWorkspace(context.toString());
		const symbols = (await workspace?.workspaceSymbol(query)) ?? [];
		return symbols.map((symbol) => ({
			name: ascot + symbol.name,
			kind: convertSymbolKind(symbol.kind),
			tags: symbol.deprecated ? [SymbolTag.Deprecated] : [],
			location: symbol.location,
		}));
	} catch (rawError) {
		console.log(rawError);
		return [];
	}
}
