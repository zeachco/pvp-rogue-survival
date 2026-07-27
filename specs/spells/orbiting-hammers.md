# Orbiting Hammers (`orbitingHammers`)

**Source:** hammer signature skill. **Activation:** automatic 3-mana magic skill; base cooldown 4.5 seconds, range 240px, and 0.85 damage multiplier. **Effect:** launches three source-relative hammers at evenly spaced angles. They rotate at 5.2 radians/s with deterministic drift, expand from 28 to 190px over their first 2.4 seconds, then orbit at that radius. Their lifetime scales linearly as `2.4 + 27.6 * (skillLevel - 1) / 98` seconds, from 2.4 seconds at level 1 to 30 seconds at level 99; they survive hits and may damage each enemy once.
