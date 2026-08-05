# Multi-Line Hero SPEC

## 1. Product Summary

Multi-Line Hero is a multiplayer-first browser arena survival game. Each player controls a hero in a private fixed arena while server-authored creep waves enter from outside the arena edges and converge on the hero. Players survive, collect weapons, and indirectly pressure nearby matched players through future creep-wave systems.

## 2. Core Goals

- Run as a Vite TypeScript client with Bun for all tooling and the local server runtime.
- Render the arena and combat on a full-window responsive canvas.
- Use stable HTML overlays for joining, player status, neighbors, wave notices, and inventory.
- Run a Bun TypeScript server serving the built client and gameplay WebSockets at `/ws`.
- Keep username identity, single-session presence, score, wave turns, and neighbor links authoritative on the server and persist player records through Bun SQL.
- Share WebSocket message types through `common/protocol.ts`.
- Keep mechanics in `specs/MECHANICS_SPEC.md` and progression/item/build rules in `specs/PROGRESSION_SPEC.md`.

## 3. Specification Boundaries

- `specs/SPEC.md` is authoritative for product goals, runtime architecture, server ownership, multiplayer/economy boundaries, UX direction, WebSocket protocol, and development process.
- `specs/MECHANICS_SPEC.md` is authoritative for arena simulation, movement, targeting, attack telegraphs, projectiles, collision resolution, damage sources, and local defeat reset.
- `specs/PROGRESSION_SPEC.md` is authoritative for permanent XP, attributes, derived stats, item generation, equipment, shared skill rules, generated enemy builds, drops, wave composition, and rival scaling. `specs/spells/` contains the authoritative per-spell contracts; `specs/item-effects/` contains the authoritative contracts for item-applied slow effects.

## 4. Hero and Combat Summary

- Every joined player controls one hero in a private fixed arena, initially placed at the arena center.
- The hero has health instead of lane lives.
- Enemy body contact does not damage the hero; see `specs/MECHANICS_SPEC.md` for damage sources and attack resolution.
- A newly created player is empty-handed and receives exactly three randomly generated level-0 Common equipment items in the backpack. This starter roll happens only once at account creation; defeat neither grants nor rerolls starter equipment. Existing saved players keep their current equipment when this default changes. Plain Clubs remain valid legacy and generated equipment, but the game never creates one as an equipment fallback.
- Generated enemy weapons can drop into the arena and be collected into the backpack. Weapon classes, requirements, affixes, skills, and progression follow `specs/PROGRESSION_SPEC.md`.
- Hero auto-aim, automatic attacks, attack areas, projectiles, and dodge rules follow `specs/MECHANICS_SPEC.md`.
- Active weapon and learned skill availability, costs, and scaling follow `specs/PROGRESSION_SPEC.md`.
- Particle effects remain future work.

## 5. Creep and Wave Rules

- The server advances a numbered wave turn for each connected player and sends one `incomingWave` payload per turn.
- The client only spawns creeps described by server-authored waves and staggers them using the supplied interval. Browser focus loss or a delayed frame never releases a backlog together: at most one due creep is released per fixed update, preserving the authored spawn debounce while catching up.
- Early waves contain melee creeps. Beginning with wave 3, waves also contain ranged bubble shooters, with their presence increasing later.
- Creep spawn positioning, steering, melee telegraphs, ranged projectiles, and collision behavior follow `specs/MECHANICS_SPEC.md`.
- Wave size, spawn batching, generated enemy builds, XP, drops, and rival scaling follow `specs/PROGRESSION_SPEC.md`.
- Killing a creep awards its bounty locally and its score value through the server.
- A creep no longer leaks or exits through a lane.
- Defeat is reported to the server. Before resetting the player's authoritative wave number to 0, the server retains the highest non-Training wave that hero has reached as a permanent profile best, then sends the adjusted wave number back to the client and neighbor summaries. The profile best never decreases across defeats.
- After the local defeat reset finishes, the client requests a replacement wave. The server sends a fresh wave-1 `incomingWave` with the normal preparation delay; this replacement request must not increment the wave number again. Any automatic rematch or later explicit Enter Realm after that death also begins at wave 1.

## 6. Multiplayer and Economy

- Players start in the Halls of Realms lobby and must explicitly choose Enter Realm before matchmaking. Connected, opted-in players are placed in stable server-owned 1v1, 1v2, or 1v3 realm groups until disconnect, voluntary exit, or realm defeat.
- Enter Realm starts play immediately even when no opponent is available. Its button gesture requests browser fullscreen for the complete game document before matchmaking begins; denial or lack of fullscreen support never blocks realm entry. An unmatched opted-in player receives solo waves while remaining eligible for matchmaking; solo waves use normal combat and defeat rules, but award half the normal XP. A newly formed realm replaces the active solo wave with a fresh competitive wave.
- The indexed SQL level column supports hero lookup by level. Live realm discovery intersects those durable hero records with the server's in-memory connected and opted-in set, then starts with the highest-level waiting player and chooses one to three lower-level opponents whose combined level is closest. Ties prefer fewer opponents, longer wait, then username; no level gap is rejected.
- A 1v1 is reciprocal. In 1v2/1v3 every team member attacks the solo player and the solo player's outgoing sends rotate across the team.
- Realm Guard identifies outbound recipients and Realm Attacker identifies inbound senders. The HUD shows their names, levels, down state, and queued items.
- Sending consumes exact equipment and queues it FIFO for future regular creeps. In the lobby or unmatched solo play, the player is shown as their own Realm Guard and Realm Attacker and sends into their own carrier queue. Carrier slots are allocated round-robin across attackers, overflow persists, and each player may retain at most 1,000 active or backlash queue entries.
- A regular creep that has another player's sent item equipped shows that player's username above the creep. Merely carrying a sent item without equipping it does not show the username.
- Closing a realm reverses undelivered items into hostile backlash queues against their original senders. Backlash pauses in Training Grounds and grants no realm-kill XP.
- A player's first defeat remains marked until the next global wave dispatch. A side is defeated when all members were down during that round. Every non-Training death resets XP, level, base attributes, and the authoritative wave number to 0, retains inventory, and removes half of Gold and Souls rounded down; an attributable opposing player receives the removed currency. Every member of the active realm receives a chat-log system announcement naming the defeated player; when an opposing player's sent carrier dealt the killing blow, the announcement also names that carrier's owner. A lethal sent carrier additionally credits its sender one Soul but no XP; enemy XP never derives from another player's level. Neutral and backlash lethals grant no realm-kill bonus. A player may use the Kill Player action to trigger the same reset from any mode. Before either a combat death or voluntary death resets the build, the server queues a hostile echo with that hero's exact level, base stats, main hand, offhand, amulet, and charm for the highest-level hero on the server when that hero is someone else; ties use leaderboard order. The echo joins that recipient's next eligible wave. The highest-ranked hero's own deaths do not create echoes for a lower-ranked hero.
- Leave to Lobby is available after the final planned spawn and before the next global dispatch. Training Grounds repeat the current neutral wave without advancing it, halve enemy movement speed, clamp the hero to at least 1 HP, grant no combat rewards or drops, and allow all inventory management including sends into the player's own future carriers.
- Enter Realm is available at any time. Training continues until matching succeeds, then a fresh competitive wave starts with the normal preparation delay.
- The former tower-building and creep-purchase economy is removed from the active UI and protocol.
- Gold is granted occasionally and directly for defeated enemies according to `specs/PROGRESSION_SPEC.md`, and through manual item sales. Passive income and purchasing are not part of this slice.
- Neutral, competitive, backlash, and training waves are always supplied by the server.

## 7. Visual and UX Direction

- A creep inspection character panel is intentionally compact: it shows only the creep name, level, live/current HP against combat maximum HP, current timed states, unmodified base attributes, and equipped Main hand, Offhand, Amulet, and Charm details. It does not show XP reward or the derived Effective stats section. Local and public hero character panels retain their existing advanced-stat presentation.
- Pointer-hover creep preview never replaces or expands the character panel. It appears as a compact, non-interactive tooltip centered at the top of the arena and shows only name, level, live/current HP against combat maximum HP, current timed states, equipped-item icons, and unmodified base attributes. Poison, Burn, Bleed, Frost/Freeze, Stun, Shock, Curse, Rapid Regeneration, and Reflective Surge use compact state badges, including stack count and remaining duration when applicable. Leaving the creep hides the tooltip and preserves whichever hero or committed creep inspection was already shown in the character panel.

- Use futuristic, simple geometric shapes with no required external art pipeline.
- Telegraph and combat rendering rules follow `specs/MECHANICS_SPEC.md`.
- Show controls, drops, and inspected enemy highlight. Every local or public hero profile header shows that hero's lifetime best wave beside their level. Selecting a creep replaces the character column with its inspection details, shows its live combat maximum HP after enemy-level and sent-item scaling rather than its unscaled derived build HP, and shows the XP that defeating that creep is currently worth after mode and balance reward modifiers; Training Grounds therefore show 0 XP. Moving over an active creep temporarily peeks the same inspection details without changing the committed selection, and moving away from all creeps restores the previously selected creep, hero, or local character sheet. Guard and attacker names in the realm header are clickable and replace the same character column with that hero's public stats and equipment; the same Back to hero button restores the local hero. The realm header includes a destructive Kill Player action. The current first-ranked leaderboard hero has a warning icon before their name everywhere realm membership is shown; its hover/focus tooltip explains that all other heroes' death echoes are sent into that hero's realm to fight.
- Show movement and auto-attack guidance as a centered, non-blocking notification that fades after a few seconds.
- A newly created hero sees a one-time, non-blocking multiplayer introduction beside the realm controls. Its FTUE lore frames survival as the continuity of the hero's bloodline: Training Grounds prevent defeat, but after a real defeat in a realm the fallen hero's child takes over. This succession explains why XP, level, base attributes, and wave progress reset while inherited equipment remains and only half of Gold and Souls are lost. It explicitly teaches that, while in a realm, the player can use an inventory item's `Send` button to invade another player's realm by arming a named creep in one of that player's future waves. In Training Grounds or unmatched solo play, the same action instead queues the item for the player's own future carrier, consistent with the realm rules. The introduction remains until explicitly dismissed, its dismissal is durable, and existing heroes created before this trigger was introduced do not receive it retroactively.
- Wave starts do not show a banner or routine notification; the fixed header's current-wave value is the persistent indication. Each dispatched wave is announced in the chat log as yellow system text containing its wave number and mode. When a competitive realm forms, yellow system messages announce every participant joining the realm to every member.
- Joining never pauses play behind a first-wave confirmation modal.
- The 3D canvas fills 100% of the viewport width and height. The compact game-information row, character panel, inventory panel, and all other stable HTML HUD surfaces float above it without resizing, offsetting, or pushing the canvas inward.
- The game page suppresses the browser context menu across both the canvas and every HTML HUD surface so right-button camera interaction never opens a native menu.
- A single-row, borderless realm summary sits at the left of the game-information header while queued or inside a realm. It includes `Wave N`, reads Waiting for realm while queued, and shows Realm Guard, Realm Attacker, queue information, and Leave to Lobby; leaving is disabled and gray until the server permits it. In the Training Grounds lobby, realm entry is instead presented in a centered modal with Enter Realm and Logout actions, keeping the decision prominent and out of the header. Kill Player appears only after entering a realm. When the current hero is highest-ranked, the same death-echo warning shown beside realm names also appears beside that hero's name in the character panel.
- Routine notifications appear near the canvas's top-right edge without changing the canvas dimensions.
- Training-kill no-reward feedback is an exception to routine notifications: it appears just above the experience/level badge and fades away after a few seconds.
- The health and mana displays sit directly beside the centered experience/level badge rather than stretching toward the arena edges. When either resource decreases, its colored fill updates immediately while a white recent-loss segment holds the previous value. Repeated losses debounce that segment's catch-up; after a short pause it animates down to the current value in the familiar fighting-game damage-bar style. Resource gains synchronize the segment immediately.
- Cooldown spells use one compact Ubuntu-dock-like vertical Spells rail on the left edge, anchored above the bottom-left health display. It shows only the six equipped active spells, shared regardless of whether each spell is learned permanently or granted by equipment, ordered by shortcut with `1` at the bottom and `6` at the top. Each badge centers its shortcut near the top inside a translucent, resource-colored circle; manual slots show their assigned key number, while auto-fire slots show a small dot instead of that number. The centered spell acronym and its current effective level share one vertically aligned line formatted like `HE lv12`, with a space before the smaller 8px white level label and no maximum-level suffix; auto-fire also retains its four gold corner triangles. The rail uses the same slight corner rounding at its top and bottom. A small `...` control beside the rail, or `K`, opens the Available Spells modal. The modal is vertically scrollable and shows every authored spell, dark and desaturated while unavailable, grouped and sorted by its payment resource in HP, Rage, then Mana order. Every entry shows its authored description, resource, active/passive type, current available level when acquired, and its separate maximum permanently learned level from extraction; temporary equipment levels never inflate that learned value. Hovering or focusing an acquired active spell then pressing `1` through `6` assigns it to that exact loadout slot, replacing the prior occupant. Passive spells are visible in the catalog but never occupy a shortcut slot. The rail and modal are the complete activation surface: a spell outside the equipped rail never triggers.
- The spell modal interaction supersedes its earlier number-key assignment wording: it shows six numbered destination slots at the top; tapping or clicking an acquired active spell selects it, then tapping or clicking a destination assigns and replaces that slot. The catalog preserves scroll position across continuous combat updates and supports wheel, touch-pan, scrollbar, and keyboard scrolling. A persistent Learned only checkbox hides every spell whose permanent extracted level is zero, including gear-only spells; unavailable cards remain visible when the filter is off. Gameplay number keys continue to cast their assigned spells.
- The Spells rail places every available passive above the six active loadout badges. Passive and active badges share the same full size; passives show their effective level and tooltip, remain visibly resource-colored or dark when non-operational, and have no shortcut, auto-fire marker, or equip interaction because availability activates them automatically. The rail expands to its contents and has no scrollbar or internal scrolling.
- The spell catalog has two persistent three-state filters that apply simultaneously as an intersection. Type selects Both, Active, or Passive. Learning selects Both, Learned, or Not learned; for example, Passive plus Learned shows only learned passives. A spell counts as Learned when its permanent extracted level is positive; spells have no minimum hero-level requirements. Empty resource sections hide while either or both filters are active.
- Use a 320px independently scrolling character/stat panel and a 640px equipment panel as floating canvas overlays. Each panel has its own small arrow toggle and retracts independently to a 30px tab; `C` toggles the character panel, while either `I` or `V` toggles inventory when keyboard focus is not in an editable control. Hovering either arrow button shows its current Expand/Collapse action and primary shortcut: `C` for Character and `V` for Inventory. The inventory spans from the viewport top to a 16px bottom inset with a 200px minimum height. Its currencies and equipment count remain fixed at the top while only the equipment list scrolls. Committing a creep selection forces the character panel open and replaces its contents with that creep; clearing the selection restores the local hero and the panel's exact pre-selection open/closed state. Temporary pointer inspection does not change that saved state.
- Canvas backing dimensions follow the full-viewport canvas element. Panel collapse/expand transitions never change those dimensions; viewport and camera sizing still observe the canvas element rather than depending only on browser-window resize events.
- Keep essential arena HUD elements readable when the floating build panels overlap the canvas.
- On touch-capable devices, a one-finger drag on unobstructed canvas space controls camera yaw and pitch with the same bounds and inverted local-X behavior as right-mouse dragging. A compact virtual movement stick appears near the lower-left arena edge and supplies camera-relative analog movement without blocking HUD controls. Touch-oriented viewports at 900 CSS pixels wide or less render the HTML HUD at 72% scale so it occupies less of the mobile play area while the 3D canvas remains full-viewport.
- Player-facing floating-point values use at most two digits after the decimal point across HUD sheets, spell tooltips, costs, and item details; authoritative calculations retain full precision.

## 8. Architecture

The codebase is a modular monolith with shared, environment-independent game-domain modules. Browser, canvas, WebSocket, HTTP, and process APIs stay at composition boundaries; progression, content generation, balance, wave construction, inventory transactions, and combat calculations remain pure and directly testable. Randomness, clocks, and identifiers are injected wherever outcomes affect game state.

Stable HTML HUD structures are created once. The fixed simulation loop may update scalar text, style, and ARIA properties, but it does not replace panel, resource, realm, spell, inventory, or form subtrees unless a flattened render signature for that subtree changes. Inventory changes reconcile keyed equipment cards in place: unchanged cards and the scroll container retain their DOM identity, changed cards update at their ordered position, and adding, removing, equipping, or changing a stack quantity never resets the equipment list's scroll position. Resource updates revalidate resource-gated inventory actions; an equipment card's signature changes only when the resulting action availability changes, not for every balance change. Canvas owns arena action rendering; HTML remains the accessibility and interaction surface for forms, inventory actions, and persistent stats.

Inventory equipment cards reserve a compact fixed-width action column so item names, requirements, effects, and combat values remain readable inside each column of the 640px, two-column inventory drawer. Sell, Purge, Upgrade, Send, and Extract buttons use concise labels and remain full-width only within that narrow action column.

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
- Local storage persists only the accepted opaque hero id and username for reconnect convenience, never authoritative progression or transient combat state. Logout erases that reference.

### Server and Shared

- `server/server.ts`: process composition and startup only. HTTP/WebSocket transport, the Bun SQL repository, and game services are independently startable and testable.
- The server writes concise player and realm lifecycle logs using opaque hero ids and usernames. A hero is connected only after a successful id reconnect or case-insensitive username login claims that hero's single in-process active session.
- `common/protocol.ts`: runtime-validated protocol messages and shared types.
- `common/balance.ts`: the single authoritative wave, combat, and reward balance configuration used in every environment.
- Shared progression, inventory, content, combat, item, and wave rules live in `common/` and have no browser or server runtime dependencies.

## 9. WebSocket Protocol

Client to server:

- `join`: exactly one of `{ name }` or `{ heroId }`; a name creates or loads a case-insensitive username, while an opaque id reconnects a saved browser. It is rejected with `That username is already logged in.` while the hero owns a responsive active socket.
- `logout`: `{}`; releases the active hero immediately, performs normal realm cleanup, clears that hero's transient arena and queue state, and leaves the socket anonymous.
- `listHeroes`: `{}`; available before login and returns the public leaderboard.
- `inspectHero`: `{ heroId }`; available before login and returns the public build projection for one hero.
- `dismissPanelTrigger`: `{ panel: "character" | "inventory" | "multiplayer" }`; durably consumes that hero's pending one-time panel auto-open trigger or multiplayer introduction.
- `updateAllocation`: `{ allocation: { agility, strength, magic, spirit, intelligence } }`
- `respecStats`: `{ allocation: { agility, strength, magic, spirit, intelligence } }`; charges `100 * currentLevel`, saves the supplied valid five-point allocation, and reapplies it retroactively to every earned level.
- `creepDefeated`: `{ unitId }`
- `collectDrop`: `{ dropId }`
- `reconcileDrops`: `{ activeDropIds, pendingDropIds }`; reports the client's current arena-drop view so transiently lost pickup requests and orphaned Gold, Scrap, or equipment can be repaired.
- `deferDrop`: `{ dropId }`; validates an owned equipment drop pushed beyond the arena and returns it to the same player next wave.
- `equipItem`: `{ tileId }`
- `sellItem`, `purgeItem`, `upgradeItem`, `sendItem`, `extractSkill`: `{ tileId, bulk? }`; `bulk: true` is authored by Shift+click and repeats the selected action server-side until it can no longer make progress.
- `setRarityAction`: `{ rarity, action }`; changes the auto-action preference for a rarity tier. `action` is one of `"keep"`, `"auto-sell"`, `"auto-purge"`, or `"auto-send"`. The server persists the choice in `progress.rarityActions` and applies it to future item collections.
- `setSkillEquipped`: `{ skillId, equipped }`; adds or removes one available active spell from the persisted spell loadout. At most six active spells may be equipped; the server rejects unavailable skills, passive skills, and additions beyond the limit.
- `toggleSkillAutoFire`: `{ skillId }`; toggles automatic firing for an equipped active spell. Auto-fire is cleared when that spell is unequipped.
- `heroDefeated`: `{ sourceUnitId? }`
- `requestWave`: `{}`
- `scoreSnapshot`: `{ score, health }` (reserved for future validation)
- `leaveRealm`: `{}`
- `enterRealm`: `{}`
- `chat`: `{ text }`; sends a text message to every member of the sender's realm. The server ignores the message if the sender is not currently in a realm.

Server to client:

- `welcome`: `{ playerId, player, progress, realm, config }`
- `loggedOut`: `{}`
- `leaderboard`: `{ heroes }`, ordered by level descending and username ascending; each entry contains `{ id, username, level, connected, receivesDeathEchoes }`. Connected heroes use a filled teal row in the anonymous hero list, while offline heroes use a transparent teal outline with high-contrast text so their names and levels remain readable. The death-echo flag is true only for the first-ranked hero.
- `heroProfile`: `{ hero }`; the public hero projection contains id, username, level, attributes, equipped items, and learned/equipped skill state, but excludes currencies and backpack contents.
- `realmUpdated`: `{ realm }`
- `incomingWave`: `{ wave }`; `wave.resetHero` is true only when entering a newly requested solo realm or newly matched competitive realm, and false for ordinary dispatches within the current realm.
- `creepDefeatResolved`: `{ unitId, score, progress, drop?, reason }`
- `collectItemResult`: `{ dropId, collected, reason }`
- `dropsReconciled`: `{ drops, removeDropIds, resolvedDropIds }`; returns every server-ledger drop missing from the client, identifies client-only drops to remove, and releases pending pickup ids whose outcome can no longer arrive.
- `progressionUpdated`: `{ progress, reason }`
- `waveAdjusted`: `{ waveNumber, reason }`
- `scoreAwarded`: `{ score, reason }`
- `serverNotice`: `{ message }`
- `chatMessage`: `{ senderId, senderName, text, kind? }`; sent to all members of a realm when one member sends a chat. Also used by the server at wave dispatch to notify a player that another player's sent creeps arrived in their realm; these notices retain the opposing sender id so the name is red. `kind: "system"` omits the sender prefix and renders the text in yellow for wave, realm-join, and death announcements. Ordinary chat displays `senderName: text` with the name in green when the sender is on the same side (both guard or both attacker) and in red when they are an opponent.
- `groundDropCreated`: `{ drop }`, where `drop` is a tagged `item`, `gold`, or `scrap` ground reward.

The server records units issued in each wave and accepts a unit defeat at most once. Unit records retain sent-item emitter attribution. XP, score, gold, and drops derive from that record. Generated and equipment-swap drops remain in a server ledger and are collected or deferred by opaque id. The client reconciles its active and pending opaque drop ids after connection recovery and whenever a pickup acknowledgement times out. The server's ledger is authoritative: client-only drops are removed, server-only drops are reissued, and pending ids absent from the ledger are released because they were already collected, retired with the arena, or otherwise resolved. Reissued drops appear at the hero's current position because drop positions are client-owned simulation state. Protocol payloads are runtime-validated; malformed or out-of-state commands do not mutate player state. Protocol compatibility is numeric version 37.

Bun SQL is the authoritative durable hero store. The `heroes` table has four columns: indexed opaque `id`, indexed `username`, indexed `level`, and serialized JSON text `hero`. The blob contains score, current and maximum wave numbers, XP, attributes, allocation, currencies, learned skills and levels, universal unlocks, disabled skill ids, equipped items, inventory stacks, and quantities; the indexed level always matches the blob's progression level. Usernames allow 1–20 ASCII letters, digits, `_`, or `-`, preserve display casing, and use a unique index on `lower(username)`. With no `DATABASE_URL`, local development uses `sqlite://./server-data/players.sqlite`; when present, `DATABASE_URL` selects production and must be a `postgres://` or `postgresql://` connection. Existing JSON snapshots are not imported. Realm membership, matchmaking opt-in, issued units, ground drops, deferred items, incoming sends, backlash queues, and socket state exist only in memory.

## 10. Balance Profiles

- Local development and production use the same authoritative balance and progression configuration; there is no development balance variant. Public simulation modifiers are sent in `welcome`.
- Normal waves contain `min(40, 10 + 2 * max(0, waveNumber - 1))` regular enemies. Wave 1 therefore starts with 10 regular enemies. The raw count stops growing at 40 so long-running games scale through enemy strength rather than unbounded active entities.
- A normal regular enemy uses level `max(floor(heroLevel / regularCount), floor((waveNumber - 1) / 2))`. A normal golden rival uses the wave-authored level `max(1, floor((waveNumber - 1) / 2) + 1)`. The divisible-by-10 competitive clone event defined in `specs/PROGRESSION_SPEC.md` is the explicit exception: clone level and rewards divide the current defender's level across the opposing attackers.
- The normal profile retains the 60-second wave interval, three-second preparation delay, ten cumulative spawn batches five seconds apart, and rival spawn after 75% of regulars.
- Development never accelerates progression. The `dev` profile currently uses the same wave, combat, XP, gold, and drop values as `normal`; its separate id remains available for future diagnostics that do not alter player advancement.

## 11. Initial Scope

- Join/resume flow and fixed responsive arena. While anonymous, the join panel displays connection and server notices—including username-in-use rejection messages—without requiring a successful login. When the gameplay WebSocket closes, both the join panel and in-game notification area display `Server disconnected. Reconnecting...` while the client retries; a successful anonymous reconnection restores the normal join prompt, while a saved session proceeds through the normal resume notice.
- WASD hero with acceleration, bounded movement, camera follow, and health, as specified in `specs/MECHANICS_SPEC.md`.
- Closest-creep auto-aim and automatic equipped-weapon attacks and skills across `specs/MECHANICS_SPEC.md` and `specs/PROGRESSION_SPEC.md`.
- Randomized edge spawns aimed directly at the hero.
- Melee creeps first, followed by ranged bubble shooters.
- Telegraph/resolution attack areas and collision-based bubble projectiles, as specified in `specs/MECHANICS_SPEC.md`.
- Character and inventory HUD with the Plain Club and three-item random starter backpack, allocation controls, item actions, and enemy inspection.
- Server-authored waves, score awards, and neighbor summaries.

## 12. Future Scope

- Obstacles and pathfinding around them.
- Additional weapon classes, skills, affixes, and particles.
- Server-side simulation validation, replays, matchmaking ratings, and mobile controls.

## 14. Reimplementation Blueprint

This section records composition details that a clean-room implementation in another language must preserve in addition to the behavior in the other specification sections.

The current client intentionally uses the proven legacy Three.js WebGL renderer for the main scene because the WebGPU path can silently omit loaded GLB character materials. WebGPU remains deferred until those assets are compatible.

- The browser document contains one full-window application root, a canvas for all world action, and persistent DOM HUD panels. Three.js prefers its WebGPU backend, but falls back to the legacy WebGL renderer when WebGPU is unavailable, initialization fails, or a WebGPU render pipeline fails at runtime; the fallback keeps the game usable on browsers and drivers with incomplete WebGPU support. The client always opens `/ws` on the page's own host and port by default, using `ws` for an HTTP page and `wss` for HTTPS. A bare `?prod` shortcut connects to `wss://pvp.up.railway.app/ws`. A `?server=<baseurl>` query overrides both the page origin and `prod`; the legacy `?ip=<baseurl>` query is an equivalent fallback when `server` is absent and also takes precedence over `prod`. A bare authority such as `?server=pvp.up.railway:443` defaults to secure WebSockets, while an explicit `http`, `https`, `ws`, or `wss` URL selects its corresponding WebSocket scheme; local or LAN overrides that do not support TLS therefore use an explicit `ws://` URL. The client appends `/ws` to the override's optional base path unless that path already ends in `/ws`. Empty, malformed, credential-bearing, or unsupported-protocol overrides fall back to the page origin. After renderer initialization succeeds, the client starts a request-animation-frame renderer plus a fixed 60 Hz simulation accumulator. A rendered frame may contribute at most 100 ms to the accumulator to avoid an unbounded catch-up spiral. A one-second timeout watchdog checks the elapsed time since the last real animation-frame callback; when that callback has been stale for at least 750 ms, the watchdog advances and renders one frame through the same capped accumulator path. The watchdog never requests another animation frame and does not advance when normal animation frames are current, preventing both a background-tab spawn backlog and competing foreground loops.
- The world is 32 by 20 meters, represented internally by 1,600 by 1,000 logical canvas pixels at the shared presentation scale of 50 logical pixels per meter. Gameplay descriptions and HUD values use meters or meters per second; internal simulation and layout geometry may retain logical pixels. The camera viewport equals the canvas CSS content size and always centers on the hero. When the viewport is smaller than the arena the hero is kept at center as long as the arena edges remain visible; when the viewport is larger than the arena the map is centered on screen. Canvas backing width and height equal CSS dimensions multiplied by device pixel ratio, and the 2D context transform restores logical-pixel drawing. Both window resize and `ResizeObserver` trigger this calculation.
- The client validates incoming envelopes before dispatch. Outgoing messages sent before the socket is open are discarded rather than buffered. On socket open, a locally stored opaque hero id may be submitted automatically. The local-storage key is `multi-line-tower.session` and contains only `{ heroId, username }`; invalid JSON, non-string values, or missing/empty fields are treated as no session. Unavailable browser storage is tolerated during load, save, and logout; logout attempts to clear the reference without interrupting the client.
- Joining by name trims the value, requires 1–20 ASCII letters, digits, `_`, or `-`, preserves its display casing, and compares it case-insensitively. The first accepted use creates the hero; later use loads that same hero without a password or secret. This username-possession login is an explicit prototype trust boundary and is not suitable for hostile public deployment without authentication. A new hero starts with the specified Throwing Axe/Buckler loadout and progression defaults.
- The HTTP server serves the built `dist` directory when it exists (otherwise the repository root), maps `/` to `index.html`, uses explicit HTML/JavaScript/CSS/SVG content types, rejects normalized paths outside the public root with 403, and otherwise falls back to `index.html` for missing paths. The WebSocket server shares that HTTP listener and accepts connections only at `/ws`. It listens on LAN-reachable `0.0.0.0:3000` by default so the machine is available as `olim3.local`; `HOST`/`PORT` may override it. Every environment uses the same authoritative balance configuration.
- Each connection must join before gameplay commands. Anonymous sockets may request leaderboard summaries and public hero profiles. Invalid JSON or schema-invalid input receives `Ignored invalid message.`; other commands before identification receive `Join before playing.` Only one socket in the authoritative game-server process may own a hero. Logout or disconnect releases it immediately.
- The server runs WebSocket heartbeat checks using ping/pong. A socket without a pong or other valid inbound activity for five minutes is terminated and processed through normal disconnect cleanup. The five-minute application timeout is authoritative even when the WebSocket library or deployment platform has a different default.
- A single 60-second server timer drives global wave dispatch. At dispatch, every realm's down set is cleared; every connected realm member or opted-in solo increments their wave, while Training Grounds players repeat without incrementing; then every connected player receives the correct competitive, solo, or training wave.
- Durable hero changes remain authoritative in server memory and mark the affected player record dirty. The serialized profile includes the resettable current wave and monotonic maximum wave reached; public profile inspection displays that lifetime best. A separate one-minute write-behind timer snapshots and upserts only dirty players. SIGINT and SIGTERM begin one idempotent graceful shutdown: the server stops accepting new commands and connections, immediately sends WebSocket close code 1012 (service restart) to every client, drains already accepted per-socket command chains, performs and awaits a final dirty flush, closes SQL, force-terminates any socket that did not complete its close handshake, and closes HTTP before exiting successfully. Database flush and close therefore cannot be delayed by lingering sockets within the host's 10-second termination grace period. Gameplay commands, joins, and wave dispatch do not synchronously wait for database writes. A failed batch restores its dirty flags for a later retry and is logged; therefore an abrupt process or machine failure can lose at most the unflushed interval of progression.
- Startup creates `heroes(id TEXT PRIMARY KEY, username TEXT NOT NULL, level INTEGER NOT NULL, hero TEXT NOT NULL)`, a unique `lower(username)` index, and a level index through Bun SQL. Repository operations are asynchronous and serialize writes so older snapshots cannot overwrite newer state. SQL startup failures stop the server. The default local SQLite parent directory is created before connection. Production connection credentials are never logged.
- Runtime validation is intentionally asymmetric in this prototype: client commands receive full discriminated-union validation, while server messages are validated by their recognized `type` envelope and then treated as the matching typed payload. Protocol compatibility is numeric version 37 delivered in `welcome`.
- When logged out, the client shows the join form and a complete leaderboard ordered by level descending then username ascending. The server pushes a fresh leaderboard to every anonymous connected socket whenever a hero joins, logs out, or loses their final socket, so online styling reflects current in-process presence without a page refresh. Clicking a row renders the selected hero's attributes, effective stats, equipped items, and skill state read-only in the character panel; currencies, backpack contents, allocation controls, and actions remain hidden. Logout clears the saved reference, resets the local arena, and returns to this anonymous view without closing the socket.
- A newly created hero starts with the character and inventory panels collapsed and with the multiplayer introduction pending. The character panel automatically opens once when that hero first reaches level 1, and the inventory panel automatically opens once when the first non-starter item is stored. Each trigger is a durable boolean in the hero blob. Its automatic opening or explicit dismissal consumes it; manually toggling a panel before its trigger also consumes that panel trigger, so later progression never overrides the player's choice. These visibility changes do not alter or preview gameplay state.
- Stable-DOM performance is behavioral: scalar resource/XP values update in place each frame; expensive character, spell, realm, and inventory subtrees are replaced only when their flattened signatures change. Canvas owns map, units, telegraphs, projectiles, drops, spell effects, selection, indicators, and floating combat text; DOM owns joining and all persistent interactive controls.

## 13. Development Process

- `specs/SPEC.md`, `specs/MECHANICS_SPEC.md`, and `specs/PROGRESSION_SPEC.md` are the source-of-truth specification set. Update the relevant spec before implementing behavior not already covered.
- Keep filenames, runtime choices, protocols, mechanics, progression rules, and UX synchronized with implementation.
- Use Bun for project scripts and tooling.
- Debug builds may expose `window.__mltDebug` and concise `[MLH][player]` logs for socket, wave, spawn, combat, defeat, and score events.
