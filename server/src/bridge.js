
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
var ArrayType = require('ref-array-napi');
var StructType = require('ref-struct-napi');
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
var IPARSE_UDL_EXPLICIT = 0x01; // require variable declaration (#dim)
var IPARSE_UDL_EXPERT = 0x4000; // this stops the SYSTEM class-keyword from being colored as a syntax-error
var IPARSE_UDL_TRACK = 0x20000; // enable variable-tracking
var STANDARDPARSEFLAGS = IPARSE_UDL_EXPLICIT + IPARSE_UDL_EXPERT + IPARSE_UDL_TRACK;


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
	return bridge_ColorSourceCompressed(source,moniker,true,STANDARDPARSEFLAGS + extraparseflags); // true => always omit whitespace records
}
exports['RUNWITH_COMPRESSED'] = RUNWITH_COMPRESSED;


// returns a structure of type attrinforesult
function GETLANGUAGEATTRINFO(moniker) {
	return bridge_GetLanguageAttributes(moniker);
}
exports['GETLANGUAGEATTRINFO'] = GETLANGUAGEATTRINFO;


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
		console.log('bridge_ColorSource: before ffi call');
	}
	bridge(function(info){
		ffitable.LIBCOMBRIDGE.COMBridgeC_ColorSource(info.ref(),moniker,source,STANDARDPARSEFLAGS,languagecolor.ref(),colorrecord.ref());
	});
	if (tracebridge) {	
		console.log('bridge_ColorSource: after ffi call');
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
		console.log('bridge_ColorSourceCompressed: before ffi call');
	}
	bridge(function(info){
		ffitable.LIBCOMBRIDGE.COMBridgeC_ColorSourceCompressed(info.ref(),moniker,source,parseflags,omitwhitespace,compressedresultrecord.ref());
	});
	if (tracebridge) {			
		console.log('bridge_ColorSourceCompressed: after ffi call');
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

