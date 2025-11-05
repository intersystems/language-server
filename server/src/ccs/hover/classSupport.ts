import { Hover, Position, Range, SignatureInformation } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import {
        beautifyFormalSpec,
        determineActiveParam,
        findOpenParen,
        getClassMemberContext,
        makeRESTRequest,
        quoteUDLIdentifier
} from '../../utils/functions';
import { ServerSpec, compressedline } from '../../utils/types';
import * as ld from '../../utils/languageDefinitions';
import { buildRoutineDocumentation, formalSpecToParamsArr } from '../signatureHelp/routineSupport';

export type MethodSignatureDetails = {
        signature: SignatureInformation;
        start: Position;
};

async function getMethodSignatureDetails(
        doc: TextDocument,
        parsed: compressedline[],
        parenLine: number,
        parenToken: number,
        server: ServerSpec
): Promise<MethodSignatureDetails | null> {
        const tokens = parsed[parenLine];
        if (tokens === undefined || tokens[parenToken] === undefined) {
                return null;
        }
        const calleeToken = tokens[parenToken - 1];
        if (calleeToken === undefined) {
                return null;
        }
        if (
                calleeToken.l !== ld.cos_langindex ||
                ![ld.cos_method_attrindex, ld.cos_mem_attrindex].includes(calleeToken.s)
        ) {
                return null;
        }

        const memberRange = Range.create(
                parenLine,
                calleeToken.p,
                parenLine,
                calleeToken.p + calleeToken.c
        );
        const member = doc.getText(memberRange);
        const unquotedName = quoteUDLIdentifier(member, 0);

        const memberContext = await getClassMemberContext(doc, parsed, parenToken - 2, parenLine, server);
        if (memberContext.baseclass === '') {
                return null;
        }

        const queryData = member === '%New'
                ? {
                        query: 'SELECT FormalSpec, ReturnType, Description, Stub, Origin FROM %Dictionary.CompiledMethod WHERE Parent = ? AND (Name = ? OR Name = ?)',
                        parameters: [memberContext.baseclass, unquotedName, '%OnNew']
                }
                : {
                        query: 'SELECT FormalSpec, ReturnType, Description, Stub FROM %Dictionary.CompiledMethod WHERE Parent = ? AND Name = ?',
                        parameters: [memberContext.baseclass, unquotedName]
                };
        const respData = await makeRESTRequest('POST', 1, '/action/query', server, queryData);
        const rows: any[] | undefined = respData?.data?.result?.content;
        if (!Array.isArray(rows) || rows.length === 0) {
                return null;
        }

        const start = Position.create(parenLine, tokens[parenToken].p + 1);

        if (member === '%New') {
                if (rows.length === 2 && rows[1].Origin !== '%Library.RegisteredObject') {
                        const formalSpec = typeof rows[1].FormalSpec === 'string' ? rows[1].FormalSpec : '';
                        if (formalSpec === '') {
                                return null;
                        }
                        const raw = beautifyFormalSpec(formalSpec);
                        const signature: SignatureInformation = {
                                label: raw,
                                parameters: formalSpecToParamsArr(raw)
                        };
                        signature.label += ` As ${memberContext.baseclass}`;
                        return { signature, start };
                }
                return null;
        }

        let methodRow = rows[0] ?? {};
        const stubValue = typeof methodRow.Stub === 'string' ? methodRow.Stub : '';
        if (stubValue !== '') {
                const stubParts = stubValue.split('.');
                if (stubParts.length >= 3) {
                        let stubQuery = '';
                        if (stubParts[2] === 'i') {
                                stubQuery = 'SELECT Description, FormalSpec, ReturnType FROM %Dictionary.CompiledIndexMethod WHERE Name = ? AND parent->Parent = ? AND parent->Name = ?';
                        } else if (stubParts[2] === 'q') {
                                stubQuery = 'SELECT Description, FormalSpec, ReturnType FROM %Dictionary.CompiledQueryMethod WHERE Name = ? AND parent->Parent = ? AND parent->Name = ?';
                        } else if (stubParts[2] === 'a') {
                                stubQuery = 'SELECT Description, FormalSpec, ReturnType FROM %Dictionary.CompiledPropertyMethod WHERE Name = ? AND parent->Parent = ? AND parent->Name = ?';
                        } else if (stubParts[2] === 'n') {
                                stubQuery = 'SELECT Description, FormalSpec, ReturnType FROM %Dictionary.CompiledConstraintMethod WHERE Name = ? AND parent->Parent = ? AND parent->Name = ?';
                        }
                        if (stubQuery !== '') {
                                const stubResp = await makeRESTRequest('POST', 1, '/action/query', server, {
                                        query: stubQuery,
                                        parameters: [stubParts[1], memberContext.baseclass, stubParts[0]]
                                });
                                const stubRows: any[] | undefined = stubResp?.data?.result?.content;
                                if (Array.isArray(stubRows) && stubRows.length > 0) {
                                        methodRow = stubRows[0];
                                }
                        }
                }
        }

        const formalSpec = typeof methodRow.FormalSpec === 'string' ? methodRow.FormalSpec : '';
        if (formalSpec === '') {
                return null;
        }

        const raw = beautifyFormalSpec(formalSpec);
        const signature: SignatureInformation = {
                label: raw,
                parameters: formalSpecToParamsArr(raw)
        };
        const returnType = typeof methodRow.ReturnType === 'string' ? methodRow.ReturnType : '';
        if (['%Open', '%OpenId'].includes(member)) {
                signature.label += ` As ${memberContext.baseclass}`;
        } else if (returnType !== '') {
                signature.label += ` As ${returnType}`;
        }

        return { signature, start };
}

export async function getClassMethodHover(
        doc: TextDocument,
        parsed: compressedline[],
        position: Position,
        tokenIndex: number,
        server: ServerSpec
): Promise<Hover | null> {
        const [parenLine, parenToken] = findOpenParen(doc, parsed, position.line, tokenIndex);
        if (parenLine === -1 || parenToken === -1) {
                return null;
        }

        const details = await getMethodSignatureDetails(doc, parsed, parenLine, parenToken, server);
        if (details === null) {
                return null;
        }

        const startPos = details.start;
        const signature = details.signature;
        const paramInfos = signature.parameters ?? [];

        let activeIndex: number | null = null;
        if (
                position.line < startPos.line ||
                (position.line === startPos.line && position.character < startPos.character)
        ) {
                activeIndex = paramInfos.length > 0 ? 0 : null;
        } else {
                const spanText = doc.getText(Range.create(startPos, position));
                const computed = determineActiveParam(spanText);
                if (paramInfos.length > 0) {
                        activeIndex = Math.min(Math.max((computed ?? 0), 0), paramInfos.length - 1);
                } else {
                        activeIndex = null;
                }
        }

        const docContent = buildRoutineDocumentation(
                signature,
                activeIndex,
                { context: 'hover', showHeaderInHover: false })
        if (docContent === undefined) {
                return null;
        }

        return {
                contents: docContent,
                range: Range.create(position, position)
        };
}
