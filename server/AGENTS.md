# Agent Instructions (server/)

## Scope and precedence

This file applies to **everything** under `server/` and complements the root `AGENTS.md`. If there is a conflict, **this file wins** because it is more specific.

## What is `server/`

`server/` contains the **Language Server (LSP)** (Node + `vscode-languageserver`) and most of the “intelligence” (parse, hover, completion, signature help, formatting, diagnostics).

## High-level layout

- `server/src/server.ts`: entrypoint and handler registration.
- `server/src/providers/**`: capability-specific handlers.
- `server/src/parse/**`: parsing/tokenization (includes native-lexer integration).
- `server/src/utils/**`: shared types and utilities.
- `server/src/ccs/**`: Consistem-specific customizations (see rule below).

## Consistem customizations (`server/src/ccs/**`)

Principle: **keep the core as close as possible to upstream** and concentrate differences in `ccs/`.

- Put in `ccs/`: internal rules, heuristics, custom documentation/hover/signature behavior, “non-upstream” tweaks.
- Avoid in `ccs/`: base LSP infrastructure, generic parsing, broadly reusable utilities (keep those in `providers/`, `parse/`, `utils/`).
- Integration: prefer small “hooks” (e.g. provider calls a `ccs/` function and only uses the return when applicable).

## Core changes (outside `ccs/`)

- Avoid whole-file refactors/reformatting; minimize diffs to reduce merge conflicts.
- Don’t change handler contracts/signatures without need (the `client/` depends on them).

## Native lexer (`server/lib/isclexer.node`)

`server/lib/isclexer.node` is **gitignored** and must exist locally for some runs.

Create/update it with:

`npm run select-isclexer`

Cross-build example (package on macOS for Windows):

`ISCLEXER_TARGET=win32-x64 npm run select-isclexer`

Note: `npm run webpack` / `npm run webpack:dev` will run `select-isclexer` automatically.

## Quick checklist

- Consistem-specific change lives in `server/src/ccs/**` (when applicable) and the core only “plugs in” what’s needed.
- `npm run compile` passes at repo root.
- Tested in VS Code via `.vscode/launch.json` (“Launch Client” and, if needed, “Attach to Server” on port 6009).
