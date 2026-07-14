# Multi-Line Hero

Multiplayer-first browser arena survival game built with Vite, TypeScript, canvas rendering, DOM HUD components, and a Bun TypeScript server.

## Specs

The source-of-truth specs live in `specs/`:

- `specs/SPEC.md`: product goals, runtime architecture, server ownership, multiplayer/economy boundaries, UX direction, WebSocket protocol, and development process.
- `specs/MECHANICS_SPEC.md`: arena simulation, movement, targeting, attack telegraphs, projectiles, collision resolution, damage sources, and local defeat reset.
- `specs/PROGRESSION_SPEC.md`: permanent XP, attributes, derived stats, item generation, equipment, skills, generated enemy builds, drops, wave composition, and rival scaling.

Update the relevant spec before changing behavior.

## Tooling

Use Bun for project tooling and scripts.

- `bun run dev`: start the Vite client dev server.
- `bun run server`: start the Bun server.
- `bun run build`: typecheck and build the client.
- `bun test`: run deterministic domain, server-service, protocol, and WebSocket integration tests.

## Architecture

- `common/` contains runtime protocol schemas and pure balance, content, combat, inventory, progression, item, random, and wave rules.
- `server/GameService.ts` is the application layer over a replaceable player repository; `server/createApp.ts` owns HTTP/WebSocket transport.
- `src/game/ArenaState.ts` and `src/game/systems/` own local simulation state and fixed-step systems. `src/game/render/` owns canvas presentation.
- `src/platform/`, `src/net/`, and `src/ui/` isolate browser persistence, transport, and stable DOM views from simulation rules.

The server is authoritative for issued enemies, rewards, generated drops, progression, and inventory mutations. Client reports contain opaque unit or drop IDs and are runtime-validated before dispatch.

## Balance profiles

Local runs use the `dev` profile id by default; production uses `normal`. Override either with `BALANCE_PROFILE=dev` or `BALANCE_PROFILE=normal` when starting the server. Both profiles currently use identical combat, wave, and reward values so development never accelerates persisted progression.

Player progression and inventory are atomically persisted to the git-ignored `server-data/players.json` file.
