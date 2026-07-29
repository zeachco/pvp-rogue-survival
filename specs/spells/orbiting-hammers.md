# Orbiting Hammers (`orbitingHammers`)

**Source:** hammer signature skill. **Activation:** automatic 3-mana magic skill; base cooldown 4.5 seconds, range 4.8 m, and 0.85 damage multiplier. **Effect:** launches three source-relative hammers at evenly spaced angles. They rotate at 5.2 radians/s with deterministic drift, expand from a 0.56 m to 3.8 m radius over their first 2.4 seconds, then orbit at that radius. Their lifetime scales linearly as `2.4 + 27.6 * (skillLevel - 1) / 98` seconds, from 2.4 seconds at level 1 to 30 seconds at level 99; they survive hits and may damage each enemy once.
