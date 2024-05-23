import { Position, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { parse } from 'node-html-parser';

import { ServerSpec, StudioOpenDialogFile, QueryData, compressedline, CommandDoc, LanguageServerConfiguration, MacroContext, DimResult, PossibleClasses, ClassMemberContext } from './types';
import { parsedDocuments, connection, serverSpecs, languageServerSettings, documents, classMemberTypes } from './variables';
import * as ld from './languageDefinitions';

import commands = require("../documentation/commands.json");
import structuredSystemVariables = require("../documentation/structuredSystemVariables.json");
import systemFunctions = require("../documentation/systemFunctions.json");
import systemVariables = require("../documentation/systemVariables.json");

// Initialize turndown and tune it for Documatic HTML
const TurndownService = require('turndown-ext').default;
const turndown = new TurndownService({
	codeBlockStyle: "fenced",
	blankReplacement: (content, node: HTMLElement) => node.nodeName == 'SPAN' ? node.outerHTML : ''
});
turndown.remove("style");
turndown.keep(["span", "table", "tr", "td"]);
turndown.addRule("pre",{
	filter: "pre",
	replacement: function (content: string, node: HTMLElement) {
		let lang = "";
		content = content.replace(/\\\\/g,"\\").replace(/\\\[/g,"[").replace(/\\\]/g,"]");
		let attrVal = node.getAttribute("LANGUAGE");
		if (attrVal === null) {
			try {
				let obj = JSON.parse(content);
				if (obj && typeof obj === "object") {
					lang = "json";
				}
			} catch {
				lang = "objectscript";
			}
		}
		else {
			switch (attrVal.toUpperCase()) {
				case "OBJECTSCRIPT":
				case "COS":
					lang = "objectscript";
					break;
				case "SQL":
					lang = "sql";
					break;
				case "HTML":
					lang = "html";
					break;
				case "XML":
					lang = "xml";
					break;
				case "JAVA":
					lang = "java";
					break;
				case "JAVASCRIPT":
					lang = "javascript";
					break;
				case "CSS":
					lang = "css";
					break;
				case "PYTHON":
					lang = "python";
					break;
			}
		}
		
		return "\n```" + lang + "\n" + content + "\n```\n";
	}
});
turndown.addRule("documaticLinks",{
	filter: ["class","method","property","query","parameter"],
	replacement: function (content: string) {
		return `***${content}***`;
	}
});
turndown.addRule("documaticArgs",{
	filter: "args",
	replacement: function (content: string, node: HTMLElement) {
		if (node.children.length > 0) {
			return `\n#### Arguments:\n${content}\n`;
		}
	}
});
turndown.addRule("documaticArg",{
	filter: "arg",
	replacement: function (content: string, node: HTMLElement) {
		let attrVal = node.getAttribute("name");
		if (attrVal !== null) {
			return `\n- \`${attrVal}\` - ${content}`;
		}
	}
});
turndown.addRule("documaticReturn",{
	filter: "return",
	replacement: function (content: string) {
		return `\n#### Return Value:\n${content}\n`;
	}
});

/**
 * Determine if the command at position (line,token) in doc is a "HALT" or "HANG".
 * 
 * @param doc The TextDocument that the command is in.
 * @param parsed The tokenized representation of doc.
 * @param line The line that the command is in.
 * @param token The offset of the command in the line.
 */
export function haltOrHang(doc: TextDocument, parsed: compressedline[], line: number, token: number): CommandDoc | undefined {
	if (parsed[line][token+1] === undefined) {
		// This is a "halt"
		return commands.find((el) => el.label === "HALT");
	}
	else {
		var nexttokentext = doc.getText(Range.create(Position.create(line,parsed[line][token+1].p),Position.create(line,parsed[line][token+1].p + parsed[line][token+1].c)));
		if (nexttokentext === ":") {
			// There's a postconditional
			nexttokentext = doc.getText(Range.create(Position.create(line,parsed[line][token+2].p),Position.create(line,parsed[line][token+2].p + parsed[line][token+2].c)));
			const restofline = doc.getText(Range.create(Position.create(line,parsed[line][token+2].p + parsed[line][token+2].c),Position.create(line+1,0))).trim();
			if (nexttokentext === "(") {
				var opencount = 1;
				var closecount = 0;
				var lastclose = 0;
				for (let i = 0; i < restofline.length; i++) {
					if (restofline.charAt(i) === "(") {
						opencount++;
					}
					else if (restofline.charAt(i) === ")") {
						closecount++;
					}
					if (opencount === closecount) {
						lastclose= i;
						break;
					}
				}
				if (lastclose === restofline.length-1) {
					// This is a "halt"
					return commands.find((el) => el.label === "HALT");
				}
				else {
					// This is a "hang"
					return commands.find((el) => el.label === "HANG");
				}
			}
			else {
				const restoflinearr = restofline.split(" ");
				if (restoflinearr.length === 1) {
					// This is a "halt"
					return commands.find((el) => el.label === "HALT");
				}
				else {
					// This is a "hang"
					return commands.find((el) => el.label === "HANG");
				}
			}
		}
		else {
			// This is a "hang"
			return commands.find((el) => el.label === "HANG");
		}
	}
};

/**
 * Get the configuration parameters from the cache or the client if the cache is empty.
 */
export async function getLanguageServerSettings(uri: string): Promise<LanguageServerConfiguration> {
	const settings = languageServerSettings.get(uri);
	if (settings == undefined) {
		const newsettings: LanguageServerConfiguration = await connection.workspace.getConfiguration({ scopeUri: uri, section: "intersystems.language-server" });
		languageServerSettings.set(uri, newsettings);
		return newsettings;
	}
	else {
		return settings;
	}
};

/**
 * Find the full range of this word.
 * 
 * @param line The line that the word is in.
 * @param parsed The tokenized representation of the document.
 * @param lineidx The position of the token in the line.
 * @param symbolstart The start of the selected token.
 * @param symbolend The end of the selected token.
 */
export function findFullRange(line: number, parsed: compressedline[], lineidx: number, symbolstart: number, symbolend: number): Range {
	var rangestart: number = symbolstart;
	var rangeend: number = symbolend;
	// Scan backwards on the line to see where the selection starts
	var newidx = lineidx;
	while (true) {
		newidx--;
		if ((newidx == -1) || (parsed[line][newidx].l != parsed[line][lineidx].l) || (parsed[line][newidx].s != parsed[line][lineidx].s)) {
			break;
		}
		else if (parsed[line][newidx].p+parsed[line][newidx].c !== parsed[line][newidx+1].p) {
			// There's whitespace in between the next token and this one
			break;
		}
		rangestart = parsed[line][newidx].p;
	}
	// Scan forwards on the line to see where the selection ends
	var newidx = lineidx;
	while (true) {
		newidx++;
		if ((parsed[line][newidx] === undefined) || (parsed[line][newidx].l != parsed[line][lineidx].l) || (parsed[line][newidx].s != parsed[line][lineidx].s)) {
			break;
		}
		else if (parsed[line][newidx].p !== parsed[line][newidx-1].p+parsed[line][newidx-1].c) {
			// There's whitespace in between the previous token and this one
			break;
		}
		rangeend = parsed[line][newidx].p + parsed[line][newidx].c;
	}
	return Range.create(Position.create(line,rangestart),Position.create(line,rangeend));
};

/**
 * Get the context of the method/routine that a macro is in.
 * 
 * @param doc The TextDocument that the macro is in.
 * @param parsed The tokenized representation of doc.
 * @param line The line that the macro is in.
 */
export function getMacroContext(doc: TextDocument, parsed: compressedline[], line: number): MacroContext {
	var result: MacroContext = {
		docname: "",
		superclasses: [],
		includes: [],
		includegenerators: [],
		imports: [],
		mode: ""
	};
	if (doc.languageId == "objectscript-class") {
		// This is a class
		for (let i = 0; i < parsed.length; i++) {
			if (parsed[i].length === 0) {
				continue;
			}
			else if (parsed[i][0].l == ld.cls_langindex && parsed[i][0].s == ld.cls_keyword_attrindex) {
				// This line starts with a UDL keyword
	
				var keyword = doc.getText(Range.create(i,parsed[i][0].p,i,parsed[i][0].p+parsed[i][0].c));
				if (keyword.toLowerCase() == "class") {
					var seenextends = false;
					for (let j = 1; j < parsed[i].length; j++) {
						if (parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_clsname_attrindex) {
							if (seenextends) {
								// This is a piece of a subclass
								if (result.superclasses.length === 0) {
									result.superclasses.push("");
								}
								result.superclasses[result.superclasses.length-1] = result.superclasses[result.superclasses.length-1].concat(
									doc.getText(Range.create(i,parsed[i][j].p,i,parsed[i][j].p+parsed[i][j].c))
								);
							}
							else {
								result.docname = result.docname.concat(doc.getText(Range.create(i,parsed[i][j].p,i,parsed[i][j].p+parsed[i][j].c)));
							}
						}
						else if (
							parsed[i][j].l == ld.cls_langindex &&
							parsed[i][j].s == ld.cls_keyword_attrindex &&
							doc.getText(Range.create(i,parsed[i][j].p,i,parsed[i][j].p+parsed[i][j].c)).toLowerCase() == "extends"
						) {
							seenextends = true;
						}
						else {
							// This is a delimiter
							if (j === parsed[i].length - 1) {
								// This is the trailing ")"
								break;
							}
							else {
								if (parsed[i][j+1].l == ld.cls_langindex && parsed[i][j+1].s == ld.cls_clsname_attrindex) {
									// This is a "," or the opening "("
									result.superclasses.push("");
								}
								else {
									// This is the trailing ")"
									break;
								}
							}
						}
					}
					break;
				}
				else if (keyword.toLowerCase() === "include" && parsed[i].length > 1) {
					var codes = doc.getText(Range.create(Position.create(i,parsed[i][1].p),Position.create(i,parsed[i][parsed[i].length-1].p+parsed[i][parsed[i].length-1].c)));
					result.includes = codes.replace("(","").replace(")","").replace(/\s+/g,"").split(",");
				}
				else if (keyword.toLowerCase() === "includegenerator" && parsed[i].length > 1) {
					var codes = doc.getText(Range.create(Position.create(i,parsed[i][1].p),Position.create(i,parsed[i][parsed[i].length-1].p+parsed[i][parsed[i].length-1].c)));
					result.includegenerators = codes.replace("(","").replace(")","").replace(/\s+/g,"").split(",");
				}
				else if (keyword.toLowerCase() === "import" && parsed[i].length > 1) {
					var codes = doc.getText(Range.create(Position.create(i,parsed[i][1].p),Position.create(i,parsed[i][parsed[i].length-1].p+parsed[i][parsed[i].length-1].c)));
					result.imports = codes.replace("(","").replace(")","").replace(/\s+/g,"").split(",");
				}
			}
		}
		for (let k = line; k >= 0; k--) {
			if (parsed[k].length === 0) {
				continue;
			}
			if (parsed[k][0].l == ld.cls_langindex && parsed[k][0].s == ld.cls_keyword_attrindex) {
				// This is the definition for the method that the macro is in
				if (
					parsed[k][parsed[k].length-1].l == ld.cls_langindex && parsed[k][parsed[k].length-1].s == ld.cls_delim_attrindex &&
					doc.getText(Range.create(
						Position.create(k,parsed[k][parsed[k].length-1].p),
						Position.create(k,parsed[k][parsed[k].length-1].p+parsed[k][parsed[k].length-1].c)
					)) === "("
				) {
					// This is a multi-line method definition
					for (let mline = k+1; mline < parsed.length; mline++) {
						if (
							parsed[mline][parsed[mline].length-1].l == ld.cls_langindex && parsed[mline][parsed[mline].length-1].s == ld.cls_delim_attrindex &&
							doc.getText(Range.create(
								Position.create(mline,parsed[mline][parsed[mline].length-1].p),
								Position.create(mline,parsed[mline][parsed[mline].length-1].p+parsed[mline][parsed[mline].length-1].c)
							)) !== ","
						) {
							// We've passed the argument lines so look for the CodeMode keyword on this line
							for (let l = 1; l < parsed[mline].length; l++) {
								if (parsed[mline][l].l == ld.cls_langindex && parsed[mline][l].s == ld.cls_keyword_attrindex) {
									const kw = doc.getText(Range.create(Position.create(mline,parsed[mline][l].p),Position.create(mline,parsed[mline][l].p+parsed[mline][l].c)));
									if (kw.toLowerCase() === "codemode") {
										// The CodeMode keyword is set
										const kwval = doc.getText(Range.create(Position.create(mline,parsed[mline][l+2].p),Position.create(mline,parsed[mline][l+2].p+parsed[mline][l+2].c)));
										if (kwval.toLowerCase() === "generator" || kwval.toLowerCase() === "objectgenerator") {
											result.mode = "generator";
										}
										break;
									}
								}
							}
							break;
						}
					}
				}
				else {
					// This is a single-line method definition so look for the CodeMode keyword on this line
					for (let l = 1; l < parsed[k].length; l++) {
						if (parsed[k][l].l == ld.cls_langindex && parsed[k][l].s == ld.cls_keyword_attrindex) {
							const kw = doc.getText(Range.create(Position.create(k,parsed[k][l].p),Position.create(k,parsed[k][l].p+parsed[k][l].c)));
							if (kw.toLowerCase() === "codemode") {
								// The CodeMode keyword is set
								const kwval = doc.getText(Range.create(Position.create(k,parsed[k][l+2].p),Position.create(k,parsed[k][l+2].p+parsed[k][l+2].c)));
								if (kwval.toLowerCase() === "generator" || kwval.toLowerCase() === "objectgenerator") {
									result.mode = "generator";
								}
								break;
							}
						}
					}
				}
				break;
			}
		}
		result.docname = result.docname.concat(".cls");
	}
	else if (doc.languageId == "objectscript-csp") {
		// This is a CSP file

		// The docname doesn't matter as long as it's valid,
		// so use the URI path for convenience
		result.docname = URI.parse(doc.uri).path;

		// Loop through the file until we hit 'line', 
		// looking for CSP:CLASS HTML tags
		var inclasstag: boolean = false;
		var searchname: string = "";
		for (let i = 0; i < line; i++) {
			for (let j = 0; j < parsed[i].length; j++) {
				if (
					parsed[i][j].l == ld.html_langindex &&
					parsed[i][j].s == ld.html_tag_attrindex &&
					doc.getText(Range.create(
						Position.create(i,parsed[i][j].p),
						Position.create(i,parsed[i][j].p+parsed[i][j].c)
					)).toLowerCase() === "csp:class"
				) {
					// This is the start of a CSP:CLASS HTML element
					inclasstag = true;
				}
				else if (
					inclasstag &&
					parsed[i][j].l == ld.html_langindex &&
					parsed[i][j].s == ld.html_delim_attrindex &&
					doc.getText(Range.create(
						Position.create(i,parsed[i][j].p),
						Position.create(i,parsed[i][j].p+parsed[i][j].c)
					)) === ">"
				) {
					// This is a tag close delimiter
					inclasstag = false;
					searchname = "";
				}
				else if (inclasstag && parsed[i][j].l == ld.html_langindex && parsed[i][j].s == ld.html_name_attrindex) {
					// This is an attribute of a CSP:CLASS HTML element
					const nametext: string = doc.getText(Range.create(
						Position.create(i,parsed[i][j].p),
						Position.create(i,parsed[i][j].p+parsed[i][j].c)
					)).toLowerCase();
					if (nametext === "super" || nametext === "import" || nametext === "includes") {
						searchname = nametext;
					}
				}
				else if (searchname !== "" && parsed[i][j].l == ld.html_langindex && parsed[i][j].s == ld.html_str_attrindex) {
					// This is the value of the last attribute that we saw
					const valuearr: string[] = doc.getText(Range.create(
						Position.create(i,parsed[i][j].p),
						Position.create(i,parsed[i][j].p+parsed[i][j].c)
					)).slice(1,-1).split(",");
					if (searchname === "super") {
						result.superclasses = valuearr;
					}
					else if (searchname === "import") {
						result.imports = valuearr;
					}
					else {
						result.includes = valuearr;
					}
					searchname = "";
				}
			}
		}
	}

	if (doc.languageId != "objectscript-csp") {
		// This is not a CSP file so look for #Include lines
		for (let i = 0; i < line; i++) {
			if (i === 0 && doc.languageId != "objectscript-class") {
				// Get the routine name from the ROUTINE header line
				const fullline = doc.getText(Range.create(Position.create(0,0),Position.create(0,parsed[0][parsed[0].length-1].p+parsed[0][parsed[0].length-1].c)));
				result.docname = fullline.split(" ")[1] + ".mac";
			}
			else if (parsed[i].length === 0) {
				continue;
			}
			else if (parsed[i][0].l == ld.cos_langindex && parsed[i][0].s == ld.cos_ppc_attrindex) {
				// This is a preprocessor command
				const command = doc.getText(Range.create(Position.create(i,parsed[i][0].p),Position.create(i,parsed[i][1].p+parsed[i][1].c)));
				if (command.toLowerCase() === "#include") {
					result.includes.push(doc.getText(Range.create(Position.create(i,parsed[i][2].p),Position.create(i,parsed[i][2].p+parsed[i][2].c))));
				} 
			}
		}
	}

	return result;
};

/**
 * Parse a line of ObjectScript code that starts with #Dim and look to see if it contains `selector`.
 * 
 * @param doc The TextDocument that the line is in.
 * @param parsed The tokenized representation of `doc`.
 * @param line The line to parse.
 * @param selector The variable that we're looking for.
 */
export function parseDimLine(doc: TextDocument, parsed: compressedline[], line: number, selector: string): DimResult {
	let result: DimResult = {
		founddim: false,
		class: ""
	};
	for (let k = 2; k < parsed[line].length; k++) {
		if (parsed[line][k].s === ld.cos_localdec_attrindex || parsed[line][k].s === ld.cos_localvar_attrindex) {
			// This is a declared local variable or a public variable
			var localvar = doc.getText(Range.create(Position.create(line,parsed[line][k].p),Position.create(line,parsed[line][k].p+parsed[line][k].c)));
			if (localvar === selector) {
				// This is the #Dim for the selector
				result.founddim = true;
			}
		}
		else if (parsed[line][k].s === ld.cos_command_attrindex) {
			// This is the "As" keyword
			if (result.founddim) {
				const nextword = doc.getText(Range.create(Position.create(line,parsed[line][k+1].p),Position.create(line,parsed[line][k+1].p+parsed[line][k+1].c)));
				if (parsed[line][k+1].s === ld.cos_clsname_attrindex) {
					result.class = doc.getText(findFullRange(line,parsed,k+1,parsed[line][k+1].p,parsed[line][k+1].p+parsed[line][k+1].c));
				}
				else if (nextword.toLowerCase() === "list") {
					result.class = "%Collection.ListOfObj";
				}
				else if (nextword.toLowerCase() === "array") {
					result.class = "%Collection.ArrayOfObj";
				}
			}
			break;
		}
		else if (parsed[line][k].s === ld.cos_oper_attrindex) {
			// This is the "=" operator
			break;
		}
	}
	return result;
};

/**
 * Get the list of all imported packages at this line of a document.
 * 
 * @param doc The TextDocument of the class to examine.
 * @param parsed The tokenized representation of doc.
 * @param line The line in the document that we need to resolve imports at.
 * @param server The server that this document is associated with.
 * 
 * The following optional parameter is only provided when called via computeDiagnostics():
 * @param inheritedpackages An array containing packages imported by superclasses of this class.
 */
export async function getImports(doc: TextDocument, parsed: compressedline[], line: number, server: ServerSpec, inheritedpackages?: string[]): Promise<string[]> {
	var result: string[] = [];
	if (doc.languageId === "objectscript-class") {
		// Look for the "Import" keyword
		var hassupers = false;
		var clsname = "";
		for (let i = 0; i < parsed.length; i++) {
			if (parsed[i].length === 0) {
				continue;
			}
			else if (parsed[i][0].l == ld.cls_langindex && parsed[i][0].s == ld.cls_keyword_attrindex) {
				// This line starts with a UDL keyword
	
				var keyword = doc.getText(Range.create(Position.create(i,parsed[i][0].p),Position.create(i,parsed[i][0].p+parsed[i][0].c))).toLowerCase();
				if (keyword === "import" && parsed[i].length > 1) {
					var codes = doc.getText(Range.create(Position.create(i,parsed[i][1].p),Position.create(i,parsed[i][parsed[i].length-1].p+parsed[i][parsed[i].length-1].c)));
					result = codes.replace("(","").replace(")","").replace(/\s+/g,"").split(",");
				}
				else if (keyword === "class") {
					// Add the current package if it's not explicitly imported
					clsname = doc.getText(findFullRange(i,parsed,1,parsed[i][1].p,parsed[i][1].p+parsed[i][1].c));
					if (!result.includes(clsname.slice(0,clsname.lastIndexOf(".")))) {
						result.push(clsname.slice(0,clsname.lastIndexOf(".")));
					}
					for (let j = 1; j < parsed[i].length; j++) {
						if (
							parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_keyword_attrindex &&
							doc.getText(Range.create(
								Position.create(i,parsed[i][j].p),
								Position.create(i,parsed[i][j].p+parsed[i][j].c)
							)).toLowerCase() === "extends"
						) {
							// The 'Extends' keyword is present
							hassupers = true;
							break;
						}
					}
					break;
				}
			}
		}
		// Look for #import's in the method containing this line
		for (let i = line; i >= 0; i--) {
			if (parsed[i].length === 0) {
				continue;
			}
			if (parsed[i][0].l == ld.cls_langindex && parsed[i][0].s == ld.cls_keyword_attrindex) {
				// This is the definition for the method that the line is in
				break;
			}
			if (
				parsed[i].length > 2 &&
				(parsed[i][0].l == ld.cos_langindex && parsed[i][0].s == ld.cos_ppc_attrindex) &&
				(parsed[i][1].l == ld.cos_langindex && parsed[i][1].s == ld.cos_ppc_attrindex) &&
				(doc.getText(Range.create(Position.create(i,parsed[i][0].p),Position.create(i,parsed[i][1].p+parsed[i][1].c))).toLowerCase() === "#import")
			) {
				// This is a #import
				const restofline = doc.getText(Range.create(Position.create(i,parsed[i][2].p),Position.create(i+1,0)));
				const packages = restofline.match(/(%?[a-z]+(\.a-z)*)/gi);
				if (packages !== null) {
					for (let p of packages) {
						if (!result.includes(p)) {
							result.push(p);
						}
					}
				}
			}
		}
		// If this class has supers, make a query to find any inherited imports
		if (hassupers) {
			if (inheritedpackages !== undefined) {
				// inheritedpackages was passed in from computeDiagnostics()
				for (let pkg of inheritedpackages) {
					if (!result.includes(pkg)) {
						result.push(pkg);
					}
				}
			}
			else {
				const querydata = {
					query: "SELECT $LISTTOSTRING(Importall) AS Importall FROM %Dictionary.CompiledClass WHERE Name = ?",
					parameters: [clsname]
				};
				const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
				if (respdata?.data?.result?.content?.length == 1) {
					// We got data back
					if (respdata.data.result.content[0].Importall != "") {
						const pkgs = respdata.data.result.content[0].Importall.replace(/[^\x20-\x7E]/g,'').split(',');
						for (let pkg of pkgs) {
							if (!result.includes(pkg)) {
								result.push(pkg);
							}
						}
					}
				}
			}
		}
	}
	else if (doc.languageId === "objectscript" || doc.languageId === "objectscript-csp") {
		// Look for #import's above this line
		for (let i = line; i >= 0; i--) {
			if (
				parsed[i].length > 2 &&
				(parsed[i][0].l == ld.cos_langindex && parsed[i][0].s == ld.cos_ppc_attrindex) &&
				(parsed[i][1].l == ld.cos_langindex && parsed[i][1].s == ld.cos_ppc_attrindex) &&
				(doc.getText(Range.create(Position.create(i,parsed[i][0].p),Position.create(i,parsed[i][1].p+parsed[i][1].c))).toLowerCase() === "#import")
			) {
				// This is a #import
				const restofline = doc.getText(Range.create(Position.create(i,parsed[i][2].p),Position.create(i+1,0)));
				const packages = restofline.match(/(%?[a-z]+(\.a-z)*)/gi);
				if (packages !== null) {
					for (let p of packages) {
						if (!result.includes(p)) {
							result.push(p);
						}
					}
				}
			}
		}
		if (result.length === 0) {
			// User package is only auto-imported if there are no other imports
			result.push("User");
		}
	}
	return result;
};

/**
 * Normalize a class name using the import statements at the top of the class, if applicable.
 * Optionally pass in an array of all the files in that database to avoid making an extra REST request and
 * an object to output the number full class names that this short class name may resolve to.
 * 
 * @param doc The TextDocument that the class name is in.
 * @param parsed The tokenized representation of doc.
 * @param clsname The class name to normalize.
 * @param server The server that doc is associated with.
 * @param line The line of doc that we're in.
 * 
 * The following optional parameters are only provided when called via computeDiagnostics():
 * @param allfiles An array of all files in a database.
 * @param possiblecls The number of possible classes that this short class name could map to.
 * @param inheritedpackages An array containing packages imported by superclasses of this class.
 */
export async function normalizeClassname(
	doc: TextDocument, parsed: compressedline[], clsname: string, server: ServerSpec, line: number,
	allfiles?: StudioOpenDialogFile[], possiblecls?: PossibleClasses, inheritedpackages?: string[]
): Promise<string> {
	var result = "";

	if (clsname === "") {
		// Can't normalize an empty string
		return result;
	}
	if (clsname.indexOf("%") === 0) {
		// Any class name that starts with "%" is fully resolved
		if (clsname.indexOf(".") === -1) {
			// This is the special case where "%Library" is shortened to "%"
			return "%Library.".concat(clsname.slice(1));
		}
		else {
			return clsname;
		}
	}
	if (clsname.indexOf(".") !== -1) {
		// Any class name that contains a "." is fully resolved
		return clsname;
	}
	const imports = await getImports(doc,parsed,line,server,inheritedpackages);
	if (imports.length > 0) {
		if (allfiles === undefined) {
			// Get all potential fully qualified classnames
			const querydata = {
				query: "SELECT Name FROM %Dictionary.ClassDefinition WHERE $PIECE(Name,'.',$LENGTH(Name,'.')) = ?",
				parameters: [clsname]
			};
			const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
			if (Array.isArray(respdata?.data?.result?.content) && respdata.data.result.content.length > 0) {
				if (respdata.data.result.content.length === 1) {
					// We got back exactly one class

					const clsobj = respdata.data.result.content[0];
					if (clsobj.Name === clsname) {
						// The one class we got back is exactly the one we were looking for
						result = clsname; 
					}
					else {
						// The class isn't an exact match. Check if any of the imports appear.
						var foundimport = false;
						for (let j = 0; j < imports.length; j++) {
							const numdots = imports[j].replace(/[^\.]/g,"").length;
							if (clsobj.Name.indexOf(imports[j]) === 0 && clsobj.Name.replace(/[^\.]/g,"").length === numdots+1) {
								foundimport = true;
								break;
							}
						}
						if (foundimport) {
							result = clsobj.Name;
						}
					}
				}
				if (respdata.data.result.content.length > 1) {
					// We got data back
					
					const potential = respdata.data.result.content.filter((clsobj) => {
						for (let j = 0; j < imports.length; j++) {
							const numdots = imports[j].replace(/[^\.]/g,"").length;
							if (clsobj.Name.indexOf(imports[j]) === 0 && clsobj.Name.replace(/[^\.]/g,"").length === numdots+1) {
								return true;
							}
						}
						return false;
					});
					if (potential.length === 1) {
						result = potential[0].Name;
					}
				}
			}
		}
		else {
			// This was called from computeDiagnosics(), which already has an array of all the classes in the database
			const filtered = allfiles.filter(file => file.Name.indexOf("."+clsname+".cls") !== -1);
			if (filtered.length === 1) {
				const clsobj = filtered[0];
				if (clsobj.Name.slice(0,-4) === clsname) {
					// The one class we got back is exactly the one we were looking for
					result = clsname; 
				}
				else {
					// The class isn't an exact match. Check if any of the imports appear.
					var foundimport = false;
					for (let j = 0; j < imports.length; j++) {
						const numdots = imports[j].replace(/[^\.]/g,"").length;
						if (clsobj.Name.indexOf(imports[j]) === 0 && clsobj.Name.replace(/[^\.]/g,"").length === numdots+2) {
							foundimport = true;
							break;
						}
					}
					if (foundimport) {
						result = clsobj.Name.slice(0,-4);
					}
				}
			}
			else if (filtered.length > 1) {
				const potential = filtered.filter((clsobj) => {
					for (let j = 0; j < imports.length; j++) {
						const numdots = imports[j].replace(/[^\.]/g,"").length;
						if (clsobj.Name.indexOf(imports[j]) === 0 && clsobj.Name.replace(/[^\.]/g,"").length === numdots+2) {
							return true;
						}
					}
					return false;
				});
				if (potential.length === 1) {
					result = potential[0].Name.slice(0,-4);
				}
				else if (potential.length > 1 && possiblecls !== undefined) {
					possiblecls.num = potential.length;
				}
			}
		}
	}
	else {
		result = clsname;
	}
	return result;
};

/**
 * Determine the normalized name of the class that a member is in and how that class was determined.
 * 
 * @param doc The TextDocument that the class member is in.
 * @param parsed The tokenized representation of doc.
 * @param dot The token number of the ".".
 * @param line The line that the class member is in.
 * @param server The server that doc is associated with.
 * 
 * The following optional parameters are only provided when called via computeDiagnostics():
 * @param allfiles An array of all files in a database.
 * @param inheritedpackages An array containing packages imported by superclasses of this class.
 */
export async function getClassMemberContext(
	doc: TextDocument, parsed: compressedline[], dot: number, line: number,
	server: ServerSpec, allfiles?: StudioOpenDialogFile[], inheritedpackages?: string[]
): Promise<ClassMemberContext> {
	var result: ClassMemberContext = {
		baseclass: "",
		context: ""
	};
	
	if (
		doc.getText(Range.create(
			Position.create(line,parsed[line][dot].p),
			Position.create(line,parsed[line][dot].p+parsed[line][dot].c)
		)) === ".."
	) {
		// This is relative dot syntax
			
		// Find the class name
		for (let i = 0; i < parsed.length; i++) {
			if (parsed[i].length === 0) {
				continue;
			}
			else if (parsed[i][0].l == ld.cls_langindex && parsed[i][0].s == ld.cls_keyword_attrindex) {
				// This line starts with a UDL keyword
	
				var keyword = doc.getText(Range.create(Position.create(i,parsed[i][0].p),Position.create(i,parsed[i][0].p+parsed[i][0].c)));
				if (keyword.toLowerCase() === "class") {
					for (let j = 1; j < parsed[i].length; j++) {
						if (parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_clsname_attrindex) {
							result.baseclass = result.baseclass.concat(doc.getText(Range.create(Position.create(i,parsed[i][j].p),Position.create(i,parsed[i][j].p+parsed[i][j].c))));
						}
						else if (parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_keyword_attrindex) {
							// We hit the 'Extends' keyword
							break;
						}
					}
					break;
				}
			}
		}
		// Find the type of this method
		for (let k = line-1; k >= 0; k--) {
			if (parsed[k].length === 0) {
				continue;
			}
			if (parsed[k][0].l == ld.cls_langindex && parsed[k][0].s == ld.cls_keyword_attrindex) {
				// This is the definition for the method that the selector is in
				const keytext = doc.getText(Range.create(Position.create(k,parsed[k][0].p),Position.create(k,parsed[k][0].p+parsed[k][0].c)));
				if (keytext.toLowerCase() === "method") {
					result.context = "instance";
				}
				else {
					result.context = "class";
				}
				break;
			}
		}
	}
	else if (
		dot > 0 && parsed[line][dot-1].l == ld.cos_langindex && parsed[line][dot-1].s == ld.cos_delim_attrindex &&
		doc.getText(Range.create(
			Position.create(line,parsed[line][dot-1].p),
			Position.create(line,parsed[line][dot-1].p+parsed[line][dot-1].c)
		)) === ")"
	) {
		// The token before the dot is a close parenthesis

		if (dot-1 > 0 && parsed[line][dot-2].l == ld.cos_langindex && parsed[line][dot-2].s == ld.cos_clsname_attrindex) {
			// This is the end of a ##class

			const clstext = doc.getText(findFullRange(line,parsed,dot-2,parsed[line][dot-2].p,parsed[line][dot-2].p+parsed[line][dot-2].c));
			if (clstext.charAt(0) === '"') {
				// This class name is delimited with double quotes and is fully qualified
				result = {
					baseclass: clstext.slice(1,-1),
					context: "class"
				};
			}
			else {
				result = {
					baseclass: await normalizeClassname(
						doc, parsed,
						doc.getText(findFullRange(line,parsed,dot-2,parsed[line][dot-2].p,parsed[line][dot-2].p+parsed[line][dot-2].c)),
						server, line, allfiles, undefined, inheritedpackages
					),
					context: "class"
				};
			}
		}
		else {
			// This is potentially a chained method call

			// Loop backwards in the file and look for the first open parenthesis that isn't closed
			const [openln, opentkn] = findOpenParen(doc,parsed,line,dot-1);

			if (openln !== -1 && opentkn !== -1) {
				// We found an open parenthesis token that wasn't closed

				// Check the language and attribute of the token before the "("
				if (
					parsed[openln][opentkn-1].l == ld.cos_langindex && 
					(parsed[openln][opentkn-1].s == ld.cos_method_attrindex || parsed[openln][opentkn-1].s == ld.cos_mem_attrindex)
				) {
					// This is a method or multidimensional property
					
					// Get the full text of the member
					const member = quoteUDLIdentifier(doc.getText(Range.create(
						Position.create(openln,parsed[openln][opentkn-1].p),
						Position.create(openln,parsed[openln][opentkn-1].p+parsed[openln][opentkn-1].c)
					)),0);

					// Get the base class that this member is in
					const membercontext = await getClassMemberContext(doc,parsed,opentkn-2,openln,server);
					if (membercontext.baseclass !== "") {
						// Query the database to find the return type of this method, if it has one
						const querydata: QueryData = {
							query: "SELECT ReturnType, Stub FROM %Dictionary.CompiledMethod WHERE parent->id = ? AND Name = ?",
							parameters: [membercontext.baseclass,member]
						};
						const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
						if (Array.isArray(respdata?.data?.result?.content) && respdata.data.result.content.length > 0) {
							// We got data back

							let memobj = respdata.data.result.content[0];
							if (respdata.data.result.content[0].Stub !== "") {
								// This is a method generated by member inheritance, so we need to get its type from the proper subtable
		
								const stubarr = respdata.data.result.content[0].Stub.split(".");
								let stubquery = "";
								if (stubarr[2] === "i") {
									// This is a method generated from an index
									stubquery = "SELECT ReturnType FROM %Dictionary.CompiledIndexMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
								}
								if (stubarr[2] === "q") {
									// This is a method generated from a query
									stubquery = "SELECT ReturnType FROM %Dictionary.CompiledQueryMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
								}
								if (stubarr[2] === "a") {
									// This is a method generated from a property
									stubquery = "SELECT ReturnType FROM %Dictionary.CompiledPropertyMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
								}
								if (stubarr[2] === "n") {
									// This is a method generated from a constraint
									stubquery = "SELECT ReturnType FROM %Dictionary.CompiledConstraintMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
								}
								if (stubquery !== "") {
									const stubrespdata = await makeRESTRequest("POST",1,"/action/query",server,{
										query: stubquery,
										parameters: [stubarr[1],membercontext.baseclass,stubarr[0]]
									});
									if (Array.isArray(stubrespdata?.data?.result?.content) && stubrespdata.data.result.content.length > 0) {
										// We got data back
										memobj = stubrespdata.data.result.content[0];
									}
								}
							}

							if (memobj.ReturnType !== "") {
								result = {
									baseclass: memobj.ReturnType,
									context: "instance"
								};
							}
						}
					}
				}
			}
		}
	}
	else if (dot > 0 && parsed[line][dot-1].l == ld.cos_langindex && parsed[line][dot-1].s == ld.cos_clsname_attrindex) {
		// The token before the dot is part of a class name

		result = {
			baseclass: "%SYSTEM".concat(doc.getText(findFullRange(line,parsed,dot-1,parsed[line][dot-1].p,parsed[line][dot-1].p+parsed[line][dot-1].c))),
			context: "system"
		};
	}
	else if (dot > 0 && parsed[line][dot-1].l == ld.cos_langindex && parsed[line][dot-1].s == ld.cos_param_attrindex) {
		// The token before the dot is a parameter

		const paramcon = await determineParameterClass(doc,parsed,line,dot-1,server);
		if (paramcon !== undefined) {
			result = paramcon;
		}
	}
	else if (dot > 0 && parsed[line][dot-1].l == ld.cos_langindex && (parsed[line][dot-1].s == ld.cos_localdec_attrindex || parsed[line][dot-1].s == ld.cos_localvar_attrindex)) {
		// The token before the dot is a declared local variable or public variable 

		// First check if it's #Dim'd
		let varContext = await determineDeclaredLocalVarClass(doc,parsed,line,dot-1,server,allfiles,inheritedpackages);
		if (varContext === undefined) {
			// If it's not, check if it's Set using %New(), %Open() or %OpenId()
			varContext = await determineUndeclaredLocalVarClass(doc,parsed,line,dot-1,server,allfiles,inheritedpackages);
		}
		if (varContext !== undefined) {
			result = varContext;
		}
	}
	else if (dot > 0 && parsed[line][dot-1].l == ld.cos_langindex && parsed[line][dot-1].s == ld.cos_sysv_attrindex) {
		// The token before the dot is a system variable

		const thisvar = doc.getText(findFullRange(line,parsed,dot-1,parsed[line][dot-1].p,parsed[line][dot-1].p+parsed[line][dot-1].c)).toLowerCase();
		if (thisvar === "$this") {
			// Find the class name
			for (let i = 0; i < parsed.length; i++) {
				if (parsed[i].length === 0) {
					continue;
				}
				else if (parsed[i][0].l == ld.cls_langindex && parsed[i][0].s == ld.cls_keyword_attrindex) {
					// This line starts with a UDL keyword
		
					var keyword = doc.getText(Range.create(Position.create(i,parsed[i][0].p),Position.create(i,parsed[i][0].p+parsed[i][0].c)));
					if (keyword.toLowerCase() === "class") {
						for (let j = 1; j < parsed[i].length; j++) {
							if (parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_clsname_attrindex) {
								result.baseclass = result.baseclass.concat(doc.getText(Range.create(Position.create(i,parsed[i][j].p),Position.create(i,parsed[i][j].p+parsed[i][j].c))));
								result.context = "instance";
							}
							else if (parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_keyword_attrindex) {
								// We hit the 'Extends' keyword
								break;
							}
						}
						break;
					}
				}
			}
		}
	}
	else if (dot > 0 && parsed[line][dot-1].l == ld.cos_langindex && parsed[line][dot-1].s == ld.cos_attr_attrindex && dot >= 2) {
		// The token before the dot is an object attribute

		// This is a chained reference, so get the base class of the previous token
		const prevtokenctxt = await getClassMemberContext(doc,parsed,dot-2,line,server,allfiles,inheritedpackages);
		if (prevtokenctxt.baseclass !== "" && prevtokenctxt.baseclass !== "%Library.DynamicArray" && prevtokenctxt.baseclass !== "%Library.DynamicObject") {
			// We got a base class for the previous token
			// Skip JSON base classes because they don't have any UDL Properties
			const attrtxt = quoteUDLIdentifier(doc.getText(Range.create(
				Position.create(line,parsed[line][dot-1].p),
				Position.create(line,parsed[line][dot-1].p+parsed[line][dot-1].c)
			)),0);

			// Query the database to find the type of this attribute, if it has one
			const querydata: QueryData = {
				query: "SELECT RuntimeType FROM %Dictionary.CompiledProperty WHERE parent->id = ? AND Name = ?",
				parameters: [prevtokenctxt.baseclass,attrtxt]
			};
			const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
			if (respdata !== undefined && respdata.data.result.content.length > 0) {
				result = {
					baseclass: respdata.data.result.content[0].RuntimeType,
					context: "instance"
				};
			}
		}
	}
	else if (dot > 0 && parsed[line][dot-1].l == ld.cos_langindex && (parsed[line][dot-1].s == ld.cos_otw_attrindex || parsed[line][dot-1].s == ld.cos_localundec_attrindex)) {
		// The token before the dot is an undeclared local variable

		const localundeccon = await determineUndeclaredLocalVarClass(doc,parsed,line,dot-1,server,allfiles,inheritedpackages);
		if (localundeccon !== undefined) {
			result = localundeccon;
		}
	}

	return result;
};

/**
 * Send a REST request to an InterSystems server.
 * 
 * @param method The REST method.
 * @param api The version of the Atelier API required for this request.
 * @param path The path portion of the URL.
 * @param server The server to send the request to.
 * @param data Optional request data. Usually passed for POST requests.
 * @param checksum Optional checksum. Only passed for SASchema requests.
 * @param params Optional URL parameters. Only passed for GET /doc/ requests.
 */
export async function makeRESTRequest(method: "GET"|"POST", api: number, path: string, server: ServerSpec, data?: any, checksum?: string, params?: any): Promise<any | undefined> {
	// As of version 2.0.0, REST requests are made on the client side
	return connection.sendRequest("intersystems/server/makeRESTRequest", {
		method,
		api,
		path,
		server,
		data,
		checksum,
		params
	}).then((respdata) => respdata ?? undefined);
}

/**
 * Get the ServerSpec for this document, or ask the client if it's not in the cache.
 * 
 * @param uri The TextDocument URI
 */
export async function getServerSpec(uri: string): Promise<ServerSpec> {
	const spec = serverSpecs.get(uri);
	if (spec !== undefined) {
		return spec;
	}
	const newspec: ServerSpec = await connection.sendRequest("intersystems/server/resolveFromUri",uri);
	serverSpecs.set(uri, newspec);
	return newspec;
};

/**
 * Create the URI for the result of a 'textDocument/definition' request.
 * 
 * @param paramsUri The URI of the document that the definition request was made on.
 * @param filename The name of the file that contains the definition.
 * @param ext The extension of the file that contains the definition, including the leading dot.
 */
export async function createDefinitionUri(paramsUri: string, filename: string, ext: string): Promise<string> {
	try {
		let newuri: string | null = await connection.sendRequest("intersystems/uri/forDocument",filename+ext);
		if (newuri === "") {
			// The active version of the main extension doesn't expose DocumentContentProvider.getUri().
			// Therefore, we need to use the old functionality.
			
			var thisdocuri: string = paramsUri;
			if (paramsUri.slice(0,4) === "file") {
				thisdocuri = await connection.sendRequest("intersystems/uri/localToVirtual",paramsUri);
			}
			var urijson = URI.parse(thisdocuri).toJSON();
			urijson.path = "/" + filename.replace(/\./g,"/") + ext;
			
			// Remove the "csp" query parameter if it's present
			if (urijson.query !== undefined) {
				var queryparams: string[] = urijson.query.split("&");
				const cspidx: number = Math.max(queryparams.indexOf("csp"),queryparams.indexOf("csp=1"));
				if (cspidx >= 0) {
					queryparams.splice(cspidx,1);
				}
				urijson.query = queryparams.join("&");
			}

			newuri = URI.from(urijson).toString();
		}
		else if (newuri == null) {
			// The main extension failed to create the URI
			newuri = "";
		}
		return newuri;
	}
	catch (error) {
		return "";
	}
};

/**
 * Determine if the selected macro is defined in the current file.
 * Returns the line number of the macro definition if it was found or -1 if it wasn't.
 * 
 * @param doc The TextDocument that the macro is in.
 * @param parsed The tokenized representation of doc.
 * @param line The line that the macro is in.
 * @param macro The selected macro.
 */
export function isMacroDefinedAbove(doc: TextDocument, parsed: compressedline[], line: number, macro: string): number {
	var result: number = -1;

	// Scan up through the file, looking for macro definitions
	for (let ln = line-1; ln >= 0; ln--) {
		if (parsed[ln].length < 4) {
			continue;
		}
		if (parsed[ln][0].l == ld.cos_langindex && parsed[ln][0].s == ld.cos_ppc_attrindex) {
			// This line begins with a preprocessor command
			const ppctext = doc.getText(Range.create(
				Position.create(ln,parsed[ln][1].p),
				Position.create(ln,parsed[ln][1].p+parsed[ln][1].c)
			)).toLowerCase();
			if (ppctext === "define" || ppctext === "def1arg") {
				// This is a macro definition
				const macrotext = doc.getText(Range.create(
					Position.create(ln,parsed[ln][2].p),
					Position.create(ln,parsed[ln][2].p+parsed[ln][2].c)
				));
				if (macrotext === macro) {
					// We found the definition for the selected macro
					result = ln;
					break;
				}
			}
		}
	}

	return result;
}

/**
 * Look through this line of a method definition for parameter "thisparam".
 * If it's found, return its class. Helper method for getClassMemberContext().
 * 
 * @param doc The TextDocument that the method definition is in.
 * @param parsed The tokenized representation of doc.
 * @param line The line that the method definition is in.
 * @param server The server that doc is associated with.
 * @param thisparam The parameter that we're looking for.
 * 
 * The following optional parameters are only provided when called via computeDiagnostics():
 * @param allfiles An array of all files in a database.
 * @param inheritedpackages An array containing packages imported by superclasses of this class.
 */
export async function findMethodParameterClass(
	doc: TextDocument, parsed: compressedline[], line: number, server: ServerSpec,
	thisparam: string, allfiles?: StudioOpenDialogFile[], inheritedpackages?: string[]
): Promise<ClassMemberContext | undefined> {
	var result: ClassMemberContext | undefined = undefined;
	for (let tkn = 0; tkn < parsed[line].length; tkn++) {
		if (parsed[line][tkn].l == ld.cls_langindex && parsed[line][tkn].s == ld.cls_param_attrindex) {
			// This is a parameter
			const paramtext = doc.getText(Range.create(
				Position.create(line,parsed[line][tkn].p),
				Position.create(line,parsed[line][tkn].p+parsed[line][tkn].c)
			));
			if (thisparam === paramtext) {
				// This is the correct parameter
				if (parsed[line][tkn+1].l == ld.cls_langindex && parsed[line][tkn+1].s == ld.cls_keyword_attrindex) {
					// The token following the parameter name is "as", so this parameter has a type
					const clsname = doc.getText(findFullRange(line,parsed,tkn+2,parsed[line][tkn+2].p,parsed[line][tkn+2].p+parsed[line][tkn+2].c));
					result = {
						baseclass: await normalizeClassname(doc,parsed,clsname,server,line,allfiles,undefined,inheritedpackages),
						context: "instance"
					};
				}
				else if (
					parsed[line][tkn+1].l == ld.cls_langindex && parsed[line][tkn+1].s == ld.cls_delim_attrindex &&
					doc.getText(Range.create(
						Position.create(line,parsed[line][tkn+1].p),
						Position.create(line,parsed[line][tkn+1].p+parsed[line][tkn+1].c)
					)) === "..."
				) {
					// The token following the parameter name is "...", so this is a variable argument parameter
					if (parsed[line][tkn+2].l == ld.cls_langindex && parsed[line][tkn+2].s == ld.cls_keyword_attrindex) {
						// The token following the "..." is "as", so this parameter has a type
						const clsname = doc.getText(findFullRange(line,parsed,tkn+3,parsed[line][tkn+3].p,parsed[line][tkn+3].p+parsed[line][tkn+3].c));
						result = {
							baseclass: await normalizeClassname(doc,parsed,clsname,server,line,allfiles,undefined,inheritedpackages),
							context: "instance"
						};
					}
				}
				break;
			}
		}
	}
	return result;
}

/**
 * Normalize a system function, variable or structured system variable
 * name according to the language server configuration settings.
 * 
 * @param name The name of this system object. Must be in the "default" state, which is long form and all uppercase.
 * @param type The type of this system object.
 * @param settings The language server configuration settings.
 */
export function normalizeSystemName(name: string, type: "sf"|"sv"|"ssv"|"unkn", settings: LanguageServerConfiguration): string {
	var result: string = "";
	if (type === "sf") {
		// This is a system function

		const sysfdoc = systemFunctions.find((el) => el.label === name.toUpperCase());
		if (sysfdoc !== undefined) {
			var idealsysftext = "";
			if (settings.formatting.system.length === "short" && sysfdoc.alias.length === 2) {
				idealsysftext = sysfdoc.alias[1];
			}
			else {
				idealsysftext = sysfdoc.label;
			}
			if (settings.formatting.system.case === "lower") {
				idealsysftext = idealsysftext.toLowerCase();
			}
			else if (settings.formatting.system.case === "word") {
				if (idealsysftext === "$BITCOUNT") {idealsysftext = "$BitCount";}
				else if (idealsysftext === "$BITFIND") {idealsysftext = "$BitFind";}
				else if (idealsysftext === "$BITLOGIC") {idealsysftext = "$BitLogic";}
				else if (idealsysftext === "$CLASSMETHOD") {idealsysftext = "$ClassMethod";}
				else if (idealsysftext === "$CLASSNAME") {idealsysftext = "$ClassName";}
				else if (idealsysftext === "$FNUMBER") {idealsysftext = "$FNumber";}
				else if (idealsysftext === "$INUMBER") {idealsysftext = "$INumber";}
				else if (idealsysftext === "$ISOBJECT") {idealsysftext = "$IsObject";}
				else if (idealsysftext === "$ISVALIDNUM") {idealsysftext = "$IsValidNum";}
				else if (idealsysftext === "$ISVALIDDOUBLE") {idealsysftext = "$IsValidDouble";}
				else if (idealsysftext === "$LISTBUILD") {idealsysftext = "$ListBuild";}
				else if (idealsysftext === "$LISTDATA") {idealsysftext = "$ListData";}
				else if (idealsysftext === "$LISTFIND") {idealsysftext = "$ListFind";}
				else if (idealsysftext === "$LISTFROMSTRING") {idealsysftext = "$ListFromString";}
				else if (idealsysftext === "$LISTGET") {idealsysftext = "$ListGet";}
				else if (idealsysftext === "$LISTLENGTH") {idealsysftext = "$ListLength";}
				else if (idealsysftext === "$LISTNEXT") {idealsysftext = "$ListNext";}
				else if (idealsysftext === "$LISTSAME") {idealsysftext = "$ListSame";}
				else if (idealsysftext === "$LISTTOSTRING") {idealsysftext = "$ListToString";}
				else if (idealsysftext === "$LISTUPDATE") {idealsysftext = "$ListUpdate";}
				else if (idealsysftext === "$LISTVALID") {idealsysftext = "$ListValid";}
				else if (idealsysftext === "$NCONVERT") {idealsysftext = "$NConvert";}
				else if (idealsysftext === "$PREFETCHOFF") {idealsysftext = "$PrefetchOff";}
				else if (idealsysftext === "$PREFETCHON") {idealsysftext = "$PrefetchOn";}
				else if (idealsysftext === "$QLENGTH") {idealsysftext = "$QLength";}
				else if (idealsysftext === "$QSUBSCRIPT") {idealsysftext = "$QSubscript";}
				else if (idealsysftext === "$SCONVERT") {idealsysftext = "$SConvert";}
				else if (idealsysftext === "$SORTBEGIN") {idealsysftext = "$SortBegin";}
				else if (idealsysftext === "$SORTEND") {idealsysftext = "$SortEnd";}
				else if (idealsysftext.charAt(1) === "W") {
					idealsysftext = idealsysftext.slice(0,3) + idealsysftext.slice(3).toLowerCase();
				}
				else if (idealsysftext.charAt(1) === "Z" && idealsysftext.charAt(2) !== "O" && idealsysftext.charAt(2) !== "F") {
					idealsysftext = idealsysftext.slice(0,3) + idealsysftext.slice(3).toLowerCase();
				}
				else {
					idealsysftext = idealsysftext.slice(0,2) + idealsysftext.slice(2).toLowerCase();
				}
			}
			result = idealsysftext;
		}
	}
	else if (type === "ssv") {
		// This is a structured system variable

		const ssysvdoc = structuredSystemVariables.find((el) => el.label === name.toUpperCase());
		if (ssysvdoc !== undefined) {
			var idealssysvtext = "";
			if (settings.formatting.system.length === "short" && ssysvdoc.alias.length === 2) {
				idealssysvtext = ssysvdoc.alias[1];
			}
			else {
				idealssysvtext = ssysvdoc.label;
			}
			if (settings.formatting.system.case === "lower") {
				idealssysvtext = idealssysvtext.toLowerCase();
			}
			else if (settings.formatting.system.case === "word") {
				idealssysvtext = idealssysvtext.slice(0,3) + idealssysvtext.slice(3).toLowerCase();
			}
			result = idealssysvtext;
		}
	}
	else if (type === "sv") {
		// This is a system variable

		const sysvdoc = systemVariables.find((el) => el.label === name.toUpperCase());
		if (sysvdoc !== undefined) {
			var idealsysvtext = "";
			if (settings.formatting.system.length === "short" && sysvdoc.alias.length === 2) {
				idealsysvtext = sysvdoc.alias[1];
			}
			else {
				idealsysvtext = sysvdoc.label;
			}
			if (settings.formatting.system.case === "lower") {
				idealsysvtext = idealsysvtext.toLowerCase();
			}
			else if (settings.formatting.system.case === "word") {
				if (idealsysvtext.charAt(1) === "Z") {
					idealsysvtext = idealsysvtext.slice(0,3) + idealsysvtext.slice(3).toLowerCase();
				}
				else {
					idealsysvtext = idealsysvtext.slice(0,2) + idealsysvtext.slice(2).toLowerCase();
				}
			}
			result = idealsysvtext;
		}
	}
	else {
		// This is an unknown Z function or variable

		var idealunknstext = name;
		if (settings.formatting.system.case === "upper") {
			idealunknstext = idealunknstext.toUpperCase();
		}
		else if (settings.formatting.system.case === "lower") {
			idealunknstext = idealunknstext.toLowerCase();
		}
		else {
			idealunknstext = idealunknstext.slice(0,3).toUpperCase() + idealunknstext.slice(3).toLowerCase();
		}
		result = idealunknstext;
	}
	return result;
}

/**
 * Escape a UDL identifier using quotes, if necessary.
 * 
 * @param identifier The identifier to modify.
 * @param direction Pass 1 to add quotes if necessary, 0 to remove existing quotes.
 */
export function quoteUDLIdentifier(identifier: string, direction: 0 | 1): string {
	var result: string = identifier;
	if (direction === 0 && identifier.indexOf('"') === 0) {
		// Remove first and last characters
		result = result.slice(1,-1);
		// Turn any "" into "
		result = result.replace(/""/g,'"');
	}
	else if (direction === 1 && identifier.indexOf('"') !== 0) {
		var needsquoting: boolean = false;
		for (let i = 0; i < result.length; i++) {
			const char: string = result.charAt(i);
			const code: number = result.charCodeAt(i);
			if (i === 0) {
				if (!(char === "%" || (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || code > 0x80)) {
					needsquoting = true;
					break;
				}
			}
			else {
				if (!((char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || code > 0x80 || (char >= '0' && char <= '9'))) {
					needsquoting = true;
					break;
				}
			}
		}
		if (needsquoting) {
			// Turn any " into ""
			result = result.replace(/"/g,'""');
			// Add " to start and end of identifier
			result = '"' + result + '"';
		}
	}
	return result;
}

/**
 * Determine the normalized name of the class for the parameter at (line,tkn).
 * If it's found, return its class. Helper method for getClassMemberContext() and onTypeDefinition().
 * 
 * @param doc The TextDocument that the parameter is in.
 * @param parsed The tokenized representation of doc.
 * @param line The line that the parameter is in.
 * @param tkn The token of the parameter in the line.
 * @param server The server that doc is associated with.
 * 
 * The following optional parameters are only provided when called via computeDiagnostics():
 * @param allfiles An array of all files in a database.
 * @param inheritedpackages An array containing packages imported by superclasses of this class.
 */
async function determineParameterClass(
	doc: TextDocument, parsed: compressedline[], line: number, tkn: number,
	server: ServerSpec, allfiles?: StudioOpenDialogFile[], inheritedpackages?: string[]
): Promise<ClassMemberContext | undefined> {
	var result: ClassMemberContext | undefined = undefined;
	if (doc.languageId === "objectscript-class") {
		// Parameters can only have a type if they're in a UDL method

		const thisparam = doc.getText(findFullRange(line,parsed,tkn,parsed[line][tkn].p,parsed[line][tkn].p+parsed[line][tkn].c));
		// Scan to the method definition
		for (let j = line; j >= 0; j--) {
			if (parsed[j].length === 0) {
				continue;
			}
			else if (parsed[j][0].l == ld.cls_langindex && parsed[j][0].s == ld.cls_keyword_attrindex) {
				// This is the method definition
				if (
					parsed[j][parsed[j].length-1].l == ld.cls_langindex && parsed[j][parsed[j].length-1].s == ld.cls_delim_attrindex &&
					doc.getText(Range.create(
						Position.create(j,parsed[j][parsed[j].length-1].p),
						Position.create(j,parsed[j][parsed[j].length-1].p+parsed[j][parsed[j].length-1].c)
					)) === "("
				) {
					// This is a multi-line method definition
					for (let mline = j+1; mline < parsed.length; mline++) {
						// Loop through the line and look for this parameter

						const paramcon = await findMethodParameterClass(doc,parsed,mline,server,thisparam,allfiles,inheritedpackages);
						if (paramcon !== undefined) {
							// We found the parameter
							result = paramcon;
							break;
						}
						else if (
							parsed[mline][parsed[mline].length-1].l == ld.cls_langindex && parsed[mline][parsed[mline].length-1].s == ld.cls_delim_attrindex &&
							doc.getText(Range.create(
								Position.create(mline,parsed[mline][parsed[mline].length-1].p),
								Position.create(mline,parsed[mline][parsed[mline].length-1].p+parsed[mline][parsed[mline].length-1].c)
							)) !== ","
						) {
							// We've reached the end of the method definition
							break;
						}
					}
				}
				else {
					// This is a single-line method definition
					const paramcon = await findMethodParameterClass(doc,parsed,j,server,thisparam);
					if (paramcon !== undefined) {
						result = paramcon;
					}
				}
				break;
			}
		}
	}
	return result;
}

/**
 * Determine the normalized name of the class for the declared local variable at (line,tkn).
 * If it's found, return its class. Helper method for getClassMemberContext() and onTypeDefinition().
 * 
 * @param doc The TextDocument that the declared local variable is in.
 * @param parsed The tokenized representation of doc.
 * @param line The line that the declared local variable is in.
 * @param tkn The token of the declared local variable in the line.
 * @param server The server that doc is associated with.
 * 
 * The following optional parameters are only provided when called via computeDiagnostics():
 * @param allfiles An array of all files in a database.
 * @param inheritedpackages An array containing packages imported by superclasses of this class.
 */
async function determineDeclaredLocalVarClass(
	doc: TextDocument, parsed: compressedline[], line: number, tkn: number,
	server: ServerSpec, allfiles?: StudioOpenDialogFile[], inheritedpackages?: string[]
): Promise<ClassMemberContext | undefined> {
	var result: ClassMemberContext | undefined = undefined;
	const thisvar = doc.getText(findFullRange(line,parsed,tkn,parsed[line][tkn].p,parsed[line][tkn].p+parsed[line][tkn].c));

	if (thisvar === "%request") {
		result = {
			baseclass: "%CSP.Request",
			context: "instance"
		};
	}
	else if (thisvar === "%response") {
		result = {
			baseclass: "%CSP.Response",
			context: "instance"
		};
	}
	else if (thisvar === "%session") {
		result = {
			baseclass: "%CSP.Session",
			context: "instance"
		};
	}
	else if (thisvar === "%code") {
		result = {
			baseclass: "%Stream.MethodGenerator",
			context: "instance"
		};
	}
	else if (thisvar === "%class") {
		result = {
			baseclass: "%Dictionary.ClassDefinition",
			context: "instance"
		};
	}
	else if (thisvar === "%method") {
		result = {
			baseclass: "%Dictionary.MethodDefinition",
			context: "instance"
		};
	}
	else if (thisvar === "%compiledclass") {
		result = {
			baseclass: "%Dictionary.CompiledClass",
			context: "instance"
		};
	}
	else if (thisvar === "%compiledmethod" || thisvar === "%objcompiledmethod") {
		result = {
			baseclass: "%Dictionary.CompiledMethod",
			context: "instance"
		};
	}
	else if (thisvar === "%trigger") {
		result = {
			baseclass: "%Dictionary.TriggerDefinition",
			context: "instance"
		};
	}
	else if (thisvar === "%compiledtrigger") {
		result = {
			baseclass: "%Dictionary.CompiledTrigger",
			context: "instance"
		};
	}
	else if (thisvar === "%SourceControl") {
		result = {
			baseclass: "%Studio.Extension.Base",
			context: "instance"
		};
	}
	else {
		// Scan to the top of the method to find the #Dim
		let founddim = false;
		let firstLabel = true;
		for (let j = line; j >= 0; j--) {
			if (parsed[j].length === 0) {
				continue;
			}
			else if (doc.languageId === "objectscript-class" && parsed[j][0].l == ld.cls_langindex && parsed[j][0].s == ld.cls_keyword_attrindex) {
				// This is the definition for the class member that the variable is in
				break;
			}
			else if (
				["objectscript","objectscript-int"].includes(doc.languageId) && firstLabel &&
				parsed[j][0].l == ld.cos_langindex && parsed[j][0].s == ld.cos_label_attrindex
			) {
				// This is the first label above the variable
				
				if (labelIsProcedureBlock(doc,parsed,j) != undefined) {
					// This variable is in a procedure block, so stop scanning
					break;
				}
				// Scan the whole file
				firstLabel = false;
			}
			else if (parsed[j][0].l == ld.cos_langindex && parsed[j][0].s == ld.cos_ppc_attrindex) {
				// This is a preprocessor command
				const command = doc.getText(Range.create(Position.create(j,parsed[j][0].p),Position.create(j,parsed[j][1].p+parsed[j][1].c)));
				if (command.toLowerCase() === "#dim") {
					// This is a #Dim
					const dimresult = parseDimLine(doc,parsed,j,thisvar);
					founddim = dimresult.founddim;
					if (founddim) {
						result = {
							baseclass: await normalizeClassname(doc,parsed,dimresult.class,server,j,allfiles,undefined,inheritedpackages),
							context: "instance"
						};
					}
				}
				if (founddim) {
					break;
				}
			}
		}
	}

	return result;
}

/**
 * Parse a Set command's arguments and look to see if `selector` was set using `%New()`, `%Open()` or `%OpenId()`.
 * 
 * @param doc The TextDocument that the Set is in.
 * @param parsed The tokenized representation of `doc`.
 * @param line The line the Set is in.
 * @param token The offset of the Set within `line`.
 * @param selector The variable that we're looking for.
 */
function parseSetCommand(doc: TextDocument, parsed: compressedline[], line: number, token: number, selector: string): { foundset: boolean; class: string; } {
	let result = {
		foundset: false,
		class: ""
	};

	let brk = false;
	let inPostconditional = false;
	let pcParenCount = 0;
	let foundVar = false;
	let operatorTuple: [number, number] | undefined = undefined;
	for (let ln = line; ln < parsed.length; ln++) {
		if (parsed[ln] == undefined || parsed[ln].length == 0) {
			continue;
		}
		for (let tkn = (ln == line ? token + 1 : 0); tkn < parsed[ln].length; tkn++) {
			if (parsed[ln][tkn].l == ld.cos_langindex && (parsed[ln][tkn].s === ld.cos_command_attrindex || parsed[ln][tkn].s === ld.cos_zcom_attrindex)) {
				// This is the next command, so stop looping
				brk = true;
				break;
			}
			if (
				ln == line && tkn == token + 1 && parsed[ln][tkn].l == ld.cos_langindex && parsed[ln][tkn].s === ld.cos_delim_attrindex &&
				doc.getText(Range.create(ln,parsed[ln][tkn].p,ln,parsed[ln][tkn].p+parsed[ln][tkn].c)) == ":"
			) {
				// This Set has a postconditional
				inPostconditional = true;
			}
			if (inPostconditional && pcParenCount == 0 && tkn > 0 && parsed[ln][tkn].p > (parsed[ln][tkn-1].p+parsed[ln][tkn-1].c)) {
				// We've hit the end of the postconditional
				inPostconditional = false;
			}
			if (
				inPostconditional && parsed[ln][tkn].l == ld.cos_langindex && parsed[ln][tkn].s === ld.cos_delim_attrindex &&
				doc.getText(Range.create(ln,parsed[ln][tkn].p,ln,parsed[ln][tkn].p+parsed[ln][tkn].c)) == "("
			) {
				pcParenCount++;
			}
			if (
				inPostconditional && parsed[ln][tkn].l == ld.cos_langindex && parsed[ln][tkn].s === ld.cos_delim_attrindex &&
				doc.getText(Range.create(ln,parsed[ln][tkn].p,ln,parsed[ln][tkn].p+parsed[ln][tkn].c)) == ")"
			) {
				pcParenCount--;
				if (pcParenCount == 0) {
					// We've hit the end of the postconditional
					inPostconditional = false;
				}
			}
			if (
				!inPostconditional && parsed[ln][tkn].l == ld.cos_langindex &&
				(
					parsed[ln][tkn].s == ld.cos_otw_attrindex || parsed[ln][tkn].s == ld.cos_localundec_attrindex ||
					parsed[ln][tkn].s == ld.cos_localdec_attrindex || parsed[ln][tkn].s == ld.cos_localvar_attrindex
				) &&
				doc.getText(Range.create(ln,parsed[ln][tkn].p,ln,parsed[ln][tkn].p+parsed[ln][tkn].c)) == selector &&
				!(tkn+1 < parsed[ln].length && parsed[ln][tkn+1].l == ld.cos_langindex && parsed[ln][tkn+1].s == ld.cos_objdot_attrindex) &&
				!(tkn-1 >= 0 && parsed[ln][tkn-1].l == ld.cos_langindex && parsed[ln][tkn-1].s == ld.cos_indir_attrindex)
			) {
				// We found the variable, so now look for the assignment operator
				foundVar = true;
			}
			if (
				foundVar && parsed[ln][tkn].l == ld.cos_langindex && parsed[ln][tkn].s == ld.cos_oper_attrindex &&
				doc.getText(Range.create(ln,parsed[ln][tkn].p,ln,parsed[ln][tkn].p+parsed[ln][tkn].c)) == "="
			) {
				// We found the assignment operator, so now we need to see what the value is
				operatorTuple = [ln,tkn];
			}
			if (operatorTuple != undefined && ((tkn == operatorTuple[1] + 1) || (ln == operatorTuple[0] + 1 && tkn == 0))) {
				// This is the token immediately after the assignment operator

				if (parsed[ln][tkn].l == ld.cos_langindex && parsed[ln][tkn].s == ld.cos_clsobj_attrindex) {
					// This is the start of a ##class

					// Find the class name and the method/parameter being referred to
					if ((tkn + 6) < parsed[ln].length) {
						// Need at least 6 more tokens (open paren, class, close paren, dot, method, open paren)
						for (let clstkn = tkn + 5; clstkn < parsed[ln].length; clstkn++) {
							if (
								parsed[ln][clstkn].l == ld.cos_langindex && parsed[ln][clstkn].s == ld.cos_method_attrindex &&
								["%New","%Open","%OpenId"].includes(doc.getText(Range.create(ln,parsed[ln][clstkn].p,ln,parsed[ln][clstkn].p+parsed[ln][clstkn].c)))
							) {
								// This is ##class(cls).%New/%Open/%OpenId( so save the class name
								result = {
									foundset: true,
									class: doc.getText(findFullRange(ln,parsed,tkn+2,parsed[ln][tkn+2].p,parsed[ln][tkn+2].p+parsed[ln][tkn+2].c))
								};
								break;
							}
						}
					}
				}
				else if (
					parsed[ln][tkn].l == ld.cos_langindex && parsed[ln][tkn].s == ld.cos_sysv_attrindex &&
					doc.getText(Range.create(ln,parsed[ln][tkn].p,ln,parsed[ln][tkn].p+parsed[ln][tkn].c)).toLowerCase() == "$system" &&
					tkn < parsed[ln].length - 1 && parsed[ln][tkn+1].l == ld.cos_langindex && parsed[ln][tkn+1].s == ld.cos_clsname_attrindex
				) {
					// This is $SYSTEM followed by a class name

					// Check if the method being called is %New(), %Open() or %OpenId()
					if ((tkn + 4) < parsed[ln].length) {
						// Need at least 4 more tokens (class, dot, method, open paren)
						for (let clstkn = tkn + 3; clstkn < parsed[ln].length; clstkn++) {
							if (
								parsed[ln][clstkn].l == ld.cos_langindex && parsed[ln][clstkn].s == ld.cos_method_attrindex &&
								["%New","%Open","%OpenId"].includes(doc.getText(Range.create(ln,parsed[ln][clstkn].p,ln,parsed[ln][clstkn].p+parsed[ln][clstkn].c)))
							) {
								// This is $SYSTEM.cls.%New/%Open/%OpenId( so find the name of this class and save it
								result = {
									foundset: true,
									class: `%SYSTEM${doc.getText(findFullRange(ln,parsed,tkn+1,parsed[ln][tkn+1].p,parsed[ln][tkn+1].p+parsed[ln][tkn+1].c))}`
								};
								break;
							}
						}
					}
				}
				else if (
					parsed[ln][tkn].l == ld.cos_langindex && parsed[ln][tkn].s == ld.cos_objdot_attrindex &&
					doc.getText(Range.create(ln,parsed[ln][tkn].p,ln,parsed[ln][tkn].p+parsed[ln][tkn].c)) == ".."
				) {
					// This is relative dot syntax

					// Check if the method being called is %New(), %Open() or %OpenId()
					if (
						(tkn + 2) < parsed[ln].length && parsed[ln][tkn+1].l == ld.cos_langindex && parsed[ln][tkn+1].s == ld.cos_method_attrindex &&
						["%New","%Open","%OpenId"].includes(doc.getText(Range.create(ln,parsed[ln][tkn+1].p,ln,parsed[ln][tkn+1].p+parsed[ln][tkn+1].c)))
					) {
						// This is ..%New/%Open/%OpenId( so find the name of this class

						let clsname = "";
						for (let i = 0; i < parsed.length; i++) {
							if (parsed[i].length === 0) {
								continue;
							}
							else if (parsed[i][0].l == ld.cls_langindex && parsed[i][0].s == ld.cls_keyword_attrindex) {
								// This line starts with a UDL keyword
					
								const keyword = doc.getText(Range.create(Position.create(i,parsed[i][0].p),Position.create(i,parsed[i][0].p+parsed[i][0].c)));
								if (keyword.toLowerCase() === "class") {
									for (let j = 1; j < parsed[i].length; j++) {
										if (parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_clsname_attrindex) {
											clsname += doc.getText(Range.create(i,parsed[i][j].p,i,parsed[i][j].p+parsed[i][j].c));
										}
										else if (parsed[i][j].l == ld.cls_langindex && parsed[i][j].s == ld.cls_keyword_attrindex) {
											// We hit the 'Extends' keyword
											break;
										}
									}
									break;
								}
							}
						}
						if (clsname != "") {
							result = {
								foundset: true,
								class: clsname
							};
						}
					}
				}
				else if (parsed[ln][tkn].l == ld.cos_langindex && parsed[ln][tkn].s == ld.cos_jsonb_attrindex) {
					// This is a %DynamicObject or %DynamicArray
					result.foundset = true;
					switch (doc.getText(Range.create(ln,parsed[ln][tkn].p,ln,parsed[ln][tkn].p+parsed[ln][tkn].c))) {
						case "{":
							result.class = "%Library.DynamicObject";
							break;
						default:
							result.class = "%Library.DynamicArray";
					}
				}

				// Exit the loop because we've already found our variable
				brk = true;
				break;
			}
		}
		if (brk) {
			break;
		}
	}

	return result;
}

/**
 * Determine the normalized name of the class for the undeclared local variable at (line,tkn).
 * If it's found, return its class. Helper method for getClassMemberContext() and onTypeDefinition().
 * 
 * @param doc The TextDocument that the undeclared local variable is in.
 * @param parsed The tokenized representation of doc.
 * @param line The line that the undeclared local variable is in.
 * @param tkn The token of the undeclared local variable in the line.
 * @param server The server that doc is associated with.
 * 
 * The following optional parameters are only provided when called via computeDiagnostics():
 * @param allfiles An array of all files in a database.
 * @param inheritedpackages An array containing packages imported by superclasses of this class.
 */
async function determineUndeclaredLocalVarClass(
	doc: TextDocument, parsed: compressedline[], line: number, tkn: number,
	server: ServerSpec, allfiles?: StudioOpenDialogFile[], inheritedpackages?: string[]
): Promise<ClassMemberContext | undefined> {
	let result: ClassMemberContext | undefined = undefined;
	const thisvar = doc.getText(findFullRange(line,parsed,tkn,parsed[line][tkn].p,parsed[line][tkn].p+parsed[line][tkn].c));

	// Scan to the top of the method to find where the variable was Set
	let foundset = false;
	let firstLabel = true;
	for (let j = line; j >= 0; j--) {
		if (parsed[j].length === 0) {
			continue;
		}
		else if (doc.languageId === "objectscript-class" && parsed[j][0].l == ld.cls_langindex && parsed[j][0].s == ld.cls_keyword_attrindex) {
			// This is the definition for the class member that the variable is in
			break;
		}
		else if (
			["objectscript","objectscript-int"].includes(doc.languageId) && firstLabel &&
			parsed[j][0].l == ld.cos_langindex && parsed[j][0].s == ld.cos_label_attrindex
		) {
			// This is the first label above the variable
			
			if (labelIsProcedureBlock(doc,parsed,j) != undefined) {
				// This variable is in a procedure block, so stop scanning
				break;
			}
			// Scan the whole file
			firstLabel = false;
		}
		else {
			// Loop through the line looking for Sets
			for (let tkn = 0; tkn < parsed[j].length; tkn++) {
				if (
					parsed[j][tkn].l == ld.cos_langindex && parsed[j][tkn].s === ld.cos_command_attrindex &&
					["s","set"].includes(doc.getText(Range.create(j,parsed[j][tkn].p,j,parsed[j][tkn].p+parsed[j][tkn].c)).toLowerCase())
				) {
					// This is a Set command
					const setresult = parseSetCommand(doc,parsed,j,tkn,thisvar);
					foundset = setresult.foundset;
					if (foundset) {
						result = {
							baseclass: await normalizeClassname(doc,parsed,setresult.class,server,j,allfiles,undefined,inheritedpackages),
							context: "instance"
						};
						break;
					}
				}
			}
			if (foundset) {
				break;
			}
		}
	}

	return result;
}

/**
 * Expand a minified FormalSpec returned by a query to be more user friendly.
 * 
 * @param FormalSpec The value of the FormalSpec column in %Dictionary.CompiledMethod.
 */
export function beautifyFormalSpec(FormalSpec: string): string {
	let result = "", inParen = false, inQuote = false, inBraces = 0;
	for (const c of FormalSpec) {
		if (!inParen && !inQuote && !inBraces) {
			// In the argument list
			switch (c) {
				case ",":
					result += ", ";
					break;
				case "*":
					result += "Output ";
					break;
				case "&":
					result += "ByRef ";
					break;
				case ":":
					result += " As ";
					break;
				case "=":
					result += " = ";
					break;
				case "\"":
					inQuote = true;
					result += c;
					break;
				case "(":
					inParen = true;
					result += c;
					break;
				case "{":
					inBraces++;
					result += c;
					break;
				default:
					result += c;
			}
		} else if (!inQuote) {
			if (inBraces) {
				// In a COS block
				switch (c) {
					case "\"":
						inQuote = true;
						result += c;
						break;
					case "{":
						inBraces++;
						result += c;
						break;
					case "}":
						inBraces--;
						result += c;
						break;
					default:
						result += c;
				}
			} else {
				// In the class parameter list
				switch (c) {
					case ",":
						result += ", ";
						break;
					case "=":
						result += " = ";
						break;
					case "\"":
						inQuote = true;
						result += c;
						break;
					case ")":
						inParen = false;
						result += c;
						break;
					case "{":
						inBraces++;
						result += c;
						break;
					default:
						result += c;
				}
			}
		} else {
			// In a quoted string
			if (c == "\"") inQuote = false;
			result += c;
		}
	}
	return `(${result})`;
}

/**
 * Find the open parenthesis token that corresponds to the close parenthesis token at [`line`,`token`].
 * 
 * @param doc The TextDocument that the close parenthesis is in.
 * @param parsed The tokenized representation of doc.
 * @param line The line that the close parenthesis is in.
 * @param token The offset of the close parenthesis in the line.
 * @returns A tuple containing the line and token number of the open parenthesis, or -1 for both if it wasn't found.
 */
export function findOpenParen(doc: TextDocument, parsed: compressedline[], line: number, token: number): [number, number] {
	let numclosed = 0;
	let openln = -1;
	let opentkn = -1;
	for (let ln = line; ln >= 0; ln--) {
		var starttkn = parsed[ln].length-1;
		if (ln === line) {
			starttkn = token-1;
		}
		for (let tkn = starttkn; tkn >= 0; tkn--) {
			if (parsed[ln][tkn].l === ld.cos_langindex && parsed[ln][tkn].s === ld.cos_delim_attrindex) {
				const delimtext = doc.getText(Range.create(Position.create(ln,parsed[ln][tkn].p),Position.create(ln,parsed[ln][tkn].p+parsed[ln][tkn].c)));
				if (delimtext === "(") {
					if (numclosed === 0) {
						openln = ln;
						opentkn = tkn;
						break;
					}
					else {
						numclosed--;
					}
				}
				else if (delimtext === ")") {
					numclosed++;
				}
			}
		}
		if (openln !== -1 && opentkn !== -1) {
			break;
		}
	}
	return [openln,opentkn];
}

/**
 * Convert a class documentation string as Markdown.
 * 
 * @param html The class documentation string to convert.
 */
export function documaticHtmlToMarkdown(html: string): string {
	let root = parse(html);
	for (const elem of root.getElementsByTagName("example")) {
		const newElem = parse("<pre></pre>").getElementsByTagName("pre")[0];
		const lang = elem.getAttribute("language");
		if (lang !== undefined) {
			newElem.setAttribute("language",lang);
		}
		let text = elem.innerText;
		if (lang?.toLowerCase() === "html") {
			text = elem.innerHTML.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
		}
		newElem.textContent = text;
		elem.parentNode.exchangeChild(elem,newElem);
	}
	return turndown.turndown(root.toString());
}

/**
 * If this class parameter is is a parameter for a class name,
 * return the raw name of that class. If the class couldn't be
 * determined, or this parameter is a method, query or trigger
 * argument, the empty string is returned.
 * 
 * @param doc The TextDocument that the class parameter is in.
 * @param parsed The tokenized representation of `doc`.
 * @param line The line that the class parameter is on.
 * @param token The offset of the class parameter in the line.
 * @param completion `true` if called from the completion provider.
 */
export function determineClassNameParameterClass(doc: TextDocument, parsed: compressedline[], line: number, token: number, completion = false): string {
	if (
		completion &&
		parsed[line][token].l == ld.cls_langindex &&
		parsed[line][token].s == ld.error_attrindex &&
		["(","()"].includes(doc.getText(Range.create(
			line,
			parsed[line][token].p,
			line,
			parsed[line][token].p+parsed[line][token].c
		))) && token > 0 &&
		parsed[line][token-1].l == ld.cls_langindex &&
		parsed[line][token-1].s == ld.cls_clsname_attrindex
	) {
		// When doing completion for (, the ( may be an
		// error token so we need to handle that special case
		return doc.getText(findFullRange(
			line,parsed,token-1,
			parsed[line][token-1].p,
			parsed[line][token-1].p+parsed[line][token-1].c
		));
	}
	let openCount = 1, clsName = "";
	for (let tkn = token; tkn >= 0; tkn--) {
		if (parsed[line][tkn].l == ld.cls_langindex && parsed[line][tkn].s == ld.cls_delim_attrindex) {
			const delimText = doc.getText(Range.create(
				line,
				parsed[line][tkn].p,
				line,
				parsed[line][tkn].p+parsed[line][tkn].c
			));
			if (delimText == ")") {
				openCount++;
			} else if (delimText == "(") {
				openCount--;
				if (openCount == 0) {
					if (tkn > 0 && parsed[line][tkn-1].l == ld.cls_langindex && parsed[line][tkn-1].s == ld.cls_clsname_attrindex) {
						clsName = doc.getText(findFullRange(
							line,parsed,tkn-1,
							parsed[line][tkn-1].p,
							parsed[line][tkn-1].p+parsed[line][tkn-1].c
						));
					}
					break;
				}
			}
		}
	}
	return clsName;
}

/**
 * Determine the nesting level for this token within a Storage definition.
 * 
 * @param doc The TextDocument.
 * @param parsed The tokenized representation of doc.
 * @param line The line this token is on.
 * @param token The offset of this token in the line.
 * @returns The key in the `storageKeywords` object for this nesting level,
 * or the empty string if the token is not in a Storage definition.
 */
export function storageKeywordsKeyForToken(doc: TextDocument, parsed: compressedline[], line: number, token: number): string {
	let result: string = "";
	// Check that this token is in a Storage definition
	let storageStart = -1;
	for (let j = line; j >= 0; j--) {
		if (parsed[j].length === 0) {
			continue;
		}
		if (parsed[j][0].l == ld.cls_langindex && parsed[j][0].s == ld.cls_keyword_attrindex) {
			const keytext = doc.getText(Range.create(j,parsed[j][0].p,j,parsed[j][0].p+parsed[j][0].c));
			if (keytext.toLowerCase() == "storage") {
				if (doc.getText(Range.create(j,0,j+1,0)).trim().endsWith("{")) {
					storageStart = j + 1;
				}
				else {
					storageStart = j + 2;
				}
			}
			break;
		}
	}
	if (storageStart != -1) {
		// Find all open XML elements
		let ignoreLastOpen = false;
		if (parsed[line][token].s == ld.cls_xmlelemname_attrindex) {
			// This token is an XML element name, so adjust the search accordingly
			const prevline = token == 0 ? line - 1 : line;
			const prevtkn = token == 0 ? parsed[prevline].length - 1 : token - 1;
			line = prevline;
			token = prevtkn;
			if (
				doc.getText(Range.create(
					prevline, parsed[prevline][prevtkn].p,
					prevline, parsed[prevline][prevtkn].p + parsed[prevline][prevtkn].c
				)) == "/"
			) {
				// This is a close element, so we need to ignore the last open element
				ignoreLastOpen = true;
			}
		}
		const open: string[] = [];
		for (let xmlline = storageStart; xmlline <= line; xmlline++) {
			var endtkn: number = parsed[xmlline].length - 1;
			if (xmlline === line) {
				// Don't parse past the completion position
				endtkn = token - 1;
			}
			for (let xmltkn = 0; xmltkn <= endtkn; xmltkn++) {
				if (parsed[xmlline][xmltkn].l == ld.cls_langindex && parsed[xmlline][xmltkn].s == ld.cls_delim_attrindex) {
					// This is a UDL delimiter 
					const tokentext = doc.getText(Range.create(
						xmlline,parsed[xmlline][xmltkn].p,
						xmlline,parsed[xmlline][xmltkn].p+parsed[xmlline][xmltkn].c
					));
					if (tokentext === "<" && xmltkn != endtkn && parsed[xmlline][xmltkn+1].s == ld.cls_xmlelemname_attrindex) {
						open.push(doc.getText(Range.create(
							xmlline,parsed[xmlline][xmltkn+1].p,
							xmlline,parsed[xmlline][xmltkn+1].p+parsed[xmlline][xmltkn+1].c
						)));
					}
					else if (tokentext === "/") {
						if (xmltkn != endtkn && parsed[xmlline][xmltkn+1].s == ld.cls_delim_attrindex) {
							if (doc.getText(Range.create(
								xmlline,parsed[xmlline][xmltkn+1].p,
								xmlline,parsed[xmlline][xmltkn+1].p+parsed[xmlline][xmltkn+1].c
							)) === ">") {
								// The previous element has been closed
								open.pop();
							}
						}
						else if (xmltkn != 0 && parsed[xmlline][xmltkn-1].s == ld.cls_delim_attrindex) {
							if (xmltkn != endtkn && doc.getText(Range.create(
								xmlline,parsed[xmlline][xmltkn-1].p,
								xmlline,parsed[xmlline][xmltkn-1].p+parsed[xmlline][xmltkn-1].c
							)) === "<") {
								// The upcoming element is being closed
								open.splice(open.lastIndexOf(doc.getText(Range.create(
									xmlline,parsed[xmlline][xmltkn+1].p,
									xmlline,parsed[xmlline][xmltkn+1].p+parsed[xmlline][xmltkn+1].c
								))),1);
							}
						}
					}
				}
			}
		}
		result = "STORAGE" + (ignoreLastOpen ? open.slice(0,-1) : open).join("").toUpperCase();
	}
	return result;
}

/**
 * Wait for the updated semantic tokens for `uri` to be stored, then return them.
 * 
 * @param uri The uri of the document to get semantic tokens for.
 * @returns The semantic tokens, or `undefined` if `uri` is not a key of `parsedDocuments` or retrieval took too long.
 */
export async function getParsedDocument(uri: string): Promise<compressedline[] | undefined> {
	if (!parsedDocuments.has(uri)) {
		return undefined;
	}
	const start = Date.now();
	function waitForTokens(resolve: (value: compressedline[] | undefined) => void) {
		const result = parsedDocuments.get(uri);
		if (result != undefined || ((Date.now() - start) >= 5000)) {
			resolve(result);
		}
		else {
			setTimeout(waitForTokens, 25, resolve);
		}
	};
	return new Promise(waitForTokens);
}

/**
 * Check if label on `line` of `doc` is a procedure block.
 * 
 * @param doc The TextDocument.
 * @param parsed The tokenized representation of doc.
 * @param line The line that this label is in.
 * @returns A line, token tuple of the first brace after the procedure definition, else `undefined`.
 */
export function labelIsProcedureBlock(doc: TextDocument, parsed: compressedline[], line: number): [number, number] | undefined {
	const lastLabelTkn = parsed[line].length > 1 && parsed[line][1].s == ld.cos_label_attrindex ? 1 : 0;
	let currentLabelIsProcedureBlock: boolean = false;
	let result: [number, number] | undefined = undefined;

	if (
		parsed[line].length > lastLabelTkn + 1 &&
		parsed[line][lastLabelTkn + 1].s == ld.cos_delim_attrindex &&
		doc.getText(
			Range.create(
				line,parsed[line][lastLabelTkn + 1].p,
				line,parsed[line][lastLabelTkn + 1].p+parsed[line][lastLabelTkn + 1].c
			)
		) == "("
	) {
		// Walk the parsed document until we hit the end of the procedure definition
		
		let openparen = 0;
		let inparam = true;
		let brk = false;
		for (let ln = (parsed[line].length == lastLabelTkn + 2 ? line + 1 : line); ln < parsed.length; ln++) {
			for (let tkn = (ln == line ? lastLabelTkn + 2 : 0); tkn < parsed[ln].length; tkn++) {
				if (parsed[ln][tkn].l == ld.cos_langindex && parsed[ln][tkn].s == ld.cos_comment_attrindex) {
					// Comments are allowed anywhere in the procedure definition, so ignore them
					continue;
				}
				else if (parsed[ln][tkn].l == ld.cos_langindex && parsed[ln][tkn].s == ld.cos_delim_attrindex) {
					const delim = doc.getText(Range.create(ln,parsed[ln][tkn].p,ln,parsed[ln][tkn].p+parsed[ln][tkn].c));
					if (inparam) {
						if (delim == "(") {
							openparen++;
						}
						else if (delim == ")") {
							if (openparen == 0) {
								// Found the end of the parameter list
								inparam = false;
							}
							else {
								openparen--;
							}
						}
					}
					else {
						if (delim == "[") {
							// We hit the public list, which means this label is a procedure block
							currentLabelIsProcedureBlock = true;
						}
						else if (currentLabelIsProcedureBlock && (delim == "]" || delim == ",")) {
							// These are delimiters inside the public list, so ignore them
							continue;
						}
						else {
							// This is some other delimiter, so this label is not a procedure block
							brk = true;
							break;
						}
					}
				}
				else if (!inparam && parsed[ln][tkn].l == ld.cos_langindex && parsed[ln][tkn].s == ld.cos_command_attrindex) {
					const command = doc.getText(Range.create(ln,parsed[ln][tkn].p,ln,parsed[ln][tkn].p+parsed[ln][tkn].c));
					if (["public","private"].includes(command.toLowerCase())) {
						// The access modifier can be present with our without a brace, so ignore it
						continue;
					}
					else {
						// This is some other command, so this label is not a procedure block
						brk = true;
						break;
					}
				}
				else if (!inparam && parsed[ln][tkn].l == ld.cos_langindex && parsed[ln][tkn].s == ld.cos_brace_attrindex) {
					const brace = doc.getText(Range.create(ln,parsed[ln][tkn].p,ln,parsed[ln][tkn].p+parsed[ln][tkn].c));
					if (brace == "{") {
						// This is an open brace, so this label is procedure block
						currentLabelIsProcedureBlock = true;
						result = [ln, tkn];
						brk = true;
						break;
					} else {
						// This is a close brace, so this label is not a procedure block
						brk = true;
						break;
					}
				}
				else if (!inparam && !currentLabelIsProcedureBlock) {
					// This is some other token, so this label is not a procedure block
					brk = true;
					break;
				}
			}
			if (brk) {
				break;
			}
		}
	}

	return result;
}

/**
 * Find the name of the class contained in `doc`.
 * Returns the empty string if no class declaration was found.
 */
export function currentClass(doc: TextDocument, parsed: compressedline[]): string {
	let result: string = "";
	for (let i = 0; i < parsed.length; i++) {
		if (parsed[i].length === 0) {
			continue;
		}
		else if (parsed[i][0].l == ld.cls_langindex && parsed[i][0].s == ld.cls_keyword_attrindex) {
			// This line starts with a UDL keyword

			const keyword = doc.getText(Range.create(i,parsed[i][0].p,i,parsed[i][0].p+parsed[i][0].c));
			if (keyword.toLowerCase() === "class") {
				result = doc.getText(findFullRange(i,parsed,1,parsed[i][1].p,parsed[i][1].p+parsed[i][1].c));
				break;
			}
		}
	}
	return result;
}

/**
 * Ask the client for the text of the file at `uri`.
 * 
 * @param uri The uri of the file.
 * @param server The server that doc `uri` is associated with.
 */
export async function getTextForUri(uri: string, server: ServerSpec): Promise<string[]> {
	const doc = documents.get(uri);
	return doc ? doc.getText().split(/\r?\n/) : connection.sendRequest("intersystems/uri/getText", { uri, server });
}

/**
 * Determine the normalized name of the class for the ObjectScript variable at (line,tkn).
 * 
 * @param doc The TextDocument that the variable is in.
 * @param parsed The tokenized representation of doc.
 * @param line The line that the variable is in.
 * @param tkn The token of the variable in the line.
 * @param server The server that doc is associated with.
 */
export async function determineVariableClass(
	doc: TextDocument, parsed: compressedline[],
	line: number, tkn: number, server: ServerSpec
): Promise<string> {
	let varClass = "";
	if (parsed[line][tkn].s == ld.cos_param_attrindex) {
		// This token is a parameter

		// Determine the class of the parameter
		const paramcon = await determineParameterClass(doc,parsed,line,tkn,server);
		if (paramcon !== undefined) {
			// The parameter has a class
			varClass = paramcon.baseclass;
		}
	} else if (
		parsed[line][tkn].s == ld.cos_localdec_attrindex ||
		parsed[line][tkn].s == ld.cos_localvar_attrindex
	) {
		// This token is a declared local variable or public variable

		// First check if it's #Dim'd
		let varContext = await determineDeclaredLocalVarClass(doc,parsed,line,tkn,server);
		if (varContext === undefined) {
			// If it's not, check if it's Set using %New(), %Open() or %OpenId()
			varContext = await determineUndeclaredLocalVarClass(doc,parsed,line,tkn,server);
		}
		if (varContext !== undefined) {
			// The declared local variable has a class
			varClass = varContext.baseclass;
		}
	} else {
		// This token is an undeclared local variable

		// Determine the class of the undeclared local variable
		const localundeccon = await determineUndeclaredLocalVarClass(doc,parsed,line,tkn,server);
		if (localundeccon !== undefined) {
			// The undeclared local variable has a class
			varClass = localundeccon.baseclass;
		}
	}
	return varClass;
}

/** Returns `true` if `keyword` is a valid class member type. */
export function isClassMember(keyword: string): boolean {
	const keywordUpper = keyword.toUpperCase();
	return classMemberTypes.some(t => t.toUpperCase() == keywordUpper);
}
