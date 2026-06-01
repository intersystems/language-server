/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as $wcm from '@vscode/wasm-component-model';
import type { u32, u8, i32, ptr, result } from '@vscode/wasm-component-model';

export namespace AnalyzerInterface {
	export type Position = {
		line: u32;
		character: u32;
	};

	export type Range = {
		start: Position;
		end: Position;
	};

	export type Location = {
		uri: string;
		range: Range;
	};

	export type DiagnosticRelatedInformation = {
		location: Location;
		message: string;
	};

	export type NameInfo = {
		before: Position;
		text: string;
		after: Position;
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
		export const parameter = 'parameter' as const;
		export type Parameter = { readonly tag: typeof parameter; readonly value: ParameterInfo } & _common;
		export function Parameter(value: ParameterInfo): Parameter {
			return new VariantImpl(parameter, value) as Parameter;
		}

		export const property = 'property' as const;
		export type Property = { readonly tag: typeof property; readonly value: string | undefined } & _common;
		export function Property(value: string | undefined): Property {
			return new VariantImpl(property, value) as Property;
		}

		export const relationship = 'relationship' as const;
		export type Relationship = { readonly tag: typeof relationship; readonly value: string | undefined } & _common;
		export function Relationship(value: string | undefined): Relationship {
			return new VariantImpl(relationship, value) as Relationship;
		}

		export const foreignKey = 'foreignKey' as const;
		export type ForeignKey = { readonly tag: typeof foreignKey } & _common;
		export function ForeignKey(): ForeignKey {
			return new VariantImpl(foreignKey, undefined) as ForeignKey;
		}

		export const index = 'index' as const;
		export type Index = { readonly tag: typeof index } & _common;
		export function Index(): Index {
			return new VariantImpl(index, undefined) as Index;
		}

		export const projection = 'projection' as const;
		export type Projection = { readonly tag: typeof projection } & _common;
		export function Projection(): Projection {
			return new VariantImpl(projection, undefined) as Projection;
		}

		export const trigger = 'trigger' as const;
		export type Trigger = { readonly tag: typeof trigger } & _common;
		export function Trigger(): Trigger {
			return new VariantImpl(trigger, undefined) as Trigger;
		}

		export const xData = 'xData' as const;
		export type XData = { readonly tag: typeof xData } & _common;
		export function XData(): XData {
			return new VariantImpl(xData, undefined) as XData;
		}

		export const storage = 'storage' as const;
		export type Storage = { readonly tag: typeof storage } & _common;
		export function Storage(): Storage {
			return new VariantImpl(storage, undefined) as Storage;
		}

		export const query = 'query' as const;
		export type Query = { readonly tag: typeof query } & _common;
		export function Query(): Query {
			return new VariantImpl(query, undefined) as Query;
		}

		export const method = 'method' as const;
		export type Method = { readonly tag: typeof method; readonly value: MethodInfo } & _common;
		export function Method(value: MethodInfo): Method {
			return new VariantImpl(method, value) as Method;
		}

		export const classMethod = 'classMethod' as const;
		export type ClassMethod = { readonly tag: typeof classMethod; readonly value: MethodInfo } & _common;
		export function ClassMethod(value: MethodInfo): ClassMethod {
			return new VariantImpl(classMethod, value) as ClassMethod;
		}

		export const clientMethod = 'clientMethod' as const;
		export type ClientMethod = { readonly tag: typeof clientMethod; readonly value: MethodInfo } & _common;
		export function ClientMethod(value: MethodInfo): ClientMethod {
			return new VariantImpl(clientMethod, value) as ClientMethod;
		}

		export type _tt = typeof parameter | typeof property | typeof relationship | typeof foreignKey | typeof index | typeof projection | typeof trigger | typeof xData | typeof storage | typeof query | typeof method | typeof classMethod | typeof clientMethod;
		export type _vt = ParameterInfo | string | undefined | string | undefined | MethodInfo | MethodInfo | MethodInfo | undefined;
		type _common = Omit<VariantImpl, 'tag' | 'value'>;
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
	export type MemberKind = MemberKind.Parameter | MemberKind.Property | MemberKind.Relationship | MemberKind.ForeignKey | MemberKind.Index | MemberKind.Projection | MemberKind.Trigger | MemberKind.XData | MemberKind.Storage | MemberKind.Query | MemberKind.Method | MemberKind.ClassMethod | MemberKind.ClientMethod;

	export type MemberInfo = {
		doc: string;
		before: Position;
		name: NameInfo;
		deprecated: boolean;
		kind: MemberKind;
		after: Position;
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
		export const inc = 'INC' as const;
		export type INC = { readonly tag: typeof inc; readonly value: MacroInfo[] } & _common;
		export function INC(value: MacroInfo[]): INC {
			return new VariantImpl(inc, value) as INC;
		}

		export const int = 'INT' as const;
		export type INT = { readonly tag: typeof int; readonly value: SubroutineInfo[] } & _common;
		export function INT(value: SubroutineInfo[]): INT {
			return new VariantImpl(int, value) as INT;
		}

		export const mac = 'MAC' as const;
		export type MAC = { readonly tag: typeof mac; readonly value: SubroutineInfo[] } & _common;
		export function MAC(value: SubroutineInfo[]): MAC {
			return new VariantImpl(mac, value) as MAC;
		}

		export type _tt = typeof inc | typeof int | typeof mac;
		export type _vt = MacroInfo[] | SubroutineInfo[] | SubroutineInfo[];
		type _common = Omit<VariantImpl, 'tag' | 'value'>;
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
		export const p = 'P' as const;
		export type P = { readonly tag: typeof p; readonly value: ParseErr } & _common;
		export function P(value: ParseErr): P {
			return new VariantImpl(p, value) as P;
		}

		export type _tt = typeof p;
		export type _vt = ParseErr;
		type _common = Omit<VariantImpl, 'tag' | 'value'>;
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

	export type Diagnostic = {
		message: string;
		range: Range;
		relatedInformation: DiagnosticRelatedInformation[];
	};

	export namespace Workspace {
		export interface Interface extends $wcm.Resource {
			/**
			 * @throws AnalysisErr.Error_
			 */
			insertCls(uri: string, src: string): ClassInfo;

			/**
			 * @throws AnalysisErr.Error_
			 */
			insertRtn(uri: string, src: string): RoutineInfo;

			remove(uri: string): void;

			check(uri: string): Diagnostic[];

			/**
			 * returns uri and class-info
			 */
			queryCls(query: string): [string, ClassInfo][];

			/**
			 * returns uri and member-info
			 */
			queryMem(cls: string, query: string): [string, MemberInfo][];
		}
		export type Statics = {
			$new?(): Interface;
		};
		export type Class = Statics & {
			new(): Interface;
		};
	}
	export type Workspace = Workspace.Interface;

	/**
	 * @throws AnalysisErr.Error_
	 */
	export type completeClass = (prefix: string) => Completion;

	/**
	 * @throws AnalysisErr.Error_
	 */
	export type completeMethod = (prefix: string) => Completion;
}
export type AnalyzerInterface = {
	Workspace: AnalyzerInterface.Workspace.Class;
	completeClass: AnalyzerInterface.completeClass;
	completeMethod: AnalyzerInterface.completeMethod;
};
export namespace analyzer {
	export type Imports = {
	};
	export namespace Imports {
		export type Promisified = $wcm.$imports.Promisify<Imports>;
	}
	export namespace imports {
		export type Promisify<T> = $wcm.$imports.Promisify<T>;
	}
	export type Exports = {
		analyzerInterface: AnalyzerInterface;
	};
	export namespace Exports {
		export type Promisified = $wcm.$exports.Promisify<Exports>;
	}
	export namespace exports {
		export type Promisify<T> = $wcm.$exports.Promisify<T>;
	}
}

export namespace AnalyzerInterface.$ {
	export const Position = new $wcm.RecordType<AnalyzerInterface.Position>([
		['line', $wcm.u32],
		['character', $wcm.u32],
	]);
	export const Range = new $wcm.RecordType<AnalyzerInterface.Range>([
		['start', Position],
		['end', Position],
	]);
	export const Location = new $wcm.RecordType<AnalyzerInterface.Location>([
		['uri', $wcm.wstring],
		['range', Range],
	]);
	export const DiagnosticRelatedInformation = new $wcm.RecordType<AnalyzerInterface.DiagnosticRelatedInformation>([
		['location', Location],
		['message', $wcm.wstring],
	]);
	export const NameInfo = new $wcm.RecordType<AnalyzerInterface.NameInfo>([
		['before', Position],
		['text', $wcm.wstring],
		['after', Position],
	]);
	export const Arg = new $wcm.RecordType<AnalyzerInterface.Arg>([
		['byRef', $wcm.bool],
		['variadic', $wcm.bool],
		['name', NameInfo],
		['t', new $wcm.OptionType<string>($wcm.wstring)],
	]);
	export const MethodInfo = new $wcm.RecordType<AnalyzerInterface.MethodInfo>([
		['args', new $wcm.ListType<AnalyzerInterface.Arg>(Arg)],
		['out', new $wcm.OptionType<string>($wcm.wstring)],
		['body', Range],
	]);
	export const ParameterInfo = new $wcm.RecordType<AnalyzerInterface.ParameterInfo>([
		['t', new $wcm.OptionType<string>($wcm.wstring)],
		['v', new $wcm.OptionType<string>($wcm.wstring)],
	]);
	export const MemberKind = new $wcm.VariantType<AnalyzerInterface.MemberKind, AnalyzerInterface.MemberKind._tt, AnalyzerInterface.MemberKind._vt>([['parameter', ParameterInfo], ['property', new $wcm.OptionType<string>($wcm.wstring)], ['relationship', new $wcm.OptionType<string>($wcm.wstring)], ['foreignKey', undefined], ['index', undefined], ['projection', undefined], ['trigger', undefined], ['xData', undefined], ['storage', undefined], ['query', undefined], ['method', MethodInfo], ['classMethod', MethodInfo], ['clientMethod', MethodInfo]], AnalyzerInterface.MemberKind._ctor);
	export const MemberInfo = new $wcm.RecordType<AnalyzerInterface.MemberInfo>([
		['doc', $wcm.wstring],
		['before', Position],
		['name', NameInfo],
		['deprecated', $wcm.bool],
		['kind', MemberKind],
		['after', Position],
	]);
	export const ClassInfo = new $wcm.RecordType<AnalyzerInterface.ClassInfo>([
		['doc', $wcm.wstring],
		['name', NameInfo],
		['extends', new $wcm.ListType<string>($wcm.wstring)],
		['deprecated', $wcm.bool],
		['members', new $wcm.ListType<AnalyzerInterface.MemberInfo>(MemberInfo)],
	]);
	export const MacroInfo = new $wcm.RecordType<AnalyzerInterface.MacroInfo>([
		['name', NameInfo],
		['args', new $wcm.ListType<string>($wcm.wstring)],
	]);
	export const SubroutineInfo = new $wcm.RecordType<AnalyzerInterface.SubroutineInfo>([
		['name', NameInfo],
		['args', new $wcm.ListType<string>($wcm.wstring)],
	]);
	export const RoutineInfo = new $wcm.VariantType<AnalyzerInterface.RoutineInfo, AnalyzerInterface.RoutineInfo._tt, AnalyzerInterface.RoutineInfo._vt>([['INC', new $wcm.ListType<AnalyzerInterface.MacroInfo>(MacroInfo)], ['INT', new $wcm.ListType<AnalyzerInterface.SubroutineInfo>(SubroutineInfo)], ['MAC', new $wcm.ListType<AnalyzerInterface.SubroutineInfo>(SubroutineInfo)]], AnalyzerInterface.RoutineInfo._ctor);
	export const ParseErr = new $wcm.RecordType<AnalyzerInterface.ParseErr>([
		['range', Range],
		['message', $wcm.wstring],
	]);
	export const AnalysisErr = new $wcm.VariantType<AnalyzerInterface.AnalysisErr, AnalyzerInterface.AnalysisErr._tt, AnalyzerInterface.AnalysisErr._vt>([['P', ParseErr]], AnalyzerInterface.AnalysisErr._ctor);
	export const Completion = new $wcm.RecordType<AnalyzerInterface.Completion>([
		['classname', new $wcm.OptionType<u8>($wcm.u8)],
		['variable', new $wcm.OptionType<u8>($wcm.u8)],
		['command', new $wcm.OptionType<u8>($wcm.u8)],
	]);
	export const Diagnostic = new $wcm.RecordType<AnalyzerInterface.Diagnostic>([
		['message', $wcm.wstring],
		['range', Range],
		['relatedInformation', new $wcm.ListType<AnalyzerInterface.DiagnosticRelatedInformation>(DiagnosticRelatedInformation)],
	]);
	export const Workspace = new $wcm.ResourceType<AnalyzerInterface.Workspace>('workspace', 'iris:objectscript-analyzer/analyzer-interface/workspace');
	export const Workspace_Handle = new $wcm.ResourceHandleType('workspace');
	Workspace.addDestructor('$drop', new $wcm.DestructorType('[resource-drop]workspace', [['inst', Workspace]]));
	Workspace.addConstructor('constructor', new $wcm.ConstructorType<AnalyzerInterface.Workspace.Class['constructor']>('[constructor]workspace', [], new $wcm.OwnType(Workspace_Handle)));
	Workspace.addMethod('insertCls', new $wcm.MethodType<AnalyzerInterface.Workspace.Interface['insertCls']>('[method]workspace.insert-cls', [
		['uri', $wcm.wstring],
		['src', $wcm.wstring],
	], new $wcm.ResultType<AnalyzerInterface.ClassInfo, AnalyzerInterface.AnalysisErr>(ClassInfo, AnalysisErr, AnalyzerInterface.AnalysisErr.Error_)));
	Workspace.addMethod('insertRtn', new $wcm.MethodType<AnalyzerInterface.Workspace.Interface['insertRtn']>('[method]workspace.insert-rtn', [
		['uri', $wcm.wstring],
		['src', $wcm.wstring],
	], new $wcm.ResultType<AnalyzerInterface.RoutineInfo, AnalyzerInterface.AnalysisErr>(RoutineInfo, AnalysisErr, AnalyzerInterface.AnalysisErr.Error_)));
	Workspace.addMethod('remove', new $wcm.MethodType<AnalyzerInterface.Workspace.Interface['remove']>('[method]workspace.remove', [
		['uri', $wcm.wstring],
	], undefined));
	Workspace.addMethod('check', new $wcm.MethodType<AnalyzerInterface.Workspace.Interface['check']>('[method]workspace.check', [
		['uri', $wcm.wstring],
	], new $wcm.ListType<AnalyzerInterface.Diagnostic>(Diagnostic)));
	Workspace.addMethod('queryCls', new $wcm.MethodType<AnalyzerInterface.Workspace.Interface['queryCls']>('[method]workspace.query-cls', [
		['query', $wcm.wstring],
	], new $wcm.ListType<[string, AnalyzerInterface.ClassInfo]>(new $wcm.TupleType<[string, AnalyzerInterface.ClassInfo]>([$wcm.wstring, ClassInfo]))));
	Workspace.addMethod('queryMem', new $wcm.MethodType<AnalyzerInterface.Workspace.Interface['queryMem']>('[method]workspace.query-mem', [
		['cls', $wcm.wstring],
		['query', $wcm.wstring],
	], new $wcm.ListType<[string, AnalyzerInterface.MemberInfo]>(new $wcm.TupleType<[string, AnalyzerInterface.MemberInfo]>([$wcm.wstring, MemberInfo]))));
	export const completeClass = new $wcm.FunctionType<AnalyzerInterface.completeClass>('complete-class', [
		['prefix', $wcm.wstring],
	], new $wcm.ResultType<AnalyzerInterface.Completion, AnalyzerInterface.AnalysisErr>(Completion, AnalysisErr, AnalyzerInterface.AnalysisErr.Error_));
	export const completeMethod = new $wcm.FunctionType<AnalyzerInterface.completeMethod>('complete-method', [
		['prefix', $wcm.wstring],
	], new $wcm.ResultType<AnalyzerInterface.Completion, AnalyzerInterface.AnalysisErr>(Completion, AnalysisErr, AnalyzerInterface.AnalysisErr.Error_));
}
export namespace AnalyzerInterface._ {
	export const id = 'iris:objectscript-analyzer/analyzer-interface' as const;
	export const witName = 'analyzer-interface' as const;
	export namespace Workspace {
		export type WasmInterface = {
			'[constructor]workspace': () => i32;
			'[method]workspace.insert-cls': (self: i32, uri_ptr: i32, uri_len: i32, src_ptr: i32, src_len: i32, result: ptr<result<ClassInfo, AnalysisErr>>) => void;
			'[method]workspace.insert-rtn': (self: i32, uri_ptr: i32, uri_len: i32, src_ptr: i32, src_len: i32, result: ptr<result<RoutineInfo, AnalysisErr>>) => void;
			'[method]workspace.remove': (self: i32, uri_ptr: i32, uri_len: i32) => void;
			'[method]workspace.check': (self: i32, uri_ptr: i32, uri_len: i32, result: ptr<Diagnostic[]>) => void;
			'[method]workspace.query-cls': (self: i32, query_ptr: i32, query_len: i32, result: ptr<[string, ClassInfo][]>) => void;
			'[method]workspace.query-mem': (self: i32, cls_ptr: i32, cls_len: i32, query_ptr: i32, query_len: i32, result: ptr<[string, MemberInfo][]>) => void;
		};
		export namespace imports {
			export type WasmInterface = Workspace.WasmInterface & { '[resource-drop]workspace': (self: i32) => void };
		}
		export namespace exports {
			export type WasmInterface = Workspace.WasmInterface & { '[dtor]workspace': (self: i32) => void };
		}
	}
	export const types: Map<string, $wcm.AnyComponentModelType> = new Map<string, $wcm.AnyComponentModelType>([
		['Position', $.Position],
		['Range', $.Range],
		['Location', $.Location],
		['DiagnosticRelatedInformation', $.DiagnosticRelatedInformation],
		['NameInfo', $.NameInfo],
		['Arg', $.Arg],
		['MethodInfo', $.MethodInfo],
		['ParameterInfo', $.ParameterInfo],
		['MemberKind', $.MemberKind],
		['MemberInfo', $.MemberInfo],
		['ClassInfo', $.ClassInfo],
		['MacroInfo', $.MacroInfo],
		['SubroutineInfo', $.SubroutineInfo],
		['RoutineInfo', $.RoutineInfo],
		['ParseErr', $.ParseErr],
		['AnalysisErr', $.AnalysisErr],
		['Completion', $.Completion],
		['Diagnostic', $.Diagnostic],
		['Workspace', $.Workspace]
	]);
	export const functions: Map<string, $wcm.FunctionType> = new Map([
		['completeClass', $.completeClass],
		['completeMethod', $.completeMethod]
	]);
	export const resources: Map<string, $wcm.ResourceType> = new Map<string, $wcm.ResourceType>([
		['Workspace', $.Workspace]
	]);
	export type WasmInterface = {
		'complete-class': (prefix_ptr: i32, prefix_len: i32, result: ptr<result<Completion, AnalysisErr>>) => void;
		'complete-method': (prefix_ptr: i32, prefix_len: i32, result: ptr<result<Completion, AnalysisErr>>) => void;
	};
	export namespace imports {
		export type WasmInterface = _.WasmInterface & Workspace.imports.WasmInterface;
	}
	export namespace exports {
		export type WasmInterface = _.WasmInterface & Workspace.exports.WasmInterface;
		export namespace imports {
			export type WasmInterface = {
				'[resource-new]workspace': (rep: i32) => i32;
				'[resource-rep]workspace': (handle: i32) => i32;
				'[resource-drop]workspace': (handle: i32) => void;
			};
		}
	}
}
export namespace analyzer.$ {
}
export namespace analyzer._ {
	type Completion = AnalyzerInterface.Completion;
	type AnalysisErr = AnalyzerInterface.AnalysisErr;
	type ClassInfo = AnalyzerInterface.ClassInfo;
	type MemberInfo = AnalyzerInterface.MemberInfo;
	type RoutineInfo = AnalyzerInterface.RoutineInfo;
	type Diagnostic = AnalyzerInterface.Diagnostic;
	export const id = 'iris:objectscript-analyzer/analyzer' as const;
	export const witName = 'analyzer' as const;
	export namespace imports {
		export function create(service: analyzer.Imports, context: $wcm.WasmContext): Imports {
			return $wcm.$imports.create<Imports>(_, service, context);
		}
		export function loop(service: analyzer.Imports, context: $wcm.WasmContext): analyzer.Imports {
			return $wcm.$imports.loop<analyzer.Imports>(_, service, context);
		}
	}
	export type Imports = {
		'[export]iris:objectscript-analyzer/analyzer-interface': AnalyzerInterface._.exports.imports.WasmInterface;
	};
	export namespace exports {
		export const interfaces: Map<string, $wcm.InterfaceType> = new Map<string, $wcm.InterfaceType>([
			['AnalyzerInterface', AnalyzerInterface._]
		]);
		export function bind(exports: Exports, context: $wcm.WasmContext): analyzer.Exports {
			return $wcm.$exports.bind<analyzer.Exports>(_, exports, context);
		}
	}
	export type Exports = {
		'iris:objectscript-analyzer/analyzer-interface#complete-class': (prefix_ptr: i32, prefix_len: i32, result: ptr<result<Completion, AnalysisErr>>) => void;
		'iris:objectscript-analyzer/analyzer-interface#complete-method': (prefix_ptr: i32, prefix_len: i32, result: ptr<result<Completion, AnalysisErr>>) => void;
		'iris:objectscript-analyzer/analyzer-interface#[constructor]workspace': () => i32;
		'iris:objectscript-analyzer/analyzer-interface#[method]workspace.insert-cls': (self: i32, uri_ptr: i32, uri_len: i32, src_ptr: i32, src_len: i32, result: ptr<result<ClassInfo, AnalysisErr>>) => void;
		'iris:objectscript-analyzer/analyzer-interface#[method]workspace.insert-rtn': (self: i32, uri_ptr: i32, uri_len: i32, src_ptr: i32, src_len: i32, result: ptr<result<RoutineInfo, AnalysisErr>>) => void;
		'iris:objectscript-analyzer/analyzer-interface#[method]workspace.remove': (self: i32, uri_ptr: i32, uri_len: i32) => void;
		'iris:objectscript-analyzer/analyzer-interface#[method]workspace.check': (self: i32, uri_ptr: i32, uri_len: i32, result: ptr<Diagnostic[]>) => void;
		'iris:objectscript-analyzer/analyzer-interface#[method]workspace.query-cls': (self: i32, query_ptr: i32, query_len: i32, result: ptr<[string, ClassInfo][]>) => void;
		'iris:objectscript-analyzer/analyzer-interface#[method]workspace.query-mem': (self: i32, cls_ptr: i32, cls_len: i32, query_ptr: i32, query_len: i32, result: ptr<[string, MemberInfo][]>) => void;
	};
	export function bind(service: analyzer.Imports, code: $wcm.Code, context?: $wcm.ComponentModelContext): Promise<analyzer.Exports>;
	export function bind(service: analyzer.Imports.Promisified, code: $wcm.Code, port: $wcm.RAL.ConnectionPort, context?: $wcm.ComponentModelContext): Promise<analyzer.Exports.Promisified>;
	export function bind(service: analyzer.Imports | analyzer.Imports.Promisified, code: $wcm.Code, portOrContext?: $wcm.RAL.ConnectionPort | $wcm.ComponentModelContext, context?: $wcm.ComponentModelContext | undefined): Promise<analyzer.Exports> | Promise<analyzer.Exports.Promisified> {
		return $wcm.$main.bind(_, service, code, portOrContext, context);
	}
}