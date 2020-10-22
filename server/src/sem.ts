
import {Proposed,ProposedFeatures} from 'vscode-languageserver';

import {extname} from 'path';

import {parsedocument, startcombridge} from './parse';
import { studiolegend, lookupattr } from './semanticdefns';
import { startupdumps, logcompressedresult } from './applogging';
import { parserlogcompressedresult, makeclsparsetree } from './config';
import { LANGUAGES } from './languagedefns';
import { monikerinfo, monikeropttype } from './types';
import { parseClassDocument, parseClassDocumentText } from './udlast';


const WARNING = 'isc_warning';

const tokenModifiers = new Map<string, number>();
tokenModifiers.set(WARNING,0);

export function parseText(text: string, moninfo: monikerinfo, builder: ProposedFeatures.SemanticTokensBuilder) {

	//console.log('parseText: ' + moninfo.moniker + ':' + moninfo.monikeropt);

	const jsonform = parsedocument(moninfo.moniker,moninfo.monikeropt,text).compressedlinearray;
	if (parserlogcompressedresult) {
		logcompressedresult(jsonform);
	}

	let anyerrors = false;
	for (let lineno in jsonform) {
		const line = jsonform[lineno];
		for (let itemno in line) {
			const item = line[itemno];
			if (item.s === 0) {
				anyerrors = true;
			}
			const tokenmodifiers = (item.w === 0) ? [] : [WARNING];
			builder.push(+lineno, item.p, item.c, lookupattr(item.l,item.s), encodeTokenModifiers(tokenmodifiers));
		}
	}

	if (makeclsparsetree && !anyerrors && moninfo.moniker === 'CLS') {

		try {
			const ast = parseClassDocument(jsonform, text);
			console.log(ast);
		}
		catch (error) {
			console.log('error calling parseClassDocument: ' + error);
		}
	}
}


/**
 * Return the moniker and possible moniker option associated with the given file extension, or undefined if none.
 * 
 * A file extension which matches a moniker will be returned as that moniker, additionally there are a number
 * of standard mappings defined.
 * 
 * Currently there is only one moniker option: INT.
 * 
 * @param filename 
 */
export function filenameToMoniker(filename: string): monikerinfo | undefined {

	const extension = extname(filename);
	if (extension === '') {
		return undefined;
	}

	return extensionToMoniker(extension.substr(1)); // remove the leading "." from 'extension'
}


/**
 * Return the moniker and possible moniker option associated with the given file extension, or undefined if none.
 * 
 * A file extension which matches a moniker will be returned as that moniker, additionally there are a number
 * of standard mappings defined.
 * 
 * Currently there is only one moniker option: INT.
 * 
 * @param extension the file extension
 */
function extensionToMoniker(extension: string): monikerinfo | undefined {

	const extlc = extension.toLowerCase();

	switch (extlc) {

		case 'mac':
		case 'inc': {
			return simpleMoniker('COS');
		}

		case 'int': {
			return {'moniker': 'COS', 'monikeropt': monikeropttype.INT};
		}

		case 'udl': {
			return simpleMoniker('CLS');
		}

		case 'csp':
		case 'csr':
		case 'htm':
		case 'asp': {
			return simpleMoniker('HTML');
		}

		case 'js': {
			return simpleMoniker('JAVASCRIPT');
		}

		default: {

			// if the extension matches a moniker then use that
			if (LANGUAGES.filter(value => value.moniker.toLowerCase() === extlc).length !== 0) {
				return simpleMoniker(extlc.toUpperCase());
			}

			return undefined;
		}
	}
}


function simpleMoniker(moniker: string): monikerinfo {
	return {'moniker': moniker, 'monikeropt': monikeropttype.NONE};
}


export function getLegend(): Proposed.SemanticTokensLegend {
	return {
		tokenTypes: studiolegend,
		tokenModifiers: [WARNING]
	};
}


function encodeTokenModifiers(strTokenModifiers: string[]): number {

	let result = 0;
	for (let i = 0; i < strTokenModifiers.length; i++) {

		const tokenModifier = strTokenModifiers[i];

		if (tokenModifiers.has(tokenModifier)) {
			result = result | (1 << tokenModifiers.get(tokenModifier)!);
		}
		
		else if (tokenModifier === 'notInLegend') {
			result = result | (1 << tokenModifiers.size + 2);
		}
	}

	return result;
}
