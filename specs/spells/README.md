# Spell Contracts

Each registered `SkillId` has exactly one contract in this directory, named after its stable serialized id. The contract is authoritative for spell-specific behavior; shared rules remain in [the progression specification](../PROGRESSION_SPEC.md) and simulation primitives remain in [the mechanics specification](../MECHANICS_SPEC.md).

| ID | Contract |
| --- | --- |
| `bash` | [Bash](bash.md) |
| `sweep` | [Sweep](sweep.md) |
| `flurry` | [Flurry](flurry.md) |
| `shockwave` | [Shockwave](shockwave.md) |
| `cleave` | [Cleave](cleave.md) |
| `whirlwind` | [Whirlwind](whirlwind.md) |
| `rendingThrow` | [Rending Throw](rending-throw.md) |
| `vampiricBoomerang` | [Vampiric Boomerang](vampiric-boomerang.md) |
| `orbitingHammers` | [Orbiting Hammers](orbiting-hammers.md) |
| `arcaneBolt` | [Arcane Bolt](arcane-bolt.md) |
| `gravityPull` | [Force Field](gravity-pull.md) |
| `attraction` | [Attraction](attraction.md) |
| `manaDrain` | [Mana Drain](mana-drain.md) |
| `penance` | [Penance](penance.md) |
| `thorns` | [Thorns](thorns.md) |
| `reflectiveSurge` | [Reflective Surge](reflective-surge.md) |
| `frostOrb` | [Frozen Orb](frost-orb.md) |
| `fireBreath` | [Fire Breath](fire-breath.md) |
| `swamp` | [Gooey Swamp](swamp.md) |
| `voodoo` | [Voodoo](voodoo.md) |
| `healing` | [Healing](healing.md) |
| `rent` | [Rent](rent.md) |
| `blocking` | [Blocking](blocking.md) |
| `slowAura` | [Glacial Aura](slow-aura.md) |
| `hinderingAura` | [Hindering Aura](hindering-aura.md) |
| `deathBurst` | [Death Burst](death-burst.md) |
| `sunburnAura` | [Sunburn](sunburn-aura.md) |
| `timeHarvest` | [Time Harvest](time-harvest.md) |
| `thunderAura` | [Thunder Aura](thunder-aura.md) |

When adding, renaming, or removing a `SkillId`, update this index, its individual contract, `common/items.ts`, `common/content.ts`, and the shared rules together.
