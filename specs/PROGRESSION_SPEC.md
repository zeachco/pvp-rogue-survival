# Progression, Items, and Rival Waves SPEC

This specification extends `specs/SPEC.md` and `specs/MECHANICS_SPEC.md` and is authoritative for progression and itemization.

## Progression

- Heroes begin at level 0 with zero Agility, Strength, Magic, Spirit, and Intelligence, 6 base max HP, and a plain club.
- Level N to N+1 costs `100 * N` XP (the first level costs 100). Each level grants five fractional attribute points using editable non-negative weights totaling 5. The UI clamps each input to the unspent budget, shows remaining points, and only enables saving at exactly 5; the server independently validates the total. Changes affect future levels only.
- Units have 6 base max HP. Strength adds 0.2 base damage, 1 HP, and 1 stamina per point. Agility adds 5% attack speed and 1% critical chance. Magic adds 2 mana. Spirit adds 0.1/second health, mana, and stamina regeneration. Intelligence adds 5% critical damage, 1% cooldown reduction, and 2% magic amplification.
- Critical chance is capped at 75%, cooldown reduction at 60%, and base critical damage is 150%.
- XP, attributes, allocation, gold, learned skills, learned skill levels, equipment, and backpack survive defeat and reconnection while the server process remains alive.

## Items and Skills

- Hardcoded item definitions and randomized generators live in a shared configuration module. Generator inputs are level, rarity, class filters, and a deterministic seed; generated instances contain no functions.
- Weapon classes are club, sword, dagger, mace, and staff. The starter club deals 100% base damage and costs little stamina.
- Edged weapons may bleed; mace/club weapons may stun; venomous and rusty affixes may poison compatible weapons; staves may amplify magic and mana regeneration.
- Requirements, damage, speed, affixes, skills, stat bonuses, modifiers, drop chance, and sell value scale with item level and rarity. Generated items use a deliberately sparse drop chance of `min(30%, 4% + 6% * rarityPower)`, currently about 10% for common through 16.6% for epic gear.
- Clubs, swords, daggers, and maces require one hand; staves require two. A one-handed build may equip one buckler offhand. Equipping a two-handed weapon drops an incompatible buckler into the arena if it cannot be stored.
- Inventory capacity is `4 + ceil(playerLevel / 10)` permanent configuration tiles. Exact matching equipment shares quantity. A zero-quantity tile remains grayed, retains automation, and consumes capacity; a new unmatched drop remains on the ground when all tiles are occupied.
- Matching includes kind, class, level, rarity, hands, affixes, requirements, bonuses, modifiers, skills, stamina cost, and reflection components while ignoring instance id, seed, generated name, drop chance, and sell value.
- Each tile has exactly one Keep, Auto Sell, Auto Merge, or Auto Purge mode. New tiles default to Keep. Auto Sell/Purge handles matching pickups before quantity increases. Auto Merge retries when inventory or resources change.
- Selling, purging, equipping, extracting, sending, and manual merging affect one copy. Purging grants `max(1, ceil(itemLevel / 3))` scraps of the item's rarity.
- Leveling consumes two matching copies, `ceil(2.5 * sellValue)` gold, and `ceil(3 * currentLevel)` same-rarity scraps. It creates one level+1 configuration preserving class, rarity, affixes, and reflection components while recalculating level-derived values. The output requires a matching tile or free permanent tile.
- Sending consumes one exact item and queues it for realm-wave use. If an equip swap cannot store old equipment, the old equipment becomes a server-confirmed ground drop.
- Weapon skills are available while equipped. Backpack weapons with skills expose an Extract action. Extraction is server-owned, consumes that weapon, costs `10 * sellValue` gold, and permanently learns the weapon's skills as cooldown spells. Extracting a skill the hero already knows increases that spell's level instead. Learned spell levels scale at least one meaningful parameter such as damage, healing, or cooldown.
- The bottom spell bar shows learned spells and currently equipped weapon skills, including their level and cooldown state. Skills automatically cast by priority when cooldown, resource, target, and health conditions permit.
- Basic attacks and physical/block skills use stamina; magic and healing use mana. Heroes and all spawned enemies share stats, resources, inventories, cooldowns, critical hits, healing, bleed, poison, and stun.
- Weapons, affixes, skills, enemy archetypes, and their numeric definitions live in typed content registries. Serialized instances contain identifiers and data only; skill-specific execution is isolated behind handlers keyed by skill id.
- One-handed generated enemy builds receive a buckler 25% of the time. Bucklers are spiked 25% of the time. Spiked common/uncommon bucklers roll one reflection component, rare two, and epic all three.

## Waves and Rivals

- Wave N has `min(40, 10 + 2 * N)` regular creeps. One regular template is rolled at `max(floor(heroLevel / regularCount), floor((N - 1) / 2))` and copied for the wave.
- Regulars spawn in ten cumulative 10% batches, five seconds apart. A separately rolled rival spawns after 75% of regulars.
- A matched realm rival copies an opponent's allocation/build tendencies, scaled to `max(floor(heroLevel * 0.8), floor((N - 1) / 2))`, with freshly generated items at that level. Unmatched and Training Grounds play generates the same level of independent rival.
- Regular kills grant `10 + effectiveLevel` XP. Rival kills grant at least the cumulative XP needed to reach the rival level.
- Enemy items independently roll their sparse item drop chances and appear in the arena for walk-over collection. At most one item is dropped per defeated enemy.
- Defeated enemies also roll a server-owned direct-gold bounty independently of item drops: regular enemies have a 20% chance to grant `1 + floor(level / 5)` gold, and rivals have a 50% chance to grant `3 + floor(level / 2)` gold. Direct gold is credited immediately without an arena pickup.
- Hover highlights enemies. Clicking one replaces the hero identity/inventory HUD with its portrait, level, attributes, resources, statuses, weapon, and backpack. Empty-space click or Back restores the hero.

## Server Ownership

- The server owns in-memory progression, allocation validation, XP/level changes, direct-gold rolls, rarity scraps, generation seeds, waves, realms, equipment, stacking, automation, selling, purging, merging, sending, and inventory mutations.
- The client owns arena simulation and reports kills and collected generated drop IDs. Protocol shapes remain suitable for later validation and database persistence.
- The server retains a ledger of wave-issued units and generated ground drops. The client reports only unit ids and opaque drop ids; duplicate, unknown, or invalid-state reports grant nothing.
- The selected balance profile modifies reward probabilities and amounts centrally. The development profile grants 3x XP, doubles direct-gold probability (capped at 100%), and triples item-drop probability (capped at 75%).

## First-session UX

- Joining shows a short dismissible briefing explaining WASD movement, automatic attacks/skills, red telegraphs, item pickup, the always-open right-side build panel, and the five-point future-level allocation. Arena simulation and spawn timers remain paused until it is dismissed, after which the full three-second preparation delay begins.
- The character sheet and permanent inventory are separate fixed right-side columns. Inspection replaces the sheet only and leaves the player's inventory usable.
- The HUD shows current HP, stamina, and mana. Allocation copy states that all five default points are assigned instead of presenting `0 remaining` without context.
- A wave has a three-second preparation delay. Off-screen enemies display edge indicators so the player understands where threats are approaching from.
