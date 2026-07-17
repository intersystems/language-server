#!/usr/bin/env bash
# Regenerate src/analyzer/generated/ + lib/analyzer.core*.wasm from the committed
# lib/analyzer.wasm. Runs from the jco devDependency via the "gen" npm script;
# the generated files are gitignored, so run this after copying in a new wasm.
# --async-mode jspi is what lets the sync get-mem import suspend on an async host
# (JS Promise Integration) instead of needing a worker.
set -euo pipefail

cd "$(dirname "$0")/.."

CORE="lib/analyzer.wasm"
COMPONENT="$(mktemp -t analyzer.component.XXXXXX.wasm)"
GEN="src/analyzer/generated"

if [ -f "$GEN/analyzer.js" ] && [ ! "$CORE" -nt "$GEN/analyzer.js" ]; then
	echo "$GEN is up to date with $CORE; skipping. (rm -rf $GEN to force)"
	exit 0
fi

trap 'rm -f "$COMPONENT"' EXIT

echo "componentizing $CORE ..."
npx jco new "$CORE" -o "$COMPONENT"

echo "transpiling to $GEN ..."
rm -rf "$GEN"
mkdir -p "$GEN"
npx jco transpile "$COMPONENT" \
	--name analyzer \
	--instantiation async \
	--async-mode jspi \
	--async-imports \
		"iris:objectscript-analyzer/imported#[method]iris-connection.get-mem" \
		"iris:objectscript-analyzer/imported#[method]iris-connection.get-supers" \
		"iris:objectscript-analyzer/imported#[method]iris-connection.is-datatype" \
	--async-exports \
		"iris:objectscript-analyzer/exported#[method]workspace.insert-cls" \
		"iris:objectscript-analyzer/exported#[method]workspace.insert-rtn" \
		"iris:objectscript-analyzer/exported#[method]workspace.check" \
		"iris:objectscript-analyzer/exported#[method]workspace.inlay-hint" \
		"iris:objectscript-analyzer/exported#[method]workspace.query-cls" \
		"iris:objectscript-analyzer/exported#[method]workspace.query-mem" \
		"iris:objectscript-analyzer/exported#complete-class" \
		"iris:objectscript-analyzer/exported#complete-method" \
	--no-nodejs-compat \
	-o "$GEN"

# We always pass getCoreModule to instantiate(), so jco's fetch(import.meta.url)
# fallback is dead code. Drop it: its dynamic `new URL(..., import.meta.url)` makes
# webpack glob the whole generated dir (including .d.ts) into a context module.
echo "stripping dead fetch fallback ..."
perl -0pi -e 's{^\s*if \(!getCoreModule\) getCoreModule = .*fetchCompile.*$}{    if (!getCoreModule) throw new Error("getCoreModule is required");}m' "$GEN/analyzer.js"

# The core wasm modules are read via fs at runtime (webpack bundles only JS), so
# they live in lib/ alongside analyzer.wasm rather than in the bundled dir.
echo "moving core wasm to lib/ ..."
mv "$GEN"/*.core*.wasm lib/

echo "done."
echo "  glue (bundled):    $GEN/analyzer.js + interfaces/"
echo "  core wasm (fs):    lib/analyzer.core*.wasm"
ls -1 "$GEN"
ls -1 lib/*.core*.wasm
