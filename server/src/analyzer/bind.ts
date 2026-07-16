/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as $wcm from '@vscode/wasm-component-model';
import type { u32, u8, i32, ptr, result } from '@vscode/wasm-component-model';

export namespace Common {
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
		content: string;
		after: Position;
	};

	export enum ArgMode {
		default = 'default',
		output = 'output',
		byRef = 'byRef'
	}

	export type NormalArg = {
		mode: ArgMode;
		name: string;
		t?: string | undefined;
		default?: string | undefined;
	};

	export type VariadicArg = {
		name: string;
		t?: string | undefined;
	};

	export type MethodInfo = {
		normal: NormalArg[];
		variadic?: VariadicArg | undefined;
		t?: string | undefined;
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

	export enum DiagnosticSeverity {
		error = 'error',
		warning = 'warning',
		information = 'information',
		hint = 'hint'
	}

	export type Diagnostic = {
		message: string;
		range: Range;
		relatedInformation: DiagnosticRelatedInformation[];
		severity: DiagnosticSeverity;
	};

	export type InlayHint = {
		position: Position;
		label: string;
		paddingLeft: boolean;
		paddingRight: boolean;
	};
}
export type Common = {
};

export namespace Imported {
	export type MemberInfo = Common.MemberInfo;

	export namespace IrisConnection {
		export interface Interface extends $wcm.Resource {
			getMem(cls: string, mem: string): [string, MemberInfo] | undefined;
		}
		export type Statics = {
		};
		export type Class = Statics & {
		};
	}
	export type IrisConnection = IrisConnection.Interface;
}
export type Imported = {
	IrisConnection: Imported.IrisConnection.Class;
};

export namespace Exported {
	export type ClassInfo = Common.ClassInfo;

	export type MemberInfo = Common.MemberInfo;

	export type RoutineInfo = Common.RoutineInfo;
	export const RoutineInfo = Common.RoutineInfo;

	export type Completion = Common.Completion;

	export type AnalysisErr = Common.AnalysisErr;
	export const AnalysisErr = Common.AnalysisErr;

	export type Diagnostic = Common.Diagnostic;

	export type InlayHint = Common.InlayHint;

	export type Range = Common.Range;

	export type IrisConnection = Imported.IrisConnection;

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

			inlayHint(uri: string, range: Range): InlayHint[];

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
			$new?(env: IrisConnection | undefined): Interface;
		};
		export type Class = Statics & {
			new(env: IrisConnection | undefined): Interface;
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
export type Exported = {
	Workspace: Exported.Workspace.Class;
	completeClass: Exported.completeClass;
	completeMethod: Exported.completeMethod;
};
export namespace analyzer {
	export type Imports = {
		imported: Imported;
	};
	export namespace Imports {
		export type Promisified = $wcm.$imports.Promisify<Imports>;
	}
	export namespace imports {
		export type Promisify<T> = $wcm.$imports.Promisify<T>;
	}
	export type Exports = {
		exported: Exported;
	};
	export namespace Exports {
		export type Promisified = $wcm.$exports.Promisify<Exports>;
	}
	export namespace exports {
		export type Promisify<T> = $wcm.$exports.Promisify<T>;
	}
}

export namespace Common.$ {
	export const Position = new $wcm.RecordType<Common.Position>([
		['line', $wcm.u32],
		['character', $wcm.u32],
	]);
	export const Range = new $wcm.RecordType<Common.Range>([
		['start', Position],
		['end', Position],
	]);
	export const Location = new $wcm.RecordType<Common.Location>([
		['uri', $wcm.wstring],
		['range', Range],
	]);
	export const DiagnosticRelatedInformation = new $wcm.RecordType<Common.DiagnosticRelatedInformation>([
		['location', Location],
		['message', $wcm.wstring],
	]);
	export const NameInfo = new $wcm.RecordType<Common.NameInfo>([
		['before', Position],
		['content', $wcm.wstring],
		['after', Position],
	]);
	export const ArgMode = new $wcm.EnumType<Common.ArgMode>(['default', 'output', 'byRef']);
	export const NormalArg = new $wcm.RecordType<Common.NormalArg>([
		['mode', ArgMode],
		['name', $wcm.wstring],
		['t', new $wcm.OptionType<string>($wcm.wstring)],
		['default', new $wcm.OptionType<string>($wcm.wstring)],
	]);
	export const VariadicArg = new $wcm.RecordType<Common.VariadicArg>([
		['name', $wcm.wstring],
		['t', new $wcm.OptionType<string>($wcm.wstring)],
	]);
	export const MethodInfo = new $wcm.RecordType<Common.MethodInfo>([
		['normal', new $wcm.ListType<Common.NormalArg>(NormalArg)],
		['variadic', new $wcm.OptionType<Common.VariadicArg>(VariadicArg)],
		['t', new $wcm.OptionType<string>($wcm.wstring)],
		['body', Range],
	]);
	export const ParameterInfo = new $wcm.RecordType<Common.ParameterInfo>([
		['t', new $wcm.OptionType<string>($wcm.wstring)],
		['v', new $wcm.OptionType<string>($wcm.wstring)],
	]);
	export const MemberKind = new $wcm.VariantType<Common.MemberKind, Common.MemberKind._tt, Common.MemberKind._vt>([['parameter', ParameterInfo], ['property', new $wcm.OptionType<string>($wcm.wstring)], ['relationship', new $wcm.OptionType<string>($wcm.wstring)], ['foreignKey', undefined], ['index', undefined], ['projection', undefined], ['trigger', undefined], ['xData', undefined], ['storage', undefined], ['query', undefined], ['method', MethodInfo], ['classMethod', MethodInfo], ['clientMethod', MethodInfo]], Common.MemberKind._ctor);
	export const MemberInfo = new $wcm.RecordType<Common.MemberInfo>([
		['doc', $wcm.wstring],
		['before', Position],
		['name', NameInfo],
		['deprecated', $wcm.bool],
		['kind', MemberKind],
		['after', Position],
	]);
	export const ClassInfo = new $wcm.RecordType<Common.ClassInfo>([
		['doc', $wcm.wstring],
		['name', NameInfo],
		['extends', new $wcm.ListType<string>($wcm.wstring)],
		['deprecated', $wcm.bool],
		['members', new $wcm.ListType<Common.MemberInfo>(MemberInfo)],
	]);
	export const MacroInfo = new $wcm.RecordType<Common.MacroInfo>([
		['name', NameInfo],
		['args', new $wcm.ListType<string>($wcm.wstring)],
	]);
	export const SubroutineInfo = new $wcm.RecordType<Common.SubroutineInfo>([
		['name', NameInfo],
		['args', new $wcm.ListType<string>($wcm.wstring)],
	]);
	export const RoutineInfo = new $wcm.VariantType<Common.RoutineInfo, Common.RoutineInfo._tt, Common.RoutineInfo._vt>([['INC', new $wcm.ListType<Common.MacroInfo>(MacroInfo)], ['INT', new $wcm.ListType<Common.SubroutineInfo>(SubroutineInfo)], ['MAC', new $wcm.ListType<Common.SubroutineInfo>(SubroutineInfo)]], Common.RoutineInfo._ctor);
	export const ParseErr = new $wcm.RecordType<Common.ParseErr>([
		['range', Range],
		['message', $wcm.wstring],
	]);
	export const AnalysisErr = new $wcm.VariantType<Common.AnalysisErr, Common.AnalysisErr._tt, Common.AnalysisErr._vt>([['P', ParseErr]], Common.AnalysisErr._ctor);
	export const Completion = new $wcm.RecordType<Common.Completion>([
		['classname', new $wcm.OptionType<u8>($wcm.u8)],
		['variable', new $wcm.OptionType<u8>($wcm.u8)],
		['command', new $wcm.OptionType<u8>($wcm.u8)],
	]);
	export const DiagnosticSeverity = new $wcm.EnumType<Common.DiagnosticSeverity>(['error', 'warning', 'information', 'hint']);
	export const Diagnostic = new $wcm.RecordType<Common.Diagnostic>([
		['message', $wcm.wstring],
		['range', Range],
		['relatedInformation', new $wcm.ListType<Common.DiagnosticRelatedInformation>(DiagnosticRelatedInformation)],
		['severity', DiagnosticSeverity],
	]);
	export const InlayHint = new $wcm.RecordType<Common.InlayHint>([
		['position', Position],
		['label', $wcm.wstring],
		['paddingLeft', $wcm.bool],
		['paddingRight', $wcm.bool],
	]);
}
export namespace Common._ {
	export const id = 'iris:objectscript-analyzer/common' as const;
	export const witName = 'common' as const;
	export const types: Map<string, $wcm.AnyComponentModelType> = new Map<string, $wcm.AnyComponentModelType>([
		['Position', $.Position],
		['Range', $.Range],
		['Location', $.Location],
		['DiagnosticRelatedInformation', $.DiagnosticRelatedInformation],
		['NameInfo', $.NameInfo],
		['ArgMode', $.ArgMode],
		['NormalArg', $.NormalArg],
		['VariadicArg', $.VariadicArg],
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
		['DiagnosticSeverity', $.DiagnosticSeverity],
		['Diagnostic', $.Diagnostic],
		['InlayHint', $.InlayHint]
	]);
	export type WasmInterface = {
	};
}

export namespace Imported.$ {
	export const MemberInfo = Common.$.MemberInfo;
	export const IrisConnection = new $wcm.ResourceType<Imported.IrisConnection>('iris-connection', 'iris:objectscript-analyzer/imported/iris-connection');
	export const IrisConnection_Handle = new $wcm.ResourceHandleType('iris-connection');
	IrisConnection.addDestructor('$drop', new $wcm.DestructorType('[resource-drop]iris-connection', [['inst', IrisConnection]]));
	IrisConnection.addMethod('getMem', new $wcm.MethodType<Imported.IrisConnection.Interface['getMem']>('[method]iris-connection.get-mem', [
		['cls', $wcm.wstring],
		['mem', $wcm.wstring],
	], new $wcm.OptionType<[string, Imported.MemberInfo]>(new $wcm.TupleType<[string, Imported.MemberInfo]>([$wcm.wstring, MemberInfo]))));
}
export namespace Imported._ {
	export const id = 'iris:objectscript-analyzer/imported' as const;
	export const witName = 'imported' as const;
	export namespace IrisConnection {
		export type WasmInterface = {
			'[method]iris-connection.get-mem': (self: i32, cls_ptr: i32, cls_len: i32, mem_ptr: i32, mem_len: i32, result: ptr<[string, MemberInfo] | undefined>) => void;
		};
		export namespace imports {
			export type WasmInterface = IrisConnection.WasmInterface & { '[resource-drop]iris-connection': (self: i32) => void };
		}
		export namespace exports {
			export type WasmInterface = IrisConnection.WasmInterface & { '[dtor]iris-connection': (self: i32) => void };
		}
	}
	export const types: Map<string, $wcm.AnyComponentModelType> = new Map<string, $wcm.AnyComponentModelType>([
		['MemberInfo', $.MemberInfo],
		['IrisConnection', $.IrisConnection]
	]);
	export const resources: Map<string, $wcm.ResourceType> = new Map<string, $wcm.ResourceType>([
		['IrisConnection', $.IrisConnection]
	]);
	export type WasmInterface = {
	};
	export namespace imports {
		export type WasmInterface = _.WasmInterface & IrisConnection.imports.WasmInterface;
	}
	export namespace exports {
		export type WasmInterface = _.WasmInterface & IrisConnection.exports.WasmInterface;
		export namespace imports {
			export type WasmInterface = {
				'[resource-new]iris-connection': (rep: i32) => i32;
				'[resource-rep]iris-connection': (handle: i32) => i32;
				'[resource-drop]iris-connection': (handle: i32) => void;
			};
		}
	}
}

export namespace Exported.$ {
	export const ClassInfo = Common.$.ClassInfo;
	export const MemberInfo = Common.$.MemberInfo;
	export const RoutineInfo = Common.$.RoutineInfo;
	export const Completion = Common.$.Completion;
	export const AnalysisErr = Common.$.AnalysisErr;
	export const Diagnostic = Common.$.Diagnostic;
	export const InlayHint = Common.$.InlayHint;
	export const Range = Common.$.Range;
	export const IrisConnection = Imported.$.IrisConnection;
	export const Workspace = new $wcm.ResourceType<Exported.Workspace>('workspace', 'iris:objectscript-analyzer/exported/workspace');
	export const Workspace_Handle = new $wcm.ResourceHandleType('workspace');
	Workspace.addDestructor('$drop', new $wcm.DestructorType('[resource-drop]workspace', [['inst', Workspace]]));
	Workspace.addConstructor('constructor', new $wcm.ConstructorType<Exported.Workspace.Class['constructor']>('[constructor]workspace', [
		['env', new $wcm.OptionType<Exported.IrisConnection>(new $wcm.OwnType<Exported.IrisConnection>(IrisConnection))],
	], new $wcm.OwnType(Workspace_Handle)));
	Workspace.addMethod('insertCls', new $wcm.MethodType<Exported.Workspace.Interface['insertCls']>('[method]workspace.insert-cls', [
		['uri', $wcm.wstring],
		['src', $wcm.wstring],
	], new $wcm.ResultType<Exported.ClassInfo, Exported.AnalysisErr>(ClassInfo, AnalysisErr, Common.AnalysisErr.Error_)));
	Workspace.addMethod('insertRtn', new $wcm.MethodType<Exported.Workspace.Interface['insertRtn']>('[method]workspace.insert-rtn', [
		['uri', $wcm.wstring],
		['src', $wcm.wstring],
	], new $wcm.ResultType<Exported.RoutineInfo, Exported.AnalysisErr>(RoutineInfo, AnalysisErr, Common.AnalysisErr.Error_)));
	Workspace.addMethod('remove', new $wcm.MethodType<Exported.Workspace.Interface['remove']>('[method]workspace.remove', [
		['uri', $wcm.wstring],
	], undefined));
	Workspace.addMethod('check', new $wcm.MethodType<Exported.Workspace.Interface['check']>('[method]workspace.check', [
		['uri', $wcm.wstring],
	], new $wcm.ListType<Exported.Diagnostic>(Diagnostic)));
	Workspace.addMethod('inlayHint', new $wcm.MethodType<Exported.Workspace.Interface['inlayHint']>('[method]workspace.inlay-hint', [
		['uri', $wcm.wstring],
		['range', Range],
	], new $wcm.ListType<Exported.InlayHint>(InlayHint)));
	Workspace.addMethod('queryCls', new $wcm.MethodType<Exported.Workspace.Interface['queryCls']>('[method]workspace.query-cls', [
		['query', $wcm.wstring],
	], new $wcm.ListType<[string, Exported.ClassInfo]>(new $wcm.TupleType<[string, Exported.ClassInfo]>([$wcm.wstring, ClassInfo]))));
	Workspace.addMethod('queryMem', new $wcm.MethodType<Exported.Workspace.Interface['queryMem']>('[method]workspace.query-mem', [
		['cls', $wcm.wstring],
		['query', $wcm.wstring],
	], new $wcm.ListType<[string, Exported.MemberInfo]>(new $wcm.TupleType<[string, Exported.MemberInfo]>([$wcm.wstring, MemberInfo]))));
	export const completeClass = new $wcm.FunctionType<Exported.completeClass>('complete-class', [
		['prefix', $wcm.wstring],
	], new $wcm.ResultType<Exported.Completion, Exported.AnalysisErr>(Completion, AnalysisErr, Common.AnalysisErr.Error_));
	export const completeMethod = new $wcm.FunctionType<Exported.completeMethod>('complete-method', [
		['prefix', $wcm.wstring],
	], new $wcm.ResultType<Exported.Completion, Exported.AnalysisErr>(Completion, AnalysisErr, Common.AnalysisErr.Error_));
}
export namespace Exported._ {
	export const id = 'iris:objectscript-analyzer/exported' as const;
	export const witName = 'exported' as const;
	export namespace Workspace {
		export type WasmInterface = {
			'[constructor]workspace': (env_case: i32, env_option: i32) => i32;
			'[method]workspace.insert-cls': (self: i32, uri_ptr: i32, uri_len: i32, src_ptr: i32, src_len: i32, result: ptr<result<ClassInfo, AnalysisErr>>) => void;
			'[method]workspace.insert-rtn': (self: i32, uri_ptr: i32, uri_len: i32, src_ptr: i32, src_len: i32, result: ptr<result<RoutineInfo, AnalysisErr>>) => void;
			'[method]workspace.remove': (self: i32, uri_ptr: i32, uri_len: i32) => void;
			'[method]workspace.check': (self: i32, uri_ptr: i32, uri_len: i32, result: ptr<Diagnostic[]>) => void;
			'[method]workspace.inlay-hint': (self: i32, uri_ptr: i32, uri_len: i32, range_Range_start_line: i32, range_Range_start_character: i32, range_Range_end_line: i32, range_Range_end_character: i32, result: ptr<InlayHint[]>) => void;
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
		['ClassInfo', $.ClassInfo],
		['MemberInfo', $.MemberInfo],
		['RoutineInfo', $.RoutineInfo],
		['Completion', $.Completion],
		['AnalysisErr', $.AnalysisErr],
		['Diagnostic', $.Diagnostic],
		['InlayHint', $.InlayHint],
		['Range', $.Range],
		['IrisConnection', $.IrisConnection],
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
	type Completion = Common.Completion;
	type AnalysisErr = Common.AnalysisErr;
	type ClassInfo = Common.ClassInfo;
	type MemberInfo = Common.MemberInfo;
	type RoutineInfo = Common.RoutineInfo;
	type Diagnostic = Common.Diagnostic;
	type InlayHint = Common.InlayHint;
	export const id = 'iris:objectscript-analyzer/analyzer' as const;
	export const witName = 'analyzer' as const;
	export namespace imports {
		export const interfaces: Map<string, $wcm.InterfaceType> = new Map<string, $wcm.InterfaceType>([
			['Common', Common._],
			['Imported', Imported._]
		]);
		export function create(service: analyzer.Imports, context: $wcm.WasmContext): Imports {
			return $wcm.$imports.create<Imports>(_, service, context);
		}
		export function loop(service: analyzer.Imports, context: $wcm.WasmContext): analyzer.Imports {
			return $wcm.$imports.loop<analyzer.Imports>(_, service, context);
		}
	}
	export type Imports = {
		'iris:objectscript-analyzer/imported': Imported._.imports.WasmInterface;
		'[export]iris:objectscript-analyzer/exported': Exported._.exports.imports.WasmInterface;
	};
	export namespace exports {
		export const interfaces: Map<string, $wcm.InterfaceType> = new Map<string, $wcm.InterfaceType>([
			['Exported', Exported._]
		]);
		export function bind(exports: Exports, context: $wcm.WasmContext): analyzer.Exports {
			return $wcm.$exports.bind<analyzer.Exports>(_, exports, context);
		}
	}
	export type Exports = {
		'iris:objectscript-analyzer/exported#complete-class': (prefix_ptr: i32, prefix_len: i32, result: ptr<result<Completion, AnalysisErr>>) => void;
		'iris:objectscript-analyzer/exported#complete-method': (prefix_ptr: i32, prefix_len: i32, result: ptr<result<Completion, AnalysisErr>>) => void;
		'iris:objectscript-analyzer/exported#[constructor]workspace': (env_case: i32, env_option: i32) => i32;
		'iris:objectscript-analyzer/exported#[method]workspace.insert-cls': (self: i32, uri_ptr: i32, uri_len: i32, src_ptr: i32, src_len: i32, result: ptr<result<ClassInfo, AnalysisErr>>) => void;
		'iris:objectscript-analyzer/exported#[method]workspace.insert-rtn': (self: i32, uri_ptr: i32, uri_len: i32, src_ptr: i32, src_len: i32, result: ptr<result<RoutineInfo, AnalysisErr>>) => void;
		'iris:objectscript-analyzer/exported#[method]workspace.remove': (self: i32, uri_ptr: i32, uri_len: i32) => void;
		'iris:objectscript-analyzer/exported#[method]workspace.check': (self: i32, uri_ptr: i32, uri_len: i32, result: ptr<Diagnostic[]>) => void;
		'iris:objectscript-analyzer/exported#[method]workspace.inlay-hint': (self: i32, uri_ptr: i32, uri_len: i32, range_Range_start_line: i32, range_Range_start_character: i32, range_Range_end_line: i32, range_Range_end_character: i32, result: ptr<InlayHint[]>) => void;
		'iris:objectscript-analyzer/exported#[method]workspace.query-cls': (self: i32, query_ptr: i32, query_len: i32, result: ptr<[string, ClassInfo][]>) => void;
		'iris:objectscript-analyzer/exported#[method]workspace.query-mem': (self: i32, cls_ptr: i32, cls_len: i32, query_ptr: i32, query_len: i32, result: ptr<[string, MemberInfo][]>) => void;
	};
	export function bind(service: analyzer.Imports, code: $wcm.Code, context?: $wcm.ComponentModelContext): Promise<analyzer.Exports>;
	export function bind(service: analyzer.Imports.Promisified, code: $wcm.Code, port: $wcm.RAL.ConnectionPort, context?: $wcm.ComponentModelContext): Promise<analyzer.Exports.Promisified>;
	export function bind(service: analyzer.Imports | analyzer.Imports.Promisified, code: $wcm.Code, portOrContext?: $wcm.RAL.ConnectionPort | $wcm.ComponentModelContext, context?: $wcm.ComponentModelContext | undefined): Promise<analyzer.Exports> | Promise<analyzer.Exports.Promisified> {
		return $wcm.$main.bind(_, service, code, portOrContext, context);
	}
}