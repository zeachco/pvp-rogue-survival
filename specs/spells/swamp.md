# Gooey Swamp (`swamp`)

**Source:** the Voodoo Doll relic perk, alongside Voodoo; it is extractable and Epic extraction makes it universally available. **Activation:** automatic 1-mana magic skill that targets the ground at the closest active enemy within 12 m. It has a level-scaled cooldown of 45 seconds at level 1 down to 15 seconds at level 99; this spell-specific cooldown is not further reduced by attributes, equipment, or generic cooldown reduction.

**Effect:** the cast creates one stationary swamp for 8 seconds. Its radius scales linearly from 4 m at level 1 to 10 m at level 99. Creeps inside have their movement speed multiplied by 0.5, stacking multiplicatively with existing aura movement slow. Each creep tracks continuous time inside a particular swamp; every completed second adds one independent standard Poison stack from the caster (24 seconds, `0.2 + 0.02 * caster Spirit` damage per second, amplified by Voodoo when present). Leaving the swamp resets that swamp's occupancy timer for that creep. A swamp does not directly deal hit damage, affect heroes, slow attacks, or move units.

**Presentation:** render the swamp as a large dark, irregular oval on the arena ground, before drops, creeps, attacks, projectiles, and units. It is distinct from the hero-centered aura fields and remains at its cast position.
