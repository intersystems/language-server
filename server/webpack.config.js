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
		// @intersystems-community/ascot's own JS gets bundled into out/ alongside ours
		// (node.__dirname is left un-faked -- see shared.webpack.config.js), so its
		// `__dirname`-relative "../lib" wasm lookup resolves to server/lib/, a sibling of
		// out/, not to node_modules/@intersystems-community/ascot/lib/ where the files
		// actually ship. Mirror them here so that lookup keeps finding them -- as part of
		// the build itself, so there's no separate install-time step to forget or skip.
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
