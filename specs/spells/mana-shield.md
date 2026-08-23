# Mana Shield

- Stable id: `manaShield`.
- Category: toggleable skill. It occupies no active spell slot, has no cooldown or upkeep, defaults on when available, and persists its disabled state.
- Source: Spirit Relic. It may be learned/extracted through the normal item skill flow.
- Generated enemies: randomly eligible only for champion-or-higher generated enemy roles. Ordinary creeps never roll it. Copied player boss and clone loadouts remain authoritative and receive no extra random skill.
- Conversion: after avoidance, blocking, defense, resistance, and all other mitigation, incoming damage is split between Mana and HP. Level 1 converts 10%; level 99 converts 99%; intermediate levels interpolate linearly and the result is capped to that range. Available Mana pays the converted portion; any shortfall spills to HP together with the unconverted portion.
- Resource spending and explicit life costs are not incoming damage and bypass Mana Shield.
- Presentation: a translucent forcefield bubble is visible only while Mana Shield is enabled and operational and its owner is alive.
