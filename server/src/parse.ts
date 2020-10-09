
import {colorinfotype, compressedcolors, compressedresult, legendtype, attrinforesult, semanticrules, attrinfo, monikeropttype, compressedline} from './types'
import {START, RUNWITH, RUNWITH_COMPRESSED, GETLANGUAGEATTRINFO} from './bridge.js';
import { jsonline, tojson } from './tojson';
import {setupfixedtables} from './semanticdefns';
import { acceptroutineheaderline } from './config';
import { cos_langindex, normal_attrindex } from './languagedefns';
import { colorRoutineLine, isRoutineHeader, routineheadertype } from './routineheader/parseroutineheader';


const LOGDEST: string = 'parse';

export function startcombridge(which: string) {
	
	try {
		START(which);
	}
	catch (e) {
		console.log('Exception starting COMBridge: ' + e);
		console.log(new Error().stack);
		throw e;
	}

	setupfixedtables(which.split(','));
}


export function oldparsedocument(moniker: string, documenttext: string): jsonline[] {
	return tojson(<colorinfotype>(RUNWITH(documenttext,moniker)));
}


export function parsedocument(moniker: string, monikeropt: monikeropttype, documenttext: string): compressedresult {

	if (acceptroutineheaderline && moniker==='COS' && isRoutineHeader(documenttext)) {

		// extract the routine header line (without the line-ending)
		const firstline = getFirstLine(documenttext);

		// color the routine header line
		const routinelinecoloring: routineheadertype = colorRoutineLine(firstline);

		 // effectively replace the routine line (before the line-ending) with spaces so that the offsets are still correct
		const doctoparse = ' '.repeat(firstline.length) + documenttext.substr(firstline.length);

		// maybe use the routine header to adjust the moniker
		let usemoniker = moniker;
		let usemonikeropt = monikeropt;
		const routineheaderinfo = routinelinecoloring.routineheaderinfo;
		if (typeof routineheaderinfo !== 'undefined') {
			const routinetype = routineheaderinfo.routinetype;
			if (typeof routinetype !== 'undefined') {
				switch (routinetype) {
					case 'INT': {
						usemoniker = 'COS';
						usemonikeropt = monikeropttype.INT;
						break;
					}
					case 'MAC':
					case 'INC': {
						usemoniker = 'COS';
						usemonikeropt = monikeropttype.NONE;
						break;
					}
				}
			}
		}

		// parse the rest of the document using Studio libraries
		let restcolors = parseImpl(usemoniker,usemonikeropt,doctoparse);

		// at this point the original restcolors[0] will be either an array with a single whitespace item or an empty array
		// - either way, overwriting that array with the routine line coloring works

		restcolors[0] = routinelinecoloring.compressedline;

		return {'compressedlinearray': restcolors, 'routineheaderinfo': routineheaderinfo};
	}
	else {
		return {'compressedlinearray': parseImpl(moniker,monikeropt,documenttext)};
	}

}

function parseImpl(moniker: string, monikeropt: monikeropttype, documenttext: string, ): compressedline[] {
	const usemoniker = actualMoniker(moniker,monikeropt);
	try {
		return (<compressedcolors>(RUNWITH_COMPRESSED(documenttext,usemoniker,0))).compressedcolors;
	}
	catch (e) {
		console.log('Exception parsing in COMBridge: ' + e);
		console.log(new Error().stack);
		throw e;
	}
}

function actualMoniker(moniker: string, monikeropt: monikeropttype): string {
	
	if (moniker === 'COS' && monikeropt === monikeropttype.INT) {
		return 'INT';
	}

	return moniker;
}

function getFirstLine(documenttext: string): string {
	
	const poslf = documenttext.indexOf('\n');
	if (poslf === -1) {
		return documenttext; // no linefeed => first line is the whole document
	}

	if (poslf > 0 && documenttext.charAt(poslf-1) === '\r') {
		return documenttext.substr(0,poslf-1); // CRLF so return up to but not including the CR
	}
	else {
		return documenttext.substr(0,poslf); // LF  so return up to but not including the LF
	}
}
