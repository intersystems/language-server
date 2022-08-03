import { createConnection, SemanticTokensBuilder, TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { compressedline, LanguageServerConfiguration, ServerSpec } from './types';

/**
 * TextDocument URI's mapped to the tokenized representation of the document.
 */
export let parsedDocuments: Map<string, compressedline[]> = new Map();

/**
 * Node IPC connection between the server and client.
 */
export let connection = createConnection();

/**
 * TextDocument manager.
 */
export let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

/**
 * TextDocument URI's mapped to the document's semantic tokens builder.
 */
export let tokenBuilders: Map<string, SemanticTokensBuilder> = new Map();

/**
 * TextDocument URI's mapped to the InterSystems server that the document belongs to.
 */
export let serverSpecs: Map<string, ServerSpec> = new Map();

/**
 * An array containing the names and descriptions of all core Property data type parameters.
 */
export const corePropertyParams = [
	{
		name: "CALCSELECTIVITY",
		desc: `Controls whether the Tune Table facility calculates the *selectivity* for a property. Usually it is best to leave this parameter as the default (1).`
	},
	{
		name: "CAPTION",
		desc: `Caption to use for this property in client applications.`
	},
	{
		name: "EXTERNALSQLNAME",
		desc: `Used in linked tables, this parameter specifies the name of the field in the external table to which this property is linked.`
	},
	{
		name: "EXTERNALSQLTYPE",
		desc: `Used in linked tables, this parameter specifies the SQL type of the field in the external table to which this property is linked.`
	},
	{
		name: "JAVATYPE",
		desc: `The Java data type to which this property is projected.`
	}
];

/**
 * Cache of the language server configuration parameters fetched from the client.
 */
export const languageServerSettings: Map<string, LanguageServerConfiguration> = new Map();
