
import { dumpstudiolegend, dumplangattrinfo, dumpcolorsettings, dumplanguages } from './config';
import { GETLANGUAGEATTRINFO } from './bridge.js';
import { attrinforesult, compressedresult, attrinfo, compressedline } from './types';
import { DEBUG_CATEGORY, LANGUAGES } from './languagedefns';
import { studiolegend, colorsettings, fliprgb } from './semanticdefns';

export function startupdumps() {

    // optionally dump the language attribute info
	if (dumplangattrinfo) {
		const cosattrinfo = (<attrinforesult><unknown>(GETLANGUAGEATTRINFO('COS'))).attrinfo;
		for (let caindex in cosattrinfo) {
			const record = cosattrinfo[caindex];
			console.log(caindex + ': ' + record.description + ' ' + record.foreground + '/' + record.background + ' (' + DEBUG_CATEGORY[record.debugcategory] + ')');
		}
		console.log("-----");
	}

	// optionally dump the studio legend (passed to registerDocumentSemanticTokensProvider)
	if (dumpstudiolegend) {
		const cosattrinfo = (<attrinforesult><unknown>(GETLANGUAGEATTRINFO('COS'))).attrinfo;
		for (let caindex in cosattrinfo) {
			const record = cosattrinfo[caindex];
			console.log(caindex + ': ' + record.description + ' ' + record.foreground + '/' + record.background + ' (' + DEBUG_CATEGORY[record.debugcategory] + ')');
		}
		console.log(studiolegend);
		console.log("-----");
	}

	// optionally dump the color info for settings.json
	if (dumpcolorsettings) {		
		const colorsettings_prefix =
			'"editor.semanticTokenColorCustomizations": {\n' +
			'\t"enabled": true, // enable for all themes\n' +
			'\t"rules": {\n\t\t';
		const colorsettings_suffix =
			'\n\t}\n' +
			'},\n'
		const cs = colorsettings();
		let result = '';
		for (let moniker in cs) {
			const line = JSON.stringify(cs[moniker]);
			if (result.length !== 0) {
				result += ',\n\t\t';
			}
			if (line.startsWith('{') && line.endsWith('}')) {
				result += line.substr(1,line.length - 2);
			}
			else {
				throw Error('dumpcolorsettings: JSON line is not enclosed in {..}');
			}
		}
		console.log(colorsettings_prefix + result + colorsettings_suffix);
		console.log("-----");
	}

	// optionally dump the languages array
	if (dumplanguages) {
		console.log(LANGUAGES);
		console.log("-----");
	}
}

export function logcompressedresult(jsonlines: compressedline[]) {

	for (let lineno in jsonlines) {
		const line = jsonlines[lineno];
		for (let itemno in line) {
			const item = line[itemno];
			const moniker:string = LANGUAGES[item.l].moniker;
			if (! languageattrmap.has(moniker)) {
				setupLanguageAttrInfo(moniker);
			}
			console.log((+lineno+1).toString() + '.' + (item.p+1).toString() + ': (' + item.c.toString() + ') ' + moniker + ' ' + expandColoringAttribute(moniker,item.s));
		}
	}
}

function expandColoringAttribute(moniker: string, attrindex: number): string {
	
	const attrrecord = languageattrmap.get(moniker)?.get(attrindex.toString());
	
	if (typeof attrrecord === 'undefined') {
		return 'no record for ' + moniker + ' at attribute index ' + attrindex;
	}

	return attrrecord.description + ' fg=' + fliprgb(attrrecord.foreground) + ' bg=' + fliprgb(attrrecord.background) + ' debugcategory=' + DEBUG_CATEGORY[attrrecord.debugcategory];
}

let languageattrmap: Map<string,Map<string,attrinfo>> = new Map();

function setupLanguageAttrInfo(moniker: string) {
	let m = new Map();
	const attrlist = (<attrinforesult><unknown>(GETLANGUAGEATTRINFO(moniker))).attrinfo;
	for (let attrindex in attrlist) {
		m.set(attrindex,attrlist[attrindex]);
	}
	languageattrmap.set(moniker,m);
}