import { MarkupContent } from 'vscode-languageserver';

/// ------ Language Feature Types

/**
 * The configuration options exposed by the client.
 */
export type LanguageServerConfiguration = {
	formatting: {
		commands: {
			case: "upper" | "lower" | "word",
			length: "short" | "long"
		},
		system: {
			case: "upper" | "lower" | "word",
			length: "short" | "long"
		}
	},
	hover: {
		commands: boolean,
		system: boolean,
		preprocessor: boolean
	},
	diagnostics: {
		routines: boolean,
		parameters: boolean,
		classes: boolean,
		deprecation: boolean
	},
	signaturehelp: {
		documentation: boolean
	},
	refactor: {
		exceptionVariable: string
	}
};

/**
 * Data returned by a query of %Library.RoutineMgr_StudioOpenDialog.
 */
export type StudioOpenDialogFile = {
	Name: string
};

/**
 * Schema of an element in the command documentation file.
 */
export type CommandDoc = {
    label: string;
    alias: string[];
    documentation: string[];
    link: string;
    insertText?: string;
};

/**
 * Structure of request body for HTTP POST /action/query.
 */
export type QueryData = {
	query: string,
	parameters: any[]
};

/**
 * Context of the method/routine that a macro is in.
 */
export type MacroContext = {
	docname: string,
	superclasses: string[],
	includes: string[],
	includegenerators: string[],
	imports: string[],
	mode: string,
	cursor?: string // Only needed for /action/getmacrolist
};

/**
 * Result of a call to parseDimLime().
 */
export type DimResult = {
	founddim: boolean,
	class: string
};

/**
 * Class that a member is in and how that class was determined.
 */
export type ClassMemberContext = {
	baseclass: string,
	context: "instance" | "class" | "system" | ""
};

/**
 * Schema of an element in a UDL keyword documentation file.
 */
export type KeywordDoc = {
	name: string,
	description?: string,
	type: string,
	constraint?: string | string[]
};

/**
 * IRIS server information received from an 'intersystems/server/resolveFromUri' request.
 */
export type ServerSpec = {
	scheme: string,
	host: string,
	port: number,
	pathPrefix: string,
	apiVersion: number,
	namespace: string,
	username: string,
	serverName: string,
	password: string,
	active: boolean
};

/**
 * Context of the method/routine that a macro is in, including extra information needed for macro expansion.
 */
export type SignatureHelpMacroContext = {
	docname: string,
	macroname: string,
	superclasses: string[],
	includes: string[],
	includegenerators: string[],
	imports: string[],
	mode: string,
	arguments: string
};

/**
 * The content of the last SignatureHelp documentation sent and the type of signature that it applies to.
 */
export type SignatureHelpDocCache = {
	doc: MarkupContent,
	type: "macro" | "method"
};

/**
 * The number of possible classes that this short class name could map to.
 */
export type PossibleClasses = {
	num: number
};

/// ------ Parser Types

export type compresseditem = {
    'p': number, // offset within line
    'c': number, // count (length of source of this item)
    'l': number, // language index
    's': number // coloring attribute index
};

export type compressedline = compresseditem[];

export type compressedresult = {'compressedlinearray': compressedline[], 'routineheaderinfo'?: routineheaderinfotype};

export type compressedcolors = {'compressedcolors': compressedline[]};


// routine header (if present 'generated' is just set to '')
export type routineheaderinfotype = {'routinename': string, 'routinetype'?: string, 'languagemode'?: number, 'generated'?: string};
