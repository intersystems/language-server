import { Memory, WasmContext } from "@vscode/wasm-component-model";
import * as fs from "fs";
import * as path from "path";
import { analyzer } from "./bind";
import { Diagnostic, DiagnosticSeverity, Range } from "vscode-languageserver";

const filename = path.resolve(__dirname, "../lib/analyzer.wasm");

async function loadAnalyzer() {
	const bits = fs.readFileSync(filename);
	const module = await WebAssembly.compile(bits);

	// The context for the WASM module
	const wasmContext: WasmContext.Default = new WasmContext.Default();

	// Instantiate the module
	const instance = await WebAssembly.instantiate(module, {});
	// Bind the WASM memory to the context
	wasmContext.initialize(new Memory.Default(instance.exports));

	// Bind the TypeScript Api
	return analyzer._.exports.bind(instance.exports as analyzer._.Exports, wasmContext);
}

export type Arg = analyzer.Arg;
export type MethodInfo = analyzer.MethodInfo;
export type ParameterInfo = analyzer.ParameterInfo;
export type MemberKind = analyzer.MemberKind;
export type MemberInfo = analyzer.MemberInfo;
export type ClassInfo = analyzer.ClassInfo;
export type AnalysisErr = analyzer.AnalysisErr;

const wasm = loadAnalyzer();

export type AnalyzeResult = ClassInfo | { error: Diagnostic[] };

export async function analyzeCls(path: string, src: string): Promise<AnalyzeResult> {
	try {
		return (await wasm).analyzeCls(path, src);
	} catch (rawError) {
		const error = rawError["cause"]["_value"] as analyzer.ParseErr;
		const range = Range.create(
			error.range.lft.line,
			error.range.lft.character,
			error.range.rht.line,
			error.range.rht.character,
		);
		const message = error.message;
		return {
			error: [
				{
					severity: DiagnosticSeverity.Information,
					range,
					message,
					source: "InterSystems Language Server",
				},
			],
		};
	}
}

export async function completeMethod(path: string, src: string) {
	try {
		return (await wasm).completeMethod(path, src);
	} catch (rawError) {
		console.log(rawError);
		return undefined;
	}
}

export async function completeClass(path: string, src: string) {
	try {
		return (await wasm).completeClass(path, src);
	} catch (rawError) {
		console.log(rawError);
		return undefined;
	}
}
