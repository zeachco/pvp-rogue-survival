# Dark Dungeon Art Direction — Implementation Plan

Companion plan to `specs/ART_DIRECTION_SPEC.md` (authoritative behavior). Work is spec-first: each spec section lands before its implementation, and specs stay synchronized as code changes.

## Phase 0 — Spec space (this pass)

- [x] `specs/ART_DIRECTION_PLAN.md` — this plan
- [x] `specs/ART_DIRECTION_SPEC.md` — authoritative for design, graphics, and visual theme:
  - Visual identity: "The Darkest Dungeon" — gloomy, creepy, eerie, atmospheric, never pitch black
  - Shading model: light toon (3–4 step gradient map, subtle inverted-hull outlines, rim readability)
  - Palette: single source of truth `src/game/theme.ts` + CSS custom properties
  - Environment: flagstone floor, torch ring, stone-pillar obstacles, chains, decorative traps, subtle fog
  - 3D asset manifest with per-asset current source → target style → phase
  - Model design plan (phased A/B/C)
  - Particle policy (bright, high quality, fixed caps, pooled)
  - HUD coherence rules
  - Licensing: CC0 only, documented in `public/assets/models/`
- [x] `specs/SPEC.md` — §3 boundaries add the new spec; §4 line "Particle effects remain future work" updated; §7 "futuristic, simple geometric shapes" replaced with dungeon direction + pointer to the new spec
- [x] `specs/MECHANICS_SPEC.md` — arena rendering bullet: Tron-style wording → dungeon arena wording (all simulation, z-layering, legibility, and light rules preserved); obstacle bullet: cones → broken stone pillars
- [x] `AGENTS.md` — spec-boundaries list gains `specs/ART_DIRECTION_SPEC.md`

## Phase 1 — Theme switch (this pass)

- [x] `src/game/theme.ts` — palette module (3D + light + fog constants); tests import from it
- [x] `src/game/render/ThreeRenderer.ts` — warm near-black clear color, cool desaturated ambient, warm key light, subtle exponential fog
- [x] `src/game/render/ArenaFloorTexture.ts` — cracked flagstone with per-stone variation, dark mortar seams, vignette; faint warm radial pulse (was cyan)
- [x] `src/game/Map.ts` — dark stone seam grid (was cyan), torch ring replacing the cyan circumference (low-poly torches + pooled flickering point lights + embers), broken stone-pillar obstacles (same collision footprints), decorative hanging chains, decorative spike pits / swinging blade (presentation-only, no collision)
- [x] `src/game/render/AnimatedCharacter.ts` — MeshStandardMaterial → MeshToonMaterial with shared gradient map, inverted-hull outlines on loaded GLB meshes, dungeon base tints, reflectiveSurge branch safe for toon materials
- [x] `src/game/Hero.ts` — bone body tint, ember stroke/aim guides, keep semantic aura colors
- [x] `src/game/Creep.ts` — sickly-red creep / ember champion / blood boss / spectral clone tints
- [x] `src/game/AttackArea.ts` — hero accent ember (was teal); enemy threat red retained
- [x] `src/game/ItemDrop.ts` — keep denomination semantics; rusted-copper brown coin
- [x] `src/styles.css` + `src/devlog.css` — dungeon palette for HUD surfaces: parchment text, ember accents, stone panel tints; rarity/HP/mana/XP semantics unchanged
- [x] `tests/simulation.test.ts` — color assertions import `theme.ts` constants
- [x] Verify: `bun test`, `bunx tsc --noEmit`, `bunx biome format --write .`

## Phase B — Nightmare monster models (later pass)

- [ ] Source CC0 fantasy/monster GLBs per archetype (creep, champion, boss, hero, clone) from Quaternius/OpenGameArt
- [ ] License + source + SHA-256 recorded in `public/assets/models/`; README updated
- [ ] Same `AnimatedCharacter` clip contracts (idle/move/attack/hit/death), same footprints, procedural fallbacks retained
- [ ] Spec manifest updated with final sources

## Phase C — Particle system (later pass)

- [ ] Pooled GPU particle system (THREE.Points/instanced sprites), additive bright materials
- [ ] Torch embers at scale, hit sparks, spell burst upgrades, death burst polish
- [ ] Fixed authored caps, batched/shared draw resources, zero per-frame GPU allocation
- [ ] `specs/ART_DIRECTION_SPEC.md` particle policy becomes the runtime contract

## Phase D — Optional

- [ ] Dungeon audio bed (cavern reverb, torch crackle) if requested

## Commits

1. `docs(specs): add art direction spec for dark dungeon theme`
2. `feat(graphics): dark dungeon theme with light toon shading`

## Risks

- Test color assertions must move in the same commit as the palette
- Torch lights are global authored lights: visible only in the `All` lighting mode, hidden in `Hero`/`Off` (existing lighting rules)
- Unlit mobile default must stay legible via outlines + authored colors
- `lightingMaterial` unlit fallback must handle `MeshToonMaterial` (already in `isLitMeshMaterial`)
