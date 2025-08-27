import { DocumentUri, Position, Range, TextDocumentPositionParams } from 'vscode-languageserver/node';
import { documents } from '../utils/variables';
import * as ld from '../utils/languageDefinitions';
import { getParsedDocument } from '../utils/functions';

interface IsolateEmbeddedLanguageParams {
	uri: DocumentUri;
	language: number;
	position: Position;
}

/**
 * Handler function for the `intersystems/embedded/languageAtPosition` request.
 */
export async function languageAtPosition(params: TextDocumentPositionParams): Promise<number> {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) return -1;
	const parsed = await getParsedDocument(params.textDocument.uri);
	if (!parsed) return -1;
	if (params.position.line >= parsed.length) return -1;
	if (!parsed[params.position.line]?.length) return -1;

	let thistoken: number = -1;
	for (let i = 0; i < parsed[params.position.line].length; i++) {
		const symbolstart: number = parsed[params.position.line][i].p;
		const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
		thistoken = i;
		if (params.position.character >= symbolstart && params.position.character <= symbolend) {
			// We found the right symbol in the line
			break;
		}
	}
	return thistoken != -1 ? parsed[params.position.line][thistoken].l : thistoken;
}

/**
 * Handler function for the `intersystems/embedded/isolateEmbeddedLanguage` request.
 */
export async function isolateEmbeddedLanguage(params: IsolateEmbeddedLanguageParams): Promise<string | undefined> {
	const doc = documents.get(params.uri);
	if (doc === undefined) {return undefined;}
	const parsed = await getParsedDocument(params.uri);
	if (parsed === undefined) {return undefined;}
	
	if (params.language == ld.py_langindex) {
		// Embedded language is python

		// Find the member that contains the position
		let positionMemberKeywordLine: number = -1;
		for (let line = 0; line < params.position.line; line++) {
			if (
				parsed[line].length > 1 &&
				parsed[line][0].l == ld.cls_langindex &&
				parsed[line][0].s == ld.cls_keyword_attrindex &&
				parsed[line][0].p == 0
			) {
				positionMemberKeywordLine = line;
			}
		}

		let newText: string[] = doc.getText().split("\n");
		let lastMemberKeyword: string = "";
		let lastMemberName: string = "";
		let lastMemberKeywordLine: number = -1;
		for (let line = 0; line < parsed.length; line++) {
			if (
				parsed[line].length > 1 &&
				parsed[line][0].l == ld.cls_langindex &&
				parsed[line][0].s == ld.cls_keyword_attrindex &&
				parsed[line][0].p == 0
			) {
				// Keep track of the member that we are in
				lastMemberKeyword = doc.getText(Range.create(line,parsed[line][0].p,line,parsed[line][0].p+parsed[line][0].c));
				lastMemberName = doc.getText(Range.create(line,parsed[line][1].p,line,parsed[line][1].p+parsed[line][1].c));
				lastMemberKeywordLine = line;
			}
			for (let tkn = 0; tkn < parsed[line].length; tkn++) {
				if (
					// This token is not the python
					parsed[line][tkn].l != params.language || (
						// We are not in the containing member or the %import XData
						lastMemberKeywordLine != positionMemberKeywordLine &&
						!(lastMemberKeyword.toLowerCase() == "xdata" &&
						lastMemberName.toLowerCase() == "%import")
					)
				) {
					// Replace all text for this token with whitespace
					newText[line] = 
						newText[line].slice(0,parsed[line][tkn].p) +
						" ".repeat(parsed[line][tkn].c) +
						newText[line].slice(parsed[line][tkn].p+parsed[line][tkn].c);
				}
			}
		}

		return newText.join("\n");
	}
	else if (params.language == ld.html_langindex) {
		// Embedded language is HTML

		// Find the offset of the token at params.position
		let newText: string[] = doc.getText().split("\n");
		let thistoken: number = 0;
		for (let i = 0; i < parsed[params.position.line].length; i++) {
			const symbolstart: number = parsed[params.position.line][i].p;
			const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
			thistoken = i;
			if (params.position.character >= symbolstart && params.position.character <= symbolend) {
				// We found the right symbol in the line
				break;
			}
		}

		// Isolate HTML above this token
		let ignoreHTML: boolean = false;
		let firstEmb: "open" | "close" | undefined = undefined;
		for (let line = params.position.line; line >= 0; line--) {
			let starttkn = parsed[line].length - 1;
			if (line == params.position.line) {
				starttkn = thistoken;
			}
			for (let tkn = starttkn; tkn >= 0; tkn--) {
				if (parsed[line][tkn].l == ld.cos_langindex && parsed[line][tkn].s == ld.cos_embo_attrindex) {
					if (firstEmb == undefined) {
						// The first embedding token is open, so replace all HTML before it
						firstEmb = "open";
						ignoreHTML = true;
					} else if (firstEmb == "close") {
						// We're no longer in an embedding, so don't auto-replace all HTML
						ignoreHTML = false;
					}
				}
				if (parsed[line][tkn].l == ld.cos_langindex && parsed[line][tkn].s == ld.cos_embc_attrindex) {
					if (firstEmb == undefined) {
						// The first embedding token is close, so replace all HTML that may be in it
						firstEmb = "close";
						ignoreHTML = true;
					} else if (firstEmb == "close") {
						// Replace all HTML that may be in this embedding
						ignoreHTML = true;
					}
				}
				if ((parsed[line][tkn].l != params.language) || ignoreHTML) {
					// Replace all text for this token with whitespace
					newText[line] = 
						newText[line].slice(0,parsed[line][tkn].p) +
						" ".repeat(parsed[line][tkn].c) +
						newText[line].slice(parsed[line][tkn].p+parsed[line][tkn].c);
				}
			}
		}
		ignoreHTML = false;

		// Isolate HTML below this token
		for (let line = params.position.line; line < parsed.length; line++) {
			let starttkn = 0;
			if (line == params.position.line) {
				starttkn = thistoken;
			}
			for (let tkn = starttkn; tkn < parsed[line].length; tkn++) {
				if (parsed[line][tkn].l == ld.cos_langindex && parsed[line][tkn].s == ld.cos_embo_attrindex) {
					if (firstEmb == "close" || firstEmb == undefined) {
						// Replace all HTML that may be in this embedding
						ignoreHTML = true;
					}
				}
				if (parsed[line][tkn].l == ld.cos_langindex && parsed[line][tkn].s == ld.cos_embc_attrindex) {
					if (firstEmb == "close" || firstEmb == undefined) {
						// We're no longer in an embedding, so don't auto-replace all HTML
						ignoreHTML = false;
					} else {
						// Replace all HTML not in this embedding
						ignoreHTML = true;
					}
				}
				if ((parsed[line][tkn].l != params.language) || ignoreHTML) {
					// Replace all text for this token with whitespace
					newText[line] = 
						newText[line].slice(0,parsed[line][tkn].p) +
						" ".repeat(parsed[line][tkn].c) +
						newText[line].slice(parsed[line][tkn].p+parsed[line][tkn].c);
				}
			}
		}

		return newText.join("\n");
	}
	else if (params.language == ld.css_langindex) {
        // Embedded language is CSS

		// Only keep CSS in this code block (excluding embeddings)
		let newText: string[] = doc.getText().split("\n");
		let startLine: number = 0;
		let endLine: number = parsed.length - 1;
		let found = false;
		// Scan up from position until we hit HTML or XML
		for (let line = params.position.line; line >= 0; line--) {
			for (let tkn = 0; tkn < parsed[line].length; tkn++) {
				if (parsed[line][tkn].l == ld.html_langindex || parsed[line][tkn].l == ld.xml_langindex) {
					startLine = line;
					found = true;
					break;
				}
			}
			if (found) {
				break;
			}
		}
		found = false;

		// Scan down from position until we hit HTML or XML
		for (let line = params.position.line; line < parsed.length; line++) {
			for (let tkn = 0; tkn < parsed[line].length; tkn++) {
				if (parsed[line][tkn].l == ld.html_langindex || parsed[line][tkn].l == ld.xml_langindex) {
					endLine = line;
					found = true;
					break;
				}
			}
			if (found) {
				break;
			}
		}

		// Only keep CSS in between startLine and endLine
		for (let line = 0; line < parsed.length; line++) {
			for (let tkn = 0; tkn < parsed[line].length; tkn++) {
				if (
					parsed[line][tkn].l != params.language ||
					line < startLine ||
					line > endLine || (
						// Also replace CSP extension tokens
						parsed[line][tkn].l == params.language && parsed[line][tkn].s == ld.css_cspext_attrindex
					)
				) {
					// Replace all text for this token with whitespace
					newText[line] = 
						newText[line].slice(0,parsed[line][tkn].p) +
						" ".repeat(parsed[line][tkn].c) +
						newText[line].slice(parsed[line][tkn].p+parsed[line][tkn].c);
				}
			}
		}

		return newText.join("\n");
	}
	else if (params.language == ld.javascript_langindex) {
        // Embedded language is JavaScript

		// Only keep JavaScript in this code block (excluding embeddings)
		let newText: string[] = doc.getText().split("\n");
		let startLine: number = 0;
		let endLine: number = parsed.length - 1;
		let found = false;
		// Scan up from position until we hit HTML or UDL or the &JS COS token
		for (let line = params.position.line; line >= 0; line--) {
			for (let tkn = 0; tkn < parsed[line].length; tkn++) {
				if (
					parsed[line][tkn].l == ld.html_langindex ||
					parsed[line][tkn].l == ld.cls_langindex || (
						parsed[line][tkn].l == ld.cos_langindex &&
						parsed[line][tkn].s == ld.cos_js_attrindex
					)
				) {
					startLine = line;
					found = true;
					break;
				}
			}
			if (found) {
				break;
			}
		}
		found = false;

		// Scan down from position until we hit HTML, UDL or the embedding close for &JS
		for (let line = params.position.line; line < parsed.length; line++) {
			for (let tkn = 0; tkn < parsed[line].length; tkn++) {
				if (
					parsed[line][tkn].l == ld.html_langindex ||
					parsed[line][tkn].l == ld.cls_langindex || (
						parsed[line][tkn].l == ld.cos_langindex &&
						parsed[line][tkn].s == ld.cos_embc_attrindex
					)
				) {
					endLine = line;
					found = true;
					break;
				}
			}
			if (found) {
				break;
			}
		}

		// Only keep JavaScript in between startLine and endLine
		for (let line = 0; line < parsed.length; line++) {
			for (let tkn = 0; tkn < parsed[line].length; tkn++) {
				if (
					parsed[line][tkn].l != params.language ||
					line < startLine ||
					line > endLine || (
						// Also replace CSP extension tokens
						parsed[line][tkn].l == params.language && parsed[line][tkn].s == ld.javascript_cspext_attrindex
					)
				) {
					// Replace all text for this token with whitespace
					newText[line] = 
						newText[line].slice(0,parsed[line][tkn].p) +
						" ".repeat(parsed[line][tkn].c) +
						newText[line].slice(parsed[line][tkn].p+parsed[line][tkn].c);
				}
			}
		}

		return newText.join("\n");
	}
}
