/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as $wcm from "@vscode/wasm-component-model";
import type { u32, u8, i32, ptr, result } from "@vscode/wasm-component-model";

export namespace analyzer {
	export type SrcLoc = {
		line: u32;
		character: u32;
	};
	export type Range = {
		lft: SrcLoc;
		rht: SrcLoc;
	};
	export type NameInfo = {
		before: SrcLoc;
		text: string;
		after: SrcLoc;
	};
	export type Arg = {
		byRef: boolean;
		variadic: boolean;
		name: NameInfo;
		t?: string | undefined;
	};
	export type MethodInfo = {
		args: Arg[];
		out?: string | undefined;
		body: Range;
	};
	export type ParameterInfo = {
		t?: string | undefined;
		v?: string | undefined;
	};
	export namespace MemberKind {
		export const parameter = "parameter" as const;
		export type Parameter = { readonly tag: typeof parameter; readonly value: ParameterInfo } & _common;
		export function Parameter(value: ParameterInfo): Parameter {
			return new VariantImpl(parameter, value) as Parameter;
		}

		export const property = "property" as const;
		export type Property = { readonly tag: typeof property; readonly value: string | undefined } & _common;
		export function Property(value: string | undefined): Property {
			return new VariantImpl(property, value) as Property;
		}

		export const relationship = "relationship" as const;
		export type Relationship = { readonly tag: typeof relationship; readonly value: string | undefined } & _common;
		export function Relationship(value: string | undefined): Relationship {
			return new VariantImpl(relationship, value) as Relationship;
		}

		export const foreignKey = "foreignKey" as const;
		export type ForeignKey = { readonly tag: typeof foreignKey } & _common;
		export function ForeignKey(): ForeignKey {
			return new VariantImpl(foreignKey, undefined) as ForeignKey;
		}

		export const index = "index" as const;
		export type Index = { readonly tag: typeof index } & _common;
		export function Index(): Index {
			return new VariantImpl(index, undefined) as Index;
		}

		export const projection = "projection" as const;
		export type Projection = { readonly tag: typeof projection } & _common;
		export function Projection(): Projection {
			return new VariantImpl(projection, undefined) as Projection;
		}

		export const trigger = "trigger" as const;
		export type Trigger = { readonly tag: typeof trigger } & _common;
		export function Trigger(): Trigger {
			return new VariantImpl(trigger, undefined) as Trigger;
		}

		export const xData = "xData" as const;
		export type XData = { readonly tag: typeof xData } & _common;
		export function XData(): XData {
			return new VariantImpl(xData, undefined) as XData;
		}

		export const storage = "storage" as const;
		export type Storage = { readonly tag: typeof storage } & _common;
		export function Storage(): Storage {
			return new VariantImpl(storage, undefined) as Storage;
		}

		export const query = "query" as const;
		export type Query = { readonly tag: typeof query } & _common;
		export function Query(): Query {
			return new VariantImpl(query, undefined) as Query;
		}

		export const method = "method" as const;
		export type Method = { readonly tag: typeof method; readonly value: MethodInfo } & _common;
		export function Method(value: MethodInfo): Method {
			return new VariantImpl(method, value) as Method;
		}

		export const classMethod = "classMethod" as const;
		export type ClassMethod = { readonly tag: typeof classMethod; readonly value: MethodInfo } & _common;
		export function ClassMethod(value: MethodInfo): ClassMethod {
			return new VariantImpl(classMethod, value) as ClassMethod;
		}

		export const clientMethod = "clientMethod" as const;
		export type ClientMethod = { readonly tag: typeof clientMethod; readonly value: MethodInfo } & _common;
		export function ClientMethod(value: MethodInfo): ClientMethod {
			return new VariantImpl(clientMethod, value) as ClientMethod;
		}

		export type _tt =
			| typeof parameter
			| typeof property
			| typeof relationship
			| typeof foreignKey
			| typeof index
			| typeof projection
			| typeof trigger
			| typeof xData
			| typeof storage
			| typeof query
			| typeof method
			| typeof classMethod
			| typeof clientMethod;
		export type _vt =
			| ParameterInfo
			| string
			| undefined
			| string
			| undefined
			| MethodInfo
			| MethodInfo
			| MethodInfo
			| undefined;
		type _common = Omit<VariantImpl, "tag" | "value">;
		export function _ctor(t: _tt, v: _vt): MemberKind {
			return new VariantImpl(t, v) as MemberKind;
		}
		class VariantImpl {
			private readonly _tag: _tt;
			private readonly _value?: _vt;
			constructor(t: _tt, value: _vt) {
				this._tag = t;
				this._value = value;
			}
			get tag(): _tt {
				return this._tag;
			}
			get value(): _vt {
				return this._value;
			}
			isParameter(): this is Parameter {
				return this._tag === MemberKind.parameter;
			}
			isProperty(): this is Property {
				return this._tag === MemberKind.property;
			}
			isRelationship(): this is Relationship {
				return this._tag === MemberKind.relationship;
			}
			isForeignKey(): this is ForeignKey {
				return this._tag === MemberKind.foreignKey;
			}
			isIndex(): this is Index {
				return this._tag === MemberKind.index;
			}
			isProjection(): this is Projection {
				return this._tag === MemberKind.projection;
			}
			isTrigger(): this is Trigger {
				return this._tag === MemberKind.trigger;
			}
			isXData(): this is XData {
				return this._tag === MemberKind.xData;
			}
			isStorage(): this is Storage {
				return this._tag === MemberKind.storage;
			}
			isQuery(): this is Query {
				return this._tag === MemberKind.query;
			}
			isMethod(): this is Method {
				return this._tag === MemberKind.method;
			}
			isClassMethod(): this is ClassMethod {
				return this._tag === MemberKind.classMethod;
			}
			isClientMethod(): this is ClientMethod {
				return this._tag === MemberKind.clientMethod;
			}
		}
	}
	export type MemberKind =
		| MemberKind.Parameter
		| MemberKind.Property
		| MemberKind.Relationship
		| MemberKind.ForeignKey
		| MemberKind.Index
		| MemberKind.Projection
		| MemberKind.Trigger
		| MemberKind.XData
		| MemberKind.Storage
		| MemberKind.Query
		| MemberKind.Method
		| MemberKind.ClassMethod
		| MemberKind.ClientMethod;
	export type MemberInfo = {
		doc: string;
		before: SrcLoc;
		name: NameInfo;
		deprecated: boolean;
		kind: MemberKind;
		after: SrcLoc;
	};
	export type ClassInfo = {
		doc: string;
		name: NameInfo;
		extends: string[];
		deprecated: boolean;
		members: MemberInfo[];
	};
	export type MacroInfo = {
		name: NameInfo;
		args: string[];
	};
	export type SubroutineInfo = {
		name: NameInfo;
		args: string[];
	};
	export namespace RoutineInfo {
		export const inc = "INC" as const;
		export type INC = { readonly tag: typeof inc; readonly value: MacroInfo[] } & _common;
		export function INC(value: MacroInfo[]): INC {
			return new VariantImpl(inc, value) as INC;
		}

		export const int = "INT" as const;
		export type INT = { readonly tag: typeof int; readonly value: SubroutineInfo[] } & _common;
		export function INT(value: SubroutineInfo[]): INT {
			return new VariantImpl(int, value) as INT;
		}

		export const mac = "MAC" as const;
		export type MAC = { readonly tag: typeof mac; readonly value: SubroutineInfo[] } & _common;
		export function MAC(value: SubroutineInfo[]): MAC {
			return new VariantImpl(mac, value) as MAC;
		}

		export type _tt = typeof inc | typeof int | typeof mac;
		export type _vt = MacroInfo[] | SubroutineInfo[] | SubroutineInfo[];
		type _common = Omit<VariantImpl, "tag" | "value">;
		export function _ctor(t: _tt, v: _vt): RoutineInfo {
			return new VariantImpl(t, v) as RoutineInfo;
		}
		class VariantImpl {
			private readonly _tag: _tt;
			private readonly _value: _vt;
			constructor(t: _tt, value: _vt) {
				this._tag = t;
				this._value = value;
			}
			get tag(): _tt {
				return this._tag;
			}
			get value(): _vt {
				return this._value;
			}
			isINC(): this is INC {
				return this._tag === RoutineInfo.inc;
			}
			isINT(): this is INT {
				return this._tag === RoutineInfo.int;
			}
			isMAC(): this is MAC {
				return this._tag === RoutineInfo.mac;
			}
		}
	}
	export type RoutineInfo = RoutineInfo.INC | RoutineInfo.INT | RoutineInfo.MAC;
	export type ParseErr = {
		range: Range;
		message: string;
	};
	export namespace AnalysisErr {
		export const p = "P" as const;
		export type P = { readonly tag: typeof p; readonly value: ParseErr } & _common;
		export function P(value: ParseErr): P {
			return new VariantImpl(p, value) as P;
		}

		export type _tt = typeof p;
		export type _vt = ParseErr;
		type _common = Omit<VariantImpl, "tag" | "value">;
		export function _ctor(t: _tt, v: _vt): AnalysisErr {
			return new VariantImpl(t, v) as AnalysisErr;
		}
		class VariantImpl {
			private readonly _tag: _tt;
			private readonly _value: _vt;
			constructor(t: _tt, value: _vt) {
				this._tag = t;
				this._value = value;
			}
			get tag(): _tt {
				return this._tag;
			}
			get value(): _vt {
				return this._value;
			}
			isP(): this is P {
				return this._tag === AnalysisErr.p;
			}
		}
	}
	export type AnalysisErr = AnalysisErr.P;
	export namespace AnalysisErr {
		export class Error_ extends $wcm.ResultError<AnalysisErr> {
			constructor(cause: AnalysisErr) {
				super(`AnalysisErr: ${cause}`, cause);
			}
		}
	}
	export type Completion = {
		classname?: u8 | undefined;
		variable?: u8 | undefined;
		command?: u8 | undefined;
	};
	export type Imports = {};
	export namespace Imports {
		export type Promisified = $wcm.$imports.Promisify<Imports>;
	}
	export namespace imports {
		export type Promisify<T> = $wcm.$imports.Promisify<T>;
	}
	export type Exports = {
		/**
		 * @throws AnalysisErr.Error_
		 */
		analyzeCls: (path: string, src: string) => ClassInfo;
		/**
		 * @throws AnalysisErr.Error_
		 */
		analyzeRtn: (path: string, src: string) => RoutineInfo;
		/**
		 * @throws AnalysisErr.Error_
		 */
		completeClass: (path: string, prefix: string) => Completion;
		/**
		 * @throws AnalysisErr.Error_
		 */
		completeMethod: (path: string, prefix: string) => Completion;
	};
	export namespace Exports {
		export type Promisified = $wcm.$exports.Promisify<Exports>;
	}
	export namespace exports {
		export type Promisify<T> = $wcm.$exports.Promisify<T>;
	}
}

export namespace analyzer.$ {
	export const SrcLoc = new $wcm.RecordType<SrcLoc>([
		["line", $wcm.u32],
		["character", $wcm.u32],
	]);
	export const Range = new $wcm.RecordType<Range>([
		["lft", SrcLoc],
		["rht", SrcLoc],
	]);
	export const NameInfo = new $wcm.RecordType<NameInfo>([
		["before", SrcLoc],
		["text", $wcm.wstring],
		["after", SrcLoc],
	]);
	export const Arg = new $wcm.RecordType<Arg>([
		["byRef", $wcm.bool],
		["variadic", $wcm.bool],
		["name", NameInfo],
		["t", new $wcm.OptionType<string>($wcm.wstring)],
	]);
	export const MethodInfo = new $wcm.RecordType<MethodInfo>([
		["args", new $wcm.ListType<analyzer.Arg>(Arg)],
		["out", new $wcm.OptionType<string>($wcm.wstring)],
		["body", Range],
	]);
	export const ParameterInfo = new $wcm.RecordType<ParameterInfo>([
		["t", new $wcm.OptionType<string>($wcm.wstring)],
		["v", new $wcm.OptionType<string>($wcm.wstring)],
	]);
	export const MemberKind = new $wcm.VariantType<MemberKind, MemberKind._tt, MemberKind._vt>(
		[
			["parameter", ParameterInfo],
			["property", new $wcm.OptionType<string>($wcm.wstring)],
			["relationship", new $wcm.OptionType<string>($wcm.wstring)],
			["foreignKey", undefined],
			["index", undefined],
			["projection", undefined],
			["trigger", undefined],
			["xData", undefined],
			["storage", undefined],
			["query", undefined],
			["method", MethodInfo],
			["classMethod", MethodInfo],
			["clientMethod", MethodInfo],
		],
		analyzer.MemberKind._ctor,
	);
	export const MemberInfo = new $wcm.RecordType<MemberInfo>([
		["doc", $wcm.wstring],
		["before", SrcLoc],
		["name", NameInfo],
		["deprecated", $wcm.bool],
		["kind", MemberKind],
		["after", SrcLoc],
	]);
	export const ClassInfo = new $wcm.RecordType<ClassInfo>([
		["doc", $wcm.wstring],
		["name", NameInfo],
		["extends", new $wcm.ListType<string>($wcm.wstring)],
		["deprecated", $wcm.bool],
		["members", new $wcm.ListType<analyzer.MemberInfo>(MemberInfo)],
	]);
	export const MacroInfo = new $wcm.RecordType<MacroInfo>([
		["name", NameInfo],
		["args", new $wcm.ListType<string>($wcm.wstring)],
	]);
	export const SubroutineInfo = new $wcm.RecordType<SubroutineInfo>([
		["name", NameInfo],
		["args", new $wcm.ListType<string>($wcm.wstring)],
	]);
	export const RoutineInfo = new $wcm.VariantType<RoutineInfo, RoutineInfo._tt, RoutineInfo._vt>(
		[
			["INC", new $wcm.ListType<analyzer.MacroInfo>(MacroInfo)],
			["INT", new $wcm.ListType<analyzer.SubroutineInfo>(SubroutineInfo)],
			["MAC", new $wcm.ListType<analyzer.SubroutineInfo>(SubroutineInfo)],
		],
		analyzer.RoutineInfo._ctor,
	);
	export const ParseErr = new $wcm.RecordType<ParseErr>([
		["range", Range],
		["message", $wcm.wstring],
	]);
	export const AnalysisErr = new $wcm.VariantType<AnalysisErr, AnalysisErr._tt, AnalysisErr._vt>(
		[["P", ParseErr]],
		analyzer.AnalysisErr._ctor,
	);
	export const Completion = new $wcm.RecordType<Completion>([
		["classname", new $wcm.OptionType<u8>($wcm.u8)],
		["variable", new $wcm.OptionType<u8>($wcm.u8)],
		["command", new $wcm.OptionType<u8>($wcm.u8)],
	]);
	export namespace exports {
		export const analyzeCls = new $wcm.FunctionType<analyzer.Exports["analyzeCls"]>(
			"analyze-cls",
			[
				["path", $wcm.wstring],
				["src", $wcm.wstring],
			],
			new $wcm.ResultType<analyzer.ClassInfo, analyzer.AnalysisErr>(
				ClassInfo,
				AnalysisErr,
				analyzer.AnalysisErr.Error_,
			),
		);
		export const analyzeRtn = new $wcm.FunctionType<analyzer.Exports["analyzeRtn"]>(
			"analyze-rtn",
			[
				["path", $wcm.wstring],
				["src", $wcm.wstring],
			],
			new $wcm.ResultType<analyzer.RoutineInfo, analyzer.AnalysisErr>(
				RoutineInfo,
				AnalysisErr,
				analyzer.AnalysisErr.Error_,
			),
		);
		export const completeClass = new $wcm.FunctionType<analyzer.Exports["completeClass"]>(
			"complete-class",
			[
				["path", $wcm.wstring],
				["prefix", $wcm.wstring],
			],
			new $wcm.ResultType<analyzer.Completion, analyzer.AnalysisErr>(
				Completion,
				AnalysisErr,
				analyzer.AnalysisErr.Error_,
			),
		);
		export const completeMethod = new $wcm.FunctionType<analyzer.Exports["completeMethod"]>(
			"complete-method",
			[
				["path", $wcm.wstring],
				["prefix", $wcm.wstring],
			],
			new $wcm.ResultType<analyzer.Completion, analyzer.AnalysisErr>(
				Completion,
				AnalysisErr,
				analyzer.AnalysisErr.Error_,
			),
		);
	}
}
export namespace analyzer._ {
	export const id = "iris:objectscript-analyzer/analyzer" as const;
	export const witName = "analyzer" as const;
	export namespace exports {
		export const functions: Map<string, $wcm.FunctionType> = new Map([
			["analyzeCls", $.exports.analyzeCls],
			["analyzeRtn", $.exports.analyzeRtn],
			["completeClass", $.exports.completeClass],
			["completeMethod", $.exports.completeMethod],
		]);
		export function bind(exports: Exports, context: $wcm.WasmContext): analyzer.Exports {
			return $wcm.$exports.bind<analyzer.Exports>(_, exports, context);
		}
	}
	export type Exports = {
		"analyze-cls": (
			path_ptr: i32,
			path_len: i32,
			src_ptr: i32,
			src_len: i32,
			result: ptr<result<ClassInfo, AnalysisErr>>,
		) => void;
		"analyze-rtn": (
			path_ptr: i32,
			path_len: i32,
			src_ptr: i32,
			src_len: i32,
			result: ptr<result<RoutineInfo, AnalysisErr>>,
		) => void;
		"complete-class": (
			path_ptr: i32,
			path_len: i32,
			prefix_ptr: i32,
			prefix_len: i32,
			result: ptr<result<Completion, AnalysisErr>>,
		) => void;
		"complete-method": (
			path_ptr: i32,
			path_len: i32,
			prefix_ptr: i32,
			prefix_len: i32,
			result: ptr<result<Completion, AnalysisErr>>,
		) => void;
	};
	export function bind(
		service: analyzer.Imports,
		code: $wcm.Code,
		context?: $wcm.ComponentModelContext,
	): Promise<analyzer.Exports>;
	export function bind(
		service: analyzer.Imports.Promisified,
		code: $wcm.Code,
		port: $wcm.RAL.ConnectionPort,
		context?: $wcm.ComponentModelContext,
	): Promise<analyzer.Exports.Promisified>;
	export function bind(
		service: analyzer.Imports | analyzer.Imports.Promisified,
		code: $wcm.Code,
		portOrContext?: $wcm.RAL.ConnectionPort | $wcm.ComponentModelContext,
		context?: $wcm.ComponentModelContext | undefined,
	): Promise<analyzer.Exports> | Promise<analyzer.Exports.Promisified> {
		return $wcm.$main.bind(_, service, code, portOrContext, context);
	}
}
