import { CompletionItem, CompletionItemKind, CompletionItemTag, CompletionParams, InsertTextFormat, Position, Range, TextEdit } from 'vscode-languageserver/node';
import { getServerSpec, getLanguageServerSettings, getMacroContext, makeRESTRequest, normalizeSystemName, getImports, findFullRange, getClassMemberContext, quoteUDLIdentifier, documaticHtmlToMarkdown, determineNormalizedPropertyClass, storageKeywordsKeyForToken, getParsedDocument, currentClass } from '../utils/functions';
import { ServerSpec, QueryData, KeywordDoc, MacroContext, compressedline } from '../utils/types';
import { documents, corePropertyParams } from '../utils/variables';
import * as ld from '../utils/languageDefinitions';

import structuredSystemVariables = require("../documentation/structuredSystemVariables.json");
import systemFunctions = require("../documentation/systemFunctions.json");
import systemVariables = require("../documentation/systemVariables.json");
import parameterTypes = require("../documentation/parameterTypes.json");
import preprocessorDirectives = require("../documentation/preprocessor.json");

import classKeywords = require("../documentation/keywords/Class.json");
import foreignkeyKeywords = require("../documentation/keywords/ForeignKey.json");
import indexKeywords = require("../documentation/keywords/Index.json");
import methodKeywords = require("../documentation/keywords/Method.json");
import parameterKeywords = require("../documentation/keywords/Parameter.json");
import projectionKeywords = require("../documentation/keywords/Projection.json");
import propertyKeywords = require("../documentation/keywords/Property.json");
import queryKeywords = require("../documentation/keywords/Query.json");
import storageKeywords = require("../documentation/keywords/Storage.json");
import triggerKeywords = require("../documentation/keywords/Trigger.json");
import xdataKeywords = require("../documentation/keywords/XData.json");
import { TextDocument } from 'vscode-languageserver-textdocument';

/**
 * ServerSpec's mapped to the XML assist schema cache for that server.
 */
export let schemaCaches: Map<ServerSpec, SchemaCache> = new Map();

/**
 * Cache of the MacroContext computed for a completion request that is used by the corresponding completion resolve requests.
 */
var macroCompletionCache: MacroContext;

/**
 * Mapping between an XML prefix and namespace.
 */
type PrefixMapping = {
	prefix: string,
	namespace: string
};

/**
 * XML attribute.
 */
class Attribute {
	name: string;
	moniker: string;

	constructor(attrDescriptor: string) {
		if (attrDescriptor.indexOf("@") === -1){
			// The name is the attribute
			this.name = attrDescriptor;
			this.moniker = "";
		}
		else {
			// Split name and moniker on delimiter
			this.name = attrDescriptor.split("@")[0];
			this.moniker = attrDescriptor.split("@")[1];
		}
	}
};

/**
 * XML element.
 */
class Element {
	private isRef: boolean;
	private schema: Schema;
	private attributes: Map<string, Attribute>;
	children: Map<string, Element>;

	constructor(schema: Schema, isReference: boolean) {
		this.schema = schema;
		this.isRef = isReference;
		this.attributes = new Map();
		this.children = new Map();
	}

	addAttribute(attrDescriptor: string) {
		const attr = new Attribute(attrDescriptor);
		this.attributes.set(attr.name,attr);
	}

	getAttributes(): string[] {
		return [...this.attributes.keys()];
	}

	getChildren(): string[] {
		var resolved: string[] = [];
		for (let [key, _] of this.children) {
			resolved.push(this.schema.convertI2E(key));
		}
		return resolved;
	}

	getAttributeMoniker(attrname: string): string {
		const attr = this.attributes.get(attrname);
		if (attr !== undefined) {
			return attr.moniker;
		}
		else {
			return "";
		}
	}

	isReference(): boolean {
		return this.isRef;
	}

	initialize(attrDescriptor: string) {
		if (attrDescriptor.length > 0) {
			this.addAttribute(attrDescriptor);
		}
	}
};

/**
 * The result of a query request.
 */
class SchemaQuery {
	private element: Element;

	constructor(element: Element) {
		this.element = element;
	}

	/**
	 * Get the attributes of this element.
	 */
	getAttributes(): string[] {
		return this.element.getAttributes();
	}

	/**
	 * Get the moniker of this attribute.
	 */
	getAttributeMoniker(attr: string): string {
		return this.element.getAttributeMoniker(attr);
	}

	/**
	 * Get the names of child elements.
	 */
	getElements(): string[] {
		return this.element.getChildren();
	}
};

/**
 * A Studio Assist XML schema.
 */
class Schema {
	private checksum: string;
	private prefixMappings: PrefixMapping[];
	private n2i: Map<string, string>;
	private i2n: Map<string, string>;
	private namespaceIndex: number;
	private rootElement: Element;
	private rootComponent: Element;

	constructor(lines: string[]) {
		this.prefixMappings = [];
		this.namespaceIndex = 0;
		this.rootElement = new Element(this,false);
		this.rootComponent = new Element(this,false);
		this.n2i = new Map();
		this.i2n = new Map();

		var checksum: string = "";
		var defaultPrefix: string = "";
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line.length > 0 && line.charAt(0) !== "#") {
				// This line has characters and is not a comment
				if (line.charAt(0) === "!") {
					// This is an instruction
					var delimpos = line.indexOf(":");
					if (delimpos === -1) {
						throw new Error("Illegal Instruction at SASchema line "+i);
					}
					// Split into instruction and parameters
					const inst = line.substring(0,delimpos);
					const params = line.substring(delimpos+1);

					if (inst === "!prefix-mapping") {
						// This is the prefix mapping
						var delimpos = params.indexOf(":");
						if (delimpos === -1) {
							throw new Error("Illegal Instruction at SASchema line "+i);
						}
						// Split into prefix and schema name
						const prefix = params.substring(0,delimpos);
						const schemaname = params.substring(delimpos+1);

						if (this.n2i.get(schemaname) === undefined) {
							// Create namespace index
							const nsidx = String(this.namespaceIndex++);
							this.n2i.set(schemaname,nsidx);
							this.i2n.set(nsidx,schemaname);
						}

						// Set the schema mapping
						this.pushMapping(prefix,schemaname);
					}
					else if (inst === "!default-namespace") {
						// Set the schema mapping
						this.pushMapping("",params);
					}
					else if (inst === "!default-prefix") {
						defaultPrefix = params;
					}
					else if (inst === "!checksum") {
						checksum = params;
					}
					else {
						// Unknown instruction, ignore
					}
				}
				else {
					// This is an element definition
					var elementPath: string = "";
					var attributes: string = "";

					// Split into path and attributes
					const baridx = line.indexOf("|");
					if (baridx !== -1) {
						elementPath = line.substring(0,baridx);
						attributes = line.substring(baridx+1);
					}
					else {
						elementPath = line;
					}
					
					const nsidx = this.prefix2Index(defaultPrefix);
					if (nsidx === "") {
						throw new Error("No prefix mapping found for default prefix");
					}
					
					// Load element into the schema
					if (elementPath.charAt(0) === "/") {
						// It's an element
						this.makeEntry(nsidx,elementPath.slice(1),attributes,0,this.rootElement.children);
					}
					else {
						// It's a component
						this.makeEntry(nsidx,elementPath,attributes,0,this.rootComponent.children);
					}
				}
			}
		}
		this.checksum = checksum;
	}

	private makeEntry(nsidx: string, elementPath: string, attributes: string, offset: number, elemCollection: Map<string, Element>) {
		var elemname: string = "";
		var isRef: boolean = false;
		
		const slashidx = elementPath.indexOf("/",offset);
		if (slashidx === -1) {
			// This is a leaf
			var lastelem: string = elementPath.slice(offset);
			if (lastelem.charAt(0) === "#") {
				// This is a reference
				isRef = true;

				// Look for namespace specification
				const delimidx = lastelem.indexOf(":",1);
				if (delimidx === -1) {
					// Not found, that means it's the same namespace
					elemname = nsidx + ":" + lastelem.slice(1);
				}
				else {
					// Pick out the namespace prefix
					const prefix = lastelem.substring(1,delimidx-1);

					// Find the namespace index
					nsidx = this.prefix2Index(prefix);
					if (nsidx === "") {
						// Can't make an entry
						return;
					}
					elemname = nsidx + ":" + lastelem.substring(delimidx+1);
				}
			}
			else {
				// It's a regular element
				elemname = nsidx + ":" + elementPath.slice(offset);
			}
			
			// Do we already have this child?
			var elem = elemCollection.get(elemname);
			if (elem !== undefined) {
				// Already exists so update the attributes
				elem.initialize(attributes);
				return;
			}

			// Need to create a new element
			elem = new Element(this,isRef);
			elem.initialize(attributes);
			elemCollection.set(elemname,elem);
		}
		else {
			// Build the element name
			elemname = nsidx + ":" + elementPath.slice(offset,slashidx);

			elem = elemCollection.get(elemname);
			if (elem === undefined) {
				// Create element
				elem = new Element(this,isRef);
				elemCollection.set(elemname,elem);
			}
			this.makeEntry(nsidx,elementPath,attributes,slashidx+1,elem.children);
		}
	}

	private pushMapping(prefix: string, namespace: string) {
		this.prefixMappings.push({prefix: prefix, namespace: namespace});
	}

	private prefix2Index(prefix: string): string {
		var result: string = "";
		// Iterate through the array of mappings in reverse
		for (let i = this.prefixMappings.length - 1; i >= 0; i--) {
			const mapping = this.prefixMappings[i];
			if (mapping.prefix === prefix) {
				// Found the correct mapping
				const entry = this.n2i.get(mapping.namespace);
				if (entry !== undefined) {
					result = entry;
				}
				break;
			}
		}
		return result;
	}

	convertE2I(extname: string): string {
		var prefix: string = "";
		const delimpos = extname.indexOf(":");
		if (delimpos !== -1) {
			prefix = extname.substring(0,delimpos);
			if (prefix.length === 0) {
				return "";
			}
		}
		var internalelemname: string = "";
		// Iterate through the array of mappings in reverse
		for (let i = this.prefixMappings.length - 1; i >= 0; i--) {
			const mapping = this.prefixMappings[i];
			if (mapping.prefix === prefix) {
				// Found the correct mapping
				const entry = this.n2i.get(mapping.namespace);
				if (entry !== undefined) {
					internalelemname = internalelemname + entry + ":";
					if (delimpos !== -1) {
						internalelemname = internalelemname + extname.slice(delimpos+1);
					}
					else {
						internalelemname = internalelemname + extname;
					}
					return internalelemname;
				}
				return "";
			}
		}
		return "";
	}

	convertI2E(intname: string): string {
		var namespaceIdx: string = "";
		var externalelemname: string = "";
		const delimpos = intname.indexOf(":");
		if (delimpos !== -1) {
			namespaceIdx = intname.substring(0,delimpos);

			// Find the namespace
			var ns = this.i2n.get(namespaceIdx);
			if (ns !== undefined) {
				var defaultns: string = "";

				// Found it, find the corresponding prefix
				for (let i = this.prefixMappings.length - 1; i >= 0; i--) {
					const mapping = this.prefixMappings[i];
					
					if (defaultns.length === 0 && mapping.prefix.length === 0) {
						defaultns = mapping.namespace;
					}
					
					// Check for match
					if (mapping.namespace === ns) {
						// If the prefix is empty
						if (ns === defaultns) {
							// The name has no prefix
							externalelemname = intname.slice(delimpos+1);
							return externalelemname;
						}
						else {
							continue;
						}
					}
					else {
						// It's not the empty prefix
						externalelemname = mapping.prefix + ":" + intname.slice(delimpos+1);
						return externalelemname;
					}
				}
			}
		}
		return "";
	}

	getMappings(): string {
		var result: string[] = [];
		for (let m of this.prefixMappings) {
			result.push(m.prefix+"="+m.namespace);
		}
		return result.join(",");
	}

	clearMappings() {
		this.prefixMappings = [];
	}

	popMapping() {
		this.prefixMappings.pop();
	}

	querySchema(externalPath: string): SchemaQuery | undefined {
		var elem: Element | undefined = undefined;
		if (externalPath === "") {
			elem = this.rootElement;
		}
		else {
			elem = this.findEntry(externalPath,0,this.rootElement.children);
		}

		// If we don't have an element for this query path, exit
		if (elem === undefined) {
			return undefined;
		}

		// We found a result, return the schema query
		return new SchemaQuery(elem);
	}

	getChecksum() {
		return this.checksum;
	}

	findEntry(externalPath: string, offset: number, elemCollection: Map<string, Element>): Element | undefined {
		var converted: string = "";
		var elem: Element | undefined = undefined;
		const slashpos = externalPath.indexOf("/",offset);
		if (slashpos === -1) {
			converted = this.convertE2I(externalPath.slice(offset));

			// Last piece
			elem = elemCollection.get(converted);
			if (elem !== undefined) {
				// If the element is a reference, track it down
				if (elem.isReference()) {
					elem = this.rootComponent.children.get(converted);
				}
			}
		}
		else {
			converted = this.convertE2I(externalPath.substring(offset,slashpos));

			// Middle piece
			var elem = elemCollection.get(converted);
			if (elem !== undefined) {
				// If the element is a reference, track it down
				if (elem.isReference()) {
					// Re-search from the original offset
					elem = this.findEntry(externalPath,offset,this.rootComponent.children);
				}
				else {
					// Search from position + 1
					elem = this.findEntry(externalPath,slashpos+1,elem.children);
				}
			}
		}
		return elem;
	}
};

/**
 * A cache of SASchemas retrieved from an InterSystems server.
 */
class SchemaCache {
	private schemas: Map<string, Schema>;
	private server: ServerSpec;

	constructor(server: ServerSpec) {
		this.schemas = new Map();
		this.server = server;
	}

	/**
	 * Get a SASchema object from the cache.
	 * 
	 * @param schemaurl The URL of the SASchema to get.
	 */
	async getSchema(schemaurl: string): Promise<Schema | undefined> {
		var schema = this.schemas.get(schemaurl);
		if (schema === undefined) {
			const respdata = await makeRESTRequest("GET",2,"/saschema/"+schemaurl,this.server,undefined,"");
			if (respdata !== undefined) {
				schema = new Schema(respdata.data.result);
				this.schemas.set(schemaurl,schema);
			}
		}
		else {
			const respdata = await makeRESTRequest("GET",2,"/saschema/"+schemaurl,this.server,undefined,schema.getChecksum());
			if (respdata !== undefined) {
				schema = new Schema(respdata.data.result);
				this.schemas.set(schemaurl,schema);
			}
		}
		return schema;
	}
};

/**
 * Build the list of all full class names for code completion, with import resolution.
 * 
 * @param doc The TextDocument that we're providing completion suggestions in.
 * @param parsed The tokenized representation of doc.
 * @param server The server that doc is associated with.
 * @param line The line of doc that we're in.
 */
async function completionFullClassName(doc: TextDocument, parsed: compressedline[], server: ServerSpec, line: number): Promise<CompletionItem[]> {
	var result: CompletionItem[] = [];

	// Get the list of imports for resolution
	const imports = await getImports(doc,parsed,line,server);

	// Get all classes
	const querydata = {
		query: "SELECT dcd.Name, dcd.Deprecated FROM %Library.RoutineMgr_StudioOpenDialog(?,?,?,?,?,?,?) AS sod, %Dictionary.ClassDefinition AS dcd WHERE sod.Name = {fn CONCAT(dcd.Name,'.cls')}",
		parameters: ["*.cls",1,1,1,1,0,1]
	};
	const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
	if (respdata !== undefined && respdata.data.result.content.length > 0) {
		for (let clsobj of respdata.data.result.content) {
			let displayname: string = clsobj.Name;
			let compItem: CompletionItem;
			if (imports.length > 0) {
				// Resolve import
				var sorttext: string = "";
				for (let imp of imports) {
					if (displayname.indexOf(imp) === 0 && displayname.slice(imp.length+1).indexOf(".") === -1) {
						displayname = displayname.slice(imp.length+1);
						sorttext = "%%%" + displayname;
						break;
					}
				}
				if (displayname.slice(0,9) === "%Library.") {
					// Use short form for %Library classes
					displayname = "%" + displayname.slice(9);
				}
				if (sorttext !== "") {
					compItem = {
						label: displayname,
						kind: CompletionItemKind.Class,
						data: ["class",clsobj.Name,doc.uri],
						sortText: sorttext
					};
				}
				else {
					compItem = {
						label: displayname,
						kind: CompletionItemKind.Class,
						data: ["class",clsobj.Name,doc.uri]
					};
				}
			}
			else {
				if (displayname.slice(0,9) === "%Library.") {
					// Use short form for %Library classes
					displayname = "%" + displayname.slice(9);
				}
				compItem = {
					label: displayname,
					kind: CompletionItemKind.Class,
					data: ["class",clsobj.Name,doc.uri]
				};
			}
			if (clsobj.Deprecated) {
				compItem.tags = [CompletionItemTag.Deprecated];
			}
			result.push(compItem);
		}
	}
	return result;
};

/**
 * Build the list of all packages for code completion.
 * 
 * @param server The server that this document is associated with.
 */
async function completionPackage(server: ServerSpec): Promise<CompletionItem[]> {
	var result: CompletionItem[] = [];

	// Get all the packages
	const querydata = {
		query: "SELECT DISTINCT $PIECE(Name,'.',1,$LENGTH(Name,'.')-2) AS Package FROM %Library.RoutineMgr_StudioOpenDialog(?,?,?,?,?,?,?)",
		parameters: ["*.cls",1,1,1,1,0,1]
	};
	const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
	if (respdata !== undefined && respdata.data.result.content.length > 0) {
		for (let packobj of respdata.data.result.content) {
			result.push({
				label: packobj.Package,
				kind: CompletionItemKind.Module,
				data: "package"
			});
		}
	}
	return result;
};

/**
 * Build the list of all include files for code completion.
 * 
 * @param server The server that this document is associated with.
 */
async function completionInclude(server: ServerSpec): Promise<CompletionItem[]> {
	var result: CompletionItem[] = [];

	// Get all inc files
	const querydata = {
		query: "SELECT Name FROM %Library.RoutineMgr_StudioOpenDialog(?,?,?,?,?,?,?)",
		parameters: ["*.inc",1,1,1,1,0,0]
	};
	const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
	if (respdata !== undefined && respdata.data.result.content.length > 0) {
		for (let incobj of respdata.data.result.content) {
			result.push({
				label: incobj.Name.slice(0,-4),
				kind: CompletionItemKind.File,
				data: "inc"
			});
		}
	}
	return result;
};

export async function onCompletion(params: CompletionParams): Promise<CompletionItem[] | null> {
	var result: CompletionItem[] = [];
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {return null;}
	const parsed = await getParsedDocument(params.textDocument.uri);
	if (parsed === undefined) {return null;}
	if (params.position.line === parsed.length) {return null;}
	const server: ServerSpec = await getServerSpec(params.textDocument.uri);
	const prevline = doc.getText(Range.create(Position.create(params.position.line,0),params.position));
	const classregex = /^class[ ]+%?[\p{L}\d]+(\.{1}[\p{L}\d]+)* +extends[ ]+(\(([%]?[\p{L}\d]+(\.{1}[\p{L}\d]+)*,[ ]*)*)?$/iu;
	var firsttwotokens = "";
	if (parsed[params.position.line].length >= 2) {
		firsttwotokens = doc.getText(Range.create(
			Position.create(params.position.line,parsed[params.position.line][0].p),
			Position.create(params.position.line,parsed[params.position.line][1].p+parsed[params.position.line][1].c)
		));
	}
	var thistoken: number = -1;
	for (let i = 0; i < parsed[params.position.line].length; i++) {
		const symbolstart: number = parsed[params.position.line][i].p;
		const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
		thistoken = i;
		if (params.position.character >= symbolstart && params.position.character <= symbolend) {
			// We found the right symbol in the line
			break;
		}
	}
	if (thistoken === -1) {return null;}
	const triggerlang: number = parsed[params.position.line][thistoken].l;
	if (
		(triggerlang == ld.cos_langindex &&
		(parsed[params.position.line][thistoken].s == ld.cos_comment_attrindex ||
		parsed[params.position.line][thistoken].s == ld.cos_dcom_attrindex))
		||
		(triggerlang == ld.cls_langindex &&
		(parsed[params.position.line][thistoken].s == ld.cls_desc_attrindex ||
		parsed[params.position.line][thistoken].s == ld.cls_comment_attrindex))
	) {
		// Don't provide completion inside of a comment
		return null;
	}
	var openparencount = 0;
	var closeparencount = 0;
	for (let char = 0; char < prevline.length; char++) {
		if (prevline.charAt(char) === "(") {
			openparencount++;
		}
		else if (prevline.charAt(char) === ")") {
			closeparencount++;
		}
	}
	const settings = await getLanguageServerSettings(params.textDocument.uri);
	
	if (prevline.slice(-3) === "$$$" && triggerlang === ld.cos_langindex) {
		// This is a macro

		// Get the details of this class and store them in the cache
		var maccon = getMacroContext(doc,parsed,params.position.line);
		macroCompletionCache = maccon;

		// Get the entire macro list from the server
		var cursorisopen: boolean = true;
		while (cursorisopen) {
			const respdata = await makeRESTRequest("POST",2,"/action/getmacrolist",server,maccon);
			if (respdata !== undefined && respdata.data.result.content.macros.length > 0) {
				// We got data back
				for (let i = 0; i < respdata.data.result.content.macros.length; i++) {
					const macro = respdata.data.result.content.macros[i];
					if (macro.slice(-1) === "(") {
						result.push({
							label: macro.slice(0,-1),
							insertText: macro,
							textEdit: TextEdit.insert(params.position, macro + "$0)"),
							insertTextFormat: InsertTextFormat.Snippet,
							kind: CompletionItemKind.Text,
							data: ["macro",doc.uri],
							// Automatically trigger SignatureHelp for macros that take arguments
							command: {
								title: "Show SignatureHelp",
								command: "editor.action.triggerParameterHints"
							}
						});
					}
					else {
						result.push({
							label: macro,
							kind: CompletionItemKind.Text,
							data: ["macro",doc.uri]
						});
					}
				}
				if (respdata.data.result.content.cursor !== "") {
					// The list is incomplete
					maccon.cursor = respdata.data.result.content.cursor;
				}
				else {
					// The list is complete
					cursorisopen = false;
				}
			}
			else {
				cursorisopen = false;
			}
		}

		// Scan up through the file, looking for macro definitions
		for (let ln = params.position.line-1; ln >= 0; ln--) {
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
					var macrodef: CompletionItem = {
						label: doc.getText(Range.create(Position.create(ln,parsed[ln][2].p),Position.create(ln,parsed[ln][2].p+parsed[ln][2].c))),
						kind: CompletionItemKind.Text,
						data: ["macro",doc.uri]
					};
					const valregex = /^(?:\([^\(\)]+\) *){0,1}(.+)$/;
					const argsregex = /^(\([^\(\)]+\))(?:.*)$/;
					if (
						parsed[ln][parsed[ln].length-1].l === ld.cos_langindex && parsed[ln][parsed[ln].length-1].s === ld.cos_ppf_attrindex &&
						doc.getText(Range.create(
							Position.create(ln,parsed[ln][parsed[ln].length-1].p),
							Position.create(ln,parsed[ln][parsed[ln].length-1].p+parsed[ln][parsed[ln].length-1].c)
						)).toLowerCase() === "continue"
					) {
						// This is the start of a multi-line macro definition
						const restofline = doc.getText(Range.create(
							Position.create(ln,parsed[ln][3].p),
							Position.create(ln,parsed[ln][parsed[ln].length-1].p+parsed[ln][parsed[ln].length-1].c)
						));
						var docstr = macrodef.label;
						if (parsed[ln][3].l == ld.cos_langindex && parsed[ln][3].s == ld.cos_delim_attrindex) {
							// This macro has args
							var argsmatchres = restofline.match(argsregex);
							if (argsmatchres !== null) {
								docstr = docstr + argsmatchres[1];
							}
						}

						var flvalmatchres = restofline.match(/^(?:\([^\(\)]+\) *){0,1}(.*)( *##continue)$/i);
						if (flvalmatchres !== null) {
							if (flvalmatchres[1] !== "") {
								docstr = docstr + "\n" + flvalmatchres[1].trim();
							}
							for (let mln = ln+1; mln < parsed.length; mln++) {
								if (
									parsed[mln][parsed[mln].length-1].l === ld.cos_langindex && parsed[mln][parsed[mln].length-1].s === ld.cos_ppf_attrindex &&
									doc.getText(Range.create(
										Position.create(mln,parsed[mln][parsed[mln].length-1].p),
										Position.create(mln,parsed[mln][parsed[mln].length-1].p+parsed[mln][parsed[mln].length-1].c)
									)).toLowerCase() === "continue"
								) {
									// This is a line of the multi-line macro definition
									docstr = docstr + "\n" + doc.getText(Range.create(
										Position.create(mln,parsed[mln][0].p),
										Position.create(mln,parsed[mln][parsed[mln].length-3].p+parsed[mln][parsed[mln].length-3].c)
									));
								}
								else {
									// This is the last line of the multi-line macro definition
									docstr = docstr + "\n" + doc.getText(Range.create(
										Position.create(mln,parsed[mln][0].p),
										Position.create(mln,parsed[mln][parsed[mln].length-1].p+parsed[mln][parsed[mln].length-1].c)
									));
									break;
								}
							}
						}
						if (docstr !== macrodef.label) {
							macrodef.documentation = {
								kind: "plaintext",
								value: docstr
							};
						}
					}
					else {
						// This is a single line macro definition
						const restofline = doc.getText(Range.create(
							Position.create(ln,parsed[ln][3].p),
							Position.create(ln,parsed[ln][parsed[ln].length-1].p+parsed[ln][parsed[ln].length-1].c)
						));
						var docstr = macrodef.label;
						if (parsed[ln][3].l == ld.cos_langindex && parsed[ln][3].s == ld.cos_delim_attrindex) {
							// This macro has args
							var argsmatchres = restofline.match(argsregex);
							if (argsmatchres !== null) {
								docstr = docstr + argsmatchres[1];
							}
						}
						var valmatchres = restofline.match(valregex);
						if (valmatchres !== null) {
							macrodef.documentation = {
								kind: "plaintext",
								value: docstr + "\n" + valmatchres[1]
							};
						}
					}
					result.push(macrodef);
				}
			}
		}
	}
	else if (prevline.slice(-1) === "$" && prevline.charAt(prevline.length-2) !== "$" && triggerlang === ld.cos_langindex) {
		if (prevline.charAt(prevline.length-2) === "^") {
			// This is a structured system variable
			for (let ssv of structuredSystemVariables) {
				const label = normalizeSystemName(ssv.label,"ssv",settings);
				result.push({
					label: label,
					kind: CompletionItemKind.Variable,
					textEdit: TextEdit.insert(params.position,label.slice(2) + "("),
					data: "ssv",
					documentation: {
						kind: "markdown",
						value: ssv.documentation.join("")
					}
				});
			}
		}
		else {
			// This is a system variable or function
			for (let sv of systemVariables) {
				const label = normalizeSystemName(sv.label,"sv",settings);
				result.push({
					label: label,
					kind: CompletionItemKind.Variable,
					textEdit: TextEdit.insert(params.position,label.slice(1)),
					data: "sv",
					documentation: {
						kind: "markdown",
						value: sv.documentation.join("")
					}
				});
			}
			for (let sf of systemFunctions) {
				if (sf.deprecated === undefined) {
					const label = normalizeSystemName(sf.label,"sf",settings);
					result.push({
						label: label,
						kind: CompletionItemKind.Function,
						textEdit: TextEdit.insert(params.position,label.slice(1) + "("),
						data: "sf",
						documentation: {
							kind: "markdown",
							value: sf.documentation.join("")
						}
					});
				}
			}
		}
	}
	else if (prevline.slice(-3).toLowerCase() === "as " && prevline.slice(0,9).toLowerCase() === "parameter"  && triggerlang === ld.cls_langindex) {
		// This is a parameter type
		for (let pt of parameterTypes) {
			result.push({
				label: pt.name,
				kind: CompletionItemKind.EnumMember,
				data: "parametertype",
				documentation: {
					kind: "plaintext",
					value: pt.documentation
				}
			});
		}
	}
	else if (/.*\) *as $/.test(prevline.toLowerCase()) && prevline.slice(0,5).toLowerCase() === "query"  && triggerlang === ld.cls_langindex) {
		// This is a class query type
		
		// Get the list of imports for resolution
		const imports = await getImports(doc,parsed,params.position.line,server);

		// Get all appropriate subclasses of %Query
		const querydata = {
			query: "SELECT Name FROM %Dictionary.ClassDefinitionQuery_SubclassOf(?) WHERE Name != ? AND Name != ?",
			parameters: ["%Library.Query","%Library.ExtentSQLQuery","%Library.RowSQLQuery"]
		};
		const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
		if (respdata !== undefined && respdata.data.result.content.length > 0) {
			for (let clsobj of respdata.data.result.content) {
				var displayname: string = clsobj.Name;
				if (imports.length > 0) {
					// Resolve import
					var sorttext: string = "";
					for (let imp of imports) {
						if (displayname.indexOf(imp) === 0 && displayname.slice(imp.length+1).indexOf(".") === -1) {
							displayname = displayname.slice(imp.length+1);
							sorttext = "%%%" + displayname;
							break;
						}
					}
					if (displayname.slice(0,9) === "%Library.") {
						// Use short form for %Library classes
						displayname = "%" + displayname.slice(9);
					}
					if (sorttext !== "") {
						result.push({
							label: displayname,
							kind: CompletionItemKind.Class,
							data: ["class",clsobj.Name+".cls",doc.uri],
							sortText: sorttext
						});
					}
					else {
						result.push({
							label: displayname,
							kind: CompletionItemKind.Class,
							data: ["class",clsobj.Name+".cls",doc.uri]
						});
					}
				}
				else {
					if (displayname.slice(0,9) === "%Library.") {
						// Use short form for %Library classes
						displayname = "%" + displayname.slice(9);
					}
					result.push({
						label: displayname,
						kind: CompletionItemKind.Class,
						data: ["class",clsobj.Name+".cls",doc.uri]
					});
				}
			}
			// Add a CompletionItem for %Query
			result.push({
				label: "%Query",
				kind: CompletionItemKind.Class,
				data: ["class","%Library.Query.cls",doc.uri]
			});
		}
	}
	else if (
		(prevline.slice(-6).toLowerCase() === "class(" && triggerlang === ld.cos_langindex) ||
		(prevline.slice(-3).toLowerCase() === "as " && (triggerlang === ld.cos_langindex || triggerlang === ld.cls_langindex)) ||
		(prevline.slice(-3).toLowerCase() === "of "  && triggerlang === ld.cos_langindex) ||
		classregex.test(prevline)
	) {
		// This is a full class name

		result = await completionFullClassName(doc,parsed,server,params.position.line);
	}
	else if (
		(prevline.slice(-1) === "." && prevline.slice(-2,-1) !== "," && prevline.slice(-2,-1) !== " "  &&
		thistoken !== 0 && (triggerlang === ld.cos_langindex || triggerlang === ld.cls_langindex)) ||
		(prevline.slice(-2) === ".#" && triggerlang === ld.cos_langindex)
	) {
		var prevtokentype = "";
		var prevtokentext = "";
		const prevtokenrange = findFullRange(params.position.line,parsed,thistoken-1,parsed[params.position.line][thistoken-1].p,parsed[params.position.line][thistoken-1].p+parsed[params.position.line][thistoken-1].c);
		prevtokentext = doc.getText(prevtokenrange);
		if ((parsed[params.position.line][thistoken-1].l == ld.cls_langindex && parsed[params.position.line][thistoken-1].s == ld.cls_clsname_attrindex) ||
		(parsed[params.position.line][thistoken-1].l == ld.cos_langindex && parsed[params.position.line][thistoken-1].s == ld.cos_clsname_attrindex)) {
			// This is a class name
			const prevchar = doc.getText(Range.create(Position.create(params.position.line,prevtokenrange.start.character-1),Position.create(params.position.line,prevtokenrange.start.character)));
			if (prevchar === " " || prevchar === "(" || prevchar === ",") {
				prevtokentype = "class";
			}
		}
		else if (parsed[params.position.line][thistoken-1].l == ld.cos_langindex && parsed[params.position.line][thistoken-1].s == ld.cos_sysv_attrindex && prevtokentext.toLowerCase() === "$system") {
			// This is $SYSTEM
			prevtokentype = "system";
		}
		if (prevtokentype === "class" || prevtokentype === "system") {
			// This is a partial class name

			var filter = "";
			if (prevtokentype === "system") {
				filter = "%SYSTEM.";
			}
			else {
				if (prevtokentext.slice(-1) !== ".") {
					filter = prevtokentext + ".";
				}
				else {
					filter = prevtokentext;
				}
			}

			// Get all classes that match the filter
			const querydata = {
				query: "SELECT dcd.Name, dcd.Deprecated FROM %Library.RoutineMgr_StudioOpenDialog(?,?,?,?,?,?,?,?) AS sod, %Dictionary.ClassDefinition AS dcd WHERE sod.Name = {fn CONCAT(dcd.Name,'.cls')}",
				parameters: ["*.cls",1,1,1,1,0,1,`Name %STARTSWITH '${filter}'`]
			};
			const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
			if (respdata !== undefined && respdata.data.result.content.length > 0) {
				// We got data back

				for (let clsobj of respdata.data.result.content) {
					result.push({
						label: clsobj.Name.slice(filter.length),
						kind: CompletionItemKind.Class,
						data: ["class",clsobj.Name,doc.uri],
						tags: clsobj.Deprecated ? [CompletionItemTag.Deprecated] : undefined
					});
				}
			}
		}
		else {
			// This is a class member

			if (prevline.slice(-2) === ".#") {
				// Get the base class that this member is in
				const membercontext = await getClassMemberContext(doc,parsed,thistoken-1,params.position.line,server);
				if (membercontext.baseclass === "") {
					// If we couldn't determine the class, don't return anything
					return null;
				}

				// Query the server to get the names and descriptions of all parameters
				const data: QueryData = {
					query: "SELECT Name, Description, Origin, Type, Deprecated FROM %Dictionary.CompiledParameter WHERE parent->ID = ?",
					parameters: [membercontext.baseclass]
				}
				const respdata = await makeRESTRequest("POST",1,"/action/query",server,data);
				if (respdata !== undefined && "content" in respdata.data.result && respdata.data.result.content.length > 0) {
					// We got data back

					for (let memobj of respdata.data.result.content) {
						const quotedname = quoteUDLIdentifier(memobj.Name,1);
						var item: CompletionItem = {
							label: ""
						};
						item = {
							label: "#" + quotedname,
							kind: CompletionItemKind.Property,
							data: "member",
							documentation: {
								kind: "markdown",
								value: documaticHtmlToMarkdown(memobj.Description)
							},
							sortText: quotedname,
							insertText: quotedname
						};
						if (memobj.Type !== "") {
							item.detail = memobj.Type;
						}
						if (memobj.Origin === membercontext.baseclass) {
							// Members from the base class should appear first
							item.sortText = "##" + quotedname;
						}
						else {
							item.sortText = item.label;
						}
						if (memobj.Deprecated) {
							item.tags = [CompletionItemTag.Deprecated];
						}
						result.push(item);
					}
				}
			}
			else {
				// Get the base class that this member is in
				const membercontext = await getClassMemberContext(doc,parsed,thistoken,params.position.line,server);
				if (membercontext.baseclass === "") {
					// If we couldn't determine the class, don't return anything
					return null;
				}
				
				// Query the server to get the metadata of all appropriate class members
				var data: QueryData = {
					query: "",
					parameters: []
				};
				if (membercontext.context === "class") {
					data.query = "SELECT Name, Description, Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
						"FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND classmethod = 1 AND Stub IS NULL AND ((Origin = parent->ID) OR (Origin != parent->ID AND NotInheritable = 0)) UNION ALL %PARALLEL " +
						"SELECT {fn CONCAT(parent->name,Name)} AS Name, Description, parent->Origin AS Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
						"FROM %Dictionary.CompiledIndexMethod WHERE parent->parent->ID = ? AND classmethod = 1 UNION ALL %PARALLEL " +
						"SELECT {fn CONCAT(parent->name,Name)} AS Name, Description, parent->Origin AS Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
						"FROM %Dictionary.CompiledQueryMethod WHERE parent->parent->ID = ? AND classmethod = 1 UNION ALL %PARALLEL " +
						"SELECT {fn CONCAT(parent->name,Name)} AS Name, Description, parent->Origin AS Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
						"FROM %Dictionary.CompiledPropertyMethod WHERE parent->parent->ID = ? AND classmethod = 1 UNION ALL %PARALLEL " +
						"SELECT {fn CONCAT(parent->name,Name)} AS Name, Description, parent->Origin AS Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
						"FROM %Dictionary.CompiledConstraintMethod WHERE parent->parent->ID = ? AND classmethod = 1 UNION ALL %PARALLEL " +
						"SELECT Name, Description, Origin, NULL AS FormalSpec, Type, 'parameter' AS MemberType, Deprecated FROM %Dictionary.CompiledParameter WHERE parent->ID = ?";
					data.parameters = new Array(6).fill(membercontext.baseclass);
				}
				else if (membercontext.context === "instance") {
					data.query = "SELECT Name, Description, Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
						"FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND classmethod = 0 AND Stub IS NULL AND ((Origin = parent->ID) OR (Origin != parent->ID AND NotInheritable = 0)) UNION ALL %PARALLEL " +
						"SELECT {fn CONCAT(parent->name,Name)} AS Name, Description, parent->Origin AS Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
						"FROM %Dictionary.CompiledIndexMethod WHERE parent->parent->ID = ? AND classmethod = 0 UNION ALL %PARALLEL " +
						"SELECT {fn CONCAT(parent->name,Name)} AS Name, Description, parent->Origin AS Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
						"FROM %Dictionary.CompiledQueryMethod WHERE parent->parent->ID = ? AND classmethod = 0 UNION ALL %PARALLEL " +
						"SELECT {fn CONCAT(parent->name,Name)} AS Name, Description, parent->Origin AS Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
						"FROM %Dictionary.CompiledPropertyMethod WHERE parent->parent->ID = ? AND classmethod = 0 UNION ALL %PARALLEL " +
						"SELECT {fn CONCAT(parent->name,Name)} AS Name, Description, parent->Origin AS Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
						"FROM %Dictionary.CompiledConstraintMethod WHERE parent->parent->ID = ? AND classmethod = 0 UNION ALL %PARALLEL " +
						"SELECT Name, Description, Origin, NULL AS FormalSpec, RuntimeType AS Type, 'property' AS MemberType, Deprecated FROM %Dictionary.CompiledProperty WHERE parent->ID = ?";
					data.parameters = new Array(6).fill(membercontext.baseclass);
				}
				else {
					data.query = "SELECT Name, Description, Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
						"FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND classmethod = 1 AND Stub IS NULL AND ((Origin = parent->ID) OR (Origin != parent->ID AND NotInheritable = 0)) UNION ALL %PARALLEL " +
						"SELECT {fn CONCAT(parent->name,Name)} AS Name, Description, parent->Origin AS Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
						"FROM %Dictionary.CompiledIndexMethod WHERE parent->parent->ID = ? AND classmethod = 1 UNION ALL %PARALLEL " +
						"SELECT {fn CONCAT(parent->name,Name)} AS Name, Description, parent->Origin AS Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
						"FROM %Dictionary.CompiledQueryMethod WHERE parent->parent->ID = ? AND classmethod = 1 UNION ALL %PARALLEL " +
						"SELECT {fn CONCAT(parent->name,Name)} AS Name, Description, parent->Origin AS Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
						"FROM %Dictionary.CompiledPropertyMethod WHERE parent->parent->ID = ? AND classmethod = 1 UNION ALL %PARALLEL " +
						"SELECT {fn CONCAT(parent->name,Name)} AS Name, Description, parent->Origin AS Origin, FormalSpec, ReturnType AS Type, 'method' AS MemberType, Deprecated " +
						"FROM %Dictionary.CompiledConstraintMethod WHERE parent->parent->ID = ? AND classmethod = 1";
					data.parameters = new Array(5).fill(membercontext.baseclass);
				}
				const respdata = await makeRESTRequest("POST",1,"/action/query",server,data);
				if (respdata !== undefined && respdata.data.result.content.length > 0) {
					// We got data back
					
					for (let memobj of respdata.data.result.content) {
						const quotedname = quoteUDLIdentifier(memobj.Name,1);
						var item: CompletionItem = {
							label: ""
						};
						if (memobj.MemberType === "method") {
							item = {
								label: quotedname,
								kind: CompletionItemKind.Method,
								data: "member",
								documentation: {
									kind: "markdown",
									value: documaticHtmlToMarkdown(memobj.Description)
								}
							};
							if (memobj.Type !== "") {
								item.detail = memobj.Type;
							}
							if (memobj.FormalSpec === "") {
								// Insert trailing parentheses because method takes no arguments
								item.insertText = quotedname + "()";
							}
							else {
								// Automatically trigger SignatureHelp for methods that take arguments
								// Need to escape $ because it has a special meaning in snippets
								item.textEdit = TextEdit.insert(params.position,quotedname.replace(/\$/g,"//$") + "($0)");
								item.insertTextFormat = InsertTextFormat.Snippet;
								item.command = {
									title: "Show SignatureHelp",
									command: "editor.action.triggerParameterHints"
								};
							}
						}
						else if (memobj.MemberType === "parameter") {
							item = {
								label: "#" + quotedname,
								kind: CompletionItemKind.Property,
								data: "member",
								documentation: {
									kind: "markdown",
									value: documaticHtmlToMarkdown(memobj.Description)
								},
								sortText: quotedname
							};
							if (memobj.Type !== "") {
								item.detail = memobj.Type;
							}
						}
						else {
							item = {
								label: quotedname,
								kind: CompletionItemKind.Property,
								data: "member",
								documentation: {
									kind: "markdown",
									value: documaticHtmlToMarkdown(memobj.Description)
								}
							};
							if (memobj.Type !== "") {
								item.detail = memobj.Type;
							}
						}
						if (memobj.Origin === membercontext.baseclass) {
							// Members from the base class should appear first
							item.sortText = "##" + quotedname;
						}
						else {
							item.sortText = item.label;
						}
						if (memobj.Deprecated) {
							item.tags = [CompletionItemTag.Deprecated];
						}
						result.push(item);
					}
				}
			}
		}
	}
	else if (
		((prevline.slice(-1) === " " || prevline.slice(-1) === "," || prevline.slice(-1) === "(") && triggerlang === ld.cls_langindex &&
		(prevline.slice(0,7).toLowerCase() === "include" || prevline.slice(0,16).toLowerCase() === "includegenerator")) ||
		(parsed[params.position.line].length === 2 && firsttwotokens.toLowerCase() === "#include" && triggerlang === ld.cos_langindex)
	) {
		// This is an include file

		result = await completionInclude(server);
	}
	else if (
		(prevline.slice(-1) === " " || prevline.slice(-1) === "," || prevline.slice(-1) === "(") &&
		(prevline.slice(0,6).toLowerCase() === "import") && triggerlang === ld.cls_langindex
	) {
		// This is an import

		result = await completionPackage(server);
	}
	else if (
		triggerlang === ld.cls_langindex &&
		firsttwotokens.toLowerCase().split(" ")[0] === "property" &&
		openparencount > closeparencount &&
		(prevline.slice(-2) === ", " || prevline.slice(-1) === "(") &&
		prevline.slice(firsttwotokens.length).indexOf("[") === -1
	) {
		// This is a Property data type parameter

		// Determine the normalized class name of this Property
		const normalizedcls = await determineNormalizedPropertyClass(doc,parsed,params.position.line,server);
		if (normalizedcls === "") {
			// If we couldn't determine the class, don't return anything
			return null;
		}

		// Find all parameters that are already used
		const existingparams: string[] = [];
		for (let i = 5; i < parsed[params.position.line].length; i++) {
			const symbolstart: number = parsed[params.position.line][i].p;
			const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
			if (params.position.character <= symbolstart) {
				break;
			}
			const symboltext = doc.getText(Range.create(Position.create(params.position.line,symbolstart),Position.create(params.position.line,symbolend)));
			if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_cparam_attrindex) {
				existingparams.push(symboltext);
			}
		}

		// Add elements for core property parameters
		const coreParams: CompletionItem[] = corePropertyParams.map(e => {
			return {
				label: e.name,
				kind: CompletionItemKind.Property,
				data: "member",
				documentation: {
					kind: "markdown",
					value: e.desc
				},
				sortText: e.name,
				insertText: `${e.name} = `
			};
		});
		result = coreParams.filter(e => !existingparams.includes(e.label));

		// Query the server to get the names and descriptions of all class-specific parameters
		const data: QueryData = {
			query: "SELECT Name, Description, Origin, Type, Deprecated FROM %Dictionary.CompiledParameter WHERE parent->ID = ? OR " +
			"parent->ID %INLIST (SELECT $LISTFROMSTRING(PropertyClass) FROM %Dictionary.CompiledClass WHERE Name = ?)",
			parameters: [normalizedcls,currentClass(doc,parsed)]
		};
		const respdata = await makeRESTRequest("POST",1,"/action/query",server,data);
		if (respdata !== undefined && "content" in respdata.data.result && respdata.data.result.content.length > 0) {
			// We got data back

			for (let memobj of respdata.data.result.content) {
				if (existingparams.includes(memobj.Name)) {
					// Don't suggest a parameter that's already present
					continue;
				}
				var item: CompletionItem = {
					label: ""
				};
				item = {
					label: memobj.Name,
					kind: CompletionItemKind.Property,
					data: "member",
					documentation: {
						kind: "markdown",
						value: documaticHtmlToMarkdown(memobj.Description)
					},
					sortText: memobj.Name,
					insertText: `${memobj.Name} = `
				};
				if (memobj.Type !== "") {
					item.detail = memobj.Type;
				}
				if (memobj.Origin === normalizedcls) {
					// Members from the base class should appear first
					item.sortText = "##" + memobj.Name;
				}
				if (memobj.Deprecated) {
					item.tags = [CompletionItemTag.Deprecated];
				}
				result.push(item);
			}
		}
	}
	else if (
		(prevline.slice(-2) === "[ " || (prevline.slice(-2) === ", " &&
		openparencount <= closeparencount)) && triggerlang === ld.cls_langindex
	) {
		var foundopenbrace = false;
		var foundclosingbrace = false;
		var existingkeywords: string[] = [];
		for (let i = 1; i < parsed[params.position.line].length; i++) {
			const symbolstart: number = parsed[params.position.line][i].p;
			const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
			if (params.position.character <= symbolstart) {
				break;
			}
			const symboltext = doc.getText(Range.create(Position.create(params.position.line,symbolstart),Position.create(params.position.line,symbolend)));
			if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_delim_attrindex && symboltext === "[") {
				foundopenbrace = true;
			}
			else if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_delim_attrindex && symboltext === "]") {
				foundclosingbrace = true;
			}
			else if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_keyword_attrindex && symboltext.toLowerCase() !== "not") {
				// If this keyword has already been specified, don't suggest it
				existingkeywords.push(symboltext.toLowerCase());
			}
		}
		if (foundopenbrace && !foundclosingbrace) {
			// This is a UDL keyword

			// Find the type of this member
			var keywordtype = doc.getText(Range.create(
				Position.create(params.position.line,parsed[params.position.line][0].p),
				Position.create(params.position.line,parsed[params.position.line][0].p+parsed[params.position.line][0].c)
			)).toLowerCase();
			if (parsed[params.position.line][0].l !== ld.cls_langindex || parsed[params.position.line][0].s !== ld.cls_keyword_attrindex) {
				// This member definition spans multiple lines
				for (let k = params.position.line-1; k >= 0; k--) {
					if (parsed[k].length === 0) {
						continue;
					}
					if (parsed[k][0].l == ld.cls_langindex && parsed[k][0].s == ld.cls_keyword_attrindex) {
						keywordtype = doc.getText(Range.create(
							Position.create(k,parsed[k][0].p),
							Position.create(k,parsed[k][0].p+parsed[k][0].c)
						)).toLowerCase();
						break;
					}
				}
			}

			var keywordsarr: KeywordDoc[] =[];
			if (keywordtype === "class") {
				keywordsarr = classKeywords.slice();
			}
			else if (keywordtype === "foreignkey") {
				keywordsarr = foreignkeyKeywords.slice();
			}
			else if (keywordtype === "index") {
				keywordsarr = indexKeywords.slice();
			}
			else if (keywordtype === "method" || keywordtype === "classmethod" || keywordtype === "clientmethod") {
				keywordsarr = methodKeywords.slice();
			}
			else if (keywordtype === "parameter") {
				keywordsarr = parameterKeywords.slice();
			}
			else if (keywordtype === "projection") {
				keywordsarr = projectionKeywords.slice();
			}
			else if (keywordtype === "property" || keywordtype === "relationship") {
				keywordsarr = propertyKeywords.slice();
			}
			else if (keywordtype === "query") {
				keywordsarr = queryKeywords.slice();
			}
			else if (keywordtype === "trigger") {
				keywordsarr = triggerKeywords.slice();
			}
			else if (keywordtype === "xdata") {
				keywordsarr = xdataKeywords.slice();
			}
			for (let keydoc of keywordsarr) {
				var doctext = keydoc.description;
				if (doctext === undefined) {
					doctext = "";
				}
				if (!existingkeywords.includes(keydoc.name.toLowerCase())) {
					if ("constraint" in keydoc && keydoc.constraint instanceof Array) {
						if (doctext !== "") {
							doctext = doctext + "\n\n";
						}
						doctext = doctext.concat("Permitted Values: ",keydoc.constraint.join(", "));
					}
					var compitem: CompletionItem = {
						label: keydoc.name,
						kind: CompletionItemKind.Keyword,
						data: "keyword",
						documentation: {
							kind: "plaintext",
							value: doctext
						}
					}
					if (!("type" in keydoc) || ("type" in keydoc && keydoc.type !== "KW_TYPE_BOOLEAN")) {
						compitem.insertText = keydoc.name + " =";
					}
					result.push(compitem);
				}
			}
		}
	}
	else if (
		triggerlang === ld.cls_langindex &&
		(prevline.slice(-2) === "= " || (prevline.slice(-2) === ", " && openparencount > closeparencount) || prevline.slice(-3) === "= (")
	) {
		var foundopenbrace = false;
		var foundclosingbrace = false;
		var thiskeyword = "";
		for (let i = 1; i < parsed[params.position.line].length; i++) {
			const symbolstart: number = parsed[params.position.line][i].p;
			const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
			if (params.position.character <= symbolstart) {
				break;
			}
			const symboltext = doc.getText(Range.create(Position.create(params.position.line,symbolstart),Position.create(params.position.line,symbolend))).toLowerCase();
			if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_delim_attrindex && symboltext === "[") {
				foundopenbrace = true;
			}
			else if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_delim_attrindex && symboltext === "]") {
				foundclosingbrace = true;
			}
			else if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_keyword_attrindex) {
				thiskeyword = symboltext;
			}
		}
		if (foundopenbrace && !foundclosingbrace) {
			// This is a value for a UDL keyword

			// Find the type of this member
			var keywordtype = doc.getText(Range.create(
				Position.create(params.position.line,parsed[params.position.line][0].p),
				Position.create(params.position.line,parsed[params.position.line][0].p+parsed[params.position.line][0].c)
			)).toLowerCase();
			if (parsed[params.position.line][0].l !== ld.cls_langindex || parsed[params.position.line][0].s !== ld.cls_keyword_attrindex) {
				// This member definition spans multiple lines
				for (let k = params.position.line-1; k >= 0; k--) {
					if (parsed[k].length === 0) {
						continue;
					}
					if (parsed[k][0].l == ld.cls_langindex && parsed[k][0].s == ld.cls_keyword_attrindex) {
						keywordtype = doc.getText(Range.create(
							Position.create(k,parsed[k][0].p),
							Position.create(k,parsed[k][0].p+parsed[k][0].c)
						)).toLowerCase();
						break;
					}
				}
			}

			var keywordsarr: KeywordDoc[] =[];
			if (keywordtype === "class") {
				keywordsarr = classKeywords.slice();
			}
			else if (keywordtype === "foreignkey") {
				keywordsarr = foreignkeyKeywords.slice();
			}
			else if (keywordtype === "index") {
				keywordsarr = indexKeywords.slice();
			}
			else if (keywordtype === "method" || keywordtype === "classmethod" || keywordtype === "clientmethod") {
				keywordsarr = methodKeywords.slice();
			}
			else if (keywordtype === "parameter") {
				keywordsarr = parameterKeywords.slice();
			}
			else if (keywordtype === "projection") {
				keywordsarr = projectionKeywords.slice();
			}
			else if (keywordtype === "property" || keywordtype === "relationship") {
				keywordsarr = propertyKeywords.slice();
			}
			else if (keywordtype === "query") {
				keywordsarr = queryKeywords.slice();
			}
			else if (keywordtype === "trigger") {
				keywordsarr = triggerKeywords.slice();
			}
			else if (keywordtype === "xdata") {
				keywordsarr = xdataKeywords.slice();
			}
			
			const thiskeydoc = keywordsarr.find((keydoc) => keydoc.name.toLowerCase() === thiskeyword);
			if (thiskeydoc !== undefined && "constraint" in thiskeydoc) {
				// The keyword was found and has a constraint
				if (thiskeydoc.constraint instanceof Array) {
					// Static list of permitted values
					for (let val of thiskeydoc.constraint) {
						result.push({
							label: val,
							kind: CompletionItemKind.EnumMember,
							data: "keywordvalue"
						});
					}
				}
				else if (thiskeydoc.constraint === "KW_SYSENUM_CLASS_LIST") {
					// List of classes
					result = await completionFullClassName(doc,parsed,server,params.position.line);
				}
				else if (thiskeydoc.constraint === "KW_SYSENUM_PACKAGE_LIST") {
					// List of packages
					result = await completionPackage(server);
				}
				else if (thiskeydoc.constraint === "KW_SYSENUM_INCFILE_LIST") {
					// List of includes
					result = await completionInclude(server);
				}
				else if (thiskeydoc.constraint === "KW_SYSENUM_METHOD_LIST") {
					// List of methods

					// Find the class name
					var thisclass = "";
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
										thisclass = thisclass.concat(doc.getText(Range.create(Position.create(i,parsed[i][j].p),Position.create(i,parsed[i][j].p+parsed[i][j].c))));
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
					const querydata = {
						query: "SELECT Name, Description, Origin FROM %Dictionary.CompiledMethod WHERE parent->ID = ?",
						parameters:[thisclass]
					};
					const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
					if (respdata !== undefined && "content" in respdata.data.result && respdata.data.result.content.length > 0) {
						// We got data back
						
						for (let method of respdata.data.result.content) {
							var item: CompletionItem  = {
								label: method.Name,
								kind: CompletionItemKind.Method,
								data: "member",
								documentation: {
									kind: "markdown",
									value: documaticHtmlToMarkdown(method.Description)
								}
							};
							if (method.Origin === method.baseclass) {
								// Members from the base class should appear first
								item.sortText = "##" + method.Name;
							}
							else {
								item.sortText = item.label;
							}
							result.push(item);
						}
					}
				}
			}
		}
	}
	else if ((prevline.slice(-1) === " " || prevline.slice(-1) === "<" || prevline.slice(-1) === '"') && triggerlang === ld.xml_langindex) {
		// Scan up to see if the XData block has an XMLNamespace
		// Also find the parent element
		var xmlns: string = "";
		var xmlstartline: number = -1;
		for (let j = params.position.line; j >= 0; j--) {
			if (parsed[j].length === 0) {
				continue;
			}
			if (parsed[j][0].l == ld.cls_langindex && parsed[j][0].s == ld.cls_keyword_attrindex) {
				// This is the definition for the XData block
				for (let k = 3; k < parsed[j].length; k++) {
					if (parsed[j][k].l == ld.cls_langindex && parsed[j][k].s == ld.cls_keyword_attrindex) {
						// This is a UDL trailing keyword
						const keytext = doc.getText(Range.create(
							Position.create(j,parsed[j][k].p),
							Position.create(j,parsed[j][k].p+parsed[j][k].c)
						)).toLowerCase();
						if (keytext === "xmlnamespace") {
							// An XMLNamespace is defined
							xmlns = doc.getText(Range.create(
								Position.create(j,parsed[j][k+2].p+1),
								Position.create(j,parsed[j][k+2].p+parsed[j][k+2].c-1)
							));
							break;
						}
					}
				}
				break;
			}
			else if (parsed[j][0].l == ld.xml_langindex) {
				// This is a line of XML
				xmlstartline = j;
			}
		}
		if (xmlns !== "") {
			// An XMLNamespace is defined
			
			// Only proceed if we can provide suggestions
			if (
				(prevline.slice(-1) === " " &&
				prevline.indexOf("<") !== -1 &&
				prevline.charAt(prevline.lastIndexOf("<")+1) !== "!" &&
				prevline.split("<").length > prevline.split(">").length) ||
				prevline.slice(-1) === "<" || prevline.slice(-1) === '"'
			) {
				// Get the SchemaCache for this server or create one if it doesn't exist
				var schemaCache = schemaCaches.get(server);
				if (schemaCache === undefined) {
					schemaCache = new SchemaCache(server);
					schemaCaches.set(server,schemaCache);
				}

				// Get the Schema from the SchemaCache
				const schema = await schemaCache.getSchema(xmlns);

				if (schema !== undefined) {
					// We got a SASchema back from the server
					
					// Parse the XML from the beginning to the completion position and build a string with the full element tree
					var openelem: string[] = [];
					for (let xmlline = xmlstartline; xmlline <= params.position.line; xmlline++) {
						var endtkn: number = parsed[xmlline].length - 1;
						if (xmlline === params.position.line) {
							// Don't parse past the completion position
							endtkn = thistoken - 1;
						}
						for (let xmltkn = 0; xmltkn <= endtkn; xmltkn++) {
							if (parsed[xmlline][xmltkn].l == ld.xml_langindex && parsed[xmlline][xmltkn].s == ld.xml_tagdelim_attrindex) {
								// This is a tag delimiter 
								const tokentext = doc.getText(Range.create(
									Position.create(xmlline,parsed[xmlline][xmltkn].p),
									Position.create(xmlline,parsed[xmlline][xmltkn].p+parsed[xmlline][xmltkn].c)
								));
								if (tokentext === "<") {
									// The upcoming element is being opened
									openelem.push(doc.getText(Range.create(
										Position.create(xmlline,parsed[xmlline][xmltkn+1].p),
										Position.create(xmlline,parsed[xmlline][xmltkn+1].p+parsed[xmlline][xmltkn+1].c)
									)));
								}
								else if (tokentext === "</") {
									// The upcoming element is being closed
									openelem.splice(openelem.lastIndexOf(doc.getText(Range.create(
										Position.create(xmlline,parsed[xmlline][xmltkn+1].p),
										Position.create(xmlline,parsed[xmlline][xmltkn+1].p+parsed[xmlline][xmltkn+1].c)
									))),1);
								}
								else if (tokentext === "/>") {
									// The previous element has been closed
									openelem.pop();
								}
							}
						}
					}
					const elementPath = openelem.join("/");
					const schemaQuery = schema.querySchema(elementPath);
					if (schemaQuery === undefined) {
						// We didn't get a result
						return null;
					}

					if (prevline.slice(-1) === " ") {
						// Looking for possible attribute values

						var possibleAttrs = schemaQuery.getAttributes();
						
						// Find any attribute names that are already used
						var usedAttrs: string[] = [];
						for (let tkn = parsed[params.position.line].length-1; tkn >= 0; tkn--) {
							if (parsed[params.position.line][tkn].p >= params.position.character) {
								continue;
							}
							if (parsed[params.position.line][tkn].l == ld.xml_langindex && parsed[params.position.line][tkn].s == ld.xml_attr_attrindex) {
								// This is an attribute name
								usedAttrs.push(doc.getText(Range.create(
									Position.create(params.position.line,parsed[params.position.line][tkn].p),
									Position.create(params.position.line,parsed[params.position.line][tkn].p+parsed[params.position.line][tkn].c)
								)));
							}
						}

						// Filter out all attribute names that have already been used
						possibleAttrs = possibleAttrs.filter((el) => !usedAttrs.includes(el));

						// Create the CompletionItem's
						for (let attr of possibleAttrs) {
							result.push({
								label: attr,
								kind: CompletionItemKind.Field,
								insertText: attr+"=",
								data: "SASchema"
							});
						}
					}
					else if (prevline.slice(-1) === "<") {
						// Looking for child element names

						var childElems = schemaQuery.getElements();

						// Create the CompletionItem's for the children
						for (let elem of childElems) {
							result.push({
								label: elem,
								kind: CompletionItemKind.Property,
								data: "SASchema"
							});
						}

						// Create the completion item for the closing tag
						result.push({
							label: "/"+openelem[openelem.length-1]+">",
							kind: CompletionItemKind.Property,
							data: "SASchema",
							sortText: "zzzzz"+"/"+openelem[openelem.length-1]+">"
						});
					}
					else {
						// Looking for an attribute value enum

						// Find the name of the attribute that we're looking for values for
						var selector: string = "";
						for (let tkn = parsed[params.position.line].length-1; tkn >= 0; tkn--) {
							if (parsed[params.position.line][tkn].p >= params.position.character) {
								continue;
							}
							if (parsed[params.position.line][tkn].l == ld.xml_langindex && parsed[params.position.line][tkn].s == ld.xml_attr_attrindex) {
								// This is an attribute name
								selector = doc.getText(Range.create(
									Position.create(params.position.line,parsed[params.position.line][tkn].p),
									Position.create(params.position.line,parsed[params.position.line][tkn].p+parsed[params.position.line][tkn].c)
								));
								break;
							}
						}

						var attrMoniker = schemaQuery.getAttributeMoniker(selector);
						if (attrMoniker === "" || attrMoniker.slice(0,4) === "enum") {
							// If the attribute moniker is an enum, create CompletionItem's for all possible values
							const vals = attrMoniker.slice(5).split(",");
							for (let val of vals) {
								if (val !== "!") {
									result.push({
										label: val,
										kind: CompletionItemKind.EnumMember,
										insertText: val + '"',
										data: "SASchema"
									});
								}
							}
						}
					}
				}
			}
		}
	}
	else if (prevline.slice(-2) === "##" && triggerlang === ld.cos_langindex) {
		// This is a double-pound preprocessor directive

		if (thistoken === 0) {
			// This preprocessor directive is on the start of the line

			for (let dir of preprocessorDirectives) {
				if (dir.start && dir.label.slice(0,2) === "##") {
					result.push({
						label: dir.label,
						kind: CompletionItemKind.Keyword,
						documentation: {
							kind: "markdown",
							value: dir.documentation + "\n\n" + `[Online documentation](https://docs.intersystems.com/irislatest/csp/docbook/Doc.View.cls?KEY=GCOS_macros#GCOS_macros_${dir.link})`
						},
						insertText: dir.label.slice(2),
						data: "Preprocessor"
					});
				}
			}
		}
		else {
			// This preprocessor directive is mid-line

			for (let dir of preprocessorDirectives) {
				if (dir.middle && dir.label.slice(0,2) === "##") {
					result.push({
						label: dir.label,
						kind: CompletionItemKind.Keyword,
						documentation: {
							kind: "markdown",
							value: dir.documentation + "\n\n" + `[Online documentation](https://docs.intersystems.com/irislatest/csp/docbook/Doc.View.cls?KEY=GCOS_macros#GCOS_macros_${dir.link})`
						},
						insertText: dir.label.slice(2),
						data: "Preprocessor"
					});
				}
			}
		}
	}
	else if (prevline.slice(-1) === "#" && triggerlang === ld.cos_langindex) {
		// This is a preprocessor directive

		if (thistoken === 0) {
			// This preprocessor directive is on the start of the line

			for (let dir of preprocessorDirectives) {
				if (dir.start) {
					result.push({
						label: dir.label,
						kind: CompletionItemKind.Keyword,
						documentation: {
							kind: "markdown",
							value: dir.documentation + "\n\n" + `[Online documentation](https://docs.intersystems.com/irislatest/csp/docbook/Doc.View.cls?KEY=GCOS_macros#GCOS_macros_${dir.link})`
						},
						insertText: dir.label.slice(1),
						data: "Preprocessor"
					});
				}
			}
		}
		else {
			// This preprocessor directive is mid-line

			for (let dir of preprocessorDirectives) {
				if (dir.middle) {
					result.push({
						label: dir.label,
						kind: CompletionItemKind.Keyword,
						documentation: {
							kind: "markdown",
							value: dir.documentation + "\n\n" + `[Online documentation](https://docs.intersystems.com/irislatest/csp/docbook/Doc.View.cls?KEY=GCOS_macros#GCOS_macros_${dir.link})`
						},
						insertText: dir.label.slice(1),
						data: "Preprocessor"
					});
				}
			}
		}
	}
	else if (prevline.slice(-1) === "<" && triggerlang === ld.cls_langindex) {
		// This is an angle bracket in UDL

		const storageObjKey = storageKeywordsKeyForToken(doc, parsed, params.position.line, thistoken);
		if (storageObjKey != "") {
			// Get the list of all possible elements at this nesting level
			const keywords: KeywordDoc[] = storageKeywords[storageObjKey];
			if (keywords) {
				if (storageObjKey != "STORAGE") {
					// Add an entry for the closing tag of the parent

					let longestStart = "";
					for (const stgKey of Object.keys(storageKeywords)) {
						if (stgKey == storageObjKey) {
							break;
						}
						longestStart = stgKey;
					}
					if (longestStart.length) {
						const parentKeyDoc = storageKeywords[longestStart].find(
							(keydoc) => keydoc.name.toUpperCase() == storageObjKey.slice(longestStart.length)
						);
						if (parentKeyDoc) {
							result.push({
								label: `/${parentKeyDoc.name}`,
								kind: CompletionItemKind.Keyword,
								data: "storage",
								insertText: `/${parentKeyDoc.name}>`,
								sortText: "zzzz" // Make sure this entry is last in the list
							});
						}
					}
				}
				result.push(...keywords.filter((keydoc) => keydoc.name != "Name").map((keydoc) => {
					let doctext = keydoc.description;
					if (doctext === undefined) {
						doctext = "";
					}
					if ("constraint" in keydoc && keydoc.constraint instanceof Array) {
						if (doctext !== "") {
							doctext = doctext + "\n\n";
						}
						doctext = doctext.concat("Permitted Values: ",keydoc.constraint.join(", "));
					}
					const compitem: CompletionItem = {
						label: keydoc.name,
						kind: CompletionItemKind.Keyword,
						data: "storage",
						documentation: {
							kind: "plaintext",
							value: doctext
						}
					};
					
					const childKeys: KeywordDoc[] = storageKeywords[storageObjKey + keydoc.name.toUpperCase()];
					if (childKeys && childKeys.findIndex((childkey) => childkey.name == "Name") != -1) {
						// This element has a name, so it needs to be included as an attribute
						if (keydoc.type == "KW_TYPE_SUBNODE") {
							compitem.insertText = `${keydoc.name} name="$1">\n$2\n</${keydoc.name}>`;
						}
						else {
							compitem.insertText = `${keydoc.name} name="$1">$2</${keydoc.name}>`;
						}
					}
					else {
						if (keydoc.type == "KW_TYPE_SUBNODE") {
							compitem.insertText = `${keydoc.name}>\n$1\n</${keydoc.name}>`;
						}
						else {
							if (keydoc.name == "IdFunction") {
								compitem.insertText = `${keydoc.name}>` + "${1|increment,sequence|}" + `</${keydoc.name}>`;
							}
							else if (keydoc.name == "Final") {
								compitem.insertText = `${keydoc.name}>1</${keydoc.name}>`;
							}
							else {
								compitem.insertText = `${keydoc.name}>$1</${keydoc.name}>`;
							}
						}
					}
					compitem.insertTextFormat = InsertTextFormat.Snippet;
					return compitem;
				}));
			}
		}
	}
	else if (prevline.slice(-2) === "i%" && triggerlang === ld.cos_langindex) {
		// This is instance variable syntax

		// Find the name of the current class
		const thisclass = currentClass(doc,parsed);
		if (thisclass == "") {
			// If we couldn't determine the class, don't return anything
			return null;
		}

		// Query the server to get the names and descriptions of all non-calculated properties
		const data: QueryData = {
			query: "SELECT Name, Description, Origin, RuntimeType, Deprecated FROM %Dictionary.CompiledProperty WHERE parent->ID = ? AND Calculated = 0",
			parameters: [thisclass]
		}
		const respdata = await makeRESTRequest("POST",1,"/action/query",server,data);
		if (respdata !== undefined && "content" in respdata.data.result && respdata.data.result.content.length > 0) {
			// We got data back

			for (let memobj of respdata.data.result.content) {
				const quotedname = quoteUDLIdentifier(memobj.Name,1);
				var item: CompletionItem = {
					label: ""
				};
				item = {
					label: quotedname,
					kind: CompletionItemKind.Property,
					data: "member",
					documentation: {
						kind: "markdown",
						value: documaticHtmlToMarkdown(memobj.Description)
					}
				};
				if (memobj.ReturnType !== "") {
					item.detail = memobj.ReturnType;
				}
				if (memobj.Origin === thisclass) {
					// Members from the base class should appear first
					item.sortText = "##" + quotedname;
				}
				else {
					item.sortText = item.label;
				}
				if (memobj.Deprecated) {
					item.tags = [CompletionItemTag.Deprecated];
				}
				result.push(item);
			}
		}
	}
	return result;
}

export async function onCompletionResolve(item: CompletionItem): Promise<CompletionItem> {
	if (item.data instanceof Array && item.data[0] === "class") {
		// Get the description for this class from the server
		const server: ServerSpec = await getServerSpec(item.data[2]);
		const querydata: QueryData = {
			query: "SELECT Description FROM %Dictionary.ClassDefinition WHERE Name = ?",
			parameters: [item.data[1]]
		};
		const respdata = await makeRESTRequest("POST",1,"/action/query",server,querydata);
		if (respdata !== undefined && respdata.data.result.content.length > 0) {
			// The class was found
			item.documentation = {
				kind: "markdown",
				value: documaticHtmlToMarkdown(respdata.data.result.content[0].Description)
			};
		}
	}
	else if (item.data instanceof Array && item.data[0] === "macro" && item.documentation === undefined) {
		// Get the macro definition from the server
		const server: ServerSpec = await getServerSpec(item.data[1]);
		const querydata = {
			docname: macroCompletionCache.docname,
			macroname: item.label,
			superclasses: macroCompletionCache.superclasses,
			includes: macroCompletionCache.includes,
			includegenerators: macroCompletionCache.includegenerators,
			imports: macroCompletionCache.imports,
			mode: macroCompletionCache.mode
		};
		const respdata = await makeRESTRequest("POST",2,"/action/getmacrodefinition",server,querydata);
		if (respdata !== undefined && respdata.data.result.content.definition.length > 0) {
			// The macro definition was found
			const parts = respdata.data.result.content.definition[0].trim().split(/\s+/);
			var defstr = "";
			if (parts[0].charAt(0) === "#") {
				defstr = defstr.concat(parts[1],"\n",parts.slice(2).join());
			}
			else {
				defstr = defstr.concat(parts[0],"\n",parts.slice(1).join());
			}
			item.documentation = {
				kind: "plaintext",
				value: defstr
			};
		}
	}
	return item;
}
