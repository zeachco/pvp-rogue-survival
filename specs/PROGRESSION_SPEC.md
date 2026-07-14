# Progression, Items, and Rival Waves SPEC

This specification extends `specs/SPEC.md` and `specs/MECHANICS_SPEC.md` and is authoritative for progression and itemization.

## Progression

- Heroes begin at level 0 with zero Agility, Strength, Magic, Spirit, and Intelligence, 6 base max HP, and a plain club.
- Level N to N+1 costs `100 * N` XP (the first level costs 100). Each level grants five fractional attribute points using editable non-negative weights totaling 5. The UI clamps each input to the unspent budget, shows remaining points, and only enables saving at exactly 5; the server independently validates the total. Changes affect future levels only.
- Units have 6 base max HP. Strength adds 0.2 base damage, 1 HP, and 1 stamina per point. Agility adds 5% attack speed and 1% critical chance. Magic adds 2 mana. Spirit adds 0.1/second health, mana, and stamina regeneration. Intelligence adds 5% critical damage, 1% cooldown reduction, and 2% magic amplification.
- Critical chance is capped at 75%, cooldown reduction at 60%, and base critical damage is 150%.
- XP, attributes, allocation, gold, learned skills, learned skill levels, equipment, and backpack survive defeat and reconnection while the server process remains alive.
- Souls are a permanent in-memory currency awarded one at a time for credited realm/player kills. The top of the character/stat sheet displays Gold, Souls, and the four rarity scrap balances in a six-cell grid that remains visible during enemy inspection.

## Items and Skills

- Hardcoded item definitions and randomized generators live in a shared configuration module. Generator inputs are level, rarity, class filters, and a deterministic seed; generated instances contain no functions.
- Weapon classes are club, sword, dagger, mace, and staff. The starter club deals 100% base damage and costs little stamina.
- Edged weapons may bleed; mace/club weapons may stun; venomous and rusty affixes may poison compatible weapons; staves may amplify magic and mana regeneration.
- Requirements, damage, speed, affixes, skills, stat bonuses, modifiers, drop chance, and sell value scale with item level and rarity. Generated items use a deliberately sparse drop chance of `min(30%, 4% + 6% * rarityPower)`, currently about 10% for common through 16.6% for epic gear.
- Clubs, swords, daggers, and maces require one hand; staves require two. A one-handed build may equip one buckler offhand. Equipped items remain as reserved copies in their inventory stacks and count toward occupied capacity. Equipping another item does not consume its tile; any previously equipped item is also retained as an inventory copy. An equip is rejected if retaining equipment that predates the inventory would exceed capacity.
- Inventory capacity is `4 + ceil(playerLevel / 10)` occupied equipment stacks. Exact matching equipment shares quantity. A zero-quantity tile remains grayed and retains its automation as a future matching rule, but does not consume capacity. A new unmatched stored drop remains on the ground when all occupied slots are full unless an Auto Sell or Auto Purge rule accepts it without storage.
- Inventory presentation groups all positive-quantity tiles first and all grayed zero-quantity tiles at the end. Within each group, tiles follow the canonical rarity order: common, uncommon, rare, then epic; equal-rarity tiles preserve their existing order.
- Matching includes kind, class, level, rarity, hands, affixes, requirements, bonuses, modifiers, skills, stamina cost, and reflection components while ignoring instance id, seed, generated name, drop chance, and sell value.
- Each tile has exactly one Keep, Auto Sell, Auto Upgrade, or Auto Purge mode, presented as a single horizontal radio row on the item card. New pickup tiles default to Keep. Changing an occupied tile to Auto Sell or Auto Purge immediately processes every stored copy, leaving a zero-quantity rule that frees its occupied slot and handles future level-agnostic matches. Auto Sell and Auto Purge matching uses the item's kind, class, rarity, handedness, affixes, bonuses, skills, and reflection components while ignoring level and level-derived requirements, modifiers, and values. Auto Upgrade outputs inherit the source tile's automation when they require a new tile, so an upgrade chain remains selected; manual upgrades from Keep produce Keep outputs. Existing destination tiles never have their selected automation overwritten.
- Selling, purging, extracting, sending, and manual upgrading affect one unreserved copy. Equipped stacks are outlined in gold. Manual Sell and Purge plus their Auto Sell and Auto Purge batch choices are disabled for an equipped stack and independently rejected by the server; other consumptive actions require a copy beyond the equipped reservation. Purging grants `max(1, ceil(itemLevel / 3))` scraps of the item's rarity.
- Upgrading consumes one stored copy, `ceil(2.5 * sellValue)` gold, and `3 * (currentLevel + 1)` same-rarity scraps obtained by purging equipment. It creates one level+1 configuration preserving class, rarity, affixes, and reflection components while recalculating level-derived values, so no duplicate equipment copy is required. The output requires a matching tile or free permanent tile. Auto Upgrade retries whenever inventory, gold, or scraps change and continues while affordable upgrades remain.
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
- Solo-wave kills grant 50% of the XP they would grant in competitive play, rounded down after the active balance-profile multiplier. Gold, drops, and score use their normal competitive rules.
- Enemy items independently roll their sparse item drop chances and appear in the arena for walk-over collection. At most one item is dropped per defeated enemy.
- Defeated enemies also roll a server-owned direct-gold bounty independently of item drops: regular enemies have a 20% chance to grant `1 + floor(level / 5)` gold, and rivals have a 50% chance to grant `3 + floor(level / 2)` gold. Direct gold is credited immediately without an arena pickup.
- Hover highlights enemies. Clicking one replaces the hero identity/inventory HUD with its portrait, level, attributes, resources, statuses, weapon, and backpack. Empty-space click or Back restores the hero.

## Server Ownership

- The server owns in-memory progression, allocation validation, XP/level changes, direct-gold rolls, rarity scraps, generation seeds, waves, realms, equipment, stacking, automation, selling, purging, upgrading, sending, and inventory mutations.
- The client owns arena simulation and reports kills and collected generated drop IDs. Protocol shapes remain suitable for later validation and database persistence.
- The server retains a ledger of wave-issued units and generated ground drops. The client reports only unit ids and opaque drop ids; duplicate, unknown, or invalid-state reports grant nothing.
- The selected balance profile modifies reward probabilities and amounts centrally. The development profile grants 3x XP, doubles direct-gold probability (capped at 100%), and triples item-drop probability (capped at 75%).

## First-session UX

- Joining shows movement, automatic combat, and item-pickup guidance in the non-blocking HUD notice. Arena simulation and spawn timers begin without a confirmation modal.
- The character sheet is a fixed retractable left-side column and the permanent inventory is a separate fixed retractable right-side column. Inspection replaces the sheet only and leaves the player's inventory usable. The arena canvas and combat HUD occupy the space between the two columns as either column expands or collapses.
- Equipped-item cards in the character sheet and every backpack item card show attack damage, attack speed, effects, skills, item level, and attribute requirements. The hero's active main-hand card uses a subtle gray background sweep tied to actual basic-attack recovery progress; inspected enemy equipment remains static.
- The bottom RPG HUD places a red gradient health bar on the left with a two-pixel yellow stamina strip beneath it, a circular XP ring around the current name/level badge in the middle, and a cyan-blue gradient mana bar on the right. Health/stamina and mana sit on subtle translucent, slightly blurred backdrops so they remain legible over combat. Bars retain current/maximum values and the XP ring shows within-level progress. The displayed XP eases by 10% of the remaining distance toward the latest authoritative XP target on each HUD frame; a newer reward retargets the animation from its current visual value without waiting for an earlier animation to finish. The visible ring and level are derived from this eased value. Allocation copy states that all five default points are assigned instead of presenting `0 remaining` without context.
- A wave has a three-second preparation delay. Off-screen enemies display edge indicators so the player understands where threats are approaching from.
