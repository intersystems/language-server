
import { compressedline, routineheaderinfotype } from '../../utils/types';
import { validInRoutineName, isValidRoutineName, isWhitespace, keywordstype } from "./routineheaderutils";
import { LineSource } from "./linesource";
import { validateKeywordValue, validateKeyword } from "./validate";
import { cos_command_attrindex, cos_delim_attrindex, cos_rtnname_attrindex } from '../../utils/languageDefinitions';


/**
 * Return true if documenttext begins with a routine header line
 * @param documenttext at least the first line of the document
 */
export function isRoutineHeader(documenttext: string): boolean {
	return documenttext.toUpperCase().startsWith(ROUTINEWORD) &&
        documenttext.length >= (ROUTINEWORD.length+1) &&
        isWhitespace(documenttext.charAt(ROUTINEWORD.length));
}


export type routineheadertype = {'compressedline': compressedline, 'routineheaderinfo'?: routineheaderinfotype};


/**
 * Return a compressedline with coloring for the routine header line and (if there are no syntax errors) a structure summarizing the routine header.
 * 
 * @param routineline the first line of the document, not including a line terminator
 */
export function colorRoutineLine(routineline: string): routineheadertype {

    let linesource: LineSource = new LineSource(routineline);

    // color the routine line, catching exceptions thrown by the parser
    let routineheaderinfo: routineheaderinfotype = {'routinename': ''};
    let rubbishError: any = new Error("Superfluous text follows correct code");
    try {
        routineheaderinfo = colorRoutineLineImpl(linesource);
    }
    catch (error) {

        // if we're at the end of the line source ..
        // (if we're NOT at the end then the 'trailing rubbish' check below will color it as error)
        if (linesource.ended()) {

            // re-color the last token as an error
            linesource.colorLastAsError(error);
        }
        rubbishError = error;
    }

    /// check for trailing rubbish
    linesource.skipWhitespace();
    if (!linesource.ended()) {

        // color any rubbish as error
        linesource.toEnd();
        linesource.commitError(rubbishError);
    }

    let result: routineheadertype = {'compressedline': linesource.getColoring()};
    if (!linesource.anyErrors()) {
        result.routineheaderinfo = routineheaderinfo;
    }

    return result;
}


// --


const ROUTINEWORD = 'ROUTINE';


/**
 * Return routine header info, or throw an exception on bad coloring.
 * 
 * @param linesource with the routine line
 */
function colorRoutineLineImpl(linesource: LineSource): routineheaderinfotype {

    // routineline: "ROUTINE" WS WS* ROUTINENAME WS* options?
    // options: "[" opt/"," "]"
    // opt: NAME "=" VALUE
	// WS: " " | "\t"
    // ROUTINENAME: (see isValidRoutineName below)

    // parse ROUTINE keyword
    linesource.advance(ROUTINEWORD.length);
    linesource.commitToken(cos_command_attrindex);
    
    // parse routine name
    linesource.skipWhitespace();
    const routinename = parseRoutineName(linesource);    
    let routineheaderinfo: routineheaderinfotype = {'routinename': routinename};    

    // parse options if there's a '[' ..
    linesource.skipWhitespace();
    if (!linesource.ended() && linesource.currentChar() === '[') {

        // cross the '['
        linesource.advance(1);
        linesource.commitToken(cos_delim_attrindex );

        // parse the comma-delimited list of options
        parseOptionsList(linesource,routineheaderinfo);

        // if there's a ']'
        if (!linesource.ended() && linesource.currentChar() === ']') {

            // cross the ']'
            linesource.advance(1);
            linesource.commitToken(cos_delim_attrindex );
        }
        else {
            throw Error('Expected "]"');
        }
    }

    return routineheaderinfo;
}


/**
 * Parse and return the routine name at the current offset in linesource, or throw an exception if there is no routine name.
 * @param linesource with the routine line
 */
function parseRoutineName(linesource: LineSource): string {

    // fetch name
    linesource.skipWhitespace();
    while (!linesource.ended() && validInRoutineName(linesource.currentChar())) {
        linesource.advance(1);
    }

    if (!linesource.anyToken()) {
        throw Error("Invalid routine name");
    }

    const routinename: string = linesource.getToken();

    // check name
    if (!isValidRoutineName(routinename)) {
        linesource.commitError(new Error("Invalid routine name"));
    }
    else {
        linesource.commitToken(cos_rtnname_attrindex);
    }

    return routinename;
}


/**
 * Parse the options list (without the [..]) at the current offset in linesource, or throw an exception if there is a syntax error.
 * @param linesource with the routine line
 */
function parseOptionsList(linesource: LineSource, routineheaderinfo: routineheaderinfotype) {

    let seenkeywords = {};
    while (!linesource.ended()) {

        // parse KEY=VALUE
        parseKeywordAndValue(linesource,seenkeywords,routineheaderinfo);
        
        linesource.skipWhitespace();
        if (linesource.ended()) {
            throw Error('Syntax error in options list');
        }

        // if it's ']' then we're done (the caller will process the ']')
        if (linesource.currentChar() === ']') {
            break;
        }

        // we expect a ',' here
        if (linesource.currentChar() !== ',') {
            throw Error('Expected "," in options list');
        }

        // cross and color the ','
        linesource.advance(1);
        linesource.commitToken(cos_delim_attrindex );
    }
}


/**
 * Parse 'NAME=VALUE'.
 * @param linesource with the routine line
 */
function parseKeywordAndValue(linesource: LineSource, seenkeywords: keywordstype, routineheaderinfo: routineheaderinfotype) {
    
    // parse NAME
    const keyword = parseKeyword(linesource,seenkeywords);

    // if there's an '=' ..
    linesource.skipWhitespace();    
    if (!linesource.ended() && linesource.currentChar() === '=') {

        // cross and color the '='
        linesource.advance(1);
        linesource.commitToken(cos_delim_attrindex );

        // parse VALUE
        parseValue(keyword,linesource,routineheaderinfo); // ignore returned VALUE
    }

    // .. no '=' ..
    else {

        // validate the keyword with no value
        validateKeywordValue(linesource,keyword,undefined,routineheaderinfo);
    }
}


/**
 * Parse a NAME and validate it as a keyword, returning the keyword.
 * 
 * @param linesource with the routine line
 * @param seenkeywords array of keywords already seen
 */
function parseKeyword(linesource: LineSource, seenkeywords: keywordstype): string {

    // parse the keyword - everything up to a delimiter or whitespace
    const keyword = parseToDelimiter(linesource,undefined); // undefined means don't color it

    // validate the keyword and color it appropriately
    validateKeyword(linesource,keyword,seenkeywords);

    return keyword;
}


/**
 * Parse a VALUE and validate it as a keyword of the given type, returning the value.
 * 
 * @param keyword with the previously-parsed keyword
 * @param linesource with the routine line
 */
function parseValue(keyword: string, linesource: LineSource, routineheaderinfo: routineheaderinfotype): string {
    
    // parse the value - everything up to a delimiter or whitespace
    const value = parseToDelimiter(linesource,undefined); // undefined means don't color it

    // validate the value and color it appropriately
    validateKeywordValue(linesource,keyword,value,routineheaderinfo);

    return value
}


/**
 * Parse up to (but not including) the next delimiter and return what we parsed, or throw an exception if there is a syntax error.
 * - a delimiter is one of ",]=" or whitespace.
 * 
 * @param linesource with the routine line
 * @param attrindex how to color the crossed tokens - or undefined, in which case this function leaves the token uncolored
 */
function parseToDelimiter(linesource: LineSource, attrindex: number | undefined): string {

    // note the start position
    linesource.skipWhitespace();
    const startpos = linesource.getPos();

    // cross characters until we see a delimiter or whitespace
    while (!linesource.ended()) {

        const c = linesource.currentChar();
        if (c === ',' || c === ']' || c === '=' || isWhitespace(c)) {
            break; // quit the while loop
        }

        linesource.advance(1);
    }

    // if we didn't cross anything ..
    if (linesource.getPos() === startpos) {
        throw Error('Syntax error');
    }

    // what we crossed
    const result = linesource.getToken();

    // color it if required
    if (typeof attrindex !== 'undefined') {
        linesource.commitToken(attrindex);
    }

    return result;
}

