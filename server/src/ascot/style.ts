import type { Style } from "@intersystems-community/ascot";
import { connection } from "../utils/variables";

const SECTION = "intersystems.language-server.ascot.style";

// The settings as VS Code holds them: every choice has an `either` that leaves the rule unchecked,
// since the settings UI can't show a three-state boolean or an unset enum, and a limit of 0 is none.
type Choice<T extends string> = "either" | T;
type Settings = {
	command?: {
		form?: Choice<"long" | "short">;
		case?: Choice<"lower" | "upper" | "pascal">;
		postcondition?: Choice<"allowed" | "keyword-only">;
		formForEachCommand?: Record<string, string>;
		caseForEachCommand?: Record<string, string>;
		postconditionForEachCommand?: Record<string, string>;
	};
	function?: {
		form?: Choice<"long" | "short">;
		case?: Choice<"lower" | "upper" | "pascal">;
		formForEachFunction?: Record<string, string>;
		caseForEachFunction?: Record<string, string>;
	};
	conditionAnd?: Choice<"comma" | "double-ampersand">;
	quitForReturn?: Choice<"allowed" | "return-only">;
	spaceAfterComma?: Choice<"after" | "none">;
	maxCommandsPerLine?: number;
	maxNewPerBlock?: number;
	openBrace?: { newlineBefore?: Choice<"required" | "forbidden">; newlineAfter?: Choice<"required" | "forbidden"> };
	closeBrace?: { newlineBefore?: Choice<"required" | "forbidden">; newlineAfter?: Choice<"required" | "forbidden"> };
};

/** The style rules a folder's settings ask for, as ascot's `Style`; `undefined` when they ask for nothing. */
export async function styleOf(folder: string): Promise<Style | undefined> {
	const s: Settings | null = await connection.workspace.getConfiguration({ scopeUri: folder, section: SECTION });
	if (!s) return undefined;
	const choice = <T extends string>(v: Choice<T> | undefined): T | undefined => (v === "either" ? undefined : v);
	const yes = (v: string | undefined, when: string): boolean | undefined =>
		v === "either" || v === undefined ? undefined : v === when;
	const limit = (v: number | undefined): number | undefined => (v ? v : undefined);
	const style: Record<string, unknown> = {};
	const put = (key: string, value: unknown) => {
		if (value !== undefined) style[key] = value;
	};
	const group = (fields: Record<string, unknown>) => {
		const kept = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
		return Object.keys(kept).length ? kept : undefined;
	};
	put(
		"command",
		group({
			form: choice(s.command?.form),
			case: choice(s.command?.case),
			allowPostconditionOnArgument: yes(s.command?.postcondition, "allowed"),
		}),
	);
	put("function", group({ form: choice(s.function?.form), case: choice(s.function?.case) }));
	put("conditionAnd", choice(s.conditionAnd));
	put("allowQuitForReturn", yes(s.quitForReturn, "allowed"));
	put("spaceAfterComma", yes(s.spaceAfterComma, "after"));
	put("maxCommandsPerLine", limit(s.maxCommandsPerLine));
	put("maxNewPerBlock", limit(s.maxNewPerBlock));
	put(
		"openBrace",
		group({
			newlineBefore: yes(s.openBrace?.newlineBefore, "required"),
			newlineAfter: yes(s.openBrace?.newlineAfter, "required"),
		}),
	);
	put(
		"closeBrace",
		group({
			newlineBefore: yes(s.closeBrace?.newlineBefore, "required"),
			newlineAfter: yes(s.closeBrace?.newlineAfter, "required"),
		}),
	);
	// The per-command and per-function tables, one per field in the settings UI, become ascot's
	// `commandDo`, `functionZwrite`, ... records.
	const perName = (
		prefix: string,
		tables: Record<string, [Record<string, string> | undefined, (v: string) => unknown]>,
	) => {
		for (const [field, [table, convert]] of Object.entries(tables)) {
			for (const [name, value] of Object.entries(table ?? {})) {
				const key = prefix + name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
				style[key] = { ...(style[key] as object | undefined), [field]: convert(value) };
			}
		}
	};
	const same = (v: string) => v;
	perName("command", {
		form: [s.command?.formForEachCommand, same],
		case: [s.command?.caseForEachCommand, same],
		allowPostconditionOnArgument: [s.command?.postconditionForEachCommand, (v) => v === "allowed"],
	});
	perName("function", { form: [s.function?.formForEachFunction, same], case: [s.function?.caseForEachFunction, same] });
	return Object.keys(style).length ? (style as Style) : undefined;
}
