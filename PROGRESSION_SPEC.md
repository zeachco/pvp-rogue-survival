# Progression, Items, and Rival Waves SPEC

This specification extends `SPEC.md` and is authoritative for progression and itemization.

## Progression

- Heroes begin at level 0 with zero Agility, Strength, Magic, Spirit, and Intelligence, 1 HP, and a plain club.
- Level N to N+1 costs `100 * N` XP (the first level costs 100). Each level grants five fractional attribute points using editable non-negative weights totaling 5. The UI clamps each input to the unspent budget, shows remaining points, and only enables saving at exactly 5; the server independently validates the total. Changes affect future levels only.
- Strength adds 0.2 base damage, 1 HP, and 1 stamina per point. Agility adds 5% attack speed and 1% critical chance. Magic adds 2 mana. Spirit adds 0.1/second health, mana, and stamina regeneration. Intelligence adds 5% critical damage, 1% cooldown reduction, and 2% magic amplification.
- Critical chance is capped at 75%, cooldown reduction at 60%, and base critical damage is 150%.
- XP, attributes, allocation, gold, learned skills, equipment, and backpack survive defeat and reconnection while the server process remains alive.

## Items and Skills

- Hardcoded item definitions and randomized generators live in a shared configuration module. Generator inputs are level, rarity, class filters, and a deterministic seed; generated instances contain no functions.
- Weapon classes are club, sword, dagger, mace, and staff. The starter club deals 100% base damage and costs little stamina.
- Edged weapons may bleed; mace/club weapons may stun; venomous and rusty affixes may poison compatible weapons; staves may amplify magic and mana regeneration.
- Requirements, damage, speed, affixes, skills, modifiers, drop chance, and sell value scale with item level and rarity.
- One weapon is equipped and eight items fit in the scrollable backpack. Walk-over collects drops. Left click opens Equip/Sell; right click equips. Requirements are enforced.
- Weapon skills exist only while equipped; learned skills such as Healing persist. Skills automatically cast by priority when cooldown, resource, target, and health conditions permit.
- Basic attacks and physical/block skills use stamina; magic and healing use mana. Heroes and all spawned enemies share stats, resources, inventories, cooldowns, critical hits, healing, bleed, poison, and stun.

## Waves and Rivals

- Wave N has `10 + 2 * N` regular creeps. One regular template is rolled at `floor(heroLevel / regularCount)` and copied for the wave.
- Regulars spawn in ten cumulative 10% batches, five seconds apart. A separately rolled rival spawns after 75% of regulars.
- A matched neighbor rival copies the neighbor's allocation/build tendencies, scaled to `floor(heroLevel * 0.8)`, with freshly generated items at that level. Solo play generates the same level of independent rival.
- Regular kills grant `10 + effectiveLevel` XP. Rival kills grant at least the cumulative XP needed to reach the rival level.
- Enemy items roll drop chances and appear in the arena for walk-over collection.
- Hover highlights enemies. Clicking one replaces the hero identity/inventory HUD with its portrait, level, attributes, resources, statuses, weapon, and backpack. Empty-space click or Back restores the hero.

## Server Ownership

- The server owns in-memory progression, allocation validation, XP/level changes, generation seeds, wave builds, rival builds, equipment, selling, and inventory mutations.
- The client owns arena simulation and reports kills and collected generated drop IDs. Protocol shapes remain suitable for later validation and database persistence.

## First-session UX

- Joining shows a short dismissible briefing explaining WASD movement, automatic attacks/skills, red telegraphs, item pickup, and the five-point future-level allocation. Arena simulation and spawn timers remain paused until it is dismissed, after which the full three-second preparation delay begins.
- The character/build panel starts collapsed so it does not obscure combat and expands on demand or when inspecting an enemy.
- The HUD shows current HP, stamina, and mana. Allocation copy states that all five default points are assigned instead of presenting `0 remaining` without context.
- A wave has a three-second preparation delay. Off-screen enemies display edge indicators so the player understands where threats are approaching from.
