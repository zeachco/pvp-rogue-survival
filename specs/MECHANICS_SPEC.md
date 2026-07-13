# Mechanics SPEC

This specification extends `specs/SPEC.md` and is authoritative for arena simulation, movement, targeting, telegraphs, projectiles, collision resolution, and local defeat reset behavior. Progression, itemization, stat formulas, wave composition, generated builds, XP, drops, and rival scaling belong in `specs/PROGRESSION_SPEC.md`.

## Simulation Loop

- The client owns local arena simulation for the active combat slice.
- A fixed client update advances hero input, acceleration-based movement, creep steering, attack telegraphs, hit areas, projectiles, collisions, local wave spawn timing, and camera following.
- Rendering draws the fixed arena, hero, creeps, attack areas, projectiles, health bars, and combat hints.
- The camera follows the hero and remains clamped to the arena bounds.
- Arena edges do not move or expand.
- Simulation state is advanced by focused systems over an explicit arena state. Systems receive time and random sources as inputs and emit typed events for networking and presentation; they never directly access the DOM or WebSocket transport.
- With the same initial state, fixed-step inputs, balance profile, and random seed, combat calculations and emitted arena events are deterministic.

## Arena and Movement

- The hero and creeps use velocity-based movement rather than waypoint movement.
- A desired movement direction is converted into velocity using acceleration and capped by maximum speed.
- Direction changes occur over successive fixed updates, producing turn/steering response instead of instantaneous full-speed changes.
- Units decelerate when they have no desired movement.
- Performing an attack temporarily slows the attacker. This applies to both the hero and attacking creeps.
- Heroes, creeps, item drops, and projectiles outside the arena receive a 30 px/second correction toward the nearest fully legal position. Once fully inside they cannot cross out again; outward velocity is removed while tangential motion and lifetime continue. Fixed attack telegraphs do not move.
- Creeps initially spawn just outside a randomly selected arena edge and enter immediately. Off-map death drops move inward until collectible.
- With no obstacles in the current slice, each melee creep continuously steers directly toward the hero. Ranged creeps steer to maintain firing distance.

## Hero Control and Targeting

- The hero is controlled with WASD, including equivalent lowercase and uppercase key events.
- The hero automatically aims at the closest living creep.
- When no living creep is active, the visible facing direction follows the latest non-zero WASD movement input.
- The equipped weapon attacks the closest creep automatically when cooldown, resource, target, range, and health conditions allow.
- Melee hero attacks use visible wind-up areas and damage only targets still overlapping when the area resolves.
- Ranged hero attacks use projectiles and damage only on projectile collision.

## Damage Sources

- Enemy body contact does not damage the hero.
- Ranged enemy body contact never deals damage.
- Hero health is reduced only by resolved enemy melee attack areas, hostile projectile collisions, and status effects.
- Enemy health is reduced only by resolved hero melee attack areas, hero projectile collisions, and status effects.
- A unit's own attack area or projectile never damages that unit.
- Damage areas and projectiles use circle or area overlap checks against unit collision radii.
- Public balance-profile multipliers are applied once at the combat calculation boundary: the development profile multiplies hero outgoing damage by 1.5 and enemy outgoing damage by 0.6.
- Every hostile damage event, including deterministic one-second status ticks, may be blocked by an equipped buckler. Dexterity references mean Agility.
- Block chance is `min(75%, 10% * rarityPower + 0.5% * (Strength + Agility))`. Success prevents `min(incomingDamage, Strength)`.
- Spiked bucklers reflect the rarity-scaled sum of rolled components: `1`, `0.2 * Strength`, and `incomingDamage * (15% + 0.4% * Agility)`. Reflection may be blocked but cannot reflect again, critically strike, apply affixes, or create statuses.
- Damage and statuses retain source attribution for realm-kill credit.

## Enemy Attacks

- Melee creeps pursue the hero until their attack range is reached.
- When a melee creep starts a swing, it immediately telegraphs a circular attack area.
- A melee attack area resolves after a wind-up duration derived from the attacker's attack speed.
- If a creep dies during that wind-up, its unresolved melee attack area is canceled immediately and deals no damage.
- The hero takes melee damage only if still inside the telegraphed area when it resolves.
- Bubble shooters maintain distance, telegraph their shot, then launch a bubble toward the hero's position at firing time.
- Bubble projectiles travel independently and deal damage only on circle collision with the hero.
- A projectile that has already launched remains active if its source creep dies.
- Bubble projectiles can be dodged and expire at arena margins or after their lifetime.
- Attack wind-up and recovery slow creep movement.

## Telegraph Rendering

- Every area-based attack is shown clearly before it resolves.
- Resolved attack areas briefly flash after damage resolution.
- Hero attack areas use the hero combat color, and enemy attack areas use the enemy threat color.
- The HUD and arena should show the hero's facing or auto-aim direction, equipped-weapon attacks, drops, and inspected enemy highlight.

## Local Defeat Reset

- Player health reaching zero starts a short defeat notice.
- When the defeat notice finishes, the client clears active creeps, attack areas, projectiles, drops, and pending local wave spawns.
- The hero is reset to the arena center with progression-derived resources.
- Score, permanent progression, inventory, session identity, and server-owned wave number are not reset by the local arena reset.
- Defeat is reported to the server. Server-owned wave number adjustment and replacement wave dispatch are defined in `specs/SPEC.md`.
- In Training Grounds health is clamped to at least 1 and defeat never starts.
