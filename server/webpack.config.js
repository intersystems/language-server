//@ts-check

'use strict';

const withDefaults = require('../shared.webpack.config');
const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = withDefaults({
	context: path.join(__dirname),
	entry: {
		extension: './src/server.ts',
	},
	output: {
		filename: 'server.js',
		path: path.join(__dirname, 'out')
	},
	plugins: [
		// ascot locates its wasm at `__dirname/../lib`. Bundled into out/ with __dirname left real
		// (see shared.webpack.config.js), that is server/lib/, so mirror the files there at build time.
		new CopyPlugin({
			patterns: [
				{
					context: path.join(__dirname, 'node_modules/@intersystems-community/ascot/lib'),
					from: '*.core*.wasm',
					to: path.join(__dirname, 'lib'),
				},
			],
		}),
	],
});
