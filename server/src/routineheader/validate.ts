
import { LineSource } from "./linesource";
import { keywordstype, cos_attribute_name, cos_attribute_number, cos_attribute_label } from "./routineheaderutils";
import { routineheaderinfotype } from "../types";



/**
 * Validate the given keyword and color it as a keyword or as a syntax error, as appropriate.
 *
 * @param linesource  with the routine line
 * @param keyword a keyword to be validated
 * @param seenkeywords array of keywords already seen (updated here)
 */
export function validateKeyword(linesource: LineSource, keyword: string, seenkeywords: keywordstype) {

    let syntaxerror = false;
    try {

        const uckeyword = keyword.toUpperCase();
        if (uckeyword !== UCTYPE && uckeyword !== UCLANGUAGEMODE && uckeyword !== UCGENERATED) {
            throw Error('unknown keyword');
        }

        if (uckeyword in seenkeywords) {
            throw Error('keyword \'' + uckeyword + '\' appears more than once');
        }
    
        // note that we've seen this keyword
        seenkeywords[uckeyword] = '';
    }
    catch (error) {
        syntaxerror = true;
    }

    if (syntaxerror) {
        linesource.commitError();
    }
    else {
        linesource.commitToken(cos_attribute_label);
    }
}    


/**
 * Validate the given value and color it as a value or as a syntax error, as appropriate.
 * 
 * @param linesource  with the routine line
 * @param keyword with the previously-validated keyword
 * @param value with either the parsed value or undefined if no value
 */
export function validateKeywordValue(linesource: LineSource, keyword: string, value: string | undefined, routineheaderinfo: routineheaderinfotype) {

    const uckeyword = keyword.toUpperCase();

    let syntaxerror = false;
    let attrindex = -1;

    try {
    
        switch (uckeyword) {
    
            // TYPE
            case UCTYPE: {
    
                if (typeof value === 'undefined') {
                    throw Error('missing value for TYPE');
                }
        
                if (!isValidTYPEValue(value)) {
                    throw Error('invalid value \'' + value + '\' for TYPE');
                }

                routineheaderinfo.routinetype = value.toUpperCase();

                attrindex = cos_attribute_name;
                
                break;
            }
    
            // LANGUAGEMODE
            case UCLANGUAGEMODE: {
    
                if (typeof value === 'undefined') {
                    throw Error('missing value for LANGUAGEMODE');
                }
        
                let valuemode = Number(value);
                if (isNaN(valuemode) || valuemode < 0) {
                    throw Error('invalid value for LANGUAGEMODE value')
                }

                routineheaderinfo.languagemode = valuemode;

                attrindex = cos_attribute_number;

                break;
            }
    
            // GENERATED
            case UCGENERATED: {

                if (typeof value !== 'undefined') {
                    throw Error('unexpected value for GENERATED');
                }

                routineheaderinfo.generated = '';

                break;
            }
    
            default: {
                throw Error('unknown keyword'); // this shouldn't happen because the keyword should have been validated by the caller
            }
        }
    }

    catch (error) {
        syntaxerror = true;
    }
    
    if (typeof value !== 'undefined') {

        if (syntaxerror) {
            linesource.commitError();
        }
        else {
            linesource.commitToken(attrindex);
        }
    }
    else {

        if (syntaxerror) {
            throw Error('syntax error');
        }
    }
}


// --


// the keywords
const UCTYPE = 'TYPE';
const UCLANGUAGEMODE = 'LANGUAGEMODE';
const UCGENERATED = 'GENERATED';


function isValidTYPEValue(value: string): boolean {

    switch (value.toUpperCase()) {

        case 'BAS':
        case 'CLS':
        case 'INC':
        case 'INT':
        case 'MAC':
        case 'MVB':
        case 'MVI':
        case 'XML': {
            return true;
        }

        default: {
            return false;
        }
    }
}

