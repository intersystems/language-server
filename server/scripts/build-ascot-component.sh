#!/usr/bin/env bash
# The generated files are gitignored, so run this after copying in a new wasm.
# --async-mode jspi is what lets the sync get-mem import suspend on an async host
# (JS Promise Integration) instead of needing a worker.
set -euo pipefail

cd "$(dirname "$0")/.."

CORE="lib/ascot.wasm"
COMPONENT="$(mktemp -t ascot.component.XXXXXX.wasm)"
GEN="src/ascot/generated"

if [ -f "$GEN/ascot.js" ] && [ ! "$CORE" -nt "$GEN/ascot.js" ]; then
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
	--name ascot \
	--instantiation async \
	--async-mode jspi \
	--async-imports \
		"iris:ascot/imported#[method]iris-connection.get-mem" \
		"iris:ascot/imported#[method]iris-connection.get-supers" \
		"iris:ascot/imported#[method]iris-connection.is-datatype" \
	--async-exports \
		"iris:ascot/exported#[method]workspace.diagnostics" \
		"iris:ascot/exported#[method]workspace.inlay-hint" \
		"iris:ascot/exported#[method]workspace.definition" \
		"iris:ascot/exported#[method]workspace.references" \
		"iris:ascot/exported#[method]workspace.hover-type" \
	--no-nodejs-compat \
	-o "$GEN"

# We always pass getCoreModule to instantiate(), so jco's fetch(import.meta.url)
# fallback is dead code. Drop it: its dynamic `new URL(..., import.meta.url)` makes
# webpack glob the whole generated dir (including .d.ts) into a context module.
echo "stripping dead fetch fallback ..."
perl -0pi -e 's{^\s*if \(!getCoreModule\) getCoreModule = .*fetchCompile.*$}{    if (!getCoreModule) throw new Error("getCoreModule is required");}m' "$GEN/ascot.js"

# The core wasm modules are read via fs at runtime (webpack bundles only JS), so
# they live in lib/ alongside ascot.wasm rather than in the bundled dir.
echo "moving core wasm to lib/ ..."
mv "$GEN"/*.core*.wasm lib/

echo "done."
echo "  glue (bundled):    $GEN/ascot.js + interfaces/"
echo "  core wasm (fs):    lib/ascot.core*.wasm"
ls -1 "$GEN"
ls -1 lib/*.core*.wasm
