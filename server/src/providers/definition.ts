import { Position, TextDocumentPositionParams, Range, LocationLink } from 'vscode-languageserver/node';
import { getServerSpec, findFullRange, normalizeClassname, makeRESTRequest, createDefinitionUri, getMacroContext, isMacroDefinedAbove, quoteUDLIdentifier, getClassMemberContext, determineClassNameParameterClass, getParsedDocument, currentClass, getTextForUri, isClassMember } from '../utils/functions';
import { ServerSpec, QueryData } from '../utils/types';
import { documents, corePropertyParams, classMemberTypes } from '../utils/variables';
import * as ld from '../utils/languageDefinitions';

/**
 * The maximum number of lines to include in the `targetRange` property
 * of the `LocationLink` object returned by a definition request.
 */
const definitionTargetRangeMaxLines: number = 10;

/** Return a `LocationLink` for class member `memberName` in class `cls` */
async function classMemberLocationLink(
	uri: string, cls: string, memberName: string, memberKeywords: string, memberRange: Range, server: ServerSpec
): Promise<LocationLink[] | undefined> {
	const targetrange = Range.create(0,0,0,0);
	let targetselrange = Range.create(0,0,0,0);
	const newuri = await createDefinitionUri(uri,cls,".cls");
	if (newuri != "") {
		// Get the full text of the target class
		const classText: string[] = await getTextForUri(newuri,server);
		if (classText.length) {
			// Loop through the file contents to find this member
			let linect = 0;
			// Make only the member keywords case insensitive
			const regex = new RegExp(`^(?:${memberKeywords.split("").map(c => /[a-z]/i.test(c) ? `[${c.toUpperCase()}${c.toLowerCase()}]` : c).join("")}) ${memberName}(?:\\(|;| )`);
			for (let j = 0; j < classText.length; j++) {
				if (linect > 0) {
					linect++;
					if (linect == definitionTargetRangeMaxLines) {
						// We've seen the maximum number of lines without hitting the next class member so cut off the preview range here
						targetrange.end = Position.create(j+1,0);
						break;
					}
					if (classMemberTypes.indexOf(classText[j].split(" ",1)[0]) !== -1) {
						// This is the first class member following the one we needed the definition for, so cut off the preview range here
						targetrange.end = Position.create(j,0);
						break;
					}
				}
				else if (regex.test(classText[j])) {
					// This is the right class member
					const memberlineidx = classText[j].indexOf(memberName);
					if (memberlineidx !== -1) {
						targetselrange = Range.create(j,memberlineidx,j,memberlineidx+memberName.length);
						targetrange.start = Position.create(j,0);
						linect++;
					}
				}
			}
			if (linect > 0) {
				// Remove any blank lines or comments from the end of the preview range
				for (let pvrln = targetrange.end.line-1; pvrln > targetrange.start.line; pvrln--) {
					const trimmed = classText[pvrln].trim();
					if (trimmed === "") {
						targetrange.end.line = pvrln;
					}
					else if (
						trimmed.slice(0,3) === "##;" || trimmed.slice(0,2) === "//" || trimmed.slice(0,1) === ";" ||
						trimmed.slice(0,2) === "#;" || trimmed.slice(0,2) === "/*"
					) {
						targetrange.end.line = pvrln;
					}
					else {
						break;
					}
				}
				return [{
					targetUri: newuri,
					targetRange: targetrange,
					originSelectionRange: memberRange,
					targetSelectionRange: targetselrange
				}];
			}
		}
	}
}

export async function onDefinition(params: TextDocumentPositionParams) {
	const doc = documents.get(params.textDocument.uri);
	if (doc === undefined) {return null;}
	const parsed = await getParsedDocument(params.textDocument.uri);
	if (parsed === undefined) {return null;}
	const server: ServerSpec = await getServerSpec(params.textDocument.uri);

	if (parsed[params.position.line] === undefined) {
		// This is the blank last line of the file
		return null;
	}
	for (let i = 0; i < parsed[params.position.line].length; i++) {
		const symbolstart: number = parsed[params.position.line][i].p;
		const symbolend: number =  parsed[params.position.line][i].p + parsed[params.position.line][i].c;
		if (params.position.character >= symbolstart && params.position.character <= symbolend) {
			// We found the right symbol in the line
			
			if (((parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_clsname_attrindex) ||
			(parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_clsname_attrindex))
			&& doc.getText(Range.create(Position.create(params.position.line,0),Position.create(params.position.line,6))).toLowerCase() !== "import") {
				// This is a class name
				
				// Get the full text of the selection
				let wordrange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
				let word = doc.getText(wordrange);
				if (word.charAt(0) === ".") {
					// This might be $SYSTEM.ClassName
					const prevseven = doc.getText(Range.create(
						Position.create(params.position.line,wordrange.start.character-7),
						Position.create(params.position.line,wordrange.start.character)
					));
					if (prevseven.toUpperCase() === "$SYSTEM") {
						// This is $SYSTEM.ClassName
						word = "%SYSTEM" + word;
					}
					else {
						// This classname is invalid
						return null;
					}
				}
				if (word.charAt(0) === '"') {
					// This classname is delimited with ", so strip them
					word = word.slice(1,-1);
				}

				// Normalize the class name if there are imports
				const normalizedname = await normalizeClassname(doc,parsed,word,server,params.position.line);

				if (normalizedname != "") {
					// Get the uri of the target class
					const newuri = await createDefinitionUri(params.textDocument.uri,normalizedname,".cls");
					if (newuri != "") {
						// Get the full text of the target class
						const classText: string[] = await getTextForUri(newuri,server);
						if (classText.length) {
							// Loop through the file contents to find the class definition
							let targetrange = Range.create(Position.create(0,0),Position.create(0,0));
							let targetselrange = Range.create(Position.create(0,0),Position.create(0,0));
							for (let j = 0; j < classText.length; j++) {
								if (classText[j].slice(0,5).toLowerCase() === "class") {
									// This line is the class definition
									const namestart = classText[j].indexOf(normalizedname);
									targetrange = Range.create(Position.create(j,0),Position.create(j+1,0));
									targetselrange = Range.create(Position.create(j,namestart),Position.create(j,namestart+normalizedname.length));
									break;
								}
							}
							return [{
								targetUri: newuri,
								targetRange: targetrange,
								originSelectionRange: wordrange,
								targetSelectionRange: targetselrange
							}];
						}
					}
				}
			}
			else if (
				parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_macro_attrindex || (
					parsed[params.position.line][i].l == ld.sql_langindex &&
					parsed[params.position.line][i].s == ld.sql_iden_attrindex &&
					doc.getText(Range.create(params.position.line,symbolstart,params.position.line,symbolstart+3)) == "$$$"
				)
			) {
				// This is a macro

				// Get the details of this class
				const isSql = parsed[params.position.line][i].l == ld.sql_langindex;
				const maccon = getMacroContext(doc,parsed,params.position.line,isSql);

				// Get the full range of the macro
				const macrorange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
				let macrotext = doc.getText(macrorange);
				if (isSql && macrotext.includes("(")) {
					// SQL macros with arguments have the arguments as part of the same token
					macrotext = macrotext.slice(0, macrotext.indexOf("("));
					macrorange.end = Position.create(params.position.line, symbolstart + macrotext.length);
				}
				if (macrotext.slice(0,3) == "$$$") {
					macrotext = macrotext.slice(3);
				}

				// Check if the macro definition appears in the current file
				const macrodefline = isMacroDefinedAbove(doc,parsed,params.position.line,macrotext);

				if (macrodefline !== -1) {
					// The macro definition is in the current file

					const targetrange = Range.create(macrodefline,0,macrodefline+1,0);
					if (
						parsed[macrodefline][parsed[macrodefline].length-1].l == ld.cos_langindex && parsed[macrodefline][parsed[macrodefline].length-1].s == ld.cos_ppf_attrindex &&
						doc.getText(Range.create(
							macrodefline,parsed[macrodefline][parsed[macrodefline].length-1].p,
							macrodefline,parsed[macrodefline][parsed[macrodefline].length-1].p+parsed[macrodefline][parsed[macrodefline].length-1].c
						)).toLowerCase() === "continue"
					) {
						// This is a multi-line macro definition so scan down the file to capture the full range of the definition
						for (let mln = macrodefline+1; mln < parsed.length; mln++) {
							if (
								parsed[mln][parsed[mln].length-1].l !== ld.cos_langindex || parsed[mln][parsed[mln].length-1].s !== ld.cos_ppf_attrindex ||
								doc.getText(Range.create(
									mln,parsed[mln][parsed[mln].length-1].p,
									mln,parsed[mln][parsed[mln].length-1].p+parsed[mln][parsed[mln].length-1].c
								)).toLowerCase() !== "continue"
							) {
								// This is the last line of the macro definition so update the target range
								targetrange.end = Position.create(mln+1,0);
								break;
							}
						}
					}

					return [{
						targetUri: params.textDocument.uri,
						targetRange: targetrange,
						originSelectionRange: macrorange,
						targetSelectionRange: Range.create(macrodefline,parsed[macrodefline][2].p,macrodefline,parsed[macrodefline][2].p+parsed[macrodefline][2].c)
					}];
				}
				else {
					// The macro is defined in another file

					// Get the macro location from the server
					const inputdata = {
						docname: maccon.docname,
						macroname: macrotext,
						superclasses: maccon.superclasses,
						includes: maccon.includes,
						includegenerators: maccon.includegenerators,
						imports: maccon.imports,
						mode: maccon.mode
					};
					const respdata = await makeRESTRequest("POST",2,"/action/getmacrolocation",server,inputdata);
					if (respdata !== undefined && respdata.data.result.content.document !== "") {
						// The macro was found in a document
						const lastdot = respdata.data.result.content.document.lastIndexOf(".");
						const filename = respdata.data.result.content.document.substring(0,lastdot);
						const ext = respdata.data.result.content.document.substring(lastdot);
						const newuri = await createDefinitionUri(params.textDocument.uri,filename,ext);
						if (newuri !== "") {
							return [{
								targetUri: newuri,
								targetRange: Range.create(respdata.data.result.content.line,0,respdata.data.result.content.line+1,0),
								originSelectionRange: macrorange,
								targetSelectionRange: Range.create(respdata.data.result.content.line,0,respdata.data.result.content.line+1,0)
							}];
						}
					}
				}
			}
			else if (
				parsed[params.position.line][i].l == ld.cos_langindex && (
				parsed[params.position.line][i].s == ld.cos_prop_attrindex ||
				parsed[params.position.line][i].s == ld.cos_method_attrindex ||
				parsed[params.position.line][i].s == ld.cos_attr_attrindex ||
				parsed[params.position.line][i].s == ld.cos_mem_attrindex ||
				parsed[params.position.line][i].s == ld.cos_instvar_attrindex)
			) {
				// This is a class member (property/parameter/method)

				// Get the full text of the selection
				const memberrange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
				var member = doc.getText(memberrange);
				if (member.charAt(0) === "#") {
					member = member.slice(1);
				} else if (parsed[params.position.line][i].s == ld.cos_instvar_attrindex) {
					member = member.slice(2);
				}
				let unquotedname = quoteUDLIdentifier(member,0);
				if (unquotedname == "%New") unquotedname = "%OnNew", member = "%OnNew";

				// If this is a class file, determine what class we're in
				let thisclass = "";
				if (doc.languageId === "objectscript-class") {
					thisclass = currentClass(doc,parsed);
				}

				let membercontext = {
					baseclass: "",
					context: ""
				};
				if (parsed[params.position.line][i].s != ld.cos_instvar_attrindex) {
					// Find the dot token
					var dottkn = 0;
					for (let tkn = 0; tkn < parsed[params.position.line].length; tkn ++) {
						if (parsed[params.position.line][tkn].p >= memberrange.start.character) {
							break;
						}
						dottkn = tkn;
					}

					// Get the base class that this member is in
					membercontext = await getClassMemberContext(doc,parsed,dottkn,params.position.line,server);
				} else {
					membercontext = {
						baseclass: thisclass,
						context: ""
					};
				}
				if (membercontext.baseclass === "") {
					// If we couldn't determine the class, don't return anything
					return null;
				}

				var targetrange = Range.create(Position.create(0,0),Position.create(0,0));
				var targetselrange = Range.create(Position.create(0,0),Position.create(0,0));
				if (thisclass === membercontext.baseclass) {
					// The member may be defined in this class

					// Loop through the file contents to find this member
					var linect = 0;
					for (let dln = 0; dln < parsed.length; dln++) {
						if (linect > 0) {
							linect++;
							if (linect === definitionTargetRangeMaxLines) {
								// We've seen the maximum number of lines without hitting the next class member so cut off the preview range here
								targetrange.end = Position.create(dln+1,0);
								break;
							}
							if (
								parsed[dln].length > 0 && parsed[dln][0].l === ld.cls_langindex &&
								(parsed[dln][0].s === ld.cls_keyword_attrindex || parsed[dln][0].s === ld.cls_desc_attrindex)
							) {
								// This is the first class member following the one we needed the definition for, so cut off the preview range here
								targetrange.end = Position.create(dln,0);
								break;
							}
						}
						else if (parsed[dln].length > 0 && parsed[dln][0].l == ld.cls_langindex && parsed[dln][0].s == ld.cls_keyword_attrindex) {
							// This line starts with a UDL keyword
				
							var keyword = doc.getText(Range.create(Position.create(dln,parsed[dln][0].p),Position.create(dln,parsed[dln][0].p+parsed[dln][0].c))).toLowerCase();
							if (keyword.indexOf("method") !== -1 || keyword.indexOf("property") !== -1 || keyword.indexOf("parameter") !== -1 || keyword.indexOf("relationship") !== -1) {
								const thismemberrange = findFullRange(dln,parsed,1,parsed[dln][1].p,parsed[dln][1].p+parsed[dln][1].c);
								const thismember = doc.getText(thismemberrange);
								if (thismember === member) {
									// We found the member
									targetselrange = thismemberrange;
									targetrange.start = Position.create(dln,0);
									linect++;
								}
							}
						}
					}
					if (targetrange.start.line !== 0) {
						// Remove any blank lines or comments from the end of the preview range
						for (let pvrln = targetrange.end.line-1; pvrln > targetrange.start.line; pvrln--) {
							if (parsed[pvrln].length === 0) {
								targetrange.end.line = pvrln;
							}
							else if (parsed[pvrln][0].l === ld.cos_langindex && (parsed[pvrln][0].s === ld.cos_comment_attrindex || parsed[pvrln][0].s === ld.cos_dcom_attrindex)) {
								targetrange.end.line = pvrln;
							}
							else {
								break;
							}
						}
						return [{
							targetUri: params.textDocument.uri,
							originSelectionRange: memberrange,
							targetSelectionRange: targetselrange,
							targetRange: targetrange
						}];
					}
				}
				// The member is defined in another class

				// Query the server to get the origin class of this member using its base class, text and token type
				var data: QueryData = {
					query: "",
					parameters: []
				};
				let memberKeywords: string;
				if (parsed[params.position.line][i].s == ld.cos_prop_attrindex) {
					// This is a parameter
					memberKeywords = "Parameter";
					data.query = "SELECT Origin, NULL AS Stub FROM %Dictionary.CompiledParameter WHERE parent->ID = ? AND name = ?";
					data.parameters = [membercontext.baseclass,unquotedname];
				}
				else if (parsed[params.position.line][i].s == ld.cos_method_attrindex || unquotedname == "%OnNew") {
					// This is a method
					memberKeywords = "Method|ClassMethod|ClientMethod";
					data.query = "SELECT Origin, Stub FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND name = ?";
					data.parameters = [membercontext.baseclass,unquotedname];
				}
				else if (parsed[params.position.line][i].s == ld.cos_attr_attrindex || parsed[params.position.line][i].s == ld.cos_instvar_attrindex) {
					// This is a property
					memberKeywords = "Property|Relationship";
					data.query = "SELECT Name, Origin, NULL AS Stub FROM %Dictionary.CompiledProperty WHERE parent->ID = ? AND (Name = ? OR ? %INLIST $LISTFROMSTRING($TRANSLATE(Aliases,' ')))";
					data.parameters = [membercontext.baseclass,unquotedname,unquotedname.replace(/\s+/g,"")];
				}
				else {
					// This is a generic member
					if (membercontext.baseclass.slice(0,7) === "%SYSTEM") {
						// This is always a method
						memberKeywords = "Method|ClassMethod|ClientMethod";
						data.query = "SELECT Origin, Stub FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND name = ?";
						data.parameters = [membercontext.baseclass,unquotedname];
					}
					else {
						// This can be a method or property
						memberKeywords = "Method|ClassMethod|ClientMethod|Property|Relationship";
						data.query = 
							"SELECT Name, Origin, Stub FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND name = ? UNION ALL " +
							"SELECT Name, Origin, NULL AS Stub FROM %Dictionary.CompiledProperty WHERE parent->ID = ? AND (Name = ? OR ? %INLIST $LISTFROMSTRING($TRANSLATE(Aliases,' ')))";
						data.parameters = [membercontext.baseclass,unquotedname,membercontext.baseclass,unquotedname,unquotedname.replace(/\s+/g,"")];
					}
				}
				let originclass = "";
				let membernameinfile = member;
				const queryrespdata = await makeRESTRequest("POST",1,"/action/query",server,data);
				if (queryrespdata !== undefined) {
					if (Array.isArray(queryrespdata?.data?.result?.content) && queryrespdata.data.result.content.length > 0) {
						// We got data back

						const result = queryrespdata.data.result.content[0];
						originclass = result.Origin;
						if (result.Name && result.Name != "") membernameinfile = quoteUDLIdentifier(result.Name,1);
						if (result.Stub !== "") {
							// This is a method generated by member inheritance, so we need to get its Origin from the proper subtable

							const stubarr = result.Stub.split(".");
							var stubquery = "";
							memberKeywords = "Method|ClassMethod|ClientMethod";
							if (stubarr[2] === "i") {
								// This is a method generated from an index
								stubquery = "SELECT Origin FROM %Dictionary.CompiledIndexMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
							}
							if (stubarr[2] === "q") {
								// This is a method generated from a query
								stubquery = "SELECT Origin FROM %Dictionary.CompiledQueryMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
							}
							if (stubarr[2] === "a") {
								// This is a method generated from a property
								stubquery = "SELECT Origin FROM %Dictionary.CompiledPropertyMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
							}
							if (stubarr[2] === "n") {
								// This is a method generated from a constraint
								stubquery = "SELECT Origin FROM %Dictionary.CompiledConstraintMethod WHERE Name = ? AND parent->parent->ID = ? AND parent->Name = ?";
							}
							if (stubquery !== "") {
								const stubrespdata = await makeRESTRequest("POST",1,"/action/query",server,{
									query: stubquery,
									parameters: [stubarr[1],membercontext.baseclass,stubarr[0]]
								});
								if (Array.isArray(stubrespdata?.data?.result?.content) && stubrespdata.data.result.content.length > 0) {
									// We got data back
									originclass = stubrespdata.data.result.content[0].Origin;
									membernameinfile = stubarr[1];
								}
							}
						}
					}
				}
				if (unquotedname == "%OnNew" && ["","%Library.RegisteredObject"].includes(originclass)) {
					originclass = "%Library.SystemBase";
					membernameinfile = "%New";
				}
				if (originclass !== "") {
					return classMemberLocationLink(params.textDocument.uri,originclass,membernameinfile,memberKeywords,memberrange,server);
				}
			}
			else if ((parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_rtnname_attrindex) ||
			(parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_rtnname_attrindex)) {
				// This is a routine name

				// Get the full text of the selection
				let wordrange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
				let word = doc.getText(wordrange);

				// Determine if this is an include file
				var isinc = false;
				if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_rtnname_attrindex) {
					isinc = true;
				}
				else {
					if (
						parsed[params.position.line][i-1].l == ld.cos_langindex &&
						parsed[params.position.line][i-1].s == ld.cos_ppc_attrindex &&
						doc.getText(
							Range.create(
								Position.create(params.position.line,parsed[params.position.line][i-1].p),
								Position.create(params.position.line,parsed[params.position.line][i-1].p+parsed[params.position.line][i-1].c)
							)
						).toLowerCase() === "include"
					) {
						isinc = true
					}
				}
				if (isinc) {
					const newuri = await createDefinitionUri(params.textDocument.uri,word,".inc");
					if (newuri !== "") {
						return [{
							targetUri: newuri,
							targetRange: Range.create(Position.create(0,0),Position.create(1,0)),
							originSelectionRange: wordrange,
							targetSelectionRange: Range.create(Position.create(0,8),Position.create(1,0))
						}];
					}
				}
				else {
					// Check if this routine is a MAC or INT
					const respdata = await makeRESTRequest("POST",1,"/action/index",server,[word+".int"]);
					if (respdata !== undefined && respdata.data.result.content.length > 0 && respdata.data.result.content[0].status === "") {
						if (respdata.data.result.content[0].others.length > 0 && respdata.data.result.content[0].others[0].slice(-3) === "mac") {
							// This is a MAC routine
							const newuri = await createDefinitionUri(params.textDocument.uri,word,".mac");
							if (newuri !== "") {
								return [{
									targetUri: newuri,
									targetRange: Range.create(Position.create(0,0),Position.create(1,0)),
									originSelectionRange: wordrange,
									targetSelectionRange: Range.create(Position.create(0,8),Position.create(1,0))
								}];
							}
						}
						else {
							// This is an INT routine
							const newuri = await createDefinitionUri(params.textDocument.uri,word,".int");
							if (newuri !== "") {
								return [{
									targetUri: newuri,
									targetRange: Range.create(Position.create(0,0),Position.create(1,0)),
									originSelectionRange: wordrange,
									targetSelectionRange: Range.create(Position.create(0,8),Position.create(1,0))
								}];
							}
						}
					}
				}
			}
			else if ((parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_label_attrindex) ||
			(parsed[params.position.line][i].l == ld.cos_langindex && parsed[params.position.line][i].s == ld.cos_extrfn_attrindex)) {
				// This is a routine label

				// Get the range and text of the label
				var labelrange: Range;
				if (parsed[params.position.line][i].s == ld.cos_extrfn_attrindex) {
					// This is the $$ before the label
					labelrange = findFullRange(params.position.line,parsed,i+1,parsed[params.position.line][i+1].p,parsed[params.position.line][i+1].p+parsed[params.position.line][i+1].c);
				}
				else {
					// This is the label
					labelrange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
				}
				const label = doc.getText(labelrange);

				// Now that we got the label text, add the $$ to the front of the range
				if (parsed[params.position.line][i].s == ld.cos_extrfn_attrindex) {
					labelrange.start.character = labelrange.start.character-2;
				}
				else if (i !== 0 && parsed[params.position.line][i-1].s == ld.cos_extrfn_attrindex) {
					labelrange.start.character = labelrange.start.character-2;
				}

				// Get the text of the routine name, if it's present
				var routine = "";
				var labelidx = i;
				if (parsed[params.position.line][i].s == ld.cos_extrfn_attrindex) {
					labelidx = i+1;
				}
				if (
					labelidx+2 < parsed[params.position.line].length &&
					parsed[params.position.line][labelidx+1].s == ld.cos_delim_attrindex &&
					doc.getText(Range.create(
						Position.create(params.position.line,parsed[params.position.line][labelidx+1].p),
						Position.create(params.position.line,parsed[params.position.line][labelidx+1].p+parsed[params.position.line][labelidx+1].c)
					)) === "^"
				) {
					// The token following the label is a caret, so this label has a routine name

					for (let j = labelidx+2; j < parsed[params.position.line].length; j++) {
						if (parsed[params.position.line][j].l == ld.cos_langindex && parsed[params.position.line][j].s == ld.cos_rtnname_attrindex) {
							// This is the routine name
							routine = doc.getText(
								Range.create(
									Position.create(params.position.line,parsed[params.position.line][j].p),
									Position.create(params.position.line,parsed[params.position.line][j].p+parsed[params.position.line][j].c)
								)
							);
							break;
						}
					}
				}

				// If the current file is a routine, get its name
				var currentroutine = "";
				if (doc.languageId === "objectscript" || doc.languageId === "objectscript-int") {
					currentroutine = doc.getText(Range.create(Position.create(0,parsed[0][1].p),Position.create(0,parsed[0][1].p+parsed[0][1].c)));
				}

				if (routine !== "" && routine !== currentroutine) {
					// This label is in another routine

					// Check if this routine is a MAC or INT
					const indexrespdata = await makeRESTRequest("POST",1,"/action/index",server,[routine+".int"]);
					if (indexrespdata !== undefined && indexrespdata.data.result.content.length > 0 && indexrespdata.data.result.content[0].status === "") {
						var ext = ".int";
						if (indexrespdata.data.result.content[0].others.length > 0 && indexrespdata.data.result.content[0].others[0].slice(-3) === "mac") {
							// This is a MAC routine
							ext = ".mac";
						}

						// Get the uri of the other routine
						const newuri = await createDefinitionUri(params.textDocument.uri,routine,ext);
						if (newuri !== "") {
							// Get the full text of the other routine
							const rtnText: string[] = await getTextForUri(newuri,server);
							if (rtnText.length) {
								// Loop through the file contents to find this label
								var targetselrange = Range.create(0,0,0,0);
								var targetrange = Range.create(0,0,0,0);
								var linect = 0;
								for (let k = 0; k < rtnText.length; k++) {
									if (linect > 0) {
										linect++;
										if (linect === definitionTargetRangeMaxLines) {
											// We've seen the maximum number of lines without hitting the next label so cut off the preview range here
											targetrange.end = Position.create(k+1,0);
											break;
										}
										const firstcharcode = rtnText[k].charCodeAt(0);
										if (
											(firstcharcode > 47 && firstcharcode < 58) || (firstcharcode > 64 && firstcharcode < 91) ||
											(firstcharcode > 96 && firstcharcode < 123) || (firstcharcode === 37)
										) {
											// This is the first label following the one we needed the definition for, so cut off the preview range here
											targetrange.end = Position.create(k,0);
											break;
										}
									}
									else if (
										rtnText[k].startsWith(label) &&
										(
											rtnText[k].trimEnd().length == label.length || // The label is the whole line
											/ |\t|\(/.test(rtnText[k].charAt(label.length)) || // The label is followed by space, tab or (
											// The label is followed by a comment
											rtnText[k].slice(label.length).startsWith(";") ||
											rtnText[k].slice(label.length).startsWith("##;") ||
											rtnText[k].slice(label.length).startsWith("//") ||
											rtnText[k].slice(label.length).startsWith("/*")
										)
									) {
										// This is the label definition
										targetselrange = Range.create(k,0,k,label.length);
										targetrange.start = Position.create(k,0);
										linect++;
									}
								}
								// Remove any blank lines or comments from the end of the preview range
								for (let pvrln = targetrange.end.line-1; pvrln > targetrange.start.line; pvrln--) {
									const trimmed = rtnText[pvrln].trim();
									if (trimmed === "") {
										targetrange.end.line = pvrln;
									}
									else if (
										trimmed.slice(0,3) === "##;" || trimmed.slice(0,2) === "//" || trimmed.slice(0,1) === ";" ||
										trimmed.slice(0,2) === "#;" || trimmed.slice(0,2) === "/*"
									) {
										targetrange.end.line = pvrln;
									}
									else {
										break;
									}
								}
								return [{
									targetUri: newuri,
									targetRange: targetrange,
									originSelectionRange: labelrange,
									targetSelectionRange: targetselrange
								}];
							}
						}
					}
				}
				else {
					// This label is in the current routine

					var targetselrange = Range.create(Position.create(0,0),Position.create(0,0));
					var targetrange = Range.create(Position.create(0,0),Position.create(0,0));
					var linect = 0;
					for (let line = 0; line < parsed.length; line++) {
						if (linect > 0) {
							linect++;
						}
						if (linect === definitionTargetRangeMaxLines) {
							// We've seen the maximum number of lines without hitting the next label so cut off the preview range here
							targetrange.end = Position.create(line+1,0);
							break;
						}
						if (
							parsed[line].length > 0 && parsed[line][0].l == ld.cos_langindex &&
							parsed[line][0].s == ld.cos_label_attrindex && parsed[line][0].p == 0
						) {
							// This is a label
							if (linect > 0) {
								// This is the first label following the one we needed the definition for, so cut off the preview range here
								targetrange.end = Position.create(line,0);
								break;
							}
							else {
								const firstwordrange = Range.create(line,parsed[line][0].p,line,parsed[line][0].p+parsed[line][0].c);
								const firstwordtext = doc.getText(firstwordrange);
								if (firstwordtext == label) {
									// This is the correct label
									targetselrange = firstwordrange;
									targetrange.start = Position.create(line,0);
									linect++;
								}
							}
						}
					}
					// Remove any blank lines or comments from the end of the preview range
					for (let pvrln = targetrange.end.line-1; pvrln > targetrange.start.line; pvrln--) {
						if (parsed[pvrln].length === 0) {
							targetrange.end.line = pvrln;
						}
						else if (parsed[pvrln][0].l === ld.cos_langindex && (parsed[pvrln][0].s === ld.cos_comment_attrindex || parsed[pvrln][0].s === ld.cos_dcom_attrindex)) {
							targetrange.end.line = pvrln;
						}
						else {
							break;
						}
					}
					return [{
						targetUri: params.textDocument.uri,
						targetRange: targetrange,
						originSelectionRange: labelrange,
						targetSelectionRange: targetselrange
					}];
				}
			}
			else if (parsed[params.position.line][i].l == ld.sql_langindex && parsed[params.position.line][i].s == ld.sql_iden_attrindex) {
				// This is a SQL identifier
				
				// Get the full text of the selection
				const idenrange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
				const iden = doc.getText(idenrange);
				
				// Find the preceding keyword (other than 'AS')
				var keytext: string = "";
				for (let ln = params.position.line; ln >= 0; ln--) {
					for (let tk = i; tk >= 0; tk--) {
						if (ln === params.position.line && parsed[ln][tk].p >= idenrange.start.character) {
							// Start looking when we pass the full range of the selected identifier
							continue;
						}
						if (
							parsed[ln][tk].l == ld.sql_langindex &&
							(parsed[ln][tk].s == ld.sql_skey_attrindex || parsed[ln][tk].s == ld.sql_qkey_attrindex || parsed[ln][tk].s == ld.sql_ekey_attrindex)
						) {
							// This is a keyword
							const tmpkeytext = doc.getText(Range.create(
								Position.create(ln,parsed[ln][tk].p),
								Position.create(ln,parsed[ln][tk].p+parsed[ln][tk].c)
							)).toLowerCase();
							if (tmpkeytext !== "as") {
								// Found the correct keyword
								keytext = tmpkeytext;
								break;
							}
						}
					}
					if (keytext !== "") {
						// Found the correct keyword
						break;
					}
				}
				
				if (
					(keytext === "join" || keytext === "from" || keytext === "into" ||
					keytext=== "lock" || keytext === "unlock" || keytext === "table" ||
					keytext === "update")
				) {
					// This identifier is a table name

					if (iden.lastIndexOf("_") > iden.lastIndexOf(".")) {
						// This table is projected from a multi-dimensional property

						// Split the identifier into the class and property
						const clsname = iden.slice(0,iden.lastIndexOf("_")).replace(/_/g,".");
						const propname = iden.slice(iden.lastIndexOf("_")+1);

						// Normalize the class name if there are imports
						const normalizedname = await normalizeClassname(doc,parsed,clsname,server,params.position.line);
						if (normalizedname !== "") {
							// Query the server to get the origin class of this property
							const data: QueryData = {
								query: "SELECT Origin FROM %Dictionary.CompiledProperty WHERE parent->ID = ? AND name = ?",
								parameters: [normalizedname,propname]
							};
							const queryrespdata = await makeRESTRequest("POST",1,"/action/query",server,data);
							if (queryrespdata !== undefined) {
								if (Array.isArray(queryrespdata?.data?.result?.content) && queryrespdata.data.result.content.length > 0) {
									// We got data back

									// Get the uri of the origin class
									const originclass = queryrespdata.data.result.content[0].Origin;
									return classMemberLocationLink(params.textDocument.uri,originclass,propname,"Property|Relationship",idenrange,server);
								}
								else {
									// Query completed successfully but we got back no data.
									// This likely means that the base class hasn't been compiled yet or the member had the wrong token type.
									return null;
								}
							}
						}
					}
					else {
						// This table is a class

						// Normalize the class name if there are imports
						const normalizedname = await normalizeClassname(doc,parsed,iden.replace(/_/g,"."),server,params.position.line);
						if (normalizedname !== "") {
							// Get the uri of the class
							const newuri = await createDefinitionUri(params.textDocument.uri,normalizedname,".cls");
							if (newuri !== "") {
								// Get the full text of the class
								const classText: string[] = await getTextForUri(newuri,server);
								// Loop through the file contents to find the class definition
								var targetrange = Range.create(Position.create(0,0),Position.create(0,0));
								var targetselrange = Range.create(Position.create(0,0),Position.create(0,0));
								for (let j = 0; j < classText.length; j++) {
									if (classText[j].slice(0,5).toLowerCase() === "class") {
										// This line is the class definition
										const namestart = classText[j].indexOf(normalizedname);
										targetrange = Range.create(Position.create(j,0),Position.create(j+1,0));
										targetselrange = Range.create(Position.create(j,namestart),Position.create(j,namestart+normalizedname.length));
										break;
									}
								}
								if (classText.length) {
									return [{
										targetUri: newuri,
										targetRange: targetrange,
										originSelectionRange: idenrange,
										targetSelectionRange: targetselrange
									}];
								}
							}
						}
					}
				}
				else if (keytext === "call" && iden.indexOf("_") !== -1) {
					// This identifier is a Query or ClassMethod being invoked as a SqlProc

					const clsname = iden.slice(0,iden.lastIndexOf("_")).replace(/_/g,".");
					const procname = iden.slice(iden.lastIndexOf("_")+1);

					// Normalize the class name if there are imports
					const normalizedname = await normalizeClassname(doc,parsed,clsname,server,params.position.line);
					if (normalizedname !== "") {
						// Query the server to get the origin class
						var querystr = "SELECT Origin FROM %Dictionary.CompiledMethod WHERE parent->ID = ? AND name = ? UNION ALL ";
						querystr = querystr.concat("SELECT Origin FROM %Dictionary.CompiledQuery WHERE parent->ID = ? AND name = ?");
						const data: QueryData = {
							query: querystr,
							parameters: [normalizedname,procname,normalizedname,procname]
						};
						const queryrespdata = await makeRESTRequest("POST",1,"/action/query",server,data);
						if (Array.isArray(queryrespdata?.data?.result?.content) && queryrespdata.data.result.content.length > 0) {
							// We got data back

							// Get the uri of the origin class
							const originclass = queryrespdata.data.result.content[0].Origin;
							return classMemberLocationLink(params.textDocument.uri,originclass,procname,"ClassMethod|Query",idenrange,server);
						}
					}
				}
				else {
					// This identifier is a property
					if ((iden.split(".").length - 1) > 0) {
						// We won't resolve properties that don't contain the table name
						const tblname = iden.slice(0,iden.lastIndexOf("."));
						const propname = iden.slice(iden.lastIndexOf(".")+1);

						if (tblname.lastIndexOf("_") > tblname.lastIndexOf(".")) {
							// This table is projected from a multi-dimensional property, so we can't provide any info
						}
						else {
							// Normalize the class name if there are imports
							const normalizedname = await normalizeClassname(doc,parsed,tblname.replace(/_/g,"."),server,params.position.line);
							if (normalizedname !== "") {
								// Query the server to get the origin class of this property
								const data: QueryData = {
									query: "SELECT Origin FROM %Dictionary.CompiledProperty WHERE parent->ID = ? AND name = ?",
									parameters: [normalizedname,propname]
								};
								const queryrespdata = await makeRESTRequest("POST",1,"/action/query",server,data);
								if (queryrespdata !== undefined) {
									if (Array.isArray(queryrespdata?.data?.result?.content) && queryrespdata.data.result.content.length > 0) {
										// We got data back

										// Get the uri of the origin class
										const originclass = queryrespdata.data.result.content[0].Origin;
										return classMemberLocationLink(params.textDocument.uri,originclass,propname,"Property|Relationship",idenrange,server);
									}
									else {
										// Query completed successfully but we got back no data.
										// This likely means that the base class hasn't been compiled yet or the member had the wrong token type.
										return null;
									}
								}
							}
						}
					}
				}
			}
			else if (parsed[params.position.line][i].l == ld.cls_langindex && parsed[params.position.line][i].s == ld.cls_cparam_attrindex) {
				// This is a class name parameter

				// Get the full text of the selection
				const paramrange = findFullRange(params.position.line,parsed,i,symbolstart,symbolend);
				const param = doc.getText(paramrange);

				// If this is a core Property data type parameter, don't return anything
				const coreParam = corePropertyParams.find(e => e.name === param);
				if (coreParam !== undefined) {
					return null;
				}

				// Verify that is is a parameter for a class name and not a method argument
				const clsName = determineClassNameParameterClass(doc,parsed,params.position.line,i);
				if (clsName == "") return null;
				// Determine the normalized class name
				const normalizedcls = await normalizeClassname(doc,parsed,clsName,server,params.position.line);
				if (normalizedcls == "") return null;

				// If this is a class file, determine what class we're in
				const thisclass = doc.languageId === "objectscript-class" ? currentClass(doc,parsed) : "";

				var targetrange = Range.create(Position.create(0,0),Position.create(0,0));
				var targetselrange = Range.create(Position.create(0,0),Position.create(0,0));
				if (thisclass === normalizedcls) {
					// The parameter may be defined in this class

					// Loop through the file contents to find this parameter
					for (let dln = 0; dln < parsed.length; dln++) {
						if (parsed[dln].length > 0 && parsed[dln][0].l == ld.cls_langindex && parsed[dln][0].s == ld.cls_keyword_attrindex) {
							// This line starts with a UDL keyword
				
							const keyword = doc.getText(Range.create(Position.create(dln,parsed[dln][0].p),Position.create(dln,parsed[dln][0].p+parsed[dln][0].c))).toLowerCase();
							if (keyword === "parameter") {
								const thismemberrange = findFullRange(dln,parsed,1,parsed[dln][1].p,parsed[dln][1].p+parsed[dln][1].c);
								const thismember = doc.getText(thismemberrange);
								if (thismember === param) {
									// We found the parameter
									targetselrange = thismemberrange;
									targetrange = Range.create(dln,0,dln+1,0);
									break;
								}
							}
						}
					}
					if (targetrange.start.line !== 0) {
						return [{
							targetUri: params.textDocument.uri,
							originSelectionRange: paramrange,
							targetSelectionRange: targetselrange,
							targetRange: targetrange
						}];
					}
				}

				// The parameter is defined in another class
				const queryrespdata = await makeRESTRequest("POST",1,"/action/query",server,{
					query: "SELECT Origin FROM %Dictionary.CompiledParameter WHERE Name = ? AND (parent->ID = ? OR " +
					"parent->ID %INLIST (SELECT $LISTFROMSTRING(PropertyClass) FROM %Dictionary.CompiledClass WHERE Name = ?))",
					parameters: [param,normalizedcls,thisclass]
				});
				if (queryrespdata !== undefined) {
					if (Array.isArray(queryrespdata?.data?.result?.content) && queryrespdata.data.result.content.length > 0) {
						// We got data back

						const originclass = queryrespdata.data.result.content[0].Origin;
						if (originclass !== "") {
							return classMemberLocationLink(params.textDocument.uri,originclass,param,"Parameter",paramrange,server);
						}
					}
				}
			}
			else if (
				parsed[params.position.line][i].l == ld.cos_langindex &&
				parsed[params.position.line][i].s == ld.cos_super_attrindex &&
				doc.languageId == "objectscript-class"
			) {
				// This is ##super

				// Determine the name of the current method, list of superclasses and Inheritance keyword
				let thisMethod = "";
				let superclasses: string[] = [];
				let rightInheritance = false;
				for (let ln = params.position.line; ln >= 0; ln--) {
					if (parsed[ln]?.length < 2) continue;
					if (parsed[ln][0].l == ld.cls_langindex && parsed[ln][0].s == ld.cls_keyword_attrindex) {
						const keyword = doc.getText(Range.create(ln,parsed[ln][0].p,ln,parsed[ln][0].p+parsed[ln][0].c));
						if (isClassMember(keyword)) {
							// We found the definition of the containg class member
							if (/^(Class)?Method$/i.test(keyword)) {
								thisMethod = doc.getText(Range.create(ln,parsed[ln][1].p,ln,parsed[ln][1].p+parsed[ln][1].c));
							}
							break;
						}
					}
				}

				if (thisMethod) {
					for (let ln = 0; ln < params.position.line; ln++) {
						if (parsed[ln]?.length < 2) continue;
						if (
							parsed[ln][0].l == ld.cls_langindex &&
							parsed[ln][0].s == ld.cls_keyword_attrindex &&
							doc.getText(Range.create(ln,parsed[ln][0].p,ln,parsed[ln][0].p+parsed[ln][0].c)).toLowerCase() == "class"
						) {
							// This is the class definition line
							let seenExtends = false, seenInheritance = false;
							for (let j = 1; j < parsed[ln].length; j++) {
								if (
									seenExtends &&
									parsed[ln][j].l == ld.cls_langindex &&
									parsed[ln][j].s == ld.cls_clsname_attrindex
								) {
									// This is a piece of a subclass
									if (!superclasses.length) superclasses.push("");
									superclasses[superclasses.length-1] += doc.getText(Range.create(ln,parsed[ln][j].p,ln,parsed[ln][j].p+parsed[ln][j].c));
								} else if (parsed[ln][j].l == ld.cls_langindex && parsed[ln][j].s == ld.cls_keyword_attrindex) {
									const clsKeyword = doc.getText(Range.create(ln,parsed[ln][j].p,ln,parsed[ln][j].p+parsed[ln][j].c)).toLowerCase();
									if (clsKeyword == "extends") {
										seenExtends = true;
									} else if (clsKeyword == "inheritance") {
										seenInheritance = true;
									}
								} else if (
									seenExtends &&
									parsed[ln][j].l == ld.cls_langindex &&
									parsed[ln][j].s == ld.cls_delim_attrindex
								) {
									const delim = doc.getText(Range.create(ln,parsed[ln][j].p,ln,parsed[ln][j].p+parsed[ln][j].c));
									if (delim == "[") {
										seenExtends = false;
									} else if (delim == ",") {
										superclasses.push("");
									}
								} else if (
									seenInheritance &&
									parsed[ln][j].l == ld.cls_langindex &&
									parsed[ln][j].s == ld.cls_str_attrindex
								) {
									rightInheritance = doc.getText(Range.create(ln,parsed[ln][j].p,ln,parsed[ln][j].p+parsed[ln][j].c)).toLowerCase() == "right";
									break;
								}
							}
							break;
						}
					}
				}

				let originclass = "";
				if (superclasses.length && thisMethod) {
					// Get the list of allsuperclasses that have this method
					const queryrespdata = await makeRESTRequest("POST",1,"/action/query",server,{
						query: "SELECT Origin, parent->ID AS Super FROM %Dictionary.CompiledMethod WHERE Name = ? AND parent->ID %INLIST $LISTFROMSTRING(?)",
						parameters: [quoteUDLIdentifier(thisMethod,0),superclasses.join(",")]
					});
					if (Array.isArray(queryrespdata?.data?.result?.content) && queryrespdata.data.result.content.length) {
						// Determine which class ##super is in
						if (rightInheritance) superclasses.reverse();
						originclass = queryrespdata.data.result.content.sort((a,b) => superclasses.indexOf(a.Super) - superclasses.indexOf(b.Super))[0].Origin;
					}
					if (originclass) {
						const superRange = Range.create(params.position.line,symbolstart,params.position.line,symbolend);
						return classMemberLocationLink(params.textDocument.uri,originclass,thisMethod,"Method|ClassMethod",superRange,server);
					}
				}
			}
			break;
		}
	}
	return null;
}
