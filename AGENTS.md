# Agent Instructions

## Spec-Driven Development

This repository uses `SPEC.md` as the source of truth for product behavior, architecture, workflow, UX constraints, and game rules.

For every request:

1. Read or check the relevant part of `SPEC.md`.
2. Confirm whether the requested change is already covered by the spec.
3. If it is not covered, update `SPEC.md` first with the new decision.
4. Implement the code change only after the spec reflects the intended behavior.
5. Keep the spec synchronized when changing filenames, runtimes, protocols, game rules, or UX expectations.

Use Bun for project tooling and scripts. The client is Vite + TypeScript with canvas rendering and stable DOM HUD components. The server is TypeScript run by Bun.
