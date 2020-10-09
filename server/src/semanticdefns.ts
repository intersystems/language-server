
import { legendtype, attrinfo, attrinforesult, semanticrules, semanticrulesforlang } from "./types";
import { GETLANGUAGEATTRINFO } from "./bridge.js";
import { LANGUAGES } from "./languagedefns";

export const ERRORATTRINDEX = '0';

export const ERRORFOREGROUND = "#E21111";


// the JSON for this should be pasted into settings
export function colorsettings(): semanticrules {
    
    let sr: semanticrules = {};

    for (let monikerindex in selectedmonikerlist) {

        let srforlang: semanticrulesforlang = {};
        const moniker: string = selectedmonikerlist[monikerindex];
        const monikerattrinfo: attrinfo[] = (<attrinforesult><unknown>(GETLANGUAGEATTRINFO(moniker))).attrinfo;
    
        for (let attrindex in monikerattrinfo) {
            const cai: attrinfo = monikerattrinfo[attrindex];
            const attrname = toSettingsKey(moniker,cai.description);
            if (attrindex === ERRORATTRINDEX) {
                srforlang[attrname] = {'foreground': ERRORFOREGROUND, 'fontStyle': "underline bold"};
            }
            else {
                srforlang[attrname] = {'foreground': '#' + fliprgb(cai.foreground)};
            }
        }

        sr[moniker] = srforlang;
    }

	return sr;
}

export function lookupattr(languageindex: number, attrindex: number): number {
    const moniker: string = LANGUAGES[languageindex].moniker;
    return languageoffsets[moniker] + attrindex;
}

let selectedmonikerlist: string[] = [];

export let studiolegend: string[] = [];
let languageoffsets: {[index:string] : number} = {};

export function setupfixedtables(monikerlist: string[]) {

    selectedmonikerlist = monikerlist.slice();

    let legendoffset = 0;

	for (let monikerindex in monikerlist) {

        let moniker = monikerlist[monikerindex];
        
        languageoffsets[moniker] = legendoffset;

		let monikerattrinfo: attrinfo[];
		try {
			monikerattrinfo = (<attrinforesult><unknown>(GETLANGUAGEATTRINFO(moniker))).attrinfo;
		}
		catch (e) {
			console.log('Exception getting language attributes from COMBridge: ' + e);
			console.log(new Error().stack);
			throw e;
		}
	
		for (let attrindex in monikerattrinfo) {
			const cai: attrinfo = monikerattrinfo[attrindex];
			const attrname = toSettingsKey(moniker,cai.description);
			studiolegend.push(attrname);
		}

		legendoffset += monikerattrinfo.length;
	}
}

function toSettingsKey(moniker: string, attrdescription: string): string {

	return moniker + '_' + attrdescription.replace(/[^a-z0-9+]+/gi,'');
}

export function fliprgb(studiorgb: string): string {
    return studiorgb.substr(4,2) + studiorgb.substr(2,2) + studiorgb.substr(0,2);
}
