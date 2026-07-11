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

## 3. Game Loop

- A fixed client update advances hero input, acceleration-based movement, creep steering, attack telegraphs, hit areas, projectiles, collisions, waves, and camera following.
- Rendering draws the fixed arena, hero, creeps, attack areas, projectiles, health bars, and combat hints.
- The hero is controlled with WASD (and equivalent lowercase/uppercase key events).
- The camera follows the hero and remains clamped to the arena bounds. The arena edges do not move or expand.
- With no obstacles in the initial slice, each creep continuously steers directly toward the hero.

## 4. Movement Rules

- The hero and creeps use velocity-based movement rather than waypoint movement.
- A desired movement direction is converted into velocity using acceleration and capped by maximum speed.
- Direction changes occur over successive fixed updates, producing a turn/steering response instead of instantaneous full-speed changes.
- Units decelerate when they have no desired movement.
- Performing an attack temporarily slows the attacker. This applies to both the hero and attacking creeps.
- Units are clamped inside the arena; creeps initially spawn just outside a randomly selected edge and enter immediately.

## 5. Hero and Inventory

- Every joined player controls one hero, initially placed at the arena center.
- The hero has health instead of lane lives. Contact or resolved enemy attacks reduce health.
- The hero automatically aims at the closest living creep.
- The starting inventory contains a plain club dealing 100% base damage; with zero starting stats this is exactly 1 damage.
- Generated enemy weapons can drop into the arena and be collected into the backpack. Weapon classes, requirements, affixes, skills, and progression follow `PROGRESSION_SPEC.md`.
- The equipped weapon attacks the closest creep automatically. Melee attacks use visible wind-up areas and damage only targets still overlapping when they resolve.
- Active weapon and learned skills cast automatically when their cooldown, resource, target, and health conditions allow.
- Particle effects remain future work.

## 6. Creep and Wave Rules

- The server advances a numbered wave turn for each connected player and sends one `incomingWave` payload per turn.
- The client only spawns creeps described by server-authored waves and staggers them using the supplied interval.
- Creeps spawn from randomized positions just outside any of the four fixed map edges.
- Early waves contain melee creeps. Beginning with wave 3, waves also contain ranged bubble shooters, with their presence increasing later.
- Melee creeps pursue the hero, telegraph a circular attack area, then damage the hero only if the hero remains in that area when it resolves.
- Bubble shooters maintain some distance, telegraph their shot, then launch a bubble toward the hero's position at firing time.
- Bubble projectiles travel independently and deal damage only on circle collision with the hero; they can be dodged and expire at arena margins or after their lifetime.
- Attack wind-up and recovery slow creep movement.
- Killing a creep awards its bounty locally and its score value through the server.
- A creep no longer leaks or exits through a lane. Player health reaching zero resets the local combat arena and hero after a short defeat notice; score and session identity remain.

## 7. Multiplayer and Economy

- Players are matched with up to `MAX_NEIGHBORS` connected players within `MATCH_SCORE_GAP`.
- Neighbor links expose names, scores, and current waves only.
- The former tower-building and creep-purchase economy is removed from the active UI and protocol.
- Gold remains a local reward counter for creep bounties and future inventory systems. Passive income and purchasing are not part of this slice.
- Neutral waves are always supplied by the server. Competitive wave modification can be redesigned with the future item system.

## 8. Visual and UX Direction

- Use futuristic, simple geometric shapes with no required external art pipeline.
- Telegraph every area-based attack clearly before it resolves, then briefly flash the resolved area.
- Show the hero's facing/auto-aim direction, equipped-weapon attacks, drops, and inspected enemy highlight.
- Show controls and auto-attack behavior in the HUD notice.
- Wave starts use a centered, non-blocking fading banner.
- The stable DOM character panel contains attributes, allocation controls, one equipped weapon, an eight-slot scrollable backpack, and enemy inspection.

## 9. Architecture

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

## 10. WebSocket Protocol

Client to server:

- `join`: `{ name, sessionId? }`
- `creepKilled`: `{ creepKind }`
- `scoreSnapshot`: `{ score, health }` (reserved for future validation)

Server to client:

- `welcome`: `{ playerId, player, neighbors, config }`
- `neighbors`: `{ neighbors }`
- `incomingWave`: `{ wave }`
- `scoreAwarded`: `{ score, reason }`
- `serverNotice`: `{ message }`

## 11. Initial Scope

- Join/resume flow and fixed responsive arena.
- WASD hero with acceleration, bounded movement, camera follow, and health.
- Closest-creep auto-aim and automatic equipped-weapon attacks and skills.
- Randomized edge spawns aimed directly at the hero.
- Melee creeps first, followed by ranged bubble shooters.
- Telegraph/resolution attack areas and collision-based bubble projectiles.
- Character and inventory HUD with a starting club, allocation controls, backpack, item actions, and enemy inspection.
- Server-authored waves, score awards, and neighbor summaries.

## 12. Future Scope

- Obstacles and pathfinding around them.
- Additional weapon classes, skills, affixes, and particles.
- Competitive wave modification redesigned around the item economy.
- Account persistence, server-side simulation validation, replays, matchmaking ratings, and mobile controls.

## 13. Development Process

- `SPEC.md` is the source of truth. Update it before implementing behavior not already covered.
- Keep filenames, runtime choices, protocols, game rules, and UX synchronized with implementation.
- Use Bun for project scripts and tooling.
- Debug builds may expose `window.__mltDebug` and concise `[MLH][player]` logs for socket, wave, spawn, combat, defeat, and score events.
- `PROGRESSION_SPEC.md` is the source of truth for permanent XP, attributes, items, skills, loot, generated creep builds, and rival waves.
