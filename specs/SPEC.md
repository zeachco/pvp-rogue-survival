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

- Players start in the Halls of Realms lobby and must explicitly choose Enter Realm before matchmaking. Connected, opted-in players are placed in stable server-owned 1v1, 1v2, or 1v3 realm groups until disconnect, voluntary exit, or realm defeat.
- Enter Realm starts play immediately even when no opponent is available. An unmatched opted-in player receives solo waves while remaining eligible for matchmaking; solo waves use normal combat and defeat rules, but award half the normal XP. A newly formed realm replaces the active solo wave with a fresh competitive wave.
- The server starts with the highest-level waiting player and chooses one to three lower-level opponents whose combined level is closest. Ties prefer fewer opponents, longer wait, then stable player id; no level gap is rejected.
- A 1v1 is reciprocal. In 1v2/1v3 every team member attacks the solo player and the solo player's outgoing sends rotate across the team.
- Realm Guard identifies outbound recipients and Realm Attacker identifies inbound senders. The HUD shows their names, levels, down state, and queued items.
- Sending consumes exact equipment and queues it FIFO for future regular creeps. Carrier slots are allocated round-robin across attackers, overflow persists, and each player may retain at most 1,000 active or backlash queue entries.
- Closing a realm reverses undelivered items into hostile backlash queues against their original senders. Backlash pauses in Training Grounds and grants no realm-kill XP.
- A player's first defeat remains marked until the next global wave dispatch. A side is defeated when all members were down during that round. A lethal sent carrier credits its sender `100 * victimLevel` XP and one Soul; neutral and backlash lethals grant no realm-kill reward. Individual defeat reset and wave-halving still apply.
- Leave to Lobby is available after the final planned spawn and before the next global dispatch. Training Grounds repeat the current neutral wave without advancing it, halve enemy movement speed, clamp the hero to at least 1 HP, grant no combat rewards or drops, allow inventory management, and disable sending.
- Enter Realm is available at any time. Training continues until matching succeeds, then a fresh competitive wave starts with the normal preparation delay.
- The former tower-building and creep-purchase economy is removed from the active UI and protocol.
- Gold is granted occasionally and directly for defeated enemies according to `specs/PROGRESSION_SPEC.md`, and through manual item sales. Passive income and purchasing are not part of this slice.
- Neutral, competitive, backlash, and training waves are always supplied by the server.

## 7. Visual and UX Direction

- Use futuristic, simple geometric shapes with no required external art pipeline.
- Telegraph and combat rendering rules follow `specs/MECHANICS_SPEC.md`.
- Show controls, drops, and inspected enemy highlight.
- Show movement and auto-attack guidance as a centered, non-blocking notification that fades after a few seconds.
- Wave starts use a centered, non-blocking fading banner.
- Joining never pauses play behind a first-wave confirmation modal.
- A single-row realm header sits at the top-left of the playable arena. It reads Halls of Realms in the lobby, Waiting for realm while queued, and Wave N during competitive play, followed by Realm Guard, Realm Attacker, and queue information.
- Routine notifications appear at the top-right edge of the playable arena, immediately left of the fixed build columns.
- Training-kill no-reward feedback is an exception to routine notifications: it appears just above the experience/level badge and fades away after a few seconds.
- The health and mana displays sit directly beside the centered experience/level badge rather than stretching toward the arena edges.
- Cooldown spells use a compact Ubuntu-dock-like vertical rail on the left edge, anchored above the bottom-left health display and growing upward as spells are added without a scrollbar.
- Reserve a 220px independently scrolling character/stat column and a 320px independently scrolling permanent equipment column. Each column has its own small arrow toggle and retracts independently to a narrow tab; the arena and HUD reclaim the released width immediately. The inventory uses `min-height: 200px` and `max-height: calc(100vh - 32px)`. Inspection replaces only the character column.
- Keep all arena HUD elements inside the playable width without overlapping the 540px right-side build area.

## 8. Architecture

The codebase is a modular monolith with shared, environment-independent game-domain modules. Browser, canvas, WebSocket, HTTP, and process APIs stay at composition boundaries; progression, content generation, balance, wave construction, inventory transactions, and combat calculations remain pure and directly testable. Randomness, clocks, and identifiers are injected wherever outcomes affect game state.

### Client

- `src/game/Game.ts`: thin browser composition root and fixed-step loop.
- `src/game/ArenaState.ts` and `src/game/systems/`: local arena state plus focused movement, combat, collision, spawning, loot, defeat, and cleanup systems. Systems emit arena events and do not access WebSockets or DOM nodes.
- `src/game/GameObject.ts`: abstract update/render base.
- `src/game/Unit.ts`: health and velocity-based steering shared by hero and creeps.
- `src/game/Hero.ts`: WASD-controlled hero, resources, closest-target auto-aim, and equipped-weapon state.
- `src/game/Creep.ts`: melee and bubble-shooter steering and attack state machines.
- `src/game/AttackArea.ts`: telegraphed, dodgeable melee weapon attack areas.
- `src/game/Projectile.ts`: moving collision-based enemy bubbles.
- `src/game/Map.ts`: fixed arena dimensions, bounds, edge spawning, and arena rendering.
- `src/ui/`: stable DOM views driven by presentation models rather than simulation objects.
- `src/net/SocketClient.ts`: validated WebSocket transport. Session storage is a separate browser adapter.
- Local storage persists only accepted session id and display name, never transient combat state.

### Server and Shared

- `server/server.ts`: process composition and startup only. HTTP/WebSocket transport, repositories, and game services are independently startable and testable.
- `common/protocol.ts`: runtime-validated protocol messages and shared types.
- `common/balance.ts`: typed normal and development balance profiles.
- Shared progression, inventory, content, combat, item, and wave rules live in `common/` and have no browser or server runtime dependencies.

## 9. WebSocket Protocol

Client to server:

- `join`: `{ name, sessionId? }`
- `creepDefeated`: `{ unitId }`
- `collectDrop`: `{ dropId }`
- `equipItem`, `sellItem`, `purgeItem`, `upgradeItem`, `sendItem`, `extractSkill`: `{ tileId }`
- `setStackAutomation`: `{ tileId, mode }`
- `heroDefeated`: `{ sourceUnitId? }`
- `requestWave`: `{}`
- `scoreSnapshot`: `{ score, health }` (reserved for future validation)
- `leaveRealm`: `{}`
- `enterRealm`: `{}`

Server to client:

- `welcome`: `{ playerId, player, progress, realm, config }`
- `realmUpdated`: `{ realm }`
- `incomingWave`: `{ wave }`
- `creepDefeatResolved`: `{ unitId, score, progress, drop?, reason }`
- `waveAdjusted`: `{ waveNumber, reason }`
- `scoreAwarded`: `{ score, reason }`
- `serverNotice`: `{ message }`
- `groundDropCreated`: `{ drop }`

The server records units issued in each wave and accepts a unit defeat at most once. Unit records retain sent-item emitter attribution. XP, score, gold, and drops derive from that record. Generated and equipment-swap drops remain in a server ledger and are collected by opaque id. Protocol payloads are runtime-validated; malformed or out-of-state commands do not mutate player state. The realm/inventory schema is protocol version 4.

## 10. Balance Profiles

- `normal` is the production profile. `dev` is the default for local development; `BALANCE_PROFILE=normal|dev` selects the server profile and public simulation modifiers are sent in `welcome`.
- Normal waves contain `min(40, 10 + 2 * waveNumber)` regular enemies. The raw count stops growing at 40 so long-running games scale through enemy strength rather than unbounded active entities.
- A normal regular enemy uses level `max(floor(heroLevel / regularCount), floor((waveNumber - 1) / 2))`. A rival uses level `max(floor(heroLevel * 0.8), floor((waveNumber - 1) / 2))`.
- The normal profile retains the 60-second wave interval, three-second preparation delay, ten cumulative spawn batches five seconds apart, and rival spawn after 75% of regulars.
- The `dev` profile retains wave timing and composition, but uses 60% enemy damage, 70% enemy health, 150% hero damage, 3x XP, 2x direct-gold probability capped at 100%, and 3x item-drop probability capped at 75%.

## 11. Initial Scope

- Join/resume flow and fixed responsive arena.
- WASD hero with acceleration, bounded movement, camera follow, and health, as specified in `specs/MECHANICS_SPEC.md`.
- Closest-creep auto-aim and automatic equipped-weapon attacks and skills across `specs/MECHANICS_SPEC.md` and `specs/PROGRESSION_SPEC.md`.
- Randomized edge spawns aimed directly at the hero.
- Melee creeps first, followed by ranged bubble shooters.
- Telegraph/resolution attack areas and collision-based bubble projectiles, as specified in `specs/MECHANICS_SPEC.md`.
- Character and inventory HUD with a starting club, allocation controls, backpack, item actions, and enemy inspection.
- Server-authored waves, score awards, and neighbor summaries.

## 12. Future Scope

- Obstacles and pathfinding around them.
- Additional weapon classes, skills, affixes, and particles.
- Account persistence, server-side simulation validation, replays, matchmaking ratings, and mobile controls.

## 13. Development Process

- `specs/SPEC.md`, `specs/MECHANICS_SPEC.md`, and `specs/PROGRESSION_SPEC.md` are the source-of-truth specification set. Update the relevant spec before implementing behavior not already covered.
- Keep filenames, runtime choices, protocols, mechanics, progression rules, and UX synchronized with implementation.
- Use Bun for project scripts and tooling.
- Debug builds may expose `window.__mltDebug` and concise `[MLH][player]` logs for socket, wave, spawn, combat, defeat, and score events.
