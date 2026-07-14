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
- Sending consumes exact equipment and queues it FIFO for future regular creeps. In the lobby or unmatched solo play, the player is shown as their own Realm Guard and Realm Attacker and sends into their own carrier queue. Carrier slots are allocated round-robin across attackers, overflow persists, and each player may retain at most 1,000 active or backlash queue entries.
- Closing a realm reverses undelivered items into hostile backlash queues against their original senders. Backlash pauses in Training Grounds and grants no realm-kill XP.
- A player's first defeat remains marked until the next global wave dispatch. A side is defeated when all members were down during that round. A lethal sent carrier credits its sender `100 * victimLevel` XP and one Soul; neutral and backlash lethals grant no realm-kill reward. Individual defeat reset and wave-halving still apply.
- Leave to Lobby is available after the final planned spawn and before the next global dispatch. Training Grounds repeat the current neutral wave without advancing it, halve enemy movement speed, clamp the hero to at least 1 HP, grant no combat rewards or drops, and allow all inventory management including sends into the player's own future carriers.
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
- Reserve a 220px independently scrolling character/stat column and a 640px permanent equipment column. Each column has its own small arrow toggle and retracts independently to a 30px tab; the arena and HUD reclaim the released width immediately. The inventory spans from the viewport top to a 16px bottom inset with a 200px minimum height. Its currencies and equipment count remain fixed at the top while only the equipment list scrolls. Inspection replaces only the character column.
- Canvas backing dimensions follow the canvas element itself, including every intermediate size during panel collapse/expand transitions; viewport and camera sizing must not depend only on browser-window resize events.
- Keep all arena HUD elements inside the playable width without overlapping the 540px right-side build area.

## 8. Architecture

The codebase is a modular monolith with shared, environment-independent game-domain modules. Browser, canvas, WebSocket, HTTP, and process APIs stay at composition boundaries; progression, content generation, balance, wave construction, inventory transactions, and combat calculations remain pure and directly testable. Randomness, clocks, and identifiers are injected wherever outcomes affect game state.

Stable HTML HUD structures are created once. The fixed simulation loop may update scalar text, style, and ARIA properties, but it does not replace panel, resource, realm, spell, inventory, or form subtrees unless a flattened render signature for that subtree changes. Inventory changes reconcile keyed equipment cards in place: unchanged cards and the scroll container retain their DOM identity, changed cards update at their ordered position, and adding, removing, equipping, or changing a stack quantity never resets the equipment list's scroll position. Canvas owns arena action rendering; HTML remains the accessibility and interaction surface for forms, inventory actions, and persistent stats.

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
- `updateAllocation`: `{ allocation: { agility, strength, magic, spirit, intelligence } }`
- `respecStats`: `{ allocation: { agility, strength, magic, spirit, intelligence } }`; charges `100 * currentLevel`, saves the supplied valid five-point allocation, and reapplies it retroactively to every earned level.
- `creepDefeated`: `{ unitId }`
- `collectDrop`: `{ dropId }`
- `deferDrop`: `{ dropId }`; validates an owned equipment drop pushed beyond the arena and returns it to the same player next wave.
- `equipItem`: `{ tileId }`
- `sellItem`, `purgeItem`, `upgradeItem`, `sendItem`, `extractSkill`: `{ tileId, bulk? }`; `bulk: true` is authored by Shift+click and repeats the selected action server-side until it can no longer make progress.
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
- `collectItemResult`: `{ dropId, collected, reason }`
- `progressionUpdated`: `{ progress, reason }`
- `waveAdjusted`: `{ waveNumber, reason }`
- `scoreAwarded`: `{ score, reason }`
- `serverNotice`: `{ message }`
- `groundDropCreated`: `{ drop }`, where `drop` is a tagged `item`, `gold`, or `scrap` ground reward.

The server records units issued in each wave and accepts a unit defeat at most once. Unit records retain sent-item emitter attribution. XP, score, gold, and drops derive from that record. Generated and equipment-swap drops remain in a server ledger and are collected or deferred by opaque id. Protocol payloads are runtime-validated; malformed or out-of-state commands do not mutate player state. The realm/inventory/skill/weight/passive/deferred-drop/enemy-skill schema is protocol version 16.

The server persists authoritative player identity, score, wave number, progression, attributes, allocation, currencies, learned skills, universal Epic-extraction unlocks, equipped items, inventory stacks, and quantities to a versioned JSON snapshot under `server-data/players.json` by default. Writes atomically replace the snapshot after state-changing commands and wave dispatches. Reconnection presents the opaque player id and recovers that durable state. Realm membership, matchmaking opt-in, issued units, ground drops, incoming sends, backlash queues, and socket state are transient and reset on server start. Browser storage keeps only `{ playerId, name }`; the client never persists or authors authoritative state.

## 10. Balance Profiles

- `normal` is the production profile. `dev` is the default for local development; `BALANCE_PROFILE=normal|dev` selects the server profile and public simulation modifiers are sent in `welcome`.
- Normal waves contain `min(40, 10 + 2 * waveNumber)` regular enemies. The raw count stops growing at 40 so long-running games scale through enemy strength rather than unbounded active entities.
- A normal regular enemy uses level `max(floor(heroLevel / regularCount), floor((waveNumber - 1) / 2))`. A rival uses level `max(floor(heroLevel * 0.8), floor((waveNumber - 1) / 2))`.
- The normal profile retains the 60-second wave interval, three-second preparation delay, ten cumulative spawn batches five seconds apart, and rival spawn after 75% of regulars.
- Development never accelerates progression. The `dev` profile currently uses the same wave, combat, XP, gold, and drop values as `normal`; its separate id remains available for future diagnostics that do not alter player advancement.

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
- Server-side simulation validation, replays, matchmaking ratings, and mobile controls.

## 14. Reimplementation Blueprint

This section records composition details that a clean-room implementation in another language must preserve in addition to the behavior in the other specification sections.

- The browser document contains one full-window application root, a canvas for all world action, and persistent DOM HUD panels. The client creates the game once and opens a WebSocket at `localhost` by default. A URL query such as `?ip=192.168.0.13` selects a valid IPv4 server address; malformed, hostname, IPv6, and out-of-range values fall back to `localhost`. The connection retains the page port and uses `ws` or `wss` according to the page scheme. The client then starts a request-animation-frame renderer plus a fixed 60 Hz simulation accumulator. A rendered frame may contribute at most 100 ms to the accumulator to avoid an unbounded catch-up spiral.
- The world is 1,600 by 1,000 logical pixels. The camera viewport equals the canvas CSS content size, follows the hero, and clamps independently on both axes. Canvas backing width and height equal CSS dimensions multiplied by device pixel ratio, and the 2D context transform restores logical-pixel drawing. Both window resize and `ResizeObserver` trigger this calculation.
- The client validates incoming envelopes before dispatch. Outgoing messages sent before the socket is open are discarded rather than buffered. On socket open, an accepted locally stored session automatically rejoins. The local-storage key is `multi-line-tower.session` and its only fields are `playerId` and `name`; invalid JSON or missing fields is treated as no session.
- Joining trims a name, and the server truncates it to 20 characters and substitutes `Player` for an empty result. A new player starts with score 0, wave 1, no realm opt-in, zero currencies and attributes, the default 1/1/1/1/1 future allocation, Healing level 1, and the Plain Club both equipped and represented by a quantity-one Keep tile.
- The HTTP server serves the built `dist` directory when it exists (otherwise the repository root), maps `/` to `index.html`, uses explicit HTML/JavaScript/CSS/SVG content types, rejects normalized paths outside the public root with 403, and otherwise falls back to `index.html` for missing paths. The WebSocket server shares that HTTP listener and accepts connections only at `/ws`. It listens on LAN-reachable `0.0.0.0:3000` by default so the machine is available as `olim3.local`; `HOST`/`PORT` may override it. Production defaults to `normal`, other environments to `dev`, and an explicit valid `BALANCE_PROFILE=normal|dev` overrides that default.
- Each connection must join before gameplay commands. Invalid JSON or schema-invalid input receives `Ignored invalid message.`; a valid non-join command before identification receives `Join before playing.` A connection is associated with the accepted player id. The player disconnects only when its final simultaneous socket closes.
- A single 60-second server timer drives global wave dispatch. At dispatch, every realm's down set is cleared; every connected realm member or opted-in solo increments its wave, while Training Grounds players repeat without incrementing; then every connected player receives the correct competitive, solo, or training wave. State is persisted after joins, commands, global dispatches, and orderly server close.
- Persistence is a versioned JSON snapshot written through a temporary file followed by atomic rename. Durable data is identity, name, score, wave, and the complete `PlayerProgress`. On load, runtime-only connection, realm, issued-unit, ground-drop, and queue state is rebuilt empty; saved level/XP and newer inventory fields are migrated to valid current defaults.
- Runtime validation is intentionally asymmetric in this prototype: client commands receive full discriminated-union validation, while server messages are validated by their recognized `type` envelope and then treated as the matching typed payload. Protocol compatibility is numeric version 16 delivered in `welcome`.
- Stable-DOM performance is behavioral: scalar resource/XP values update in place each frame; expensive character, spell, realm, and inventory subtrees are replaced only when their flattened signatures change. Canvas owns map, units, telegraphs, projectiles, drops, spell effects, selection, indicators, and floating combat text; DOM owns joining and all persistent interactive controls.

## 13. Development Process

- `specs/SPEC.md`, `specs/MECHANICS_SPEC.md`, and `specs/PROGRESSION_SPEC.md` are the source-of-truth specification set. Update the relevant spec before implementing behavior not already covered.
- Keep filenames, runtime choices, protocols, mechanics, progression rules, and UX synchronized with implementation.
- Use Bun for project scripts and tooling.
- Debug builds may expose `window.__mltDebug` and concise `[MLH][player]` logs for socket, wave, spawn, combat, defeat, and score events.
