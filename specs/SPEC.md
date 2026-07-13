# Multi-Line Hero SPEC

## 1. Product Summary

Multi-Line Hero is a multiplayer-first browser arena survival game. Each player controls a hero in a private fixed arena while server-authored creep waves enter from outside the arena edges and converge on the hero. Players survive, collect weapons, and indirectly pressure nearby matched players through future creep-wave systems.

## 2. Core Goals

- Run as a Vite TypeScript client with Bun for all tooling and the local server runtime.
- Render the arena and combat on a full-window responsive canvas.
- Use stable HTML overlays for joining, player status, neighbors, wave notices, and inventory.
- Run a Bun TypeScript server serving the built client and gameplay WebSockets at `/ws`.
- Keep multiplayer identity, score, wave turns, and neighbor links authoritative on the server.
- Share WebSocket message types through `common/protocol.ts`.
- Keep mechanics in `specs/MECHANICS_SPEC.md` and progression/item/build rules in `specs/PROGRESSION_SPEC.md`.

## 3. Specification Boundaries

- `specs/SPEC.md` is authoritative for product goals, runtime architecture, server ownership, multiplayer/economy boundaries, UX direction, WebSocket protocol, and development process.
- `specs/MECHANICS_SPEC.md` is authoritative for arena simulation, movement, targeting, attack telegraphs, projectiles, collision resolution, damage sources, and local defeat reset.
- `specs/PROGRESSION_SPEC.md` is authoritative for permanent XP, attributes, derived stats, item generation, equipment, skills, generated enemy builds, drops, wave composition, and rival scaling.

## 4. Hero and Combat Summary

- Every joined player controls one hero in a private fixed arena, initially placed at the arena center.
- The hero has health instead of lane lives.
- Enemy body contact does not damage the hero; see `specs/MECHANICS_SPEC.md` for damage sources and attack resolution.
- The starting inventory contains a plain club dealing 100% base damage; with zero starting stats this is exactly 1 damage.
- Generated enemy weapons can drop into the arena and be collected into the backpack. Weapon classes, requirements, affixes, skills, and progression follow `specs/PROGRESSION_SPEC.md`.
- Hero auto-aim, automatic attacks, attack areas, projectiles, and dodge rules follow `specs/MECHANICS_SPEC.md`.
- Active weapon and learned skill availability, costs, and scaling follow `specs/PROGRESSION_SPEC.md`.
- Particle effects remain future work.

## 5. Creep and Wave Rules

- The server advances a numbered wave turn for each connected player and sends one `incomingWave` payload per turn.
- The client only spawns creeps described by server-authored waves and staggers them using the supplied interval.
- Early waves contain melee creeps. Beginning with wave 3, waves also contain ranged bubble shooters, with their presence increasing later.
- Creep spawn positioning, steering, melee telegraphs, ranged projectiles, and collision behavior follow `specs/MECHANICS_SPEC.md`.
- Wave size, spawn batching, generated enemy builds, XP, drops, and rival scaling follow `specs/PROGRESSION_SPEC.md`.
- Killing a creep awards its bounty locally and its score value through the server.
- A creep no longer leaks or exits through a lane.
- Defeat is reported to the server. The server halves the player's authoritative wave number using floor division, then sends the adjusted wave number back to the client and neighbor summaries.
- After the local defeat reset finishes, the client requests a replacement wave. The server sends a fresh `incomingWave` for the already-adjusted wave number with the normal preparation delay; this replacement request must not increment the wave number again.

## 6. Multiplayer and Economy

- Players are matched with up to `MAX_NEIGHBORS` connected players within `MATCH_SCORE_GAP`.
- Neighbor links expose names, scores, and current waves only.
- The former tower-building and creep-purchase economy is removed from the active UI and protocol.
- Gold is granted occasionally and directly for defeated enemies according to `specs/PROGRESSION_SPEC.md`, and through manual item sales. Passive income and purchasing are not part of this slice.
- Neutral waves are always supplied by the server. Competitive wave modification can be redesigned with the future item system.

## 7. Visual and UX Direction

- Use futuristic, simple geometric shapes with no required external art pipeline.
- Telegraph and combat rendering rules follow `specs/MECHANICS_SPEC.md`.
- Show controls, drops, and inspected enemy highlight.
- Show controls and auto-attack behavior in the HUD notice.
- Wave starts use a centered, non-blocking fading banner.
- Reserve a fixed 200px right-side rail for the stable DOM build panel. It is always open on the hero by default; selecting a creep reuses the same rail for creep inspection until Back restores the hero. The panel contains attributes, allocation controls, one equipped weapon, an eight-slot scrollable backpack with manual item actions, and enemy inspection.
- Show a bottom spell bar for learned and equipped cooldown skills without overlapping the right-side build rail.

## 8. Architecture

### Client

- `src/game/Game.ts`: fixed-step orchestration, input, spawning, collisions, combat outcomes, networking, and camera following.
- `src/game/GameObject.ts`: abstract update/render base.
- `src/game/Unit.ts`: health and velocity-based steering shared by hero and creeps.
- `src/game/Hero.ts`: WASD-controlled hero, resources, closest-target auto-aim, and equipped-weapon state.
- `src/game/Creep.ts`: melee and bubble-shooter steering and attack state machines.
- `src/game/AttackArea.ts`: telegraphed, dodgeable melee weapon attack areas.
- `src/game/Projectile.ts`: moving collision-based enemy bubbles.
- `src/game/Map.ts`: fixed arena dimensions, bounds, edge spawning, and arena rendering.
- `src/ui/Hud.tsx`: stable join, status, neighbor, wave, notice, and inventory DOM.
- `src/net/SocketClient.ts`: typed WebSocket wrapper.
- Local storage persists only accepted session id and display name, never transient combat state.

### Server and Shared

- `server/server.ts`: static HTTP server, `/ws`, sessions, matchmaking, score, and wave dispatch.
- `common/protocol.ts`: progression messages, generated unit builds, waves, and public player summaries.
- Shared progression formulas and item generators live in `common/progression.ts` and `common/items.ts`.

## 9. WebSocket Protocol

Client to server:

- `join`: `{ name, sessionId? }`
- `creepKilled`: `{ unitId, isRival, xpReward, goldReward }`
- `heroDefeated`: `{}`
- `requestWave`: `{}`
- `scoreSnapshot`: `{ score, health }` (reserved for future validation)
- `extractSkill`: `{ itemId }`

Server to client:

- `welcome`: `{ playerId, player, neighbors, config }`
- `neighbors`: `{ neighbors }`
- `incomingWave`: `{ wave }`
- `waveAdjusted`: `{ waveNumber, reason }`
- `scoreAwarded`: `{ score, reason }`
- `serverNotice`: `{ message }`

## 10. Initial Scope

- Join/resume flow and fixed responsive arena.
- WASD hero with acceleration, bounded movement, camera follow, and health, as specified in `specs/MECHANICS_SPEC.md`.
- Closest-creep auto-aim and automatic equipped-weapon attacks and skills across `specs/MECHANICS_SPEC.md` and `specs/PROGRESSION_SPEC.md`.
- Randomized edge spawns aimed directly at the hero.
- Melee creeps first, followed by ranged bubble shooters.
- Telegraph/resolution attack areas and collision-based bubble projectiles, as specified in `specs/MECHANICS_SPEC.md`.
- Character and inventory HUD with a starting club, allocation controls, backpack, item actions, and enemy inspection.
- Server-authored waves, score awards, and neighbor summaries.

## 11. Future Scope

- Obstacles and pathfinding around them.
- Additional weapon classes, skills, affixes, and particles.
- Competitive wave modification redesigned around the item economy.
- Account persistence, server-side simulation validation, replays, matchmaking ratings, and mobile controls.

## 12. Development Process

- `specs/SPEC.md`, `specs/MECHANICS_SPEC.md`, and `specs/PROGRESSION_SPEC.md` are the source-of-truth specification set. Update the relevant spec before implementing behavior not already covered.
- Keep filenames, runtime choices, protocols, mechanics, progression rules, and UX synchronized with implementation.
- Use Bun for project scripts and tooling.
- Debug builds may expose `window.__mltDebug` and concise `[MLH][player]` logs for socket, wave, spawn, combat, defeat, and score events.
