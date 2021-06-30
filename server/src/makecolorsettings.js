
import {colorsettings } from './semanticdefns';

const monikers = "CLS,COS,INT,XML,BAS,CSS,HTML,JAVA,JAVASCRIPT,MVBASIC,SQL,PYTHON".split(',');

const cs = colorsettings(monikers);
var first = true;
for (let moniker in cs) {
	let result = '';
	const line = JSON.stringify(cs[moniker]);
	if (!first) {
		result += ',\n\t\t';
		first = false;
	}
	if (line.startsWith('{') && line.endsWith('}')) {
		result += line.substr(1,line.length - 2);
	}
	else {
		throw Error('dumpcolorsettings: JSON line is not enclosed in {..}');
	}
	console.log(result + ',');
}
