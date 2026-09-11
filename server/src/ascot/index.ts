import * as Ascot from "@intersystems-community/ascot";
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

const ORIGIN: Ascot.Position = { line: 0, character: 0 };
const CACHE_TTL_MS = 60 * 60 * 1000;

interface MemberMetadataRow {
	Name: string;
	Aliases: string;
	MemberType: "method" | "property" | "parameter";
	Description: string;
	FormalSpec: string;
	ReturnType: string;
	Collection: string | null;
	Stub: string;
	ClassMethod: "0" | "1" | 0 | 1;
	Deprecated: "0" | "1" | 0 | 1;
	Origin: string;
}

interface ClassMetadataRow {
	Description: string;
	Super: string;
	PropertyClass: string;
	ClassType: string;
	IncludeCode: string;
	Deprecated: "0" | "1" | 0 | 1;
}

// Resolves members/superclasses/datatype-ness for out-of-workspace classes via REST;
// in-workspace classes are served from ascot's own memory and never reach here.
class IrisConnection implements Ascot.Imported {
	constructor(
		private readonly folderURI: string,
		private readonly clsCache = new Map<string, [number, Ascot.ClassInfo | undefined]>(),
		private readonly routineCache = new Map<string, [number, Ascot.RoutineSource | undefined]>(),
	) {}

	// ascot declares this sync; jspi's WebAssembly.Suspending lets this async body await
	// a REST call while ascot itself still sees a plain sync return. `cls`'s own (not
	// inherited) members, superclasses, and other class-level metadata, in one round trip.
	public async getCls(cls: string): Promise<Ascot.ClassInfo | undefined> {
		const cached = this.clsCache.get(cls);
		if (cached && Date.now() - cached[0] < CACHE_TTL_MS) return cached[1];
		const server = await getServerSpec(this.folderURI);
		if (server === undefined) return undefined;

		const clsdata = await makeRESTRequest("POST", 1, "/action/query", server, {
			query:
				"SELECT Description, Super, PropertyClass, ClassType, IncludeCode, Deprecated FROM %Dictionary.CompiledClass WHERE Name = ?",
			parameters: [cls],
		});
		const clsrows: ClassMetadataRow[] | undefined = clsdata?.data?.result?.content;
		if (!Array.isArray(clsrows) || clsrows.length === 0) {
			this.clsCache.set(cls, [Date.now(), undefined]);
			return undefined;
		}
		const clsrow = clsrows[0];

		const memdata = await makeRESTRequest("POST", 1, "/action/query", server, {
			query:
				"SELECT Name, NULL AS Aliases, 'method' AS MemberType, Description, FormalSpec, ReturnType, NULL AS Collection, Stub, ClassMethod, Deprecated, Origin " +
				"FROM %Dictionary.CompiledMethod WHERE Parent = ? UNION ALL " +
				"SELECT Name, Aliases, 'property' AS MemberType, Description, NULL AS FormalSpec, Type AS ReturnType, Collection, " +
				"NULL AS Stub, 0 AS ClassMethod, Deprecated, Origin FROM %Dictionary.CompiledProperty WHERE Parent = ? UNION ALL " +
				"SELECT Name, NULL AS Aliases, 'parameter' AS MemberType, Description, NULL AS FormalSpec, Type AS ReturnType, NULL AS Collection, " +
				"NULL AS Stub, 0 AS ClassMethod, Deprecated, Origin FROM %Dictionary.CompiledParameter WHERE Parent = ?",
			parameters: [cls, cls, cls],
		});
		const memrows: MemberMetadataRow[] = memdata?.data?.result?.content ?? [];
		const members = await Promise.all(
			memrows.filter((row) => row.Name).map((row) => memberRowToInfo(server, cls, row)),
		);

		const info: Ascot.ClassInfo = {
			doc: clsrow.Description ?? "",
			name: { before: ORIGIN, content: cls, after: ORIGIN },
			extends: splitClasses(clsrow.Super),
			deprecated: clsrow.Deprecated == "1",
			members,
			propertyClassNames: splitClasses(clsrow.PropertyClass),
			includes: splitClasses(clsrow.IncludeCode),
			isDatatype: clsrow.ClassType === "datatype",
		};
		this.clsCache.set(cls, [Date.now(), info]);
		return info;
	}

	// The raw source of an `#include`d name that isn't already open in the workspace (e.g.
	// %occInclude). No uri of our own to offer ascot for these -- they aren't backed by a
	// document this server's client could navigate to.
	public getInc(name: string): Promise<Ascot.RoutineSource | undefined> {
		return this.fetchRoutine(name, ["inc"]);
	}

	// Likewise for a cross-routine call target. The .int first: it is the instance's own macro
	// expansion of the .mac, so ascot has nothing to expand (or include) itself.
	public getIntOrMac(name: string): Promise<Ascot.RoutineSource | undefined> {
		return this.fetchRoutine(name, ["int", "mac"]);
	}

	private async fetchRoutine(name: string, exts: string[]): Promise<Ascot.RoutineSource | undefined> {
		const key = `${name}.${exts[0]}`;
		const cached = this.routineCache.get(key);
		if (cached && Date.now() - cached[0] < CACHE_TTL_MS) return cached[1];
		const server = await getServerSpec(this.folderURI);
		if (server === undefined) return undefined;
		let text: string | undefined;
		for (const ext of exts) {
			text = await fetchDoc(server, `${name}.${ext}`);
			if (text !== undefined) break;
		}
		const source = text !== undefined ? { text } : undefined;
		this.routineCache.set(key, [Date.now(), source]);
		return source;
	}
}

async function fetchDoc(
	server: Awaited<ReturnType<typeof getServerSpec>>,
	docName: string,
): Promise<string | undefined> {
	const respdata = await makeRESTRequest("GET", 1, `/doc/${encodeURIComponent(docName)}`, server);
	const lines: string[] | undefined = respdata?.data?.result?.content;
	return Array.isArray(lines) ? lines.join("\n") : undefined;
}

function splitClasses(s: string | undefined): string[] {
	return s
		? s
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: [];
}

// A `list Of`/`array Of` property is the collection object, not its element type.
function collectionType(collection: string | null | undefined): string | undefined {
	switch (collection?.toLowerCase()) {
		case "list":
			return "%Collection.AbstractList";
		case "array":
			return "%Collection.AbstractArray";
		default:
			return undefined;
	}
}

// A property's alias list is a comma-separated %Translate'd string.
function splitAliases(aliases: string | undefined): string[] {
	return aliases
		? aliases
				.split(",")
				.map((alias) => alias.replace(/\s+/g, ""))
				.filter(Boolean)
		: [];
}

async function memberRowToInfo(
	server: Awaited<ReturnType<typeof getServerSpec>>,
	cls: string,
	row: MemberMetadataRow,
): Promise<Ascot.MemberInfo> {
	const aliases = splitAliases(row.Aliases);
	const declaringClass = row.Origin || undefined;
	// A method row with a `Stub` is a compiler-generated accessor (index/query/property/
	// constraint-backed) -- its real metadata lives in a different table, keyed by the
	// stub's `origin.subname.kindchar` segments.
	if (row.MemberType === "method" && row.Stub) {
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
			if (Array.isArray(stubrows) && stubrows.length > 0) row = { ...stubrows[0], Name: row.Name };
		}
	}
	return {
		doc: row.Description ?? "",
		before: ORIGIN,
		name: { before: ORIGIN, content: row.Name, after: ORIGIN },
		aliases,
		deprecated: row.Deprecated == "1",
		kind: rowToMemberKind(row),
		after: ORIGIN,
		origin: declaringClass,
	};

	function rowToMemberKind(row: MemberMetadataRow): Ascot.MemberKind {
		const type = row.ReturnType || undefined;
		switch (row.MemberType) {
			case "property":
				return { tag: "property", val: collectionType(row.Collection) ?? type };
			case "parameter":
				return { tag: "parameter", val: { t: type } };
			default: {
				const { normal, variadic } = parseFormalSpec(row.FormalSpec ?? "");
				const val: Ascot.MethodInfo = { normal, variadic, t: type, body: { start: ORIGIN, end: ORIGIN } };
				return { tag: row.ClassMethod == "1" ? "class-method" : "method", val };
			}
		}
	}

	// Parse IRIS's minified FormalSpec (e.g. `*out:%String,&ref:%Integer,x...`) into the
	// structured args ascot expects. Prefixes: `*` output, `&` by-ref; `:` starts the
	// type, `=` the default; a trailing `...` marks the variadic arg. Types and defaults
	// may contain commas/parens/quotes, so split respecting quote and paren nesting.
	function parseFormalSpec(spec: string): { normal: Ascot.NormalArg[]; variadic?: Ascot.VariadicArg } {
		const normal: Ascot.NormalArg[] = [];
		let variadic: Ascot.VariadicArg | undefined;
		for (const raw of splitTopLevel(spec)) {
			let s = raw.trim();
			if (s === "") continue;
			let mode: Ascot.ArgMode = "default";
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

export type NormalArg = Ascot.NormalArg;
export type MemberInfo = Ascot.MemberInfo;

/** Prefix marking a hover/completion/symbol result as sourced from ascot rather than a REST query. */
export const ascot = `[👔] `;

const workspaces = new Map<string, Ascot.Workspace>();

const severityMap: Record<Ascot.DiagnosticSeverity, DiagnosticSeverity> = {
	error: DiagnosticSeverity.Error,
	warning: DiagnosticSeverity.Warning,
	information: DiagnosticSeverity.Information,
	hint: DiagnosticSeverity.Hint,
};

const symbolKindMap: Record<Ascot.SymbolKind, SymbolKind> = {
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
	fn: (workspace: Ascot.Workspace) => Promise<T> | T,
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

export const inlayHint = (docURI: string, range: Ascot.Range) =>
	withWorkspace(docURI, [] as Ascot.InlayHint[], (w) => w.inlayHint(docURI, range));

export const getDefinition = (docURI: string, position: Ascot.Position) =>
	withWorkspace<Ascot.Location | undefined>(docURI, undefined, (w) => w.definition(docURI, position));

export const getReferences = (docURI: string, position: Ascot.Position, includeDeclaration: boolean) =>
	withWorkspace(docURI, [] as Ascot.Location[], (w) => w.references(docURI, position, includeDeclaration));

export const getHover = (docURI: string, position: Ascot.Position) =>
	withWorkspace<string | undefined>(docURI, undefined, (w) => w.hover(docURI, position));

async function filePathToWorkspace(docURI: string): Promise<Ascot.Workspace> {
	const folders = await connection.workspace.getWorkspaceFolders();
	const folder = folders?.find((f) => docURI.startsWith(f.uri));
	return rootURIToWorkspace(folder?.uri ?? docURI);
}

async function rootURIToWorkspace(folderURI: string): Promise<Ascot.Workspace> {
	let workspace = workspaces.get(folderURI);
	if (!workspace) {
		workspace = await Ascot.createWorkspace(new IrisConnection(folderURI));
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

export async function* getClasses(docURI: string): AsyncGenerator<[string, Ascot.ClassInfo]> {
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
): AsyncGenerator<[string, Ascot.MemberInfo]> {
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

		function convertSymbolInfo(info: Ascot.SymbolInfo): DocumentSymbol {
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
