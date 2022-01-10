

if (typeof exports === 'undefined') {

	exports = {};

}



// set this to trace this file

const tracebridge = false;



// set this to allow warnings (like the deprecation of Buffer) to be shown

const showwarnings = false;



if (!showwarnings) {

	process.removeAllListeners('warning');

}



var os = require('os');



var ref = require("ref-napi");

var ffi = require("ffi-napi");

var ArrayType = require('ref-array-di')(ref);

var StructType = require('ref-struct-di')(ref);



const { config } = require('process');

const path = require('path');



var charPtr = ref.refType('char');

var StringArray = ArrayType('string');

var charPtrPtr = ref.refType(charPtr);

var CharPtrArray = ArrayType(charPtr);





// --



var infotype = StructType({

  info_result: 'int',

  info_message: 'string'

});

var refInfotype = ref.refType(infotype);



var INFO_RESULT_OK = 0;

var INFO_RESULT_EXCEPTION = 1;



// --



var languagecolortype = StructType({

	languagecolor_languagename: 'string',

	languagecolor_attrindex: 'int',

	languagecolor_colorname: 'string'

});

var refLanguageColortype = ref.refType(languagecolortype);

var LanguageColorPtrArray = ArrayType(refLanguageColortype);



var languagecolorresult = StructType({

	languagecolorresult_languagescount: 'int',

	languagecolorresult_languages: LanguageColorPtrArray,

});

var refLanguageColorResult = ref.refType(languagecolorresult);



// --



var colorrecordtype = StructType({

	colorrecord_languagename: 'string',

	colorrecord_attrindex: 'int',

	colorrecord_source: 'string'

});

var refColorRecordtype = ref.refType(colorrecordtype);

var ColorRecordPtrArray = ArrayType(refColorRecordtype);



var colorrecordresult = StructType({

	colorrecordresult_recordscount: 'int',

	colorrecordresult_records: ColorRecordPtrArray,

});

var refColorRecordResult = ref.refType(colorrecordresult);



// --



var compresseditemtype = StructType({

	p: 'int',

	c: 'int',

	l: 'int',

	s: 'int',

	w: 'int'

});



var refCompressedItemType = ref.refType(compresseditemtype);



var CompressedItemPtrArray = ArrayType(refCompressedItemType);



var compressedlinetype = StructType({

	compressedlinetype_itemscount: 'int',

	compressedlinetype_items: CompressedItemPtrArray

});



var refCompressedLineType = ref.refType(compressedlinetype);



var CompressedLinePtrArray = ArrayType(refCompressedLineType);



var compressedresulttype = StructType({

	compressedresult_linescount: 'int',

	compressedresult_lines: CompressedLinePtrArray

});



var refCompressedResult = ref.refType(compressedresulttype);



// --



var attrinfotype = StructType({

	description: 'string',

	foreground: 'string', // RGB hex

	background: 'string', // RGB hex

    debugcategory: 'int' // enumeration

});



var refAttrInfoType = ref.refType(attrinfotype);



var AttrInfoPtrArray = ArrayType(refAttrInfoType);



var attrinforesulttype = StructType({

	attrinforesult_attrinfocount: 'int',

	attrinforesult_attrinfo: AttrInfoPtrArray

});



var refAttrInfoResult = ref.refType(attrinforesulttype);



// --



var ffitable = {};



function setupffitable() {



	ffitable.LIBCOMBRIDGE = ffi.Library(

		libpath(),

		{

			"COMBridgeC_Initialize": [ 'void', [refInfotype] ],

			"COMBridgeC_SetupParser": [ 'void', [refInfotype, 'CString'] ],

			"COMBridgeC_GetLanguageAttributes": ['void', [refInfotype, 'string', refAttrInfoResult ]],

			"COMBridgeC_ColorSource": [ 'void', [refInfotype, 'string', 'string', 'int', refLanguageColorResult, refColorRecordResult]],

			"COMBridgeC_ColorSourceCompressed": [ 'void', [refInfotype, 'string', 'string', 'int', 'bool', refCompressedResult]],

			"COMBridgeC_ColorSourceCompressed_String": [ 'string', [refInfotype, 'string', 'string', 'int', 'bool']],

			"COMBridgeC_Finalize": ['void', [refInfotype]]

		},

	);

}





function libpath() {

	return path.join(getLibPath(),libname());

}



function libname() {

	var platform = os.platform();

	if (platform == 'darwin') {

		return 'libCOMBridge.dylib';

	}

	if (platform == 'win32') {

		return 'COMBridge.dll';

	}

	return './libCOMBridge.so';

}



function platformsubfolder() {

	

	var platform = os.platform();

	

	if (platform == 'darwin') {

		return 'mac';

	}



	if (platform == 'win32') {

		return 'win';

	}



	return 'unix';

}



function resetffitable() {

	ffitable = {};

}





// flags to pass to SyntaxColor*
var IPARSE_UDL_EXPLICIT = 0x0001; // require variable declaration (#dim)
var IPARSE_UDL_EXPERT = 0x4000; // this stops the SYSTEM class-keyword from being colored as a syntax-error
var IPARSE_UDL_TRACK = 0x20000; // enable variable-tracking

var STANDARDPARSEFLAGS = IPARSE_UDL_EXPLICIT + IPARSE_UDL_EXPERT + IPARSE_UDL_TRACK;

// these flags are only passed (by parseImpl in parse.ts) for HTML documents
var IPARSE_ALL_CSPEXTENSIONS = 0x0400; // all parsers: recognize CSP extensions like #(..)#
var IPARSE_HTML_CSPMODE = 0x0800; // HTML parser: is in CSP mode
exports['IPARSE_ALL_CSPEXTENSIONS'] = IPARSE_ALL_CSPEXTENSIONS;
exports['IPARSE_HTML_CSPMODE'] = IPARSE_HTML_CSPMODE;





function START(which) {



	if (tracebridge) {

		console.log('START', 'called with ' + which);

	}



	var libdir = getLibPath();

	var oldcwd = process.cwd();

	process.chdir(libdir);



	if (tracebridge) {

		console.log('using ' + libdir + ' - was in ' + oldcwd);

	}



	try {

		if (tracebridge) {

			console.log('setupffitable');

		}

		setupffitable();

		if (tracebridge) {			

			console.log('bridge_Initialize');

		}

		bridge_Initialize();	

		var arr = which.split(',');

		for (var index in arr) {

			if (tracebridge) {			

				console.log('begin: bridge_SetupParser(' + arr[index] + ')');

			}

			bridge_SetupParser(arr[index]);

			if (tracebridge) {			

				console.log('complete: bridge_SetupParser(' + arr[index] + ')');

			}

		}

		if (tracebridge) {			

			console.log('done');

		}

	}

	finally {

		process.chdir(oldcwd);

	}

}

exports['START'] = START;





// returns a structure of type colorinfotype

function RUNWITH(source,moniker) {

	return bridge_ColorSource(source,moniker);

}

exports['RUNWITH'] = RUNWITH;





// returns a structure of type compressedcolors

function RUNWITH_COMPRESSED(source,moniker,extraparseflags) {

	//return bridge_ColorSourceCompressed(source,moniker,true,STANDARDPARSEFLAGS + extraparseflags); // true => always omit whitespace records

	return bridge_ColorSourceCompressed_String(source,moniker,true,STANDARDPARSEFLAGS + extraparseflags); // true => always omit whitespace records

}

exports['RUNWITH_COMPRESSED'] = RUNWITH_COMPRESSED;

// <--- START
// The following section is generated by makeattributesarray.js
var attributes = {};
attributes["CLS"] = {"attrinfo":[{"description":"Error","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"White Space","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"_Tab","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"Class Member","foreground":"00800080","background":"80000005","debugcategory":0},{"description":"Keyword","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Class Name","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Comment","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"Description","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Delimiter","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Numeric Literal","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"String Literal","foreground":"00800080","background":"80000005","debugcategory":0},{"description":"Identifier","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Sql Identifier","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"Routine Name","foreground":"000000FF","background":"80000005","debugcategory":0},{"description":"XML Attribute Value","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"XML CDATA","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"XML Entity","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"XML Entity Value","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"XML Escape Sequence","foreground":"000000FF","background":"80000005","debugcategory":0},{"description":"XML P.I. value","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"XML Public id","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"XML System Literal","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"XML Text","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Class Parameter","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Parameter","foreground":"00FF00FF","background":"80000005","debugcategory":6},{"description":"XML Attribute Name    ","foreground":"00000000","background":"80000005","debugcategory":6},{"description":"XML Element Name      ","foreground":"00000000","background":"80000005","debugcategory":6},{"description":"Keyword Text Value","foreground":"00000000","background":"80000005","debugcategory":0}]};
attributes["COS"] = {"attrinfo":[{"description":"Error","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"White Space","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"_Tab","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"Label","foreground":"000000FF","background":"80000005","debugcategory":3},{"description":"Dots","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Object (Class)","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"String","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"Comment","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"Object dot operator","foreground":"00000000","background":"80000005","debugcategory":4},{"description":"SQL","foreground":"00800080","background":"80000005","debugcategory":0},{"description":"Pre-Processor Function","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Pre-Processor Command","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Macro","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Delimiter","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"External reference","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Extrinsic function","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Format specifier","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Function","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Global variable","foreground":"00000000","background":"80000005","debugcategory":6},{"description":"Indirection","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Local variable","foreground":"00000080","background":"80000005","debugcategory":6},{"description":"Mnemonic","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Name","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Number","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Operator","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Routine","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Special","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Structured variable","foreground":"00FF0000","background":"80000005","debugcategory":6},{"description":"System variable","foreground":"00FF0000","background":"80000005","debugcategory":6},{"description":"HTML","foreground":"00800080","background":"80000005","debugcategory":0},{"description":"Object property","foreground":"00FF0000","background":"80000005","debugcategory":5},{"description":"Object name","foreground":"00808000","background":"80000005","debugcategory":6},{"description":"Command","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Object instance var","foreground":"00000000","background":"80000005","debugcategory":6},{"description":"Object reference var","foreground":"80000008","background":"80000005","debugcategory":5},{"description":"Object method","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Object attribute","foreground":"00FF0000","background":"80000005","debugcategory":5},{"description":"Object (This)","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"VB Form name","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"VB Control name","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"VB Property name","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"Pattern","foreground":"00008080","background":"80000005","debugcategory":0},{"description":"Brace","foreground":"00800080","background":"80000005","debugcategory":0},{"description":"Javascript","foreground":"00800080","background":"80000005","debugcategory":0},{"description":"CSP Extension","foreground":"00800080","background":"80000005","debugcategory":0},{"description":"Object (Super)","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Local variable (private)","foreground":"00008080","background":"80000005","debugcategory":6},{"description":"Option Track Warning","foreground":"00800080","background":"80000005","debugcategory":6},{"description":"Parameter","foreground":"00FF00FF","background":"80000005","debugcategory":6},{"description":"Local (undeclared)","foreground":"00000000","background":"80000005","debugcategory":6},{"description":"Neutral","foreground":"00008080","background":"80000005","debugcategory":0},{"description":"Documentation comment","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Unknown Z-command","foreground":"00008080","background":"80000005","debugcategory":0},{"description":"Unknown Z-function","foreground":"00008080","background":"80000005","debugcategory":0},{"description":"Unknown Z-variable","foreground":"00008080","background":"80000005","debugcategory":6},{"description":"Object member","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"JSON bracket","foreground":"00FF00FF","background":"80000005","debugcategory":0},{"description":"JSON delimeter","foreground":"00808080","background":"80000005","debugcategory":0},{"description":"JSON keyword","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Embedding open","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Embedding close","foreground":"00000000","background":"80000005","debugcategory":0}]};
attributes["INT"] = {"attrinfo":[{"description":"Error","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"White Space","foreground":"80000008","background":"80000005","debugcategory":0}]};
attributes["XML"] = {"attrinfo":[{"description":"Error","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"White Space","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"_Tab","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"Tag Delimiter (\"<\" and \">\")","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"DTD Delimiter","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Element Name","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Attribute Name","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"Name","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"DTD Name","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"DTD Keyword","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"Entity Reference","foreground":"00800080","background":"80000005","debugcategory":0},{"description":"Parameter Entity Reference","foreground":"00800080","background":"80000005","debugcategory":0},{"description":"Character Reference","foreground":"00800080","background":"80000005","debugcategory":0},{"description":"Processing Instruction Delimiter","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Processing Instruction Content","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"Comment","foreground":"00008080","background":"80000005","debugcategory":0},{"description":"Text","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"String","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"Grayout","foreground":"00C0C0C0","background":"80000005","debugcategory":0},{"description":"Indirection (@)","foreground":"00000080","background":"80000005","debugcategory":0}]};
attributes["BAS"] = {"attrinfo":[{"description":"Error","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"White Space","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"_Tab","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"Assignment operator","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Binary operator","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Class Identifier","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Comment","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"Constant","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Delimiter","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Function","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Hexadecimal integer","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Identifier","foreground":"00000000","background":"80000005","debugcategory":6},{"description":"Integer","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Keyword","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Label","foreground":"00000000","background":"80000005","debugcategory":3},{"description":"Object identifier","foreground":"00808000","background":"80000005","debugcategory":0},{"description":"Object operator","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Procedure","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Property","foreground":"00FF0000","background":"80000005","debugcategory":5},{"description":"Real","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Relational operator","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Routine name","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"String","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"Subroutine","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"System Function","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Type declaration","foreground":"000000FF","background":"80000005","debugcategory":0},{"description":"Unary operator","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Variable identifier","foreground":"00000000","background":"80000005","debugcategory":6}]};
attributes["CSS"] = {"attrinfo":[{"description":"Error","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"White Space","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"_Tab","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"Identifier","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"@Keyword","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"CSS @Keyword","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"String","foreground":"0000FF00","background":"80000005","debugcategory":0},{"description":"#Name","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Number","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"Hexcolor","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"Percentage","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"Dimension","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"Measure","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"URI","foreground":"00800080","background":"80000005","debugcategory":0},{"description":"Unicode-range","foreground":"0000FF00","background":"80000005","debugcategory":0},{"description":"C-style Comment /* xxx */","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"CSS Delimiter","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"Other Delimiter","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Function","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Operator","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"CSP Extension","foreground":"00800080","background":"80000005","debugcategory":0}]};
attributes["HTML"] = {"attrinfo":[{"description":"Error","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"White Space","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"_Tab","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"Attribute","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Comment","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"Delimiter","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Escape Sequence","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Name","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Number","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Script","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"String","foreground":"00800080","background":"80000005","debugcategory":0},{"description":"Tag","foreground":"000000FF","background":"80000005","debugcategory":0},{"description":"Text","foreground":"00000000","background":"80000005","debugcategory":0}]};
attributes["JAVA"] = {"attrinfo":[{"description":"Error","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"White Space","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"_Tab","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"Label","foreground":"0000FFFF","background":"80000005","debugcategory":0},{"description":"Delimiter","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Class name","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Interface name","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"String","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"Comment","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"Character literal","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"Decimal integer","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Hexadecimal integer","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Octal integer","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Floating point number","foreground":"00808000","background":"80000005","debugcategory":0},{"description":"Identifier","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Operator","foreground":"000000FF","background":"80000005","debugcategory":0},{"description":"Definition keyword","foreground":"00808000","background":"80000005","debugcategory":0},{"description":"Statement keyword","foreground":"000000FF","background":"80000005","debugcategory":0},{"description":"Literal keyword","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Basic type","foreground":"000000FF","background":"80000005","debugcategory":0},{"description":"Object keyword","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Annotation","foreground":"00000080","background":"80000005","debugcategory":0}]};
attributes["JAVASCRIPT"] = {"attrinfo":[{"description":"Error","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"White Space","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"_Tab","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"Label","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"Delimiter","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"String","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"Comment","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"Decimal integer","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Hexadecimal integer","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Floating point number","foreground":"00808000","background":"80000005","debugcategory":0},{"description":"Regexp delimiter","foreground":"00808000","background":"80000005","debugcategory":0},{"description":"Regexp body","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Regexp escape sequence","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Regexp flags","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"Identifier","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Operator","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Definition keyword","foreground":"00808000","background":"80000005","debugcategory":0},{"description":"Statement keyword","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"Literal keyword","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Expression keyword","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"Future keyword","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"CSP extension","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"JSON property name","foreground":"00FF0000","background":"80000005","debugcategory":0}]};
attributes["MVBASIC"] = {"attrinfo":[{"description":"Error","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"White Space","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"_Tab","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"Assignment operator","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Binary operator","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Class Identifier","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Comment","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"Constant","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Delimiter","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Function","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Hexadecimal integer","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Identifier","foreground":"00000000","background":"80000005","debugcategory":6},{"description":"Integer","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Keyword","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Label","foreground":"00000000","background":"80000005","debugcategory":3},{"description":"Object identifier","foreground":"00808000","background":"80000005","debugcategory":0},{"description":"Object operator","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Procedure","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Property","foreground":"00FF0000","background":"80000005","debugcategory":5},{"description":"Real","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Relational operator","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Routine name","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"String","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"Subroutine","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"System Function","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Type declaration","foreground":"000000FF","background":"80000005","debugcategory":0},{"description":"Unary operator","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Variable identifier","foreground":"00000000","background":"80000005","debugcategory":6}]};
attributes["SQL"] = {"attrinfo":[{"description":"Error","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"White Space","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"_Tab","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"Delimiter","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"String","foreground":"00808000","background":"80000005","debugcategory":0},{"description":"Comment","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Integer number","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Floating point number","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Identifier","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"Host variable name","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"Host instance name","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"Host extrinsic function","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"Operator","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Scalar function name","foreground":"00008080","background":"80000005","debugcategory":0},{"description":"ODBC function name","foreground":"00008080","background":"80000005","debugcategory":0},{"description":"Aggregate function name","foreground":"00008080","background":"80000005","debugcategory":0},{"description":"Data type","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Statement keyword","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Qualifier keyword","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Expression keyword","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"CSP/PP extension","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"Host reference variable name","foreground":"00000080","background":"80000005","debugcategory":0}]};
attributes["PYTHON"] = {"attrinfo":[{"description":"Error","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"White Space","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"_Tab","foreground":"80000008","background":"80000005","debugcategory":0},{"description":"Comment","foreground":"00000080","background":"80000005","debugcategory":0},{"description":"Statement Keyword","foreground":"00800080","background":"80000005","debugcategory":0},{"description":"String","foreground":"00008000","background":"80000005","debugcategory":0},{"description":"Delimiter","foreground":"00000000","background":"80000005","debugcategory":0},{"description":"Number","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Floating Point","foreground":"00800000","background":"80000005","debugcategory":0},{"description":"Name","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Line Continuation","foreground":"00FF0000","background":"80000005","debugcategory":0},{"description":"Keyword","foreground":"00800080","background":"80000005","debugcategory":0},{"description":"Definition Keyword","foreground":"000000FF","background":"80000005","debugcategory":0},{"description":"Expression Keyword","foreground":"00FF00FF","background":"80000005","debugcategory":0},{"description":"Neutral","foreground":"00808080","background":"80000005","debugcategory":0},{"description":"Operator","foreground":"00FF00FF","background":"80000005","debugcategory":0},{"description":"Assignment Operator","foreground":"00800080","background":"80000005","debugcategory":0}]};
// END --->

// returns a structure of type attrinforesult

function GETLANGUAGEATTRINFO(moniker) {

	return attributes[moniker];

}

exports['GETLANGUAGEATTRINFO'] = GETLANGUAGEATTRINFO;





// returns a structure of type attrinforesult

function GETLANGUAGEATTRINFO_OLD(moniker) {

	return bridge_GetLanguageAttributes(moniker);

}

exports['GETLANGUAGEATTRINFO_OLD'] = GETLANGUAGEATTRINFO_OLD;





function END() {

	bridge_Finalize();

	// ffitable.LIBCOMBRIDGE._.close()

	resetffitable();

}





function bridge_Initialize() {



	bridge(function(info){

		ffitable.LIBCOMBRIDGE.COMBridgeC_Initialize(info.ref());

	});

}



function bridge_SetupParser(moniker) {

	bridge(function(info){

		ffitable.LIBCOMBRIDGE.COMBridgeC_SetupParser(info.ref(),moniker);

	});

}



function bridge_GetLanguageAttributes(moniker) {



	var attrinforesult = new attrinforesulttype({'attrinforesult_attrinfocount': 0, 'attrinforesult_attrinfo': []});



	if (tracebridge) {			

		console.log('bridge_GetLanguageAttributes(' + moniker + ')');

	}



	bridge(function(info){

		ffitable.LIBCOMBRIDGE.COMBridgeC_GetLanguageAttributes(info.ref(),moniker,attrinforesult.ref());

	})



	var obj = attrinforesult.toObject();

	obj.attrinforesult_attrinfo.length = obj.attrinforesult_attrinfocount;

	var arr = obj.attrinforesult_attrinfo.toArray();

	var attrinforet = [];

	for (var item in arr) {

		attrinforet.push(arr[item].deref().toObject());

	}



	return {'attrinfo': attrinforet};

}



function bridge_ColorSource(source,moniker) {



	// call into C++

	var languagecolor = new languagecolorresult({'languagecolorresult_languagescount': 0, 'languagecolorresult_languages': []});

	var colorrecord = new colorrecordresult({'colorrecordresult_recordscount': 0, 'colorrecordresult_records': []});	



	if (tracebridge) {			

		console.log('bridge_ColorSource: before ffi call(' + moniker + ' ' + source.length + ')');

	}

	bridge(function(info){

		ffitable.LIBCOMBRIDGE.COMBridgeC_ColorSource(info.ref(),moniker,source,STANDARDPARSEFLAGS,languagecolor.ref(),colorrecord.ref());

	});

	if (tracebridge) {	

		console.log('bridge_ColorSource: after ffi call(' + moniker + ' ' + source.length + ')');

	}

	

	// unpack the language colors

	var obj = languagecolor.toObject();

	obj.languagecolorresult_languages.length = obj.languagecolorresult_languagescount;

	var arr = obj.languagecolorresult_languages.toArray();

	

	var languagesret = {};

	for (var index in arr) {



		var item = arr[index].deref().toObject();

		var lang = item.languagecolor_languagename;

		if (typeof languagesret[lang] == 'undefined') {

			languagesret[lang] = [];

		}

		languagesret[lang][item.languagecolor_attrindex] = item.languagecolor_colorname;

	}

	

	// unpack the color records

	var obj = colorrecord.toObject();

	obj.colorrecordresult_records.length = obj.colorrecordresult_recordscount;

	var arr = obj.colorrecordresult_records.toArray();

	var colorsret = [];

	for (var item in arr) {

		colorsret.push(arr[item].deref().toObject());

	}

	

	return {'languages': languagesret, 'colors': colorsret};

}



function bridge_ColorSourceCompressed(source,moniker,omitwhitespace,parseflags) {

		

	var compressedresultrecord = new compressedresulttype({'compressedresult_linescount': 0, 'compressedresult_lines': []});	

	

	// call into C++	

	if (tracebridge) {			

		console.log('bridge_ColorSourceCompressed: before ffi call(' + moniker + ' ' + source.length + ')');

	}

	bridge(function(info){

		ffitable.LIBCOMBRIDGE.COMBridgeC_ColorSourceCompressed(info.ref(),moniker,source,parseflags,omitwhitespace,compressedresultrecord.ref());

	});

	if (tracebridge) {			

		console.log('bridge_ColorSourceCompressed: after ffi call(' + moniker + ' ' + source.length + ')');

	}



	// unpack the compressed result records

	var obj = compressedresultrecord.toObject();

	obj.compressedresult_lines.length = obj.compressedresult_linescount;

	var arr = obj.compressedresult_lines.toArray();



	// unpack the lines

	var linesresult = [];

	for (var arrindex in arr) {



		var lineobj = arr[arrindex].deref().toObject();

		lineobj.compressedlinetype_items.length = lineobj.compressedlinetype_itemscount

		var linearr = lineobj.compressedlinetype_items.toArray()



		// unpack each item in the line

		var itemsresult = [];

		for (var linearrindex in linearr) {

			var itemobj = linearr[linearrindex].deref().toObject();

			itemsresult.push(itemobj);

		}



		linesresult.push(itemsresult);

	}



	return {'compressedcolors': linesresult};

}



function bridge_ColorSourceCompressed_String(source,moniker,omitwhitespace,parseflags) {



	// call into C++	

	if (tracebridge) {			

		console.log('bridge_ColorSourceCompressed_String: before ffi call(' + moniker + ' ' + source.length + ')');

	}

	const resultstring = bridge(function(info){

		return ffitable.LIBCOMBRIDGE.COMBridgeC_ColorSourceCompressed_String(info.ref(),moniker,source,parseflags,omitwhitespace);

	});

	if (tracebridge) {			

		console.log('bridge_ColorSourceCompressed_String: after ffi call(' + moniker + ' ' + source.length + ')');

	}



	// decode the string into records

	const linearr = resultstring.split('/');

	var clinearr = [];

	for (var lineno in linearr) {

		const line = linearr[lineno];

		

		var cline = [];



		if (line.length != 0) {



			const itemarr = line.split(';');

	

			for (var itemno in itemarr) {

				const item = itemarr[itemno];



				const fieldarr = item.split(',');

				const citem = {'p': +fieldarr[0], 'c': +fieldarr[1], 'l': +fieldarr[2], 's': +fieldarr[3], 'w': +fieldarr[4]};



				cline.push(citem);

			}

		}



		clinearr.push(cline);

	}



	return {'compressedcolors': clinearr};

}



function bridge_Finalize() {

	bridge(function(info){

		ffitable.LIBCOMBRIDGE.COMBridgeC_Finalize(info.ref());

	});

}



function bridge(callfunc) {



	var info = new infotype({'info_result': 0, 'info_message': ''});



	var libdir = getLibPath();

	var oldcwd = process.cwd();

	process.chdir(libdir);

	try {

		var result = callfunc(info);

	}

	finally {

		process.chdir(oldcwd);

	}

	

	var inforesult = info.info_result;

	

	if (inforesult == INFO_RESULT_EXCEPTION) {

		console.log('bridge: exception returned from COMBridge');

		console.log(info.info_message);

		throw info.info_message;

	}





	return result;

}



function getLibPath() {



	if (tracebridge) {

	

		console.log('cwd() = ' + process.cwd());

		if (typeof __dirname == 'undefined') {

			console.log('__dirname is undefined');

		}

		else {

			console.log('__dirname = ' + __dirname);

		}

	}



	const currentdir = (typeof __dirname == 'undefined') ? process.cwd() : __dirname;

	if (!currentdir.endsWith('out')) {

		return currentdir;

	}

	

	const parentdir = path.normalize(path.join(currentdir,'..'));

	return path.join(parentdir,'lib',platformsubfolder());

}



// ANSI coloring



// pre-requisite is calling START()

function color(source,moniker,wantedlanguages) {



	throw 'color: calls to bridge code need review';



	if (typeof moniker == 'undefined') {

		moniker = which;

	}



	var coloringinfo = RUNWITH(source,moniker,wantedlanguages);



	var line = '';

	for (var index in coloringinfo.colors) {

		

		var record = coloringinfo.colors[index];

		var lang = record.colorrecord_languagename;

		var attrindex = record.colorrecord_attrindex;

		var source = record.colorrecord_source;



		if (attrindex == -1) {

			console.log(line);

			line = '';

		}



		else {		



			var langsection = coloringinfo.languages[lang];

			var colorname;

			if (typeof langsection != 'undefined') {

				colorname = langsection[attrindex];

			}

			if (typeof colorname == 'undefined') {

				colorname = 'UNK';

			}



			var ansi = ANSICOLOR[colorname];

			if (typeof ansi == 'undefined') {

				ansi = '<! ' + colorname + '!>';

			}

			line += ansi;

			line += source;

			line += ANSICOLOR['RESET'];

		}

	}



	if (line != '') {

		console.log(line);

	}

}



function toansi(n) {

	return '\u001b[' + n + 'm';

}



var ANSICOLOR = {

	'RESET': toansi(0),

	'BLACK': toansi(30),

	'RED': toansi(31),

	'GREEN': toansi(32),

	'KHACKY': toansi(33),

	'BLUE': toansi(34),

	'MAGENTA': toansi(35),

	'CYAN': toansi(36),

	'LIGHTBLUE': toansi(36),

	'WHITE': toansi(37)

};





// testing rigs



function testuppercase()

{

	var input = [ 'foo', 'bar', 'baz' ];

	var length = input.length;



	var ret = LIBCOMBRIDGE.uppercase(input, length);



// length of returned array is same as input length

ret.length = length;



// now you can access the 3 entries

console.log(ret);

// "[ 'FOO', 'BAR', 'BAZ' ]" 



return ret;

}





function testincrement(num)

{

	var z = ref.alloc('int',num);

	var ret = LIBCOMBRIDGE.increment(z);

	return z.deref();

}





function teststruct()

{

	var info = new infotype({'info_result': 99, 'info_message': 'test'});

	LIBCOMBRIDGE.usestruct(info.ref());

	console.log(info.toObject());

}



