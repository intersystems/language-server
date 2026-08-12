export interface ServerSpec {
	serverName: string;
	active: boolean;
	apiVersion: number;
	serverVersion: string;
	scheme: "http" | "https";
	https?: boolean;
	host: string;
	port: number;
	superserverPort?: number;
	pathPrefix: string;
	namespace: string;
	username: string;
	credentials?: {
		auth?: { username: string; password: string };
		headers?: Record<string, string>;
	};
}

export interface MakeRESTRequestParams {
	method: "GET" | "POST" | "HEAD";
	api: number;
	path: string;
	server: ServerSpec;
	data?: any;
	checksum?: string;
	params?: any;
}

export interface MakeRESTRequestResult {
	data: any;
}

export interface GetTextParams {
	uri: string;
	server: ServerSpec;
}

export interface ProtocolMethods {
	"intersystems/server/resolveFromUri": (_: string) => Promise<ServerSpec>;
	"intersystems/uri/localToVirtual": (_: string) => string;
	"intersystems/uri/forDocument": (_: string) => string | null;
	"intersystems/uri/forTypeHierarchyClasses": (_: string[]) => string[];
	"intersystems/server/makeRESTRequest": (_: MakeRESTRequestParams) => Promise<MakeRESTRequestResult | undefined>;
	"intersystems/uri/getText": (_: GetTextParams) => Promise<string[]>;
}
