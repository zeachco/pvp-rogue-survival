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
