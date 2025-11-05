import { Hover, Position, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { determineActiveParam, findOpenParen } from '../../utils/functions';
import { ServerSpec, compressedline } from '../../utils/types';
import * as ld from '../../utils/languageDefinitions';
import {
        buildRoutineDocumentation,
        getRoutineSignatureDetails
} from '../signatureHelp/routineSupport';

/** Try to build a hover result for an extrinsic routine call parameter at the given location. */
export async function getRoutineHover(
        doc: TextDocument,
        parsed: compressedline[],
        position: Position,
        tokenIndex: number,
        uri: string,
        server: ServerSpec
): Promise<Hover | null> {
        const token = parsed[position.line]?.[tokenIndex];
        if (token === undefined) {
                return null;
        }

        if (token.l !== ld.cos_langindex) {
                return null;
        }
        if ([ld.cos_comment_attrindex, ld.cos_dcom_attrindex, ld.cos_str_attrindex].includes(token.s)) {
                return null;
        }

        const [parenLine, parenToken] = findOpenParen(doc, parsed, position.line, tokenIndex);
        if (parenLine === -1 || parenToken === -1) {
                return null;
        }

        const routineDetails = await getRoutineSignatureDetails(
                doc,
                parsed,
                parenLine,
                parenToken,
                uri,
                server
        );
        if (routineDetails === null) {
                return null;
        }

        const startPos = routineDetails.start;
        let activeIndex: number | null = null;
        if (
                position.line < startPos.line ||
                (position.line === startPos.line && position.character < startPos.character)
        ) {
                activeIndex = 0;
        } else {
                const spanText = doc.getText(Range.create(startPos, position));
                const computed = determineActiveParam(spanText);
                if (routineDetails.signature.parameters.length > 0) {
                        activeIndex = Math.min(
                                Math.max((computed ?? 0), 0),
                                routineDetails.signature.parameters.length - 1
                        );
                } else {
                        activeIndex = null;
                }
        }

        const docContent = buildRoutineDocumentation(
                routineDetails.signature,
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
