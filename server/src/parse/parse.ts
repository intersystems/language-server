import { compressedresult, compressedline } from '../utils/types'
import { colorRoutineLine, isRoutineHeader, routineheadertype } from './routineheader/parseroutineheader';
import { SemanticTokensLegend } from 'vscode-languageserver';
import { GetLanguageAttributes, Tokenize } from '../../lib/isclexer.node';
import { lexerLanguages } from '../utils/variables';

// Set this to false if routines stop using the ROUTINE header line
const acceptroutineheaderline = true;

// flags to pass to Tokenize
const IPARSE_UDL_EXPLICIT = 0x0001; // require variable declaration (#dim)
const IPARSE_UDL_EXPERT = 0x4000; // this stops the SYSTEM class keyword from being colored as a syntax error
const IPARSE_COS_U2 = 0x10000; // accept U2 syntax
const IPARSE_UDL_TRACK = 0x20000; // enable variable tracking
// these flags are only passed for HTML documents
const IPARSE_ALL_CSPEXTENSIONS = 0x0400; // all parsers: recognize CSP extensions like #(..)#
const IPARSE_HTML_CSPMODE = 0x0800; // HTML parser: is in CSP mode

const STANDARDPARSEFLAGS = IPARSE_UDL_EXPLICIT + IPARSE_UDL_EXPERT + IPARSE_UDL_TRACK;

export function parseDocument(languageId: string, fileExt: string, text: string): compressedresult {
	let moniker = "COS";
	let flags = STANDARDPARSEFLAGS;
	if (languageId === "objectscript-class") {
		moniker = "CLS"
	}
	else if (languageId === "objectscript-csp") {
		moniker = "HTML";
	}
	else if (languageId === "objectscript-int" || (languageId === "objectscript" && fileExt === "int")) {
		moniker = "INT";
	}

	if (acceptroutineheaderline && (moniker === "COS" || moniker === "INT") && isRoutineHeader(text)) {

		// extract the routine header line (without the line-ending)
		const firstline = getFirstLine(text);

		// color the routine header line
		const routinelinecoloring: routineheadertype = colorRoutineLine(firstline);

		if (routinelinecoloring?.routineheaderinfo?.languagemode == 10) {
			// LanguageMode 10 is U2, so allow U2 syntax
			flags += IPARSE_COS_U2;
		}

		// effectively replace the routine line (before the line-ending) with spaces so that the offsets are still correct
		const doctoparse = ' '.repeat(firstline.length) + text.slice(firstline.length);

		// parse the rest of the document using Studio libraries
		let restcolors: compressedline[] = Tokenize(doctoparse,moniker,false,flags);

		// at this point the original restcolors[0] will be either an array with a single whitespace item or an empty array
		// - either way, overwriting that array with the routine line coloring works
		restcolors[0] = routinelinecoloring.compressedline;

		return {compressedlinearray: restcolors, routineheaderinfo: routinelinecoloring.routineheaderinfo};
	}
	else {
		flags += (moniker === "HTML") ? (IPARSE_ALL_CSPEXTENSIONS + IPARSE_HTML_CSPMODE) : 0;
		return {compressedlinearray: Tokenize(text,moniker,false,flags)};
	}

}

function getFirstLine(documenttext: string): string {
	
	const poslf = documenttext.indexOf('\n');
	if (poslf === -1) {
		return documenttext; // no linefeed => first line is the whole document
	}

	if (poslf > 0 && documenttext.charAt(poslf-1) === '\r') {
		return documenttext.slice(0,poslf-1); // CRLF so return up to but not including the CR
	}
	else {
		return documenttext.slice(0,poslf); // LF  so return up to but not including the LF
	}
}

let languageoffsets: {[index:number] : number} = {};

export function getLegend(): SemanticTokensLegend {
	const legend: string[] = [];
	let legendoffset = 0;
	for (const lang of lexerLanguages) {
		languageoffsets[lang.index] = legendoffset;
		const attrs: string[] = GetLanguageAttributes(lang.moniker);
		for (const attr of attrs) {
			legend.push(`${lang.moniker}_${attr.replace(/[^a-z0-9+]+/gi,"")}`);
		}
		legendoffset += attrs.length;
	}
	return {
		tokenTypes: legend,
		tokenModifiers: []
	};
}

export function lookupattr(languageindex: number, attrindex: number): number {
    return languageoffsets[languageindex] + attrindex;
}
