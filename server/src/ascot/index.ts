import * as fs from "fs";
import * as path from "path";
import { instantiate, Root } from "./generated/ascot.js";
import type * as wit from "./generated/interfaces/iris-ascot-common.js";
import {
	Diagnostic,
	DiagnosticSeverity,
	DocumentSymbol,
	SymbolInformation,
	SymbolKind,
	SymbolTag,
} from "vscode-languageserver";
import { connection } from "../utils/variables";
import { getServerSpec, makeRESTRequest } from "../utils/functions";

const ORIGIN: wit.Position = { line: 0, character: 0 };
const CACHE_TTL_MS = 60 * 60 * 1000;

interface MemberMetadataRow {
	MemberType: "method" | "property" | "parameter";
	Description: string;
	FormalSpec: string;
	ReturnType: string;
	Stub: string;
	ClassMethod: "0" | "1" | 0 | 1;
	Deprecated: "0" | "1" | 0 | 1;
}

// Resolves members/superclasses/datatype-ness for out-of-workspace classes via REST;
// in-workspace classes are served from ascot's own memory and never reach here.
class IrisConnection {
	constructor(
		private readonly folderURI: string,
		private readonly memCache = new Map<string, [number, wit.MemberInfo]>(),
		private readonly superCache = new Map<string, [number, string[]]>(),
		private readonly datatypeCache = new Map<string, [number, boolean | undefined]>(),
		private readonly includeCache = new Map<string, [number, string | undefined]>(),
	) {}

	// WIT declares this sync; jspi's WebAssembly.Suspending lets this async body await
	// a REST call while ascot itself still sees a plain sync return.
	public async getMem(cls: string, mem: string): Promise<wit.MemberInfo | undefined> {
		const key = `${cls}||${mem}`;
		const cached = this.memCache.get(key);
		if (cached && Date.now() - cached[0] < CACHE_TTL_MS) return cached[1];
		const server = await getServerSpec(this.folderURI);
		if (server === undefined) return undefined;
		const nospace = mem.replace(/\s+/g, "");
		// Search all three tables since the kind isn't known up front; columns line up so
		// rows read as a uniform MemberMetadataRow regardless of which table matched.
		const respdata = await makeRESTRequest("POST", 1, "/action/query", server, {
			query:
				"SELECT 'method' AS MemberType, Description, FormalSpec, ReturnType, Stub, ClassMethod, Deprecated " +
				"FROM %Dictionary.CompiledMethod WHERE Parent = ? AND Name = ? UNION ALL " +
				"SELECT 'property' AS MemberType, Description, NULL AS FormalSpec, " +
				"CASE WHEN Collection IS NOT NULL THEN Collection||' Of '||Type ELSE Type END AS ReturnType, " +
				"NULL AS Stub, 0 AS ClassMethod, Deprecated " +
				"FROM %Dictionary.CompiledProperty WHERE Parent = ? AND (Name = ? OR ? %INLIST $LISTFROMSTRING($TRANSLATE(Aliases,' '))) UNION ALL " +
				"SELECT 'parameter' AS MemberType, Description, NULL AS FormalSpec, Type AS ReturnType, " +
				"NULL AS Stub, 0 AS ClassMethod, Deprecated FROM %Dictionary.CompiledParameter WHERE Parent = ? AND Name = ?",
			parameters: [cls, mem, cls, mem, nospace, cls, mem],
		});
		const rows: MemberMetadataRow[] | undefined = respdata?.data?.result?.content;
		if (!Array.isArray(rows) || rows.length === 0) return undefined;
		let row = rows[0];
		if (row.MemberType === "method" && row.Stub) {
			// Stub-generated methods (member inheritance) have their real metadata in a
			// subtable keyed by the Stub's i/q/a/n segments.
			const [origin, subname, kindchar] = row.Stub.split(".");
			const table = { i: "Index", q: "Query", a: "Property", n: "Constraint" }[kindchar];
			if (table) {
				const stubdata = await makeRESTRequest("POST", 1, "/action/query", server, {
					query:
						`SELECT 'method' AS MemberType, Description, FormalSpec, ReturnType, '' AS Stub, ClassMethod, Deprecated ` +
						`FROM %Dictionary.Compiled${table}Method WHERE Name = ? AND parent->Parent = ? AND parent->Name = ?`,
					parameters: [subname, cls, origin],
				});
				const stubrows = stubdata?.data?.result?.content;
				if (Array.isArray(stubrows) && stubrows.length > 0) row = stubrows[0];
			}
		}
		const info: wit.MemberInfo = {
			doc: row.Description ?? "",
			before: ORIGIN,
			name: { before: ORIGIN, content: mem, after: ORIGIN },
			deprecated: row.Deprecated == "1",
			kind: rowToMemberKind(row),
			after: ORIGIN,
		};
		this.memCache.set(key, [Date.now(), info]);
		return info;

		function rowToMemberKind(row: MemberMetadataRow): wit.MemberKind {
			const type = row.ReturnType || undefined;
			switch (row.MemberType) {
				case "property":
					return { tag: "property", val: type };
				case "parameter":
					return { tag: "parameter", val: { t: type } };
				default: {
					const { normal, variadic } = parseFormalSpec(row.FormalSpec ?? "");
					const val: wit.MethodInfo = { normal, variadic, t: type, body: { start: ORIGIN, end: ORIGIN } };
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
	}

	// Direct superclasses, nearest first.
	public async getSupers(cls: string): Promise<string[]> {
		const cached = this.superCache.get(cls);
		if (cached && Date.now() - cached[0] < CACHE_TTL_MS) return cached[1];
		const server = await getServerSpec(this.folderURI);
		if (server === undefined) return [];
		const respdata = await makeRESTRequest("POST", 1, "/action/query", server, {
			query: "SELECT Super FROM %Dictionary.CompiledClass WHERE Name = ?",
			parameters: [cls],
		});
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

	// IRIS's compiled ClassType already resolves both the [ ClassType = datatype ] keyword
	// and inheritance from %Library.DataType; undefined means unknown (no server, or not found).
	public async isDatatype(cls: string): Promise<boolean | undefined> {
		const cached = this.datatypeCache.get(cls);
		if (cached && Date.now() - cached[0] < CACHE_TTL_MS) return cached[1];
		const server = await getServerSpec(this.folderURI);
		if (server === undefined) return undefined;
		const respdata = await makeRESTRequest("POST", 1, "/action/query", server, {
			query: "SELECT ClassType FROM %Dictionary.CompiledClass WHERE Name = ?",
			parameters: [cls],
		});
		const rows = respdata?.data?.result?.content;
		const isDatatype = Array.isArray(rows) && rows.length > 0 ? rows[0]?.ClassType === "datatype" : undefined;
		this.datatypeCache.set(cls, [Date.now(), isDatatype]);
		return isDatatype;
	}

	// Only for includes outside the workspace (e.g. %occInclude); in-workspace ones are
	// already open in ascot's own document store.
	public async getInclude(name: string): Promise<string | undefined> {
		const cached = this.includeCache.get(name);
		if (cached && Date.now() - cached[0] < CACHE_TTL_MS) return cached[1];
		const server = await getServerSpec(this.folderURI);
		if (server === undefined) return undefined;
		const respdata = await makeRESTRequest("GET", 1, `/doc/${encodeURIComponent(name)}.inc`, server);
		const lines: string[] | undefined = respdata?.data?.result?.content;
		const content = Array.isArray(lines) ? lines.join("\n") : undefined;
		this.includeCache.set(name, [Date.now(), content]);
		return content;
	}
}

export type NormalArg = wit.NormalArg;
export type MemberInfo = wit.MemberInfo;

/** Prefix marking a hover/completion/symbol result as sourced from ascot rather than a REST query. */
export const ascot = `[👔] `;

const wasm = (async (): Promise<Root> =>
	instantiate((name) => new WebAssembly.Module(fs.readFileSync(path.resolve(__dirname, "../lib", name))), {
		"iris:ascot/common": {},
		"iris:ascot/imported": { IrisConnection },
	} as never))();

type WorkspaceInstance = InstanceType<Root["exported"]["Workspace"]>;

// jco's jspi glue allows only one in-flight suspended call per component instance --
// overlapping calls (e.g. diagnostics() and inlayHint() both awaiting a REST round trip)
// trip its exclusive-lock check. Every `Workspace` shares the same `wasm` instance, so
// this queue is module-wide, not per-Workspace.
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

const workspaces = new Map<string, WorkspaceInstance>();

const severityMap: Record<wit.DiagnosticSeverity, DiagnosticSeverity> = {
	error: DiagnosticSeverity.Error,
	warning: DiagnosticSeverity.Warning,
	information: DiagnosticSeverity.Information,
	hint: DiagnosticSeverity.Hint,
};

const symbolKindMap: Record<wit.SymbolKind, SymbolKind> = {
	class: SymbolKind.Class,
	module: SymbolKind.Module,
	method: SymbolKind.Method,
	property: SymbolKind.Property,
	interface: SymbolKind.Interface,
	function: SymbolKind.Function,
	constant: SymbolKind.Constant,
	array: SymbolKind.Array,
	object: SymbolKind.Object,
	key: SymbolKind.Key,
	struct: SymbolKind.Struct,
	event: SymbolKind.Event,
};

// Stores the raw source; no parsing happens here (kind is inferred from `docURI`'s
// extension). Doubles as both open and edit.
export async function openDoc(docURI: string, src: string, folderURI?: string): Promise<void> {
	try {
		const workspace =
			typeof folderURI === "string" ? await rootURIToWorkspace(folderURI) : await filePathToWorkspace(docURI);
		await workspace.open(docURI, src);
	} catch (rawError) {
		console.log(rawError);
	}
}

/** Run `fn` against `docURI`'s workspace, logging and falling back to `empty` on any error. */
async function withWorkspace<T>(
	docURI: string,
	empty: T,
	fn: (workspace: WorkspaceInstance) => Promise<T> | T,
): Promise<T> {
	try {
		return await fn(await filePathToWorkspace(docURI));
	} catch (rawError) {
		console.log(rawError);
		return empty;
	}
}

export const closeDoc = (docURI: string) => withWorkspace<void>(docURI, undefined, (w) => void w.close(docURI));

export const getDiagnostics = (docURI: string) =>
	withWorkspace(docURI, [] as Diagnostic[], async (w) =>
		(await w.diagnostics(docURI)).map((d) => ({
			message: d.message,
			range: d.range,
			severity: severityMap[d.severity],
			source: "Ascot via InterSystems Language Server",
		})),
	);

export const inlayHint = (docURI: string, range: wit.Range) =>
	withWorkspace(docURI, [] as wit.InlayHint[], (w) => w.inlayHint(docURI, range));

export const getDefinition = (docURI: string, position: wit.Position) =>
	withWorkspace<wit.Location | undefined>(docURI, undefined, (w) => w.definition(docURI, position));

export const getReferences = (docURI: string, position: wit.Position, includeDeclaration: boolean) =>
	withWorkspace(docURI, [] as wit.Location[], (w) => w.references(docURI, position, includeDeclaration));

export const getHover = (docURI: string, position: wit.Position) =>
	withWorkspace<string | undefined>(docURI, undefined, (w) => w.hover(docURI, position));

async function filePathToWorkspace(docURI: string): Promise<WorkspaceInstance> {
	const folders = await connection.workspace.getWorkspaceFolders();
	const folder = folders?.find((f) => docURI.startsWith(f.uri));
	return rootURIToWorkspace(folder?.uri ?? docURI);
}

async function rootURIToWorkspace(folderURI: string): Promise<WorkspaceInstance> {
	let workspace = workspaces.get(folderURI);
	if (!workspace) {
		workspace = serialize(new (await wasm).exported.Workspace(new IrisConnection(folderURI)));
		workspaces.set(folderURI, workspace);
	}
	return workspace;
}

async function findByName<T extends { name: { content: string } }>(
	entries: AsyncGenerator<[string, T]>,
	name: string,
): Promise<[string, T] | null> {
	for await (const [uri, item] of entries) {
		if (item.name.content === name) return [uri, item];
	}
	return null;
}

const getClass = (docURI: string, name: string) => findByName(getClasses(docURI), name);

export async function* getClasses(docURI: string): AsyncGenerator<[string, wit.ClassInfo]> {
	const workspace = await filePathToWorkspace(docURI);
	const classes = await workspace.queryCls("");
	for (const x of classes) {
		yield x;
	}
}

export const getClassMember = (docURI: string, clsName: string, memName: string) =>
	findByName(getClassMembers(docURI, clsName, memName), memName);

export async function* getClassMembers(
	docURI: string,
	clsName: string,
	memQuery: string = "",
): AsyncGenerator<[string, wit.MemberInfo]> {
	const workspace = await filePathToWorkspace(docURI);
	for (const x of await workspace.queryMem(clsName, memQuery)) {
		yield x;
	}
	const result = await getClass(docURI, clsName);
	if (result) {
		const cls = result[1];
		for (const sup of cls.extends) {
			yield* getClassMembers(docURI, sup, memQuery);
		}
	}
}

export const getDocumentSymbol = (docURI: string) =>
	withWorkspace(docURI, [] as DocumentSymbol[], async (w) => {
		const classSymbol = await w.documentSymbol(docURI);
		return classSymbol
			? [{ ...convertSymbolInfo(classSymbol.root), children: classSymbol.members.map(convertSymbolInfo) }]
			: [];

		function convertSymbolInfo(info: wit.SymbolInfo): DocumentSymbol {
			return {
				name: info.name,
				kind: symbolKindMap[info.kind],
				tags: info.deprecated ? [SymbolTag.Deprecated] : [],
				range: info.range,
				selectionRange: info.selectionRange,
			};
		}
	});

export const getWorkspaceSymbol = (folderURI: string, query: string) =>
	withWorkspace(folderURI, [] as SymbolInformation[], async (w) =>
		(await w.workspaceSymbol(query)).map((symbol) => ({
			name: symbol.name,
			kind: symbolKindMap[symbol.kind],
			tags: symbol.deprecated ? [SymbolTag.Deprecated] : [],
			location: symbol.location,
		})),
	);
