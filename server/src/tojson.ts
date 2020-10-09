
import {colorinfotype} from './types';

export type jsonpart = {"p": number, "c": number, "l": number, "s": number};
export type jsonline = jsonpart[];

export function tojson(colorinfo: colorinfotype): jsonline[] {
    
    let result: jsonline[] = [];

    let colno = 0;
    let resultline: jsonline = [];
    const colorrecords = colorinfo.colors;
    for (let recno in colorrecords) {

        const rec = colorrecords[recno];

        const attrindex = rec.colorrecord_attrindex;
        if (attrindex === -1) {
            colno = 0;
            result.push(resultline);
            resultline = [];
        }

        else {
            const langindex = toLanguageIndex(rec.colorrecord_languagename);
            const count = rec.colorrecord_source.length;
            resultline.push({"p": colno, "c": count, "l": langindex, "s": attrindex});
            colno += count;
        }
    }

    // we always want to push non-empty lines
    // we only want to push empty lines when there is something in result already
    if (resultline.length !== 0 || result.length !== 0) {
        result.push(resultline);
    }

    return result;
}


function toLanguageIndex(languagename: string): number {
    
    switch (languagename) {
        case "COS": return 1;
        case "CLS": return 3;
        default: return 0; // unknown for now
    }
}