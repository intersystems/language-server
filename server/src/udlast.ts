
import {compressedline, monikeropttype} from './types';

import {ast,astclass, membertype, astmember} from './udlasttypes';
import {tokensourcetype, itempredicate} from './tokensource';
import { cls_langindex } from './languagedefns';
import { parsedocument } from './parse';


/**
 * Front-end to parseClassDocument which calls the Studio parser and then builds the parse tree, which it returns.
 * If syntax errors are found this returns undefined.
 * @param text 
 */
export function parseClassDocumentText(text: string): ast | undefined {

	const jsonform = parsedocument('CLS',monikeropttype.NONE,text).compressedlinearray;

	let anyerrors = false;
	for (let lineno in jsonform) {
		const line = jsonform[lineno];
		for (let itemno in line) {
			const item = line[itemno];
			if (item.s === 0) {
                anyerrors = true;
                break; // quit the for loop
			}
		}
    }
    
    if (anyerrors) {
        return undefined;
    }

    return parseClassDocument(jsonform, text);
}


/**
 * Expects no whitespace tokens (the default for parse.parsedocument).
 * 
 * DO NOT USE if there are any syntax errors in the document.
 * 
 * @param lines an array of compressedline objects
 * @param textlines either a list of strings or a single string with '\n' delimiting lines
 */
export function parseClassDocument(lines: compressedline[], textarg: string[] | string): ast {

    // make sure we have lines
    const textlines: string[] = (typeof textarg === 'string') ? textarg.split('\n') : textarg;

    // the token reader
    const tokensource: tokensourcetype = new tokensourcetype(lines,textlines);

    // parse the document
    return {'class': parseClass(tokensource)};
}


// parse a class definition
function parseClass(tokensource: tokensourcetype): astclass {

    // parse the 'class' keyword
    tokensource.expectTokenType({'lang': cls_langindex, 'attrindex': udl_keyword, 'text':'class'});

    // parse the class name
    const classname: string = parseClassName(tokensource);

    // fetch everything up to the first member
    const premembertext: string = tokensource.textUpTo(membertypepred);

    // parse the member list
    const memberlist = parseMemberList(tokensource);

    return {
        'header': {'name': classname, 'premembertext': premembertext},
        'memberlist': memberlist
    };
}


// parse a list of member definitions
function parseMemberList(tokensource: tokensourcetype): astmember[] {
    
    const memberlist: astmember[] = [];

    // as long as we see a member keyword ..
    while (!tokensource.ended() && tokensource.peekxIs(membertypepred)) {

        // parse a member
        memberlist.push(parseMember(tokensource));
    }

    return memberlist;
}


// parse a single member definition
function parseMember(tokensource: tokensourcetype): astmember {
    
    // parse the member type keyword
    const membertypename: string = tokensource.expectTokenType(membertypepred).text;
    
    // parse the member name
    const membername: string = tokensource.expectTokenType(identifierpred).text;

    // fetch everything up to the next member
    const restofmembertext: string = tokensource.textUpTo(membertypepred);

    return {
        'type': membertype[membertypename],
        'name': membername,
        'restofmembertext': restofmembertext
    };
}


// parse a class name - one or more simple names separated by dots
function parseClassName(tokensource: tokensourcetype): string {

    let classname = '';

    // as long as the token has type udl_classname ..
    // (the dots between the names have the udl_classname attribute too)
    while (!tokensource.ended() && tokensource.peekxIs(classnamepartpred)) {

        // collect the text
        classname += tokensource.peekText();

        // next token
        tokensource.next();
    }

    return classname;
}


// useful UDL attribute indexes
const udl_keyword = 0x04;
const udl_classname = 0x05;
const udl_delimiter = 0x08;
const udl_identifier = 0x0B;

// predicate for a member type keyword
const membertypepred: itempredicate = {'lang': cls_langindex, 'attrindex': udl_keyword, 'text': function(name: string): boolean {return name.toUpperCase() in membertype}};

// predicate for a class name part
const classnamepartpred: itempredicate = {'lang': cls_langindex, 'attrindex': udl_classname};

// predicate for an identifier
const identifierpred: itempredicate = {'lang': cls_langindex, 'attrindex': udl_identifier};
