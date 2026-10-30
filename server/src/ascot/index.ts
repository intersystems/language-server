import {
	Atelier,
	createWorkspace,
	type ClassInfo,
	type InlayHint,
	type Location,
	type MemberInfo,
	type Position,
	type Range,
	type SymbolInfo,
	type Workspace,
	type WorkspaceSymbol,
} from "@intersystems-community/ascot";
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

export type { MemberInfo } from "@intersystems-community/ascot";

// Every out-of-workspace class ascot meets is a lookup; don't ask the client about a missing server each time.
const NO_SERVER_MS = 30 * 1000;
const LOOKUP_TIMEOUT_MS = 5 * 1000;

// A request that throws leaves what ascot looked up taken on trust, with the message as the reason.
class RestAtelier extends Atelier {
	noServerUntil = 0;
	/** The server the lookups were answered by, `null` for none; `undefined` before any lookup. */
	lastServer?: string | null;

	constructor(private readonly folder: string) {
		super();
	}

	async resolve(): Promise<ServerSpec | undefined> {
		if (Date.now() < this.noServerUntil) return;
		// ascot calls run one at a time, so a client that never answers would freeze them all.
		const server = await Promise.race([
			getServerSpec(this.folder),
			new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), LOOKUP_TIMEOUT_MS)),
		]);
		if (!server) this.noServerUntil = Date.now() + NO_SERVER_MS;
		return server;
	}

	private async server(): Promise<ServerSpec> {
		const server = await this.resolve();
		this.lastServer = serverKey(server);
		if (!server) throw new Error(`no server connection for ${this.folder}`);
		return server;
	}

	async query(sql: string, params: string[]): Promise<string> {
		const resp = await makeRESTRequest("POST", 1, "/action/query", await this.server(), {
			query: sql,
			parameters: params,
		});
		const rows = resp?.data?.result?.content;
		if (!Array.isArray(rows)) throw new Error(resp?.data?.status?.summary || "the REST request failed");
		return JSON.stringify(rows);
	}

	async getDoc(name: string): Promise<string | undefined> {
		const resp = await makeRESTRequest("GET", 1, `/doc/${name}`, await this.server());
		if (!resp) throw new Error("the REST request failed");
		const lines = resp.data?.result?.content;
		return Array.isArray(lines) ? lines.join("\n") : undefined;
	}
}

// The trace setting can't be read until `initialized`, after the startup scan; buffer until then.
let tracing: boolean | undefined;
let pending: string[] | undefined = [];
let seq = 0;

export async function refreshTrace(): Promise<void> {
	tracing = (await connection.workspace.getConfiguration("intersystems.language-server.ascot.trace")) === true;
	if (tracing) pending?.forEach((line) => connection.console.log(line));
	pending = undefined;
}

function trace(line: string): void {
	line = `[ascot] ${line}`;
	if (tracing) connection.console.log(line);
	else if (pending && pending.length < 20_000) pending.push(line);
}

function traced<T extends object>(target: T, arrow: string): T {
	return new Proxy(target, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof value !== "function" || tracing === false) return value;
			return async (...args: unknown[]) => {
				const id = ++seq;
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
		.map((v) => {
			if (typeof v === "string") {
				return v.length > 80 ? `<${v.length} chars>` : v.slice(v.lastIndexOf("/") + 1);
			}
			const json = JSON.stringify(v, (_, x) =>
				x && typeof x === "object" && "line" in x ? `${x.line}:${x.character}` : x,
			);
			if (json === undefined) return "nothing";
			if (json.length <= 80) return json;
			return Array.isArray(v) ? `${v.length} item(s)` : `${json.slice(0, 80)}…`;
		})
		.join(" ");
}

// Requests wait for the startup scan: ascot records no dependency on a name it couldn't find, so a
// check against a half-loaded workspace would never be invalidated by the rest of it loading.
let scanned = Promise.resolve();

export function setStartupScan(scan: Promise<void>): void {
	const start = Date.now();
	scanned = scan.then(() => trace(`startup scan finished after ${Date.now() - start}ms`));
}

function serverKey(server: ServerSpec | undefined): string | null {
	return server ? `${server.username}@${server.host}:${server.port}${server.pathPrefix}/${server.namespace}` : null;
}

// A folder whose server changed gets a new env, which stales every analysis so ascot asks it again.
export async function onConfigurationChanged(): Promise<void> {
	refreshTrace();
	for (const [folder, atelier] of ateliers) {
		atelier.noServerUntil = 0;
		if (atelier.lastServer === undefined) continue;
		const key = serverKey(await atelier.resolve());
		if (key === atelier.lastServer) continue;
		atelier.lastServer = key;
		await (await workspaces.get(folder)!).setEnv(atelier);
	}
}

const workspaces = new Map<string, Promise<Workspace>>();
const ateliers = new Map<string, RestAtelier>();

function workspaceOfFolder(folder: string): Promise<Workspace> {
	let workspace = workspaces.get(folder);
	if (!workspace) {
		const atelier = traced(new RestAtelier(folder), "←");
		ateliers.set(folder, atelier);
		workspace = createWorkspace(atelier).then((w) => traced(w, "→"));
		workspaces.set(folder, workspace);
	}
	return workspace;
}

async function workspaceOfDoc(uri: string): Promise<Workspace> {
	await scanned;
	const folders = await connection.workspace.getWorkspaceFolders();
	return workspaceOfFolder(folders?.find((f) => uri.startsWith(f.uri))?.uri ?? uri);
}

// Open and edit alike; returns the uris whose analysis this made stale, this one included.
export async function openDoc(uri: string, text: string, folder?: string): Promise<string[]> {
	try {
		const workspace = await (folder ? workspaceOfFolder(folder) : workspaceOfDoc(uri));
		return await workspace.open(uri, text);
	} catch (error) {
		console.log(error);
		return [];
	}
}

async function withWorkspace<T>(uri: string, empty: T, fn: (workspace: Workspace) => Promise<T>): Promise<T> {
	try {
		return await fn(await workspaceOfDoc(uri));
	} catch (error) {
		console.log(error);
		return empty;
	}
}

export const closeDoc = (uri: string) => withWorkspace(uri, [] as string[], (w) => w.close(uri));

export const inlayHint = (uri: string, range: Range) =>
	withWorkspace(uri, [] as InlayHint[], (w) => w.inlayHint(uri, range));

export const getDefinition = (uri: string, position: Position) =>
	withWorkspace<Location | undefined>(uri, undefined, (w) => w.definition(uri, position));

export const getReferences = (uri: string, position: Position, includeDeclaration: boolean) =>
	withWorkspace(uri, [] as Location[], (w) => w.references(uri, position, includeDeclaration));

export const getHover = (uri: string, position: Position) =>
	withWorkspace<string | undefined>(uri, undefined, (w) => w.hover(uri, position));

// LSP's severities 1-4, in order.
const SEVERITIES = ["error", "warning", "information", "hint"];

export const getDiagnostics = (uri: string) =>
	withWorkspace(uri, [] as Diagnostic[], async (w) =>
		(await w.diagnostics(uri)).map((d) => ({
			message: d.message,
			range: d.range,
			severity: (SEVERITIES.indexOf(d.severity) + 1) as DiagnosticSeverity,
			code: d.code || undefined,
			codeDescription: d.codeDescription ? { href: d.codeDescription } : undefined,
			source: "Ascot via InterSystems Language Server",
		})),
	);

// ascot's symbol kinds are LSP's, lowercased.
function toSymbol({ name, kind, deprecated }: SymbolInfo | WorkspaceSymbol) {
	return {
		name,
		kind: SymbolKind[(kind[0].toUpperCase() + kind.slice(1)) as keyof typeof SymbolKind],
		tags: deprecated ? [SymbolTag.Deprecated] : [],
	};
}

export const getDocumentSymbol = (uri: string) =>
	withWorkspace(uri, [] as DocumentSymbol[], async (w) => {
		const toDocSymbol = (s: SymbolInfo): DocumentSymbol => ({
			...toSymbol(s),
			range: s.range,
			selectionRange: s.selectionRange,
		});
		const symbol = await w.documentSymbol(uri);
		return symbol ? [{ ...toDocSymbol(symbol.root), children: symbol.members.map(toDocSymbol) }] : [];
	});

export const getWorkspaceSymbol = (folder: string, query: string) =>
	withWorkspace(folder, [] as SymbolInformation[], async (w) =>
		(await w.workspaceSymbol(query)).map((s) => ({ ...toSymbol(s), location: s.location })),
	);

export async function* getClasses(uri: string, prefix = ""): AsyncGenerator<[string, ClassInfo]> {
	yield* await (await workspaceOfDoc(uri)).queryCls(prefix);
}

export const getClass = (uri: string, name: string) =>
	withWorkspace<ClassInfo | undefined>(
		uri,
		undefined,
		async (w) => (await w.queryCls(name)).find(([, c]) => c.name.content === name)?.[1],
	);

export async function* getClassMembers(uri: string, cls: string, query = ""): AsyncGenerator<[string, MemberInfo]> {
	yield* await (await workspaceOfDoc(uri)).queryMem(cls, query);
	for (const sup of (await getClass(uri, cls))?.extends ?? []) yield* getClassMembers(uri, sup, query);
}

export async function getClassMember(uri: string, cls: string, name: string): Promise<[string, MemberInfo] | null> {
	for await (const entry of getClassMembers(uri, cls, name)) {
		if (entry[1].name.content === name) return entry;
	}
	return null;
}
