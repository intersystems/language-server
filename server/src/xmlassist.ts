import axios, { AxiosResponse } from 'axios';
import { ServerSpec, makeRESTRequest } from './server';

/**
 * Mapping between an XML prefix and namespace.
 */
export type PrefixMapping = {
	prefix: string,
	namespace: string
};

/**
 * XML attribute.
 */
export class Attribute {
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
export class Element {
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
export class SchemaQuery {
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
export class Schema {
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
export class SchemaCache {
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