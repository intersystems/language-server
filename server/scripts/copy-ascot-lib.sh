#!/usr/bin/env bash
# webpack bundles @intersystems-community/ascot's JS into server/out/ alongside our own
# code (node.__dirname is left un-faked -- see shared.webpack.config.js), so its
# `__dirname`-relative "../lib" wasm lookup resolves to server/lib/, a sibling of out/,
# not to node_modules/@intersystems-community/ascot/lib/ where the files actually ship.
# Mirror them here so that lookup keeps finding them after bundling.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p lib
cp node_modules/@intersystems-community/ascot/lib/*.core*.wasm lib/
