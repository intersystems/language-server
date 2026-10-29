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

export type { NormalArg, MemberInfo, PropertyInfo } from "@intersystems-community/ascot";

// How long "this folder has no server" is believed before asking the client again. Every
// out-of-workspace class ascot meets is a lookup here; without this, each one was a client
// round trip that resolved to nothing.
const NO_SERVER_TTL_MS = 30 * 1000;
const SERVER_LOOKUP_TIMEOUT_MS = 5 * 1000;

// The two Atelier REST requests ascot resolves out-of-workspace classes and routines with;
// in-workspace ones are served from ascot's own memory and never reach here. ascot caches what
// it finds; a request that throws leaves what it was for taken on trust, saying why.
class RestAtelier extends Ascot.Atelier {
	noServerUntil = 0;

	constructor(private readonly folderURI: string) {
		super();
	}

	private async server() {
		if (Date.now() >= this.noServerUntil) {
			// Every ascot call is queued behind the previous one, so a client that never answers
			// the server lookup would freeze all of them; give up on it after a while.
			const server = await Promise.race([
				getServerSpec(this.folderURI),
				new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), SERVER_LOOKUP_TIMEOUT_MS)),
			]);
			if (server) return server;
			this.noServerUntil = Date.now() + NO_SERVER_TTL_MS;
		}
		throw new Error(`no server connection for ${this.folderURI}`);
	}

	async query(sql: string, params: string[]): Promise<string> {
		const respdata = await makeRESTRequest("POST", 1, "/action/query", await this.server(), {
			query: sql,
			parameters: params,
		});
		const rows = respdata?.data?.result?.content;
		if (!Array.isArray(rows)) throw new Error(respdata?.data?.status?.summary || "the REST request failed");
		return JSON.stringify(rows);
	}

	async getDoc(name: string): Promise<string | undefined> {
		const respdata = await makeRESTRequest("GET", 1, `/doc/${name}`, await this.server());
		if (!respdata) throw new Error("the REST request failed");
		const lines = respdata.data?.result?.content;
		return Array.isArray(lines) ? lines.join("\n") : undefined;
	}
}

// Tracing of every call across the server/ascot boundary -- the server's calls into the wasm
// `Workspace` (→) and the wasm's calls back into the `Atelier` (←) -- to the client's
// "InterSystems Language Server" output channel. ascot runs → calls strictly one at a time, so a
// call that logs a start but never a finish is the one everything behind it is stuck on.
//
// The setting can't be read until the client says `initialized`, which is after the startup
// scan; lines from before then are buffered until it's known.
let traceEnabled: boolean | undefined;
let traceBuffer: string[] | undefined = [];
let traceSeq = 0;

/** Re-read `intersystems.language-server.ascot.trace`; call once initialized and on every change. */
export async function refreshTrace(): Promise<void> {
	traceEnabled = (await connection.workspace.getConfiguration("intersystems.language-server.ascot.trace")) === true;
	if (traceEnabled) traceBuffer?.forEach((line) => connection.console.log(line));
	traceBuffer = undefined;
}

function trace(line: string): void {
	line = `[ascot] ${line}`;
	if (traceEnabled) connection.console.log(line);
	else if (traceBuffer && traceBuffer.length < 20_000) traceBuffer.push(line);
}

/** `target` with every method call logged through `trace`: `arrow method args`, then its duration and result. */
function traced<T extends object>(target: T, arrow: string): T {
	return new Proxy(target, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof value !== "function" || traceEnabled === false) return value;
			return async (...args: unknown[]) => {
				const id = ++traceSeq;
				const start = Date.now();
				const call = `#${id} ${arrow} ${String(prop)}`;
				trace(`${call} ${describe(args)}`);
				try {
					const result = await value.apply(target, args);
					trace(`${call} ${Date.now() - start}ms: ${describe([result])}`);
					return result;
				} catch (error) {
					trace(`${call} ${Date.now() - start}ms: threw ${error}`);
					throw error;
				}
			};
		},
	});
}

function describe(values: unknown[]): string {
	return values
		.map((value) => {
			if (typeof value === "string") {
				return value.length > 80 ? `<${value.length} chars>` : value.slice(value.lastIndexOf("/") + 1);
			}
			const json = JSON.stringify(value, (_, x) =>
				x && typeof x === "object" && "line" in x ? `${x.line}:${x.character}` : x,
			);
			if (json === undefined) return "nothing";
			if (json.length <= 80) return json;
			return Array.isArray(value) ? `${value.length} item(s)` : `${json.slice(0, 80)}…`;
		})
		.join(" ");
}

// The startup scan of the workspace folders. Requests for a document wait for it: a check run
// against a half-loaded workspace reports its includes and referenced classes as missing, and
// since ascot records no dependency on a name it couldn't find, opening them later wouldn't
// invalidate that result.
let startupScan = Promise.resolve();

export function setStartupScan(scan: Promise<void>): void {
	const start = Date.now();
	startupScan = scan.then(() => trace(`startup scan finished after ${Date.now() - start}ms`));
}

/** Configuration changed: every folder's connection may now resolve to a server. */
export function onConfigurationChanged(): void {
	for (const atelier of ateliers.values()) atelier.noServerUntil = 0;
	refreshTrace();
}

const workspaces = new Map<string, Promise<Ascot.Workspace>>();
const ateliers = new Map<string, RestAtelier>();

function rootURIToWorkspace(folderURI: string): Promise<Ascot.Workspace> {
	let workspace = workspaces.get(folderURI);
	if (!workspace) {
		const atelier = new RestAtelier(folderURI);
		ateliers.set(folderURI, atelier);
		workspace = Ascot.createWorkspace(traced(atelier, "←")).then((w) => traced(w, "→"));
		workspaces.set(folderURI, workspace);
	}
	return workspace;
}

async function filePathToWorkspace(docURI: string): Promise<Ascot.Workspace> {
	await startupScan;
	const folders = await connection.workspace.getWorkspaceFolders();
	return rootURIToWorkspace(folders?.find((f) => docURI.startsWith(f.uri))?.uri ?? docURI);
}

// Stores the raw source; no parsing happens here (kind is inferred from `docURI`'s
// extension). Doubles as both open and edit. Returns the uris (this one included) whose
// cached analysis is now stale -- a document this one is included by or referenced from.
export async function openDoc(docURI: string, src: string, folderURI?: string): Promise<string[]> {
	try {
		const workspace = await (folderURI ? rootURIToWorkspace(folderURI) : filePathToWorkspace(docURI));
		return await workspace.open(docURI, src);
	} catch (error) {
		console.log(error);
		return [];
	}
}

/** Run `fn` against `docURI`'s workspace, logging and falling back to `empty` on any error. */
async function withWorkspace<T>(docURI: string, empty: T, fn: (workspace: Ascot.Workspace) => Promise<T>): Promise<T> {
	try {
		return await fn(await filePathToWorkspace(docURI));
	} catch (error) {
		console.log(error);
		return empty;
	}
}

export const closeDoc = (docURI: string) => withWorkspace(docURI, [] as string[], (w) => w.close(docURI));

export const inlayHint = (docURI: string, range: Ascot.Range) =>
	withWorkspace(docURI, [] as Ascot.InlayHint[], (w) => w.inlayHint(docURI, range));

export const getDefinition = (docURI: string, position: Ascot.Position) =>
	withWorkspace<Ascot.Location | undefined>(docURI, undefined, (w) => w.definition(docURI, position));

export const getReferences = (docURI: string, position: Ascot.Position, includeDeclaration: boolean) =>
	withWorkspace(docURI, [] as Ascot.Location[], (w) => w.references(docURI, position, includeDeclaration));

export const getHover = (docURI: string, position: Ascot.Position) =>
	withWorkspace<string | undefined>(docURI, undefined, (w) => w.hover(docURI, position));

// LSP's severities 1-4, in order.
const SEVERITIES: Ascot.DiagnosticSeverity[] = ["error", "warning", "information", "hint"];

export const getDiagnostics = (docURI: string) =>
	withWorkspace(docURI, [] as Diagnostic[], async (w) =>
		(await w.diagnostics(docURI)).map((d) => ({
			message: d.message,
			range: d.range,
			severity: (SEVERITIES.indexOf(d.severity) + 1) as DiagnosticSeverity,
			code: d.code || undefined,
			codeDescription: d.codeDescription ? { href: d.codeDescription } : undefined,
			source: "Ascot via InterSystems Language Server",
		})),
	);

// ascot's symbol kinds are LSP's, lowercased.
function toSymbol({ name, kind, deprecated }: Ascot.SymbolInfo | Ascot.WorkspaceSymbol) {
	return {
		name,
		kind: SymbolKind[(kind[0].toUpperCase() + kind.slice(1)) as keyof typeof SymbolKind],
		tags: deprecated ? [SymbolTag.Deprecated] : [],
	};
}

export const getDocumentSymbol = (docURI: string) =>
	withWorkspace(docURI, [] as DocumentSymbol[], async (w) => {
		const toDocumentSymbol = (s: Ascot.SymbolInfo): DocumentSymbol => ({
			...toSymbol(s),
			range: s.range,
			selectionRange: s.selectionRange,
		});
		const symbol = await w.documentSymbol(docURI);
		return symbol ? [{ ...toDocumentSymbol(symbol.root), children: symbol.members.map(toDocumentSymbol) }] : [];
	});

export const getWorkspaceSymbol = (folderURI: string, query: string) =>
	withWorkspace(folderURI, [] as SymbolInformation[], async (w) =>
		(await w.workspaceSymbol(query)).map((s) => ({ ...toSymbol(s), location: s.location })),
	);

export async function* getClasses(docURI: string): AsyncGenerator<[string, Ascot.ClassInfo]> {
	yield* await (await filePathToWorkspace(docURI)).queryCls("");
}

/** `clsName`'s members matching `memQuery`, its superclasses' included. */
export async function* getClassMembers(
	docURI: string,
	clsName: string,
	memQuery = "",
): AsyncGenerator<[string, Ascot.MemberInfo]> {
	const workspace = await filePathToWorkspace(docURI);
	yield* await workspace.queryMem(clsName, memQuery);
	const cls = (await workspace.queryCls(clsName)).find(([, c]) => c.name.content === clsName)?.[1];
	for (const sup of cls?.extends ?? []) yield* getClassMembers(docURI, sup, memQuery);
}

export async function getClassMember(
	docURI: string,
	clsName: string,
	memName: string,
): Promise<[string, Ascot.MemberInfo] | null> {
	for await (const entry of getClassMembers(docURI, clsName, memName)) {
		if (entry[1].name.content === memName) return entry;
	}
	return null;
}
