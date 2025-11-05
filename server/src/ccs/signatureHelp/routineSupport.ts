import { MarkupContent, MarkupKind, ParameterInformation, Position, Range, SignatureInformation } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { createDefinitionUri, getTextForUri, makeRESTRequest } from '../../utils/functions';
import { ServerSpec, compressedline } from '../../utils/types';

/** Remove anything following the first semicolon in a routine line. */
function stripRoutineComment(line: string): string {
        const commentIdx = line.indexOf(';');
        return commentIdx === -1 ? line : line.slice(0, commentIdx);
}

/** Split a routine parameter list into individual parameters. */
function splitRoutineParams(paramStr: string): string[] {
        const normalized = paramStr.replace(/\r?\n/g, ' ');
        if (normalized.trim() === '') {
                return [];
        }
        const result: string[] = [];
        let current = '';
        let inQuote = false;
        let parenDepth = 0;
        for (let i = 0; i < normalized.length; i++) {
                const char = normalized.charAt(i);
                if (char === '"' && normalized.charAt(i - 1) !== '\\') {
                        inQuote = !inQuote;
                        current += char;
                        continue;
                }
                if (!inQuote) {
                        if (char === '(') {
                                parenDepth++;
                                current += char;
                                continue;
                        }
                        if (char === ')' && parenDepth > 0) {
                                parenDepth--;
                                current += char;
                                continue;
                        }
                        if (char === ',' && parenDepth === 0) {
                                result.push(current.trim());
                                current = '';
                                continue;
                        }
                }
                current += char;
        }
        const finalParam = current.trim();
        if (finalParam.length) {
                result.push(finalParam);
        }
        return result.filter((param) => param.length > 0);
}

type RoutineCallContext = {
        label: string;
        routine: string;
};

function extractRoutineCall(callPrefix: string): RoutineCallContext | null {
        const prefix = callPrefix.trimEnd();

        const extrinsicMatch = prefix.match(/\$\$([%A-Za-z][\w%]*)(?:\s*\^\s*([%A-Za-z][\w%]*))?$/);
        if (extrinsicMatch) {
                return {
                        label: extrinsicMatch[1],
                        routine: extrinsicMatch[2] ?? ''
                };
        }

        const doLabelMatch = prefix.match(/\b[Dd][Oo]\b\s+([%A-Za-z][\w%]*)(?:\s*\^\s*([%A-Za-z][\w%]*))?$/);
        if (doLabelMatch) {
                return {
                        label: doLabelMatch[1],
                        routine: doLabelMatch[2] ?? ''
                };
        }

        const doRoutineMatch = prefix.match(/\b[Dd][Oo]\b\s*\^\s*([%A-Za-z][\w%]*)$/);
        if (doRoutineMatch) {
                return {
                        label: doRoutineMatch[1],
                        routine: doRoutineMatch[1]
                };
        }

        return null;
}

/** Build the ParameterInformation array for a routine signature label. */
export function routineParameterInfos(signatureLabel: string, params: string[]): ParameterInformation[] {
        if (params.length === 0) {
                return [];
        }
        const result: ParameterInformation[] = [];
        let currentPos = signatureLabel.indexOf('(') + 1;
        params.forEach((param, idx) => {
                const trimmed = param.trim();
                const start = currentPos;
                const end = start + trimmed.length;
                result.push(ParameterInformation.create([start, end]));
                currentPos = end;
                if (idx < params.length - 1) {
                        currentPos += 2; // Account for the comma and following space
                }
        });
        return result;
}

/** Returns the [start,end] tuples for all parameters in a formal spec string. */
export function formalSpecToParamsArr(formalSpec: string): ParameterInformation[] {
        const result: ParameterInformation[] = [];
        if (formalSpec.replace(/\s+/g, "") === "()") {
                return result;
        }
        let currentParamStart = 1;
        let openParenCount = 0;
        let openBraceCount = 0;
        let inQuote = false;
        Array.from(formalSpec).forEach((char: string, idx: number) => {
                switch (char) {
                        case "{":
                                if (!inQuote) {
                                        openBraceCount++;
                                }
                                break;
                        case "}":
                                if (!inQuote) {
                                        openBraceCount--;
                                }
                                break;
                        case "(":
                                if (!inQuote) {
                                        openParenCount++;
                                }
                                break;
                        case ")":
                                if (!inQuote) {
                                        openParenCount--;
                                }
                                break;
                        case "\"":
                                inQuote = !inQuote;
                                break;
                        case ",":
                                if (!inQuote && !openBraceCount && openParenCount === 1) {
                                        result.push(ParameterInformation.create([currentParamStart, idx]));
                                        currentParamStart = idx + 1;
                                }
                                break;
                        default:
                                break;
                }
        });
        result.push(ParameterInformation.create([currentParamStart, formalSpec.length - 1]));
        return result;
}

export type RoutineSignatureDetails = {
        signature: SignatureInformation;
        start: Position;
        parameters: string[];
};

/** Try to build signature help details for an extrinsic routine call preceding the paren at (line, token). */
export async function getRoutineSignatureDetails(
        doc: TextDocument,
        parsed: compressedline[],
        parenLine: number,
        parenToken: number,
        paramsUri: string,
        server: ServerSpec
): Promise<RoutineSignatureDetails | null> {
        if (parsed[parenLine]?.[parenToken] === undefined) {
                return null;
        }
        const parenPos = parsed[parenLine][parenToken].p;
        const callPrefix = doc.getText(Range.create(Position.create(parenLine, 0), Position.create(parenLine, parenPos)));
        const callContext = extractRoutineCall(callPrefix);
        if (callContext === null) {
                return null;
        }
        const { label } = callContext;
        let routineName = callContext.routine ?? '';

        let currentRoutine = '';
        if (["objectscript", "objectscript-int"].includes(doc.languageId) && parsed[0]?.length > 1) {
                currentRoutine = doc.getText(
                        Range.create(
                                Position.create(0, parsed[0][1].p),
                                Position.create(0, parsed[0][1].p + parsed[0][1].c)
                        )
                );
        }
        if (routineName === '') {
                routineName = currentRoutine;
        }
        if (routineName === '') {
                return null;
        }

        let routineLines: string[] = [];
        if (routineName === currentRoutine && ["objectscript", "objectscript-int"].includes(doc.languageId)) {
                routineLines = doc.getText().split(/\r?\n/);
        } else {
                const indexResp = await makeRESTRequest('POST', 1, '/action/index', server, [`${routineName}.int`]);
                if (!Array.isArray(indexResp?.data?.result?.content) || indexResp.data.result.content.length === 0) {
                        return null;
                }
                const routineEntry = indexResp.data.result.content[0];
                if (routineEntry.status !== '') {
                        return null;
                }
                let ext = '.int';
                if (
                        Array.isArray(routineEntry.others) &&
                        routineEntry.others.some((other: string) => other.slice(-3).toLowerCase() === 'mac')
                ) {
                        ext = '.mac';
                }
                const routineUri = await createDefinitionUri(paramsUri, routineName, ext);
                if (routineUri === '') {
                        return null;
                }
                routineLines = await getTextForUri(routineUri, server);
                if (!Array.isArray(routineLines) || routineLines.length === 0) {
                        return null;
                }
        }

        let labelLineIndex = -1;
        for (let i = 0; i < routineLines.length; i++) {
                const line = routineLines[i];
                if (!line.startsWith(label)) {
                        continue;
                }
                const trimmed = line.trimEnd();
                const afterLabel = line.slice(label.length);
                if (
                        trimmed.length === label.length ||
                        afterLabel.startsWith(' ') ||
                        afterLabel.startsWith('\t') ||
                        afterLabel.startsWith('(') ||
                        afterLabel.startsWith(';') ||
                        afterLabel.startsWith('##;') ||
                        afterLabel.startsWith('//') ||
                        afterLabel.startsWith('/*')
                ) {
                        labelLineIndex = i;
                        break;
                }
        }
        if (labelLineIndex === -1) {
                return null;
        }

        const labelLine = routineLines[labelLineIndex];
        const noComment = stripRoutineComment(labelLine);
        const openParenIdx = noComment.indexOf('(');
        let paramString = '';
        if (openParenIdx >= 0) {
                let remainder = noComment.slice(openParenIdx + 1);
                let closeIdx = remainder.indexOf(')');
                let searchIdx = labelLineIndex;
                while (closeIdx === -1) {
                        searchIdx++;
                        if (searchIdx >= routineLines.length) {
                                break;
                        }
                        const nextLineRaw = stripRoutineComment(routineLines[searchIdx]);
                        if (nextLineRaw.length && /^[A-Za-z%]/.test(nextLineRaw.charAt(0))) {
                                break;
                        }
                        const nextTrimmed = nextLineRaw.trim();
                        if (nextTrimmed.length) {
                                if (remainder.length && !remainder.endsWith(' ') && !nextTrimmed.startsWith(',')) {
                                        remainder += ' ';
                                }
                                remainder += nextTrimmed;
                        }
                        closeIdx = remainder.indexOf(')');
                }
                if (closeIdx !== -1) {
                        paramString = remainder.slice(0, closeIdx);
                } else {
                        paramString = remainder.trim();
                }
        }

        const params = splitRoutineParams(paramString);
        const paramsText = params.join(', ');
        const signatureLabel = `${label}(${paramsText})`;
        const signature: SignatureInformation = {
                label: signatureLabel,
                parameters: routineParameterInfos(signatureLabel, params)
        };

        return {
                signature,
                start: Position.create(parenLine, parsed[parenLine][parenToken].p + 1),
                parameters: params
        };
}

function escapeHtml(text: string): string {
        return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
}

export function buildRoutineDocumentation(
        signature: SignatureInformation,
        activeIndex: number | null,
        options?: {
                context?: 'hover' | 'signature';
                boldParameter?: boolean;
                // opcional: mostrar o cabeçalho (bloco de código) no hover
                showHeaderInHover?: boolean;
        }
): MarkupContent | undefined {
        const paramInfos = signature.parameters ?? [];
        const isHover = options?.context === 'hover';
        const isSignature = options?.context === 'signature';
        const boldParam = options?.boldParameter === true;
        const showHeaderInHover = options?.showHeaderInHover ?? true;

        const clamp = (i: number) =>
                paramInfos.length ? Math.min(Math.max(i, 0), paramInfos.length - 1) : 0;

        const getParamText = (i: number) => {
                const info = paramInfos[i];
                if (!info) return '';
                if (Array.isArray(info.label)) {
                        const [s, e] = info.label;
                        return s < e ? signature.label.slice(s, e) : '';
                }
                return typeof info.label === 'string' ? info.label : '';
        };

        const esc = (s: string) =>
                s.replace(/[<&>]/g, m => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[m]!));

        // assinatura com o parâmetro ativo em `inline code`
        const renderSignatureWithInlineParam = (label: string, i: number) => {
                const info = paramInfos[i];
                if (!info) return esc(label);

                if (Array.isArray(info.label)) {
                        const [s, e] = info.label;
                        if (s < e) {
                                const pre = esc(label.slice(0, s));
                                const mid = esc(label.slice(s, e));
                                const pos = esc(label.slice(e));
                                const midCode = boldParam ? `**\`${mid}\`**` : `\`${mid}\``;
                                return `${pre}${midCode}${pos}`;
                        }
                        return esc(label);
                }

                if (typeof info.label === 'string' && info.label) {
                        const safeLabel = esc(label);
                        const needle = esc(info.label);
                        const k = safeLabel.indexOf(needle);
                        if (k >= 0) {
                                const pre = safeLabel.slice(0, k);
                                const pos = safeLabel.slice(k + needle.length);
                                const midCode = boldParam ? `**\`${needle}\`**` : `\`${needle}\``;
                                return `${pre}${midCode}${pos}`;
                        }
                }
                return esc(label);
        };

        const idx = clamp(activeIndex ?? 0);
        const pText = getParamText(idx);
        const pEsc = esc(pText);
        const pInline = boldParam ? `**\`${pEsc}\`**` : `\`${pEsc}\``;

        const lines: string[] = [];

        if (isHover && showHeaderInHover) {
                // cabeçalho tipo “bloco de código” no hover
                lines.push('```');
                lines.push(signature.label); // sem escape — preserve exatamente a assinatura
                lines.push('```');
                lines.push('');
        }

        // ⛔ NO SIGNATURE: NÃO renderiza a linha “do meio”
        if (!isSignature) {
                // hover: mantém a linha “signature-like”
                lines.push(renderSignatureWithInlineParam(signature.label, idx));
                lines.push('');
        }

        // “Parâmetro na origem” em ambos os contextos
        lines.push(pText ? `Parâmetro na origem: ${pInline}` : 'Parâmetro na origem:');

        return { kind: MarkupKind.Markdown, value: lines.join('\n') };
}
