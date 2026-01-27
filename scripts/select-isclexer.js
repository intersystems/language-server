/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-var-requires */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Optional cross-build override.
 *
 * Examples:
 * - ISCLEXER_TARGET=win32-x64
 * - ISCLEXER_TARGET=win32-arm64
 * - ISCLEXER_TARGET=darwin-arm64
 * - ISCLEXER_TARGET=linux-x64
 * - ISCLEXER_TARGET=alpine-x64
 */
function getEnvTarget() {
	const raw = process.env.ISCLEXER_TARGET;
	if (!raw) return null;

	const trimmed = raw.trim();
	if (!trimmed) return null;

	const match = /^([^-]+)-([^-]+)$/.exec(trimmed);
	if (!match) {
		throw new Error(`Invalid ISCLEXER_TARGET "${raw}". Expected "<platform>-<arch>", e.g. "win32-x64".`);
	}

	return { platformKey: match[1], archKey: match[2] };
}

function isMusl() {
	// Heuristic: Node report includes glibcVersionRuntime when running on glibc.
	// On musl-based distros (e.g. Alpine), this is typically absent.
	try {
		// process.report is available on modern Node.
		// eslint-disable-next-line no-undef
		const report = process.report?.getReport?.();
		return !(report?.header?.glibcVersionRuntime);
	} catch {
		return false;
	}
}

function getPlatformKey() {
	switch (process.platform) {
		case 'win32':
			return 'win32';
		case 'darwin':
			return 'darwin';
		case 'linux':
			return isMusl() ? 'alpine' : 'linux';
		default:
			throw new Error(`Unsupported platform for isclexer: ${process.platform}`);
	}
}

function getArchKey() {
	switch (process.arch) {
		case 'x64':
			return 'x64';
		case 'arm64':
			return 'arm64';
		default:
			throw new Error(`Unsupported architecture for isclexer: ${process.arch}`);
	}
}

function main() {
	const envTarget = getEnvTarget();
	const platformKey = envTarget?.platformKey ?? getPlatformKey();
	const archKey = envTarget?.archKey ?? getArchKey();
	const srcFile = `${platformKey}-${archKey}-isclexer.node`;

	const libDir = path.join(__dirname, '..', 'server', 'lib');
	const srcPath = path.join(libDir, srcFile);
	const dstPath = path.join(libDir, 'isclexer.node');

	if (!fs.existsSync(srcPath)) {
		throw new Error(`Missing native lexer binary: ${srcPath}`);
	}

	fs.copyFileSync(srcPath, dstPath);
	console.log(`[select-isclexer] ${srcFile} -> ${path.relative(path.join(__dirname, '..'), dstPath)}`);
}

main();
