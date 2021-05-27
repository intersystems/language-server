import {
	EvaluatableExpressionProvider,
	Position,
	TextDocument,
	EvaluatableExpression
} from 'vscode';

import { client } from './extension';

export class ObjectScriptEvaluatableExpressionProvider implements EvaluatableExpressionProvider {

	constructor() {}
	
	provideEvaluatableExpression(document: TextDocument, position: Position): Promise<EvaluatableExpression> {
		// Have the server do the work
		return client.sendRequest("intersystems/debugger/evaluatableExpression",{
			uri: document.uri.toString(),
			position: position
		});
	}

}
