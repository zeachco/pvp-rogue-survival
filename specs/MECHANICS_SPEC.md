# Mechanics SPEC

This specification extends `specs/SPEC.md` and is authoritative for arena simulation, movement, targeting, telegraphs, projectiles, collision resolution, and local defeat reset behavior. Progression, itemization, stat formulas, wave composition, generated builds, XP, drops, and rival scaling belong in `specs/PROGRESSION_SPEC.md`.

## Simulation Loop

- The client owns local arena simulation for the active combat slice.
- A fixed client update advances hero input, acceleration-based movement, creep steering, attack telegraphs, hit areas, projectiles, collisions, local wave spawn timing, and camera following.
- Rendering draws the fixed arena, hero, creeps, attack areas, projectiles, health bars, and combat hints.
- The camera follows the hero and remains clamped to the arena bounds.
- Arena edges do not move or expand.

## Arena and Movement

- The hero and creeps use velocity-based movement rather than waypoint movement.
- A desired movement direction is converted into velocity using acceleration and capped by maximum speed.
- Direction changes occur over successive fixed updates, producing turn/steering response instead of instantaneous full-speed changes.
- Units decelerate when they have no desired movement.
- Performing an attack temporarily slows the attacker. This applies to both the hero and attacking creeps.
- Units are clamped inside the arena.
- Creeps initially spawn just outside a randomly selected arena edge and enter immediately.
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

## Enemy Attacks

- Melee creeps pursue the hero until their attack range is reached.
- When a melee creep starts a swing, it immediately telegraphs a circular attack area.
- A melee attack area resolves after a wind-up duration derived from the attacker's attack speed.
- The hero takes melee damage only if still inside the telegraphed area when it resolves.
- Bubble shooters maintain distance, telegraph their shot, then launch a bubble toward the hero's position at firing time.
- Bubble projectiles travel independently and deal damage only on circle collision with the hero.
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
