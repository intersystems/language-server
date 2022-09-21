//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

'use strict';

const path = require('path');
const merge = require('merge-options');

module.exports = function withDefaults(/**@type WebpackConfig*/extConfig) {

	/** @type WebpackConfig */
	let defaultConfig = {
		mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')
		target: 'node', // extensions run in a node context
		node: {
			__dirname: false // leave the __dirname-behaviour intact
		},
		resolve: {
			mainFields: ['module', 'main'],
			extensions: ['.ts', '.js', '.node']
		},
		module: {
			rules: [
				{
					test: /\.ts$/,
					exclude: /node_modules/,
					use: [{
						// configure TypeScript loader:
						// * enable sources maps for end-to-end source maps
						loader: 'ts-loader',
						options: {
							compilerOptions: {
								"sourceMap": true,
							}
						}
					}]
				},
				{
					test: /\.node$/,
					loader: "node-loader",
				}
			]
		},
		externals: {
			'vscode': 'commonjs vscode', // ignored because it doesn't exist
		},
		output: {
			// all output goes into `out`.
			filename: '[name].js',
			path: path.join(extConfig.context, 'out'),
			libraryTarget: "commonjs",
		},
		// yes, really source maps
		devtool: 'source-map'
	};

	return merge(defaultConfig, extConfig);
};
