
import { LineSource } from "./linesource";
import { keywordstype } from "./routineheaderutils";
import { routineheaderinfotype } from '../../utils/types';
import { cos_label_attrindex, cos_name_attrindex, cos_number_attrindex } from '../../utils/languageDefinitions';



/**
 * Validate the given keyword and color it as a keyword or as a syntax error, as appropriate.
 *
 * @param linesource  with the routine line
 * @param keyword a keyword to be validated
 * @param seenkeywords array of keywords already seen (updated here)
 */
export function validateKeyword(linesource: LineSource, keyword: string, seenkeywords: keywordstype) {

    let syntaxerror;
    try {

        const uckeyword = keyword.toUpperCase();
        if (uckeyword !== UCTYPE && uckeyword !== UCLANGUAGEMODE && uckeyword !== UCGENERATED) {
            throw Error('Unknown keyword');
        }

        if (uckeyword in seenkeywords) {
            throw Error(`${uckeyword[0] + uckeyword.slice(1).toLowerCase()} appears more than once`);
        }
    
        // note that we've seen this keyword
        seenkeywords[uckeyword] = '';
    }
    catch (error) {
        syntaxerror = error;
    }

    if (syntaxerror) {
        linesource.commitError(syntaxerror);
    }
    else {
        linesource.commitToken(cos_label_attrindex);
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

    let syntaxerror;
    let attrindex = -1;

    try {
    
        switch (uckeyword) {
    
            // TYPE
            case UCTYPE: {
    
                if (typeof value === 'undefined') {
                    throw Error('Missing value for Type');
                }
        
                if (!isValidTYPEValue(value)) {
                    throw Error("Type must be one of MAC, INT, INC, BAS, MVB, or MVI");
                }

                routineheaderinfo.routinetype = value.toUpperCase();

                attrindex = cos_name_attrindex;
                
                break;
            }
    
            // LANGUAGEMODE
            case UCLANGUAGEMODE: {
    
                if (typeof value === 'undefined') {
                    throw Error('Missing value for LanguageMode');
                }
        
                let valuemode = Number(value);
                if (isNaN(valuemode) || valuemode < 0) {
                    throw Error('LanguageMode must be an integer')
                }

                routineheaderinfo.languagemode = valuemode;

                attrindex = cos_number_attrindex;

                break;
            }
    
            // GENERATED
            case UCGENERATED: {

                if (typeof value !== 'undefined') {
                    throw Error('Unexpected value for Generated');
                }

                routineheaderinfo.generated = '';

                break;
            }
    
            default: {
                throw Error('Unknown keyword'); // this shouldn't happen because the keyword should have been validated by the caller
            }
        }
    }

    catch (error) {
        syntaxerror = error;
    }
    
    if (typeof value !== 'undefined') {

        if (syntaxerror) {
            linesource.commitError(syntaxerror);
        }
        else {
            linesource.commitToken(attrindex);
        }
    }
    else {

        if (syntaxerror) {
            throw syntaxerror;
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
        case 'INC':
        case 'INT':
        case 'MAC':
        case 'MVB':
        case 'MVI': {
            return true;
        }

        default: {
            return false;
        }
    }
}

