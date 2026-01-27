# Agent Instructions (client/)

## Scope and precedence

This file applies to **everything** under `client/` and complements the root `AGENTS.md`. If there is a conflict, **this file wins** because it is more specific.

## What is `client/`

`client/` contains the **VS Code extension** (Language Client), responsible for activating/starting the server (`LanguageClient`), integrating with VS Code APIs, and orchestrating the editor ⇄ server flow.

## High-level layout

- `client/src/extension.ts`: activation/entrypoint and main `LanguageClient` wiring.
- `client/src/requestForwarding.ts`: middleware and embedded-content provider.
- `client/src/commands.ts`: extension-registered commands.
- `client/src/makeRESTRequest.ts`: client-side REST helper (when applicable).
- `client/src/ccs/**`: Consistem-specific customizations (see rule below).

## Consistem customizations (`client/src/ccs/**`)

Principle: **keep the client core stable** to make upstream merges easier.

- Put in `ccs/`: UX/editor behavior (e.g. formatting control), internal integrations/middleware, and rules that don’t belong upstream.
- Integration: `extension.ts` should only “plug in” `ccs/` modules at clear extension points; avoid scattered “Consistem” conditionals.

## Changes in `extension.ts` and protocols

- Avoid broad changes in activation (merge-conflict hotspot).
- Don’t change request/notification IDs (`intersystems/...`) without aligning with `server/`.

## Quick checklist

- Consistem-specific change lives in `client/src/ccs/**` (when applicable) and the core only “plugs in” what’s needed.
- `npm run compile` passes at repo root.
- Validated in VS Code via `.vscode/launch.json` (“Launch Client”) and reproduced the affected flow.
