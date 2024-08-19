import { createConnection, SemanticTokensBuilder, TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { compressedline, LanguageServerConfiguration, ServerSpec } from './types';

/**
 * TextDocument URI's mapped to the tokenized representation of the document.
 */
export let parsedDocuments: Map<string, compressedline[] | undefined> = new Map();

/**
 * Node IPC connection between the server and client.
 */
export let connection = createConnection();

/**
 * TextDocument manager.
 */
export let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

/**
 * TextDocument URI's mapped to the document's semantic tokens builder.
 */
export let tokenBuilders: Map<string, SemanticTokensBuilder> = new Map();

/**
 * TextDocument URI's mapped to the InterSystems server that the document belongs to.
 */
export let serverSpecs: Map<string, ServerSpec> = new Map();

/**
 * An array containing the names and descriptions of all core Property data type parameters.
 */
export const corePropertyParams = [
	{
		name: "CALCSELECTIVITY",
		desc: `Controls whether the Tune Table facility calculates the *selectivity* for a property. Usually it is best to leave this parameter as the default (1).`
	},
	{
		name: "CAPTION",
		desc: `Caption to use for this property in client applications.`
	},
	{
		name: "EXTERNALSQLNAME",
		desc: `Used in linked tables, this parameter specifies the name of the field in the external table to which this property is linked.`
	},
	{
		name: "EXTERNALSQLTYPE",
		desc: `Used in linked tables, this parameter specifies the SQL type of the field in the external table to which this property is linked.`
	},
	{
		name: "JAVATYPE",
		desc: `The Java data type to which this property is projected.`
	}
];

/**
 * Cache of the language server configuration parameters fetched from the client.
 */
export const languageServerSettings: Map<string, LanguageServerConfiguration> = new Map();

/**
 * Notable `$ZUTIL` functions.
 */
export const zutilFunctions: { deprecated: string[]; replace: { [func: string]: string }; noReplace: string[]; } = {
	/** Functions that are deprecated. */
	deprecated: [
		"67,1,","68,6,","68,27,","68,39,","68,55,","69,6,","69,13,","69,14,","69,19,","69,20,","69,27,",
		"69,28,","69,31,","69,35,","69,39,","69,55,","69,67,","78,28,","90,4,","100)","113)","130,","133,"
	],
	/** Functions that can be replaced by ClassMethods. */
	replace: {
		"4,":"%SYSTEM.Process_Terminate","18,":"%SYSTEM.Process_Undefined","18)":"%SYSTEM.Process_Undefined",
		"20,":"%SYSTEM.Process_UserRoutinePath","20)":"%SYSTEM.Process_UserRoutinePath","21)":"%SYSTEM.Process_PrivateGlobalLocation",
		"21,0)":"%SYSTEM.Process_PrivateGlobalLocation","21,1)":"%SYSTEM.Process_KillAllPrivateGlobals","21,2)":"%SYSTEM.Process_KillAllPrivateGlobals",
		"22,0,":"%Device_SetFFBS","22,0)":"%Device_SetFFBS","28,":"%SYSTEM.Util_Collation","39,":"%SYSTEM.Process_SysRoutinePath",
		"39)":"%SYSTEM.Process_SysRoutinePath","53)":"%SYSTEM.INetInfo_TCPName","53,":"%SYSTEM.INetInfo_TCPStats",
		"55,":"%SYSTEM.Process_LanguageMode","55)":"%SYSTEM.Process_LanguageMode","56,2)":"%SYSTEM.Process_ErrorLine",
		"56,6)":"%SYSTEM.Process_OSError","67,0,":"%SYSTEM.Process_IsGhost","67,4,":"%SYSTEM.Process_State",
		"67,5,":"%SYSTEM.Process_Routine","67,6,":"%SYSTEM.Process_NameSpace","67,7,":"%SYSTEM.Process_CurrentDevice",
		"67,8,":"%SYSTEM.Process_LinesExecuted","67,5)":"%SYSTEM.Process_Routine","67,6)":"%SYSTEM.Process_NameSpace",
		"67,7)":"%SYSTEM.Process_CurrentDevice","67,8)":"%SYSTEM.Process_LinesExecuted","67,9,":"%SYSTEM.Process_GlobalReferences",
		"67,10,":"%SYSTEM.Process_JobType","67,11,":"%SYSTEM.Process_UserName","67,12,":"%SYSTEM.Process_ClientNodeName",
		"67,13,":"%SYSTEM.Process_ClientExecutableName","67,14,":"%SYSTEM.Process_CSPSessionID","67,15,":"%SYSTEM.Process_ClientIPAddress",
		"67,9)":"%SYSTEM.Process_GlobalReferences","67,10)":"%SYSTEM.Process_JobType","67,11)":"%SYSTEM.Process_UserName",
		"67,12)":"%SYSTEM.Process_ClientNodeName","67,13)":"%SYSTEM.Process_ClientExecutableName","67,14)":"%SYSTEM.Process_CSPSessionID",
		"67,15)":"%SYSTEM.Process_ClientIPAddress","71,":"%SYSTEM.Process_FixedDate","71)":"%SYSTEM.Process_FixedDate",
		"78,23,":"%SYS.Journal.File_PurgeOne","78,29)":"%SYS.Journal.System_Sync","78,40)":"%SYS.Journal.System_WhereCommitted",
		"82,12,":"%Device_ReDirectIO","82,12)":"%Device_ReDirectIO","90,10,":"%SYS.Namespace_Exists",
		"94,":"%SYSTEM.Process_Broadcast","96,3,":"%SYSTEM.Process_ThrowError","96,4,":"%SYSTEM.Process_IODollarTest",
		"96,9)":"%SYSTEM.Process_CallingRoutine","96,10)":"%SYSTEM.Process_CallingDatabase","96,14)":"%Device_GetType",
		"110)":"%SYS.System_GetNodeName","114,":"%SYSTEM.INetInfo_EthernetAddress","128,1)":"%SYSTEM.Process_StepInfo",
		"132)":"%Device_ChangePrincipal","140,7,":"%File_Attributes","147,":"%File_NormalizeFilenameWithSpaces",
		"158,0)":"%Device_InstalledPrinters","158,1,":"%Device_InstalledPrinters","168,":"%SYSTEM.Process_CurrentDirectory",
		"168)":"%SYSTEM.Process_CurrentDirectory","186,":"%SYSTEM.Process_TerminalPrompt","186)":"%SYSTEM.Process_TerminalPrompt",
		"189)":"%SYSTEM.INetInfo_Connected","68,1,":"%SYSTEM.Process_NullSubscripts","68,1)":"%SYSTEM.Process_NullSubscripts",
		"68,2,":"%SYSTEM.Process_OpenMode","68,2)":"%SYSTEM.Process_OpenMode","68,3,":"%SYSTEM.Process_FileMode",
		"68,3)":"%SYSTEM.Process_FileMode","68,5,":"%SYSTEM.Process_BreakMode","68,5)":"%SYSTEM.Process_BreakMode",
		"68,7,":"%SYSTEM.Process_RefInKind","68,7)":"%SYSTEM.Process_RefInKind","68,11,":"%SYSTEM.Process_LineRecall",
		"68,11)":"%SYSTEM.Process_LineRecall","68,15,":"%SYSTEM.Process_DisconnectErr","68,15)":"%SYSTEM.Process_DisconnectErr",
		"68,21,":"%SYSTEM.Process_SynchCommit","68,21)":"%SYSTEM.Process_SynchCommit","68,22,":"%SYSTEM.Process_DX",
		"68,22)":"%SYSTEM.Process_DX","68,25,":"%SYSTEM.Process_BatchFlag","68,25)":"%SYSTEM.Process_BatchFlag",
		"68,28,":"%SYSTEM.Process_GlobalKillDisabled","68,28)":"%SYSTEM.Process_GlobalKillDisabled","68,30,":"%SYSTEM.Process_PopError",
		"68,30)":"%SYSTEM.Process_PopError","68,32,":"%SYSTEM.Process_ZDateNull","68,32)":"%SYSTEM.Process_ZDateNull",
		"68,34,":"%SYSTEM.Process_AsynchError","68,34)":"%SYSTEM.Process_AsynchError","68,40,":"%SYSTEM.Process_SetZEOF",
		"68,40)":"%SYSTEM.Process_SetZEOF","68,42,":"%SYSTEM.Process_NodeNameInPid","68,42)":"%SYSTEM.Process_NodeNameInPid",
		"68,43,":"%SYSTEM.Process_OldZU5","68,43)":"%SYSTEM.Process_OldZU5","68,45,":"%SYSTEM.Process_TruncateOverflow",
		"68,45)":"%SYSTEM.Process_TruncateOverflow","68,51,":"%SYSTEM.Process_SwitchOSdir","68,51)":"%SYSTEM.Process_SwitchOSdir",
		"68,60,":"%SYSTEM.Process_AsyncDisconnectErr","68,60)":"%SYSTEM.Process_AsyncDisconnectErr","68,63,":"%SYSTEM.Process_ScientificNotation",
		"68,63)":"%SYSTEM.Process_ScientificNotation","68,66,":"%SYSTEM.Process_TelnetNUL","68,66)":"%SYSTEM.Process_TelnetNUL",
		"68,67,":"%SYSTEM.Process_ExceptionLog","68,67)":"%SYSTEM.Process_ExceptionLog","68,70,":"%SYSTEM.Process_IEEEError",
		"68,70)":"%SYSTEM.Process_IEEEError","68,71,":"%SYSTEM.Process_IPv6Format","68,71)":"%SYSTEM.Process_IPv6Format",
		"68,72,":"%SYSTEM.Process_MVUndefined","68,72)":"%SYSTEM.Process_MVUndefined"
	},
	/** Functions that cannot be easily replaced automatically. */
	noReplace: [
		"5,","9,","12,","15,","49,","62,","67,0)","67,4)","78,21)","86)","78,22,","96,5,","115,11,",
		"140,1,","188)","193,","69,0,","69,1,","69,2,","69,3,","69,5,","69,7,","69,8,","69,10,",
		"69,11,","69,15,","69,21,","69,22,","69,26,","69,30,","69,32,","69,34,","69,37,","69,40,",
		"69,42,","69,43,","69,44,","69,45,","69,49,","69,51,","69,60,","69,63,","69,66,","69,68,",
		"69,69,","69,70,","69,71,","69,72,","68,26,","68,26)"
	]
};

/** Languages supported by `isclexer.node` */
export const lexerLanguages: { moniker: string; index: number; }[] = [
	{ moniker: 'CLS', index: 3 },
	{ moniker: 'COS', index: 1 },
	{ moniker: 'XML', index: 9 },
	{ moniker: 'CSS', index: 15 },
	{ moniker: 'HTML', index: 5 },
	{ moniker: 'JAVA', index: 13 },
	{ moniker: 'JAVASCRIPT', index: 11 },
	{ moniker: 'SQL', index: 2 },
	{ moniker: 'PYTHON', index: 7 }
];

/** All class member types */
export const classMemberTypes: string[] = ["Parameter","Property","Relationship","ForeignKey","Index","Query","Storage","Trigger","XData","Projection","Method","ClassMethod","ClientMethod"];

/** Regex for testing if a MPP directive is `##Continue` */
export const mppContinue: RegExp = /^(?:##)?continue$/i;
