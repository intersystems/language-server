import * as path from "path";
import {
	ExtensionContext,
	extensions,
	Uri,
	window,
	ColorThemeKind,
	workspace,
	commands,
	languages,
	authentication,
} from "vscode";

import {
	DocumentSelector,
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
} from "vscode-languageclient/node";

import { gt, lte, lt } from "semver";
import * as serverManager from "@intersystems-community/intersystems-servermanager";

import { ObjectScriptEvaluatableExpressionProvider } from "./evaluatableExpressionProvider";
import {
	extractMethod,
	showSymbolInClass,
	overrideClassMembers,
	selectImportPackage,
	selectParameterType,
	setSelection,
} from "./commands";
import { makeRESTRequest } from "./makeRESTRequest";
import { ISCEmbeddedContentProvider, requestForwardingMiddleware } from "./requestForwarding";
import type { ServerSpec, ProtocolMethods } from "../../common/out/types";
import type { Disposable } from "vscode-languageclient";
import { Authorization, ResolvedAuthorization } from "@intersystems-community/intersystems-servermanager";

export let client: {
	onRequest<K extends keyof ProtocolMethods>(
		method: K,
		handler: (params: Parameters<ProtocolMethods[K]>[0]) => ReturnType<ProtocolMethods[K]>,
	): Disposable;
} & Omit<LanguageClient, "onRequest">;

/**
 * Cache for cookies from REST requests to InterSystems servers.
 */
const cookiesCache: Map<string, string[]> = new Map();

export function updateCookies(newCookies: string[], server: ServerSpec): string[] {
	const key = `${server.username}@${server.host}:${server.port}${server.pathPrefix}`;
	const cookies = cookiesCache.get(key) ?? [];
	newCookies.forEach((cookie) => {
		const [cookieName] = cookie.split("=");
		const index = cookies.findIndex((el) => el.startsWith(cookieName));
		if (index >= 0) {
			cookies[index] = cookie;
		} else {
			cookies.push(cookie);
		}
	});
	cookiesCache.set(key, cookies);
	return cookies;
}

export function getCookies(server: ServerSpec): string[] {
	return cookiesCache.get(`${server.username}@${server.host}:${server.port}${server.pathPrefix}`) ?? [];
}

let objectScriptApi: serverManager.VSCodeObjectScriptAPI;
let serverManagerApi: serverManager.ServerManagerAPI;

/** Resolved connection information for each workspace folder */
const wsFolderServerSpecs: Map<string, ServerSpec> = new Map();

export async function activate(context: ExtensionContext) {
	// Get the main extension exported API
	const objectScriptExt = extensions.getExtension("intersystems-community.vscode-objectscript")!;
	objectScriptApi = objectScriptExt.isActive ? objectScriptExt.exports : await objectScriptExt.activate();

	// The server is implemented in node
	const serverModule = context.asAbsolutePath(path.join("server", "out", "server.js"));
	// The debug options for the server
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
	const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions,
		},
	};

	// The languages we handle
	const targetLanguages = [
		"objectscript",
		"objectscript-int",
		"objectscript-class",
		"objectscript-csp",
		"objectscript-macros",
	];

	// The uri schemes we handle those languages for
	const targetSchemes = [
		"isfs",
		"isfs-readonly",
		"objectscript",
		"objectscriptxml",
		"file",
		"vscode-remote",
		"vscode-notebook-cell",
	];

	// A document selector to target the right {language, scheme} tuples
	const documentSelector: DocumentSelector = [];
	targetLanguages.forEach((language) => {
		targetSchemes.forEach((scheme) => {
			documentSelector.push({ language, scheme });
		});
	});

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		// Register the server for InterSystems files handled by vscode-objectscript extension
		documentSelector: documentSelector,
		// Register middleware for embedded language request forwarding
		middleware: requestForwardingMiddleware,
		// Allow the rendering of HTML tags like <table>, <tr> and <td>
		markdown: {
			supportHtml: true,
		},
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		"intersystems.language-server",
		"InterSystems Language Server",
		serverOptions,
		clientOptions,
	);

	// Send custom notifications when the connection or password changes
	objectScriptApi.onDidChangeConnection()(() => {
		wsFolderServerSpecs.clear();
		client.sendNotification("intersystems/server/connectionChange");
	});
	const serverManagerExt = extensions.getExtension("intersystems-community.servermanager");
	if (serverManagerExt !== undefined) {
		// The server manager extension is installed
		serverManagerApi = serverManagerExt.isActive ? serverManagerExt.exports : await serverManagerExt.activate();
		serverManagerApi.onDidChangePassword()((serverName: string) => {
			for (const [k, v] of wsFolderServerSpecs.entries()) {
				if (v.serverName == serverName) wsFolderServerSpecs.delete(k);
			}
			client.sendNotification("intersystems/server/passwordChange", serverName);
		});
	}

	// Resolve the ServerSpec for a document or workspace folder URI, prompting
	// for a missing password via the Server Manager's authentication provider.
	async function resolveServerSpec(uri: Uri): Promise<ServerSpec | undefined> {
		const wsFolderUriString = workspace.getWorkspaceFolder(uri)?.uri.toString();
		const serverSpec = objectScriptApi.serverForUri(uri);
		if (serverSpec === undefined) {
			return undefined;
		}
		const auth = serverSpec.auth ?? new BasicAuthorization(serverSpec.username, serverSpec.password);
		if (
			// Server was resolved
			serverSpec.host !== "" &&
			// Connection isn't unauthenticated
			auth.username != undefined &&
			auth.username != "" &&
			auth.username.toLowerCase() != "unknownuser" &&
			// A password is missing
			typeof auth.password === "undefined" &&
			// A supported version of the Server Manager is installed
			serverManagerExt != undefined &&
			gt(serverManagerExt.packageJSON.version, "3.0.0")
		) {
			// The main extension didn't provide a password, so we must
			// get it from the server manager's authentication provider.
			const scopes = [serverSpec.serverName, auth.username];
			try {
				const account = serverManagerApi?.getAccount
					? serverManagerApi.getAccount({ name: serverSpec.serverName, ...serverSpec })
					: undefined;
				let session = await authentication.getSession(serverManager.AUTHENTICATION_PROVIDER, scopes, {
					silent: true,
					account,
				});
				if (!session) {
					session = await authentication.getSession(serverManager.AUTHENTICATION_PROVIDER, scopes, {
						createIfNone: true,
						account,
					});
				}
				if (session) {
					auth.resolve({
						username: session.scopes[1],
						accessToken: session.accessToken,
					});
				}
			} catch (error) {
				// The user did not consent to sharing authentication information
				if (error instanceof Error) {
					client.warn(`${serverManager.AUTHENTICATION_PROVIDER}: ${error.message}`);
				}
			}
		}
		if (
			typeof auth.username == "string" &&
			auth.username.toLowerCase() == "unknownuser" &&
			typeof auth.password == "undefined"
		) {
			// UnknownUser without a password means "unauthenticated"
			auth.clear() as void;
		}
		const server: ServerSpec = {
			...serverSpec,
			username: auth.username,
			credentials: auth.credentials,
		};
		if (wsFolderUriString && !wsFolderServerSpecs.has(wsFolderUriString)) {
			wsFolderServerSpecs.set(wsFolderUriString, server);
		}
		return server;
	}

	// Ensure that every server has at most one session.
	for (const f of workspace.workspaceFolders ?? []) {
		try {
			const serverSpec = await resolveServerSpec(f.uri);
			if (serverSpec?.active) {
				await makeRESTRequest("HEAD", 1, "", serverSpec);
			}
		} catch {
			// Ignore any failure; the session will be created on demand instead
		}
	}

	const textDecoder = new TextDecoder();
	context.subscriptions.push(
		// Register custom request handlers
		client.onRequest("intersystems/server/resolveFromUri", (uri) => resolveServerSpec(Uri.parse(uri))),
		client.onRequest("intersystems/uri/localToVirtual", (uri) => {
			const newuri: Uri = objectScriptApi.serverDocumentUriForUri(Uri.parse(uri));
			return newuri.toString();
		}),
		client.onRequest("intersystems/uri/forDocument", (document) => {
			if (lte(objectScriptExt.packageJSON.version, "1.0.10")) {
				// If the active version of vscode-objectscript doesn't expose
				// DocumentContentProvider.getUri(), just return the empty string.
				return "";
			}
			const uri: Uri | null = objectScriptApi.getUriForDocument(document);
			return uri == null ? null : uri.toString();
		}),
		client.onRequest("intersystems/uri/forTypeHierarchyClasses", (classes) => {
			// vscode-objectscript version 1.0.11+ has been available for long enough that
			// it's safe to assume that users have upgraded to at least 1.0.11
			return classes.map((cls: string) => {
				const uri: Uri = objectScriptApi.getUriForDocument(`${cls}.cls`);
				return uri.toString();
			});
		}),
		client.onRequest("intersystems/server/makeRESTRequest", async (args) => {
			// As of version 2.0.0, REST requests are made on the client side
			return makeRESTRequest(args.method, args.api, args.path, args.server, args.data, args.checksum, args.params).then(
				(respdata) => {
					if (respdata) {
						// Can't return the entire AxiosResponse object because it's not JSON.stringify-able due to circularity
						return { data: respdata.data };
					}
				},
			);
		}),
		client.onRequest(
			"intersystems/uri/getText",
			async (params: { uri: string; server: ServerSpec }): Promise<string[]> => {
				try {
					const uri = Uri.parse(params.uri);
					if (uri.scheme == "objectscript") {
						// Can't use the FileSystem with a DocumentContentProvider, so fetch the text directly from the server
						const uriParams = new URLSearchParams(uri.query);
						const fileName =
							uriParams.has("csp") && ["", "1"].includes(uriParams.get("csp") ?? "")
								? uri.path.slice(1)
								: uri.path.split("/").slice(1).join(".");
						const docParams =
							params.server.apiVersion >= 4 &&
							workspace
								.getConfiguration(
									"objectscript",
									workspace.workspaceFolders?.find((f) => f.name.toLowerCase() == uri.authority.toLowerCase()),
								)
								.get<boolean>("multilineMethodArgs")
								? { format: "udl-multiline" }
								: undefined;
						const resp = await makeRESTRequest(
							"GET",
							1,
							`/doc/${fileName}`,
							params.server,
							undefined,
							undefined,
							docParams,
						);
						return resp?.data?.result?.content || [];
					} else {
						// Read the contents of the file at uri
						return textDecoder.decode(await workspace.fs.readFile(uri)).split(/\r?\n/);
					}
				} catch {
					// The file wasn't found or wasn't valid utf-8
					return [];
				}
			},
		),

		// Register commands
		commands.registerCommand("intersystems.language-server.overrideClassMembers", overrideClassMembers),
		commands.registerCommand("intersystems.language-server.selectParameterType", selectParameterType),
		commands.registerCommand("intersystems.language-server.selectImportPackage", selectImportPackage),
		commands.registerCommand("intersystems.language-server.extractMethod", extractMethod),
		commands.registerCommand("intersystems.language-server.showSymbolInClass", showSymbolInClass),
		commands.registerTextEditorCommand("intersystems.language-server.setSelection", setSelection),

		// Register EvaluatableExpressionProvider
		languages.registerEvaluatableExpressionProvider(documentSelector, new ObjectScriptEvaluatableExpressionProvider()),

		// Register embedded language request forwarding content provider
		workspace.registerTextDocumentContentProvider("isc-embedded-content", new ISCEmbeddedContentProvider()),
	);

	// Start the client. This will also launch the server
	await client.start();

	const workbenchConfig = workspace.getConfiguration("workbench");
	if (
		workspace
			.getConfiguration(
				"intersystems.language-server",
				workspace.workspaceFolders != undefined ? workspace.workspaceFolders[0] : undefined,
			)
			.get("suggestTheme") === true &&
		!workbenchConfig.get<string>("colorTheme")?.startsWith("InterSystems Default ")
	) {
		// Suggest an InterSystems default theme depending on the current active theme type
		if (window.activeColorTheme.kind === ColorThemeKind.Light) {
			if (workspace.name === undefined) {
				window
					.showInformationMessage(
						`For the best user experience, InterSystems recommends that you activate the default light theme included with the [InterSystems Language Server extension](https://marketplace.visualstudio.com/items?itemName=intersystems.language-server). Activate now?`,
						"Yes",
						"Don't Ask Again",
					)
					.then((answer) => {
						if (answer === "Yes") {
							workbenchConfig.update("colorTheme", "InterSystems Default Light Modern", true);
						} else if (answer === "Don't Ask Again") {
							workspace.getConfiguration("intersystems.language-server").update("suggestTheme", false, true);
						}
					});
			} else {
				// Only give the "Only This Workspace" option if a workspace is open
				window
					.showInformationMessage(
						`For the best user experience, InterSystems recommends that you activate the default light theme included with the [InterSystems Language Server extension](https://marketplace.visualstudio.com/items?itemName=intersystems.language-server). Activate now?`,
						"Globally",
						"Only This Workspace",
						"Don't Ask Again",
					)
					.then((answer) => {
						if (answer === "Globally") {
							workbenchConfig.update("colorTheme", "InterSystems Default Light Modern", true);
						} else if (answer === "Only This Workspace") {
							workbenchConfig.update("colorTheme", "InterSystems Default Light Modern", false);
						} else if (answer === "Don't Ask Again") {
							workspace.getConfiguration("intersystems.language-server").update("suggestTheme", false, true);
						}
					});
			}
		} else if (window.activeColorTheme.kind === ColorThemeKind.Dark) {
			if (workspace.name === undefined) {
				window
					.showInformationMessage(
						`For the best user experience, InterSystems recommends that you activate the default dark theme included with the [InterSystems Language Server extension](https://marketplace.visualstudio.com/items?itemName=intersystems.language-server). Activate now?`,
						"Yes",
						"Don't Ask Again",
					)
					.then((answer) => {
						if (answer === "Yes") {
							workbenchConfig.update("colorTheme", "InterSystems Default Dark Modern", true);
						} else if (answer === "Don't Ask Again") {
							workspace.getConfiguration("intersystems.language-server").update("suggestTheme", false, true);
						}
					});
			} else {
				// Only give the "Only This Workspace" option if a workspace is open
				window
					.showInformationMessage(
						`For the best user experience, InterSystems recommends that you activate the default dark theme included with the [InterSystems Language Server extension](https://marketplace.visualstudio.com/items?itemName=intersystems.language-server). Activate now?`,
						"Globally",
						"Only This Workspace",
						"Don't Ask Again",
					)
					.then((answer) => {
						if (answer === "Globally") {
							workbenchConfig.update("colorTheme", "InterSystems Default Dark Modern", true);
						} else if (answer === "Only This Workspace") {
							workbenchConfig.update("colorTheme", "InterSystems Default Dark Modern", false);
						} else if (answer === "Don't Ask Again") {
							workspace.getConfiguration("intersystems.language-server").update("suggestTheme", false, true);
						}
					});
			}
		}
	}
}

export async function deactivate(): Promise<void> {
	// Stop the server and log out of all CSP sessions
	const loggedOut: Set<string> = new Set();
	const promises: Promise<any>[] = client ? [client.stop()] : [];
	for (const f of workspace.workspaceFolders ?? []) {
		const serverSpec = wsFolderServerSpecs.get(f.uri.toString());
		if (!serverSpec?.active) continue;
		const sessionCookie = getCookies(serverSpec).find((c) => c.startsWith("CSPSESSIONID-"));
		if (!sessionCookie || loggedOut.has(sessionCookie)) continue;
		loggedOut.add(sessionCookie);
		promises.push(
			makeRESTRequest(
				"HEAD",
				0,
				"",
				serverSpec,
				undefined,
				undefined,
				// Prefer IRISLogout for servers that support it
				lt(serverSpec.serverVersion, "2018.2.0") ? { CacheLogout: "end" } : { IRISLogout: "end" },
			),
		);
	}
	await Promise.allSettled(promises);
}

// A copy of the BasicAuthorization class from ServerManager
// We use it to patch older version of getServerSpec.
export default class BasicAuthorization implements Authorization {
	#username?: string;
	#password?: string;
	constructor(username?: string, password?: string) {
		this.#username = username;
		this.#password = password;
	}

	public get username(): string {
		return this.#username || "";
	}

	public get password(): string | undefined {
		return this.#password;
	}

	public get accessToken(): string | undefined {
		return this.#password;
	}

	public get httpAuthorizationHeader(): string {
		return `Basic ${Buffer.from(`${this.#username}:${this.#password}`).toString("base64")}`;
	}

	public resolved(): this is ResolvedAuthorization {
		return this.username !== "" && this.#password !== undefined;
	}

	public resolve(param: { accessToken: string; username?: string }): this is ResolvedAuthorization {
		this.#username = param.username ?? this.#username;
		this.#password = param.accessToken ?? this.#password;
		return this.resolved();
	}

	public clear(): asserts this is Authorization {
		this.#password = undefined;
	}

	public get credentials(): { auth: { username: string; password: string }; headers?: Record<string, string> } {
		return {
			auth: {
				username: this.username,
				password: this.password!,
			},
			headers: {},
		};
	}

	public clone(): BasicAuthorization {
		return new BasicAuthorization(this.#username, this.#password);
	}
}
