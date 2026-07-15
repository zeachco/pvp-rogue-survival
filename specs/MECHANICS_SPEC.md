# Mechanics SPEC

This specification extends `specs/SPEC.md` and is authoritative for arena simulation, movement, targeting, telegraphs, projectiles, collision resolution, and local defeat reset behavior. Progression, itemization, stat formulas, wave composition, generated builds, XP, drops, and rival scaling belong in `specs/PROGRESSION_SPEC.md`.

## Unarmed Combat

An empty main-hand slot resolves to an unarmed physical attack profile: `1 + effective Strength` base damage, 70px range, one attack per second, and one Stamina per attack. Punches use the ordinary critical-hit and target-mitigation rules, but have no weapon affixes or weapon/offensive active skills. Independent offhand and globally bound effects—including Healing, auras, Attraction, and buckler Blocking—remain available. Insufficient Stamina prevents a punch. Empty-handed clones and death echoes use this same profile.

Every physical attack and every spell whose resource is Stamina pushes hit enemies away from its source. Baseline pushback is derived from the attacker's effective Strength and current movement speed. Skill execution metadata may add a pushback multiplier or flat bonus for skills with stronger impact; this augments rather than replaces the shared baseline.

Rent restores 1% of the caster's maximum HP for each distinct enemy touched by its attack area.

## Simulation Loop

- The client owns local arena simulation for the active combat slice.
- A fixed client update advances hero input, acceleration-based movement, creep steering, attack telegraphs, hit areas, projectiles, collisions, local wave spawn timing, and camera following.
- Rendering draws the fixed arena, hero, creeps, attack areas, projectiles, health bars, combat hints, filled-diamond equipment drops, yellow circular Gold drops, and hollow-diamond Scrap drops.
- The camera follows the hero and remains clamped to the arena bounds.
- Arena edges do not move or expand.
- Simulation state is advanced by focused systems over an explicit arena state. Systems receive time and random sources as inputs and emit typed events for networking and presentation; they never directly access the DOM or WebSocket transport.
- With the same initial state, fixed-step inputs, balance profile, and random seed, combat calculations and emitted arena events are deterministic.

## Arena and Movement

- The hero and creeps use velocity-based movement rather than waypoint movement.
- A desired movement direction is converted into velocity using acceleration and capped by maximum speed for self-propelled movement. External impulses may temporarily exceed that movement speed.
- Direction changes occur over successive fixed updates, producing turn/steering response instead of instantaneous full-speed changes. Creep velocity approaches its desired movement velocity over time; the same response acts as friction when steering stops and gradually dissipates external impulses.
- Units decelerate when they have no desired movement. Force Field never teleports a creep: it adds a 180 px/s radial velocity impulse, inward for melee main hands and outward for ranged/magic main hands. Applying either impulse interrupts the target creep's current attack: internal ranged wind-up is cleared and an unresolved melee/area telegraph from that creep is invalidated. Already-launched projectiles remain independent and continue.
- Push-mode Force Field also applies its radial impulse to uncollected equipment drops, but not Gold or Scrap. A pushed equipment drop may cross the arena boundary instead of receiving inward correction. Once fully beyond the arena margin, the client reports only its opaque drop id; the server validates that it is an owned equipment drop, removes it from the current ground ledger, and defers it to the same player's next wave. At that dispatch the server returns it to inventory when capacity permits, otherwise reissues it as a ground equipment drop. Pull-mode Force Field does not defer drops.
- Performing an attack temporarily slows the attacker. This applies to both the hero and attacking creeps.
- Heroes, creeps, item drops, and projectiles outside the arena receive a 30 px/second correction toward the nearest fully legal position. Once fully inside they cannot cross out again; outward velocity is removed while tangential motion and lifetime continue. Fixed attack telegraphs do not move.
- Creeps initially spawn just outside a randomly selected arena edge and enter immediately. Off-map death drops move inward until collectible.
- When the hero has an equipped staff or offhand relic with Attraction, every active uncollected item drop moves directly toward the hero at 35 pixels/second before arena-boundary correction and overlap collection. The passive changes only client presentation and pickup proximity; the server remains authoritative over whether the opaque drop id can be collected.
- With no obstacles in the current slice, each melee creep continuously steers directly toward the hero. Ranged creeps steer to maintain firing distance.

## Hero Control and Targeting

- The hero is controlled with WASD, including equivalent lowercase and uppercase key events.
- The hero automatically aims at the closest living creep.
- When no living creep is active, the visible facing direction follows the latest non-zero WASD movement input.
- The equipped weapon attacks the closest creep automatically when cooldown, resource, target, range, and health conditions allow.
- Melee hero attacks use visible wind-up areas and damage only targets still overlapping when the area resolves.
- Ranged hero attacks use projectiles and damage only on projectile collision. Staff attacks are magical; one-handed throwing-axe attacks and Rending Throw are physical, target only within their configured short range, and use the same single-hit projectile collision rules.

## Damage Sources

- Enemy body contact does not damage the hero.
- Ranged enemy body contact never deals damage.
- Hero health is reduced only by resolved enemy melee attack areas, hostile projectile collisions, and status effects.
- Before health loss, equipped-item Dodge is added to attribute Dodge and capped at 50%. Defense then subtracts flat damage, and the matching Physical, Magic, Fire, Frost, Poison, or Bleed resistance reduces the remainder, capped at 50%.
- Enemy health is reduced only by resolved hero melee attack areas, hero projectile collisions, and status effects.
- A unit's own attack area or projectile never damages that unit.
- Damage areas and projectiles use circle or area overlap checks against unit collision radii.
- Public balance-profile multipliers are applied once at the combat calculation boundary. Development and production currently use identical combat multipliers so local play does not indirectly accelerate durable progression.
- Every hostile damage event, including deterministic one-second status ticks, may be blocked by an equipped buckler while its reactive Blocking spell is ready. A successful block starts its cooldown; damage received during that cooldown cannot block. Dexterity references mean Agility.
- Direct weapon and skill hits first roll dodge at `min(35%, 0.3% * Agility)`. Status ticks, reflection, and self-paid life costs cannot dodge. A dodge prevents damage and all on-hit effects. Successful dodges and blocks emit `DODGE` and `BLOCK` floating text from the affected hero or enemy; a partial block also emits its remaining damage number.
- Block chance is `min(100%, 10% * rarityPower + 0.5% * (Strength + Agility))`. A block can occur only when the defender has its full block cost available. Each successful block immediately spends that cost; failed rolls spend nothing. Block cost has a hard floor of 1 stamina. A buckler without percentage return costs 1; a buckler with Return costs `1 + ((15% + 0.4% * Agility) * rarityPower) / (1 + 0.1 * itemLevel)`, so stronger percentage return costs more while upgrading the buckler moves the premium back toward the floor. Success prevents `min(incomingDamage, Strength)`.
- Spiked bucklers reflect the rarity-scaled sum of rolled components: `1`, `0.2 * Strength`, and `incomingDamage * (15% + 0.4% * Agility)`. Reflection may be blocked but cannot reflect again, critically strike, apply affixes, or create statuses.
- Damage and statuses retain source attribution for realm-kill credit.
- A direct hero or enemy weapon hit may trigger equipped life steal after mitigation and health clamping. It uses health actually removed, cannot recursively trigger itself, and does not apply to reflected or periodic status damage.
- Resolved damage, healing, dodges, and blocks create short-lived floating canvas text that rises and fades from the affected unit. A damage number shows the rolled damage remaining after block/mitigation but before clamping against the target's remaining HP, so overkill still communicates weapon output; healing shows only health actually restored. Physical damage is light gray; critical hits override the base color with yellow-white; magic is yellow; electric is cyan; poison is pink-purple; fire is red-orange; bleed is red; healing is green; dodge is pale cyan; and block is shield gold. Shield reflection uses the triggering damage type's color, cannot be styled as a critical hit, and remains visible even when the damaged unit is removed in the same simulation update.

## Enemy Attacks

- Melee creeps pursue the hero until their attack range is reached.
- When a melee creep starts a swing, it immediately telegraphs a circular attack area.
- A melee attack area resolves after a wind-up duration derived from the attacker's attack speed.
- If a creep dies during that wind-up, its unresolved melee attack area is canceled immediately and deals no damage.
- The hero takes melee damage only if still inside the telegraphed area when it resolves.
- Enemies with ranged weapons maintain a distance appropriate to their weapon, telegraph their shot, then launch a projectile toward the hero's position at firing time. Staff users retain the bubble presentation; throwing-axe users launch physical axes and engage at 210 pixels.
- Enemy projectiles travel independently and deal damage only on circle collision with the hero. Their weapon on-hit effects, including throwing-axe bleed, resolve on collision.
- A projectile that has already launched remains active if its source creep dies.
- Orbiting Hammer projectiles stay source-relative while their hero remains active: their angle advances continuously and their orbit radius expands from 28 to 190 pixels over 2.4 seconds. Three are emitted per cast at evenly spaced starting angles, with a small deterministic per-hammer/per-cast angular drift so successive paths do not stack exactly. A hammer remains active after collision for its full lifetime, may damage multiple enemies, and remembers hit unit ids so it can damage each enemy at most once.
- Bubble projectiles can be dodged and expire at arena margins or after their lifetime.
- Attack wind-up and recovery slow creep movement.

## Telegraph Rendering

- Every area-based attack is shown clearly before it resolves.
- Resolved attack areas briefly flash after damage resolution.
- Hero attack areas use the hero combat color, and enemy attack areas use the enemy threat color.
- The HUD and arena should show the hero's facing or auto-aim direction, equipped-weapon attacks, drops, and inspected enemy highlight.
- Weapon-skill casts create deterministic, short-lived canvas effects without consuming combat randomness: Club Bash uses an expanding impact ring and debris, Sword Sweep a directional crescent, Dagger Flurry crossing blade streaks, Mace Shockwave concentric rings and radial sparks, Staff Arcane Bolt an arcane launch burst, and Healing rising green motes. Effects are presentation-only arena objects, update in the fixed loop, and are removed at the end of their bounded lifetime.
- Fire Breath renders as a short forward-moving series of red-orange arcs. Its cone resolves once after the telegraph and applies Burn for four one-second ticks. Burn uses fire-colored combat text and cannot itself dodge.

## Local Defeat Reset

- Player health reaching zero starts a short defeat notice.
- The realm-header Kill Player action asks for confirmation, then performs the server-owned defeat immediately and starts a fresh local arena with the replacement wave.
- When the defeat notice finishes, the client clears active creeps, attack areas, projectiles, drops, and pending local wave spawns.
- The hero is reset to the arena center with progression-derived resources.
- Score, permanent progression, inventory, canonical username identity, and server-owned wave number are not reset by the local arena reset.
- A server-authored wave marks entry into a newly requested solo realm or a newly matched competitive realm. Before that wave is queued, the client clears the previous arena, restores the hero to full health, mana, and stamina, removes every bleed, poison, burn, stun, and freeze instance, clears reactive/block and temporary-surge state, stops residual velocity, and resets hero attack and skill cooldowns. Ordinary later wave dispatches inside the same realm do not restore resources or statuses.
- Defeat is reported to the server. Server-owned wave number adjustment and replacement wave dispatch are defined in `specs/SPEC.md`.
- In Training Grounds health is clamped to at least 1 and defeat never starts.

## Exact Simulation Constants and Order

- Run fixed updates at `1/60` second. In each update: release due spawns; regenerate/update the hero; derive WASD input and move the hero; run automatic hero combat; update each creep and create its attacks; update attacks, projectiles, effects, and attracted drops; correct arena boundaries; resolve combat; report newly dead units and overlapping drops; update combat text; remove inactive objects; synchronize the HUD; handle defeat; then update the camera. Render after all available fixed updates.
- Hero radius is 18, base movement speed is 235 px/s, and acceleration is 920 px/s²; active attack areas reduce maximum movement speed to 48%. Regular creep radius is 16, rival radius 22. Melee and bubble-shooter movement is 72 px/s with 190 px/s² acceleration; rival movement is 100 px/s with 250 px/s² acceleration. Agility multiplies enemy maximum speed by `1 + 0.01 * Agility`. Training multiplies creep speed by 0.5.
- Melee range is 62. Bubble shooters attack at 330, stand still from 210 through 285, retreat below 210, and approach above 285. Initial creep cooldown is uniformly `0.5 + random * 0.4` seconds. Melee wind-up is `0.7 / attacksPerSecond` and recovery is `0.75 / attacksPerSecond`; ranged wind-up is `0.65 / attacksPerSecond` and recovery is `1.15 / attacksPerSecond`. Wind-up steering uses one quarter maximum speed.
- Enemy melee areas have range 70, a full-circle arc, their computed wind-up, and 0.14 seconds resolved linger. Hero melee areas wind up for 0.18 and linger 0.13 seconds. Their half-arcs are full circle for Bash, Sweep, Shockwave, and unskilled club/mace/hammer attacks; 1.8 radians for Cleave; 1.1 for Flurry; and 0.72 otherwise.
- Standard projectiles have radius 11, speed 245 px/s, lifetime 4 seconds, and disappear beyond a 40px arena margin. Orbiting Hammers live 2.4 seconds, rotate at 5.2 radians/second, and expand linearly from radius 28 to 190. Frozen Orb moves at 75 px/s for 4 seconds, emits eight radial single-hit spikes every 0.45 seconds, and does not disappear when its orb overlaps an enemy; its spikes travel at 235 px/s for 1.2 seconds. Other projectiles are single-hit.
- A basic or non-Flurry skilled attack recovers in `1 / attacksPerSecond`; Flurry uses `0.35 / attacksPerSecond`. Physical skills add 0.35 stamina to the weapon's normal cost. Most magical skills cost 1 mana; Orbiting Hammers costs 3, Force Field costs 8, and Frozen Orb costs 10. Force Field pulls with a melee main hand and pushes with a projectile/ranged or staff/magic main hand. Reflective Surge costs 3 stamina. Healing costs 2 mana, triggers only below 50% HP, and restores `(0.5 + 1.2 * Spirit) * magicAmp * spellPower(level)`.
- Status procs roll independently on a direct weapon hit. Throwing axes have a base 15% bleed chance before compatible affixes are added, and Rending Throw guarantees one standard bleed in addition to independently rolled procs. Bleed lasts 3 seconds at 0.25 damage/second; poison lasts 4 seconds at `0.2 + 0.02 * targetSpirit` damage/second; stun lasts 0.7 seconds. Freeze lasts 2 seconds: entering Freeze cancels self-propelled velocity, frozen creeps cannot steer, and any velocity subsequently applied by Force Field slides them without friction until Freeze ends. Bash always stuns 1.1 seconds, Shockwave 0.6, Sweep bleeds for 3 seconds at 0.35/second, Cleave bleeds for 2 seconds at 0.45/second, and Arcane Bolt stuns 0.35 seconds. Frozen Orb and each emitted spike apply Freeze. Status instances stack as separate records, periodic instances tick once per second, and any active stun prevents steering.
- The hero-down presentation lasts 1.8 seconds before local reset and replacement-wave request. Hover selection accepts the nearest active creep only within its radius plus 8 pixels. Drop pickup uses circle overlap and records one pending request only when its WebSocket send succeeds. After a rejected request it suppresses retries until the hero leaves that drop's overlap. A bounded acknowledgement timeout or connection recovery triggers the authoritative Gold, Scrap, and equipment reconciliation defined by `specs/PROGRESSION_SPEC.md`; reconciliation clears resolved pending ids, removes client-only drops, and places reissued server-only drops at the hero's current position.
