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
import { ServerSpec } from "../utils/types";

// How long "this folder has no server" is believed before asking the client again. Every
// out-of-workspace class ascot meets is a lookup here; without this, each one was a client
// round trip that resolved to nothing.
const NO_SERVER_TTL_MS = 30 * 1000;
const SERVER_LOOKUP_TIMEOUT_MS = 5 * 1000;

// The two Atelier REST requests ascot resolves out-of-workspace classes and routines with;
// in-workspace ones are served from ascot's own memory and never reach here. ascot caches what
// it finds; a request that throws leaves what it was for taken on trust, saying why.
class RestAtelier extends Ascot.Atelier {
	private noServerUntil = 0;

	constructor(private readonly folderURI: string) {
		super();
	}

	/** The configuration may have changed: ask the client again on the next lookup. */
	public forgetNoServer(): void {
		this.noServerUntil = 0;
	}

	private async server(): Promise<ServerSpec> {
		if (Date.now() >= this.noServerUntil) {
			// Every ascot call is queued behind the previous one, so a client that never answers
			// the server lookup would freeze all of them; give up on it after a while.
			const server = await Promise.race([
				getServerSpec(this.folderURI),
				new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), SERVER_LOOKUP_TIMEOUT_MS)),
			]);
			if (server !== undefined) return server;
			this.noServerUntil = Date.now() + NO_SERVER_TTL_MS;
			trace(`no server for ${this.folderURI}; not asking again for ${NO_SERVER_TTL_MS / 1000}s`);
		}
		throw new Error(`no server connection for ${shortUri(this.folderURI)}`);
	}

	public query(sql: string, params: string[]): Promise<string> {
		return traceCall(
			"← query",
			`${/FROM\s+([\w%.]+)/.exec(sql)?.[1]} ${[...new Set(params)].join(" ")}`,
			async () => {
				const respdata = await makeRESTRequest("POST", 1, "/action/query", await this.server(), {
					query: sql,
					parameters: params,
				});
				const rows = respdata?.data?.result?.content;
				if (!Array.isArray(rows)) throw new Error(respdata?.data?.status?.summary || "the REST request failed");
				return JSON.stringify(rows);
			},
			(rows) => `${rows.length} chars`,
		);
	}

	public getDoc(name: string): Promise<string | undefined> {
		return traceCall(
			"← getDoc",
			name,
			async () => {
				const respdata = await makeRESTRequest("GET", 1, `/doc/${name}`, await this.server());
				if (respdata === undefined) throw new Error("the REST request failed");
				const lines = respdata.data?.result?.content;
				return Array.isArray(lines) ? lines.join("\n") : undefined;
			},
			(text) => (text === undefined ? "not found" : `${text.length} chars`),
		);
	}
}

export type NormalArg = Ascot.NormalArg;
export type MemberInfo = Ascot.MemberInfo;
export type PropertyInfo = Ascot.PropertyInfo;

/** Prefix marking a hover/completion/symbol result as sourced from ascot rather than a REST query. */
export const ascot = `[👔] `;

const workspaces = new Map<string, Ascot.Workspace>();
const connections = new Map<string, RestAtelier>();

// Tracing of every call across the server/ascot boundary -- the server's calls into the wasm
// `Workspace` (→) and the wasm's calls back into `Atelier` (←) -- to the client's
// "InterSystems Language Server" output channel. ascot runs → calls strictly one at a time
// (see the package's `serialize`), so a call that logs a start but never a finish is the one
// everything behind it is stuck on; `ahead` says how many that is.
//
// The setting can't be read until the client says `initialized`, which is after the startup
// scan; lines from before then are buffered and flushed (or dropped) once it's known.
let traceEnabled: boolean | undefined;
let traceBuffer: string[] = [];
const TRACE_BUFFER_MAX = 20_000;
let traceSeq = 0;
let callsInFlight = 0;

/** Re-read `intersystems.language-server.ascot.trace`; call once initialized and on every change. */
export async function refreshTrace(): Promise<void> {
	traceEnabled = (await connection.workspace.getConfiguration("intersystems.language-server.ascot.trace")) === true;
	if (traceEnabled) for (const line of traceBuffer) connection.console.log(line);
	traceBuffer = [];
}

function emit(line: string): void {
	if (traceEnabled === undefined) {
		if (traceBuffer.length < TRACE_BUFFER_MAX) traceBuffer.push(line);
	} else if (traceEnabled) {
		connection.console.log(line);
	}
}

function trace(message: string): void {
	emit(`[ascot] ${message}`);
}

function traceCall<T>(
	tag: string,
	detail: string,
	run: () => Promise<T>,
	summarize: (result: T) => string,
): Promise<T> {
	if (traceEnabled === false) return run();
	const id = ++traceSeq;
	const start = Date.now();
	const outbound = tag.startsWith("→");
	const ahead = outbound && callsInFlight ? ` (${callsInFlight} ahead)` : "";
	emit(`[ascot] #${id} ${tag} ${detail}${ahead}`);
	if (outbound) callsInFlight++;
	return run().then(
		(result) => {
			if (outbound) callsInFlight--;
			emit(`[ascot] #${id} ${tag} ${Date.now() - start}ms: ${summarize(result)}`);
			return result;
		},
		(error) => {
			if (outbound) callsInFlight--;
			emit(`[ascot] #${id} ${tag} ${Date.now() - start}ms: threw ${error}`);
			throw error;
		},
	);
}

function shortUri(uri: string): string {
	return decodeURIComponent(uri.slice(uri.lastIndexOf("/") + 1));
}

function describeArgs(method: string, args: unknown[]): string {
	if (method === "open") return `${shortUri(args[0] as string)} <${(args[1] as string).length} chars>`;
	return args
		.map((arg) => {
			if (typeof arg === "string") return shortUri(arg);
			if (typeof arg !== "object" || arg === null) return String(arg);
			if ("line" in arg) return `${(arg as Ascot.Position).line}:${(arg as Ascot.Position).character}`;
			if ("start" in arg) {
				const { start, end } = arg as Ascot.Range;
				return `${start.line}:${start.character}-${end.line}:${end.character}`;
			}
			return JSON.stringify(arg);
		})
		.join(" ");
}

function summarize(result: unknown): string {
	if (result === undefined || result === null) return "nothing";
	if (Array.isArray(result)) return `${result.length} item(s)`;
	if (typeof result === "string") return `${result.length} chars`;
	if (typeof result === "object" && "uri" in result && "range" in result) {
		const { uri, range } = result as Ascot.Location;
		return `${shortUri(uri)} ${range.start.line}:${range.start.character}`;
	}
	return typeof result;
}

/** `workspace` with every method call logged through `traceCall`. */
function traced(workspace: Ascot.Workspace): Ascot.Workspace {
	return new Proxy(workspace, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof value !== "function" || typeof prop !== "string") return value;
			return (...args: unknown[]) =>
				traceCall(`→ ${prop}`, describeArgs(prop, args), () => value.apply(target, args), summarize);
		},
	});
}

// The startup scan of the workspace folders. Requests for a document wait for it: a check run
// against a half-loaded workspace reports its includes and referenced classes as missing, and
// since ascot records no dependency on a name it couldn't find, opening them later wouldn't
// invalidate that result.
let startupScan: Promise<void> = Promise.resolve();
let startupScanDone = true;

export function setStartupScan(scan: Promise<void>): void {
	startupScanDone = false;
	const start = Date.now();
	startupScan = scan.finally(() => {
		startupScanDone = true;
		trace(`startup scan finished after ${Date.now() - start}ms`);
	});
}

/** Configuration changed: every folder's connection may now resolve to a server. */
export function onConfigurationChanged(): void {
	for (const connection of connections.values()) connection.forgetNoServer();
	refreshTrace();
}

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
// extension). Doubles as both open and edit. Returns the uris (this one included) whose
// cached analysis is now stale -- a document this one is included by or referenced from.
export async function openDoc(docURI: string, src: string, folderURI?: string): Promise<string[]> {
	try {
		const workspace =
			typeof folderURI === "string" ? await rootURIToWorkspace(folderURI) : await filePathToWorkspace(docURI);
		return await workspace.open(docURI, src);
	} catch (rawError) {
		console.log(rawError);
		return [];
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
			code: d.code || undefined,
			codeDescription: d.codeDescription ? { href: d.codeDescription } : undefined,
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
	if (!startupScanDone) trace(`${shortUri(docURI)}: waiting for the startup scan`);
	await startupScan;
	const folders = await connection.workspace.getWorkspaceFolders();
	const folder = folders?.find((f) => docURI.startsWith(f.uri));
	return rootURIToWorkspace(folder?.uri ?? docURI);
}

async function rootURIToWorkspace(folderURI: string): Promise<Ascot.Workspace> {
	let workspace = workspaces.get(folderURI);
	if (!workspace) {
		const connection = new RestAtelier(folderURI);
		workspace = traced(await Ascot.createWorkspace(connection));
		workspaces.set(folderURI, workspace);
		connections.set(folderURI, connection);
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
