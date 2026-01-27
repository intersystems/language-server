# Agent Instructions (root)

## Scope and precedence

This file applies to the **entire repository**. More specific instructions in subfolders (e.g. `client/AGENTS.md`, `server/AGENTS.md`) **override** this file in case of conflict.

## Fork goals (Consistem)

- Keep changes as close as possible to the InterSystems upstream.
- Concentrate Consistem-specific behavior in `client/src/ccs/**` and `server/src/ccs/**`, using small “hooks” in the core.

## General rules (for agents)

- Make minimal, localized changes; avoid broad refactors/reformatting.
- Don’t change request/notification IDs (`intersystems/...`) without aligning `client/` and `server/`.
- Avoid touching `package-lock.json` unless necessary (don’t run installs as “formatting”).
- Follow existing style: tabs, and generally single quotes in TS.

## Preferred validation

- `npm run compile` at repo root.
- Manual test via VS Code: `.vscode/launch.json` (“Launch Client”) and, if needed, “Attach to Server” (port 6009).

## Notes

- `server/lib/isclexer.node` is gitignored and must exist locally for runs that use the native lexer.
  - Preferred: run `npm run select-isclexer` from repo root (auto-selects for the current OS/arch).
  - Cross-build: set `ISCLEXER_TARGET=<platform>-<arch>` (e.g. `win32-x64`) before running `npm run select-isclexer` / `npm run webpack`.
