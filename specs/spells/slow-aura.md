# Glacial Aura (`slowAura`)

**Source:** extractable aura on Scepters and qualifying Holy Bucklers. **Activation:** togglable passive with Mana upkeep of `0.005 * effective level` per second. **Effect:** nearby active enemies have movement speed multiplied from 0.8 at level 1 to 0.5 at level 99. Its radius is `180 + 120 * (level - 1) / 98 + min(300, 0.5 * level * Spirit)` px. It uses a blue radial ground field, can coexist with other auras, and refreshes each simulation update rather than creating timed status instances.
