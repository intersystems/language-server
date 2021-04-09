import { Position, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { compressedline } from './types';
import * as ld from './languagedefns';

/**
 * An EvaluatableExpression represents an expression in a document that can be evaluated by an active debugger or runtime.
 * The result of this evaluation is shown in a tooltip-like widget.
 * If only a range is specified, the expression will be extracted from the underlying document.
 * An optional expression can be used to override the extracted expression.
 * In this case the range is still used to highlight the range in the document.
 */
export type EvaluatableExpression = {

	/*
	 * The range is used to extract the evaluatable expression from the underlying document and to highlight it.
	 */
	range: Range,

	/*
	 * If specified the expression overrides the extracted expression.
	 */
	expression?: string

}

/**
 * Return the [line,offset] of the closing parenthesis token for this argument or subscript list.
 * Arguments `line` and `tkn` should correspond to the token following the open parenthesis.
 * 
 * @param doc The TextDocument.
 * @param parsed The tokenized representation of `doc`.
 * @param line The line that the token is on.
 * @param tkn The offset within `line` that the token is located.
 * @returns The [line,offset] of the closing parenthesis token, or null if it wasn't found.
 */
function findClosingParenToken(doc: TextDocument, parsed: compressedline[], line: number, tkn: number): [number, number] | null {
	var openparen = 0;
	var closingparen = 0;
	var resultline = -1;
	var resulttkn = -1;

	for (let i = line; i < parsed.length; i++) {
		for (let j = 0; j < parsed[i].length; j++) {
			if (i === line && j < tkn) {
				// Skip tokens before the open paren on the starting line
				continue;
			}
			if (parsed[i][j].l === ld.cos_langindex && parsed[i][j].s === ld.cos_delim_attrindex) {
				// This is a COS delimiter
				const tokentext = doc.getText(Range.create(
					Position.create(i,parsed[i][j].p),
					Position.create(i,parsed[i][j].p+parsed[i][j].c)
				));
				if (tokentext === "(") {
					openparen++;
				}
				if (tokentext === ")") {
					closingparen++;
					if (closingparen > openparen) {
						// This is the correct closing paren
						resultline = i;
						resulttkn = j;
						break;
					}
				}
			}
		}
		if (resultline !== -1) {
			// We found the correct closing paren
			break;
		}
	}

	if (resultline !== -1) {
		return [resultline,resulttkn];
	}
	else {
		return null;
	}
}

/**
 * Check if the token trailing `parsed[line,tkn]` is an open parenthesis and if so,
 * determine the line and offet of the first token following that open parenthesis.
 * 
 * @param doc The TextDocument.
 * @param parsed The tokenized representation of `doc`.
 * @param line The line that the token is on.
 * @param tkn The offset within `line` that the token is located.
 * @returns A tuple containing `true` and the line and offset of the first token
 * following the open parenthesis, or [`false`,-1,-1] if the trailing token is
 * not an open parenthesis.
 */
function isTrailingTokenOpenParen(doc: TextDocument, parsed: compressedline[], line: number, tkn: number): [boolean, number, number] {

	var result: [boolean,number,number] = [false,-1,-1];

	if (
		tkn !== parsed[line].length-1 &&
		parsed[line][tkn+1].l === ld.cos_langindex &&
		parsed[line][tkn+1].s === ld.cos_delim_attrindex &&
		doc.getText(Range.create(
			Position.create(line,parsed[line][tkn+1].p),
			Position.create(line,parsed[line][tkn+1].p+parsed[line][tkn+1].c)
		)) === "("
	) {
		// The trailing token is an open parenthesis, so capture the subscript list

		if (tkn+1 === parsed[line].length-1) {
			result = [true,line+1,0];
		}
		else {
			result = [true,line,tkn+2]
		}
	}

	return result;
}

/**
 * Check if the token trailing `parsed[line,tkn]` is an object dot operator.
 * 
 * @param parsed The tokenized representation of the TextDocument.
 * @param line The line that the token is on.
 * @param tkn The offset within `line` that the token is located.
 * @returns Whether the following token is a dot or not.
 */
function isTrailingTokenDot(parsed: compressedline[], line: number, tkn: number): boolean {
	var result: boolean = false;
	if (
		tkn !== parsed[line].length-1 &&
		parsed[line][tkn+1].l === ld.cos_langindex &&
		parsed[line][tkn+1].s === ld.cos_objdot_attrindex
	) {
		result = true;
	}
	return result;
}

/**
 * Return the position of the ##class.
 * Arguments `line` and `tkn` should correspond to the token preceding the closing parenthesis.
 * 
 * @param parsed The tokenized representation of the TextDocument.
 * @param line The line that the token is on.
 * @param tkn The offset within `line` that the token is located.
 * @returns The position of the ##class, or null if it wasn't found.
 */
function findClassSyntax(parsed: compressedline[], line: number, tkn: number): Position | null {
	var resultline = -1;
	var resultchar = -1;

	for (let i = line; i >= 0; i--) {
		for (let j = parsed[i].length-1; j >= 0; j--) {
			if (i === line && j > tkn) {
				// Skip tokens after the closing paren on the starting line
				continue;
			}
			if (parsed[i][j].l === ld.cos_langindex && parsed[i][j].s === ld.cos_clsobj_attrindex) {
				// We found the ##class
				resultline = i;
				resultchar = parsed[i][j].p;
				break;
			}
		}
		if (resultline !== -1) {
			// We found the ##class
			break;
		}
	}

	if (resultline !== -1) {
		return Position.create(resultline,resultchar);
	}
	else {
		return null;
	}
}

/**
 * Return the position of the caret for a global.
 * Arguments `line` and `tkn` should correspond to the token preceding the extended reference closing delimiter.
 * 
 * @param doc The TextDocument.
 * @param parsed The tokenized representation of `doc`.
 * @param line The line that the token is on.
 * @param tkn The offset within `line` that the token is located.
 * @returns The position of the caret, or null if it wasn't found.
 */
function findCaret(doc: TextDocument, parsed: compressedline[], line: number, tkn: number): Position | null {
	var resultline = -1;
	var resultchar = -1;

	for (let i = line; i >= 0; i--) {
		for (let j = parsed[i].length-1; j >= 0; j--) {
			if (i === line && j > tkn) {
				// Skip tokens after the extended reference closing delimiter on the starting line
				continue;
			}
			if (parsed[i][j].l === ld.cos_langindex && parsed[i][j].s === ld.cos_delim_attrindex) {
				// This is a COS delimiter
				const tokenfirstchar = doc.getText(Range.create(
					Position.create(i,parsed[i][j].p),
					Position.create(i,parsed[i][j].p+parsed[i][j].c)
				)).charAt(0);

				if (tokenfirstchar === "^") {
					// We found the caret for the global
					resultline = i;
					resultchar = parsed[i][j].p;
					break;
				}
			}
		}
		if (resultline !== -1) {
			// We found the caret
			break;
		}
	}

	if (resultline !== -1) {
		return Position.create(resultline,resultchar);
	}
	else {
		return null;
	}
}

/**
 * Return the start position of the expression that class parameter token `parsed[line,tkn]` is a part of.
 * 
 * @param doc The TextDocument.
 * @param parsed The tokenized representation of `doc`.
 * @param line The line that the token is on.
 * @param tkn The offset within `line` that the token is located.
 * @returns The start position of the expression, or null if it can't be determined.
 */
function findClassParameterStart(doc: TextDocument, parsed: compressedline[], line: number, tkn: number): Position | null {
	var result: Position | null = Position.create(line,parsed[line][tkn].p);

	// Check that the preceding token is a dot
	if (parsed[line][tkn-1].l === ld.cos_langindex && parsed[line][tkn-1].s === ld.cos_objdot_attrindex) {
		if (parsed[line][tkn-1].c === 2) {
			// This is a double dot, which means we've reached the beginning of the expression
			result = Position.create(line,parsed[line][tkn-1].p);
		}
		else {
			// This is a single dot, so check the token preceding it
			if (
				parsed[line][tkn-2].l === ld.cos_langindex &&
				parsed[line][tkn-2].s === ld.cos_delim_attrindex &&
				doc.getText(Range.create(
					Position.create(line,parsed[line][tkn-2].p),
					Position.create(line,parsed[line][tkn-2].p+parsed[line][tkn-2].c)
				)) === ")"
			) {
				// The preceding token is a closing parenthesis

				// This is ##class() syntax, so find the start of it
				result = findClassSyntax(parsed,line,tkn-3);
			}
			else if (
				parsed[line][tkn-2].l === ld.cos_langindex &&
				parsed[line][tkn-2].s === ld.cos_sysv_attrindex &&
				doc.getText(Range.create(
					Position.create(line,parsed[line][tkn-2].p),
					Position.create(line,parsed[line][tkn-2].p+parsed[line][tkn-2].c)
				)).toLowerCase() === "$this"
			) {
				// The preceding token is $THIS
				result = Position.create(line,parsed[line][tkn-2].p);
			}
			else {
				// The preceding token is something else
				result = null;
			}
		}
	}
	else {
		// A dot must precede a class parameter
		result = null;
	}

	return result;
}

export function findEvaluatableExpression(doc: TextDocument, parsed: compressedline[], line: number, tkn: number): EvaluatableExpression | null {

	var result: EvaluatableExpression | null = null;
	try {
		if (parsed[line][tkn].l !== ld.cos_langindex) {
			return result;
		}

		var resultstart: Position | null = null;
		var resultend: Position | null = null;
		if (
			parsed[line][tkn].s === ld.cos_localvar_attrindex ||
			parsed[line][tkn].s === ld.cos_localdec_attrindex ||
			parsed[line][tkn].s === ld.cos_localundec_attrindex ||
			parsed[line][tkn].s === ld.cos_param_attrindex ||
			parsed[line][tkn].s === ld.cos_otw_attrindex
		) {
			// This is a variable

			resultstart = Position.create(line,parsed[line][tkn].p);
			if (
				tkn > 0 &&
				parsed[line][tkn-1].l === ld.cos_langindex &&
				parsed[line][tkn-1].s === ld.cos_delim_attrindex &&
				doc.getText(Range.create(
					Position.create(line,parsed[line][tkn-1].p),
					Position.create(line,parsed[line][tkn-1].p+parsed[line][tkn-1].c)
				)) === ")"
			) {
				// A variable has ##class() casting syntax in front of it, so it's part of a method casting expression
				// Return null because we don't support evaluating methods 
				resultstart = null;
			}

			if (resultstart !== null) {
				// Check if the trailing token is an open parenthesis
				resultend = Position.create(line,parsed[line][tkn].p+parsed[line][tkn].c);
				const istrailingopenparen = isTrailingTokenOpenParen(doc,parsed,line,tkn);
				if (istrailingopenparen[0]) {
					// The trailing token is an open parenthesis, so capture the subscript or argument list
					const closingparen = findClosingParenToken(doc,parsed,istrailingopenparen[1],istrailingopenparen[2]);
					if (closingparen === null) {
						// Couldn't find the closing parenthesis
						resultend = null;
					}
					else {
						resultend = Position.create(closingparen[0],parsed[closingparen[0]][closingparen[1]].p+parsed[closingparen[0]][closingparen[1]].c);
					}
				}
				// Check if the trailing token is a dot
				else if (isTrailingTokenDot(parsed,line,tkn)) {
					// The trailing token is a dot, so the token following that must be a method or property
					// Return null because we don't support evaluating methods or properties
					resultend = null;
				}
			}
		}
		else if (parsed[line][tkn].s === ld.cos_global_attrindex) {
			// This is a global

			// Check if the preceding token is a ] or |
			resultstart = Position.create(line,parsed[line][tkn].p);
			if (
				tkn > 0 &&
				parsed[line][tkn-1].l === ld.cos_langindex &&
				parsed[line][tkn-1].s === ld.cos_delim_attrindex
			) {
				// The preceding token is a COS delimiter
				const prectokentext = doc.getText(Range.create(
					Position.create(line,parsed[line][tkn-1].p),
					Position.create(line,parsed[line][tkn-1].p+parsed[line][tkn-1].c)
				));
				if (prectokentext === "]" || prectokentext === "|") {
					// The preceding token is an extended reference closing delimiter

					if (tkn-1 === 0) {
						resultstart = findCaret(doc,parsed,line-1,parsed[line-1].length-1);
					}
					else {
						resultstart = findCaret(doc,parsed,line,tkn-2);
					}
				}
			}

			if (resultstart !== null) {
				// Check if the trailing token is an open parenthesis
				resultend = Position.create(line,parsed[line][tkn].p+parsed[line][tkn].c);
				const istrailingopenparen = isTrailingTokenOpenParen(doc,parsed,line,tkn);
				if (istrailingopenparen[0]) {
					// The trailing token is an open parenthesis, so capture the subscript or argument list
					const closingparen = findClosingParenToken(doc,parsed,istrailingopenparen[1],istrailingopenparen[2]);
					if (closingparen === null) {
						// Couldn't find the closing parenthesis
						resultend = null;
					}
					else {
						resultend = Position.create(closingparen[0],parsed[closingparen[0]][closingparen[1]].p+parsed[closingparen[0]][closingparen[1]].c);
					}
				}
			}
		}
		else if (parsed[line][tkn].s === ld.cos_sysv_attrindex || parsed[line][tkn].s === ld.cos_uknzvar_attrindex) {
			// This is a system variable

			resultstart = Position.create(line,parsed[line][tkn].p);
			resultend = Position.create(line,parsed[line][tkn].p+parsed[line][tkn].c);

			// Check if the following token is a class ($SYSTEM.Class.Method() syntax)
			if (
				tkn !== parsed[line].length-1 &&
				parsed[line][tkn+1].l === ld.cos_langindex &&
				parsed[line][tkn+1].s === ld.cos_clsname_attrindex
			) {
				// The following token is a class
				// Return null because we don't support evaluating methods
				resultend = null;
			}

			// Check if the following token is a dot ($THIS.Member syntax)
			if (isTrailingTokenDot(parsed,line,tkn)) {
				// The following token is a dot, so the token following that must be a method or property
				// Return null because we don't support evaluating methods or properties
				resultend = null;
			}
		}
		else if (parsed[line][tkn].s == ld.cos_prop_attrindex) {
			// This is a class parameter

			// Class parameters are parsed as two tokens (#, then the name) so check which one this is
			if (parsed[line][tkn-1].l == ld.cos_langindex && parsed[line][tkn-1].s == ld.cos_prop_attrindex) {
				// This is the second token
				resultstart = findClassParameterStart(doc,parsed,line,tkn-1);
				resultend = Position.create(line,parsed[line][tkn].p+parsed[line][tkn].c);
			}
			else {
				// This is the first token
				resultstart = findClassParameterStart(doc,parsed,line,tkn);
				resultend = Position.create(line,parsed[line][tkn+1].p+parsed[line][tkn+1].c);
			}
		}

		// Create the EvaluatableExpression if both start and end positions were found
		if (resultstart !== null && resultend !== null) {
			const exprrange: Range = Range.create(resultstart,resultend);
			if (resultstart.line !== resultend.line) {
				// The expression is on multiple lines, so strip out the newline characters
				result = {
					range: exprrange,
					expression: doc.getText(exprrange).replace(/\r?\n|\r/g,"")
				};
			}
			else {
				// The expression is on one line
				result = {
					range: exprrange
				};
			}
		}
	} catch (error) {
		// We're doing a lot of jumping between and scanning through tokens so we need to wrap everything
		// in a try/catch in case we accidentally run off the beginning or end of a line of tokens.
		console.log(error);
		return null;
	}
	
	return result;
}
