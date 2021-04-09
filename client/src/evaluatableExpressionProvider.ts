import {
	EvaluatableExpressionProvider,
	Position,
	TextDocument,
	EvaluatableExpression
} from 'vscode';

import { LanguageClient } from 'vscode-languageclient/node';

export class ObjectScriptEvaluatableExpressionProvider implements EvaluatableExpressionProvider {

	private client: LanguageClient;

	constructor(client: LanguageClient) {
		this.client = client;
	}
	
	provideEvaluatableExpression(document: TextDocument, position: Position): Promise<EvaluatableExpression> {
		// Have the server do the work
		return this.client.sendRequest("intersystems/debugger/evaluatableExpression",{
			uri: document.uri.toString(),
			position: position
		});
	}

}
