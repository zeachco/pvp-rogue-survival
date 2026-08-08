# Agent Instructions

## Spec-Driven Development

This repository uses the Markdown files in `specs/` as the source of truth for product behavior, architecture, workflow, UX constraints, mechanics, progression, and game rules.

- `specs/SPEC.md`: product goals, runtime architecture, server ownership, multiplayer/economy boundaries, UX direction, WebSocket protocol, and development process.
- `specs/MECHANICS_SPEC.md`: arena simulation, movement, targeting, attack telegraphs, projectiles, collision resolution, damage sources, and local defeat reset.
- `specs/PROGRESSION_SPEC.md`: permanent XP, attributes, derived stats, item generation, equipment, skills, generated enemy builds, drops, wave composition, and rival scaling.

For every request:

1. Read or check the relevant part of the spec files in `specs/`.
2. Confirm whether the requested change is already covered by the spec.
3. If it is not covered, update the relevant spec file first with the new decision.
4. Implement the code change only after the spec reflects the intended behavior.
5. Keep the specs synchronized when changing filenames, runtimes, protocols, mechanics, progression, game rules, or UX expectations.
6. After modifying any TypeScript/JavaScript file, run `bunx biome format --write .` to ensure consistent formatting.

Use Bun for project tooling and scripts. The client is Vite + TypeScript with canvas rendering and stable DOM HUD components. The server is TypeScript run by Bun.

## Preview-Driven Game Tweaks

For changes that affect resources, equipment, attributes, advanced stats, or spells, use the project skill at `skills/td-war-preview-driven-tweaks/SKILL.md`. The behavior remains authoritative in `specs/`; the skill defines the implementation and validation workflow for consistent before/after HUD projections.

## commit semantic

feat: feature
chore: clean up or other changes that aren't pertinent to changelogs
fix: bug fix
ux: User experience features of fixes
balance: tweak in game configs
docs: changed documentation, usually not exposed in devlog
refactor: changed code without functionality
perf: improved performance

### examples of a commit message

```
feat(graphics): added dynamic shadows

- added options to control graphics
- added no shadows
- added dynamic shadows
```

```
perf(spawn): limited maximum creeps to 100
```

```
docs: updated tooltips for ressources
```

```
ux(inventory): improved font size in panel
```
