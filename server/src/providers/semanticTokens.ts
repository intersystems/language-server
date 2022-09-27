import { SemanticTokensBuilder, SemanticTokensDeltaParams, SemanticTokensParams } from 'vscode-languageserver/node';
import { lookupattr } from '../parse/parse';
import { getParsedDocument } from '../utils/functions';
import { compressedline } from '../utils/types';
import { tokenBuilders } from '../utils/variables';

/**
 * Get the semantic tokens builder for this document, or create one if it doesn't exist.
 * 
 * @param document The TextDocument
 */
function getTokenBuilder(document: string): SemanticTokensBuilder {
	let result = tokenBuilders.get(document);
	if (result !== undefined) {
		return result;
	}
	result = new SemanticTokensBuilder();
	tokenBuilders.set(document, result);
	return result;
}

function insertTokensIntoBuilder(tokens: compressedline[], builder: SemanticTokensBuilder) {
	for (let lineno = 0; lineno < tokens.length; lineno++) {
		const line = tokens[lineno];
		for (let itemno = 0; itemno < line.length; itemno++) {
			const item = line[itemno];
			builder.push(lineno, item.p, item.c, lookupattr(item.l,item.s), 0);
		}
	}
}

export async function onSemanticTokens(params: SemanticTokensParams) {
	const parsed = await getParsedDocument(params.textDocument.uri);
	if (parsed === undefined) {return { data: [] };}
	
	// Get the token builder for this document
	const builder = getTokenBuilder(params.textDocument.uri);

	// Push the tokens into the builder
	insertTokensIntoBuilder(parsed, builder);
	
	return builder.build();
}

export async function onSemanticTokensDelta(params: SemanticTokensDeltaParams) {
	const parsed = await getParsedDocument(params.textDocument.uri);
	if (parsed === undefined) {return { edits: [] };}
	
	// Get the token builder for this document
	const builder = getTokenBuilder(params.textDocument.uri);

	// Load the previous results
	builder.previousResult(params.previousResultId);

	// Push the tokens into the builder
	insertTokensIntoBuilder(parsed, builder);
	
	return builder.buildEdits();
}
