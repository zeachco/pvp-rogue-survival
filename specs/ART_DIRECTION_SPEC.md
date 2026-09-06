# Art Direction Spec

Authoritative for design, graphics, and visual theme: visual identity, shading model, palette, environment, 3D assets, particle policy, HUD coherence, and asset licensing. This spec does not change simulation, input, balance, or protocol; presentation-only.

- `specs/ART_DIRECTION_PLAN.md` tracks the implementation phases against this spec.
- The palette in `src/game/theme.ts` is the single source of truth for 3D and CSS colors.

## 1. Visual Identity

- The game is a dark dungeon: gloomy, creepy, eerie, atmospheric.
- The scene is never pitch black: stone surfaces, ember torchlight, and cool ambient moonlight keep every gameplay element readable.
- Warm light sources (torch, ember) contrast cool desaturated stone and moonlight.
- Shading is light toon (cel) shading with subtle outlines: readable at a glance, soft but not photoreal.
- Legibility always wins: the lighting-off path must render a complete, readable scene with authored colors alone.
- No post-processing (no composer, no bloom, no SSAO) in the current phase; glow comes from bright unlit materials and pooled lights.

## 2. Shading Model

- Lit character and environment surfaces use `THREE.MeshToonMaterial` with a shared 4-step gradient map (values 0.40 / 0.65 / 0.85 / 1.00, nearest filtering).
- Each world-standing character model receives an inverted-hull outline on its dominant silhouette mesh (largest surface area): back-face material, color `0x14100c`, uniform scale 1.04, no shadow casting or receiving, frustum culling disabled.
- Flat procedural presentation shapes keep their authored stroke rings and recolor to the dungeon palette instead of gaining new geometry.
- Bright unlit elements (torch flames, embers, spell cores) use `MeshBasicMaterial` or additive sprites so they read in every lighting mode.
- The unlit fallback used by lighting mode `Off` must accept `MeshToonMaterial` (already covered by `isLitMeshMaterial`).

## 3. Palette

`src/game/theme.ts` exports all theme colors; tests and CSS map to the same values.

### Environment

| Token | Hex | Use |
| --- | --- | --- |
| `clearColor` | `0x0a0908` | Scene clear, fog, void |
| `ambientLight` | `0x8a93a8` | Cool moonlight ambient (mode intensities unchanged) |
| `keyLight` | `0xffd9a8` | Warm directional key |
| `fog` | `0x0a0908`, density `0.00045` | Exponential fog for depth |
| `floorStone` | `0x4a4238` | Flagstone base |
| `floorMortar` | `0x171310` | Seams between stones |
| `seamMinor` | `0x1c1712` | Fine 50px grid lines |
| `seamMajor` | `0x2a2119` | Brighter major lanes |
| `rimRing` | `0x241d16` | Dark ring under the torch line |
| `pillarStone` | `0x57504a` | Obstacle pillars, ±15% per instance |
| `chainIron` | `0x3a3a40` | Hanging chains |
| `torchWood` | `0x2e2620` | Torch posts and bowls |
| `torchFlame` | `0xffa03c` | Flame body |
| `torchFlameCore` | `0xffd9a0` | Flame core |
| `torchEmber` | `0xff7a2d` | Rising embers |
| `torchLight` | `0xff9a3c` | Pooled torch point lights |

### Characters

| Token | Hex | Use |
| --- | --- | --- |
| `heroBody` | `0xd8c9a8` | Hero bone/parchment body |
| `heroAccent` | `0xffb454` | Hero stroke, aim line, aim range ring, facing chevron |
| `heroLight` | `0xffe8c2` | Hero spotlight (unchanged) |
| `outline` | `0x14100c` | Inverted-hull outlines |
| `creepBody` | `0xc74b52` | Standard creep |
| `creepStroke` | `0x2a1216` | Creep stroke when no sent item |
| `championBody` | `0xe8a84c` | Champion / rival body |
| `bossBody` | `0xb03038` | Boss body |
| `cloneBody` | `0x9a6fd0` | Clone body |
| `roleLightChampion` | `0xffc06a` | Champion point light |
| `roleLightBoss` | `0xff3348` | Boss point light |
| `roleLightClone` | `0xb98cff` | Clone point light |
| `bubbleEye` | `0xcfe8ff` | Bubble shooter eye |

### Preserved semantics (do not recolor)

- HP red `0xff3b4f` / hero bar `0xff5252`, mana blue `0x45a9ff`, rage gold `0xffd166`, XP gold `0xf4cf42`.
- Rarity ladder colors from `RARITY_COLORS` in `common/items.ts`.
- Selection `0xfff08a`, windup `0xffea77`, bonus skill `0xff6534`, threat `0xff4b62`.
- All status-effect, spell-identity, and buff icon colors.

## 4. Environment

- Clear color is `clearColor`; the scene uses `THREE.FogExp2` with the same color at density `0.00045`.
- The arena floor is procedural cracked flagstone: 8×8 stones with per-stone brightness and warm/hue variation, dark mortar seams, crack detail, and an edge vignette that melts into the void.
- The faint animated radial pulse remains, recolored to a warm ember shimmer (was cyan).
- The fine cyan grid becomes faint dark stone seams aligned to the 50px gameplay grid, with slightly brighter major lanes.
- The cyan circumference is replaced by a dark rim ring and a torch ring.
- Torches: 12 low-poly torches (wood post, iron bowl, bright unlit flame) on a ring just outside the arena radius; flames flicker by scale/rotation; 6 pooled point lights (every other torch, `torchLight`, distance 140, decay 1) flicker at 10Hz; embers are one `InstancedMesh` of 48 billboard quads (single draw call, additive, per-instance matrix updates, no per-frame buffer allocation).
- Torch lights and embers are children of the map group, so the existing lighting-mode rules apply: visible in `All`, hidden in `Hero` and `Off`.
- The 15 arena obstacles become broken stone pillars: low-poly tapered columns with a rubble base, same collision footprints and heights, per-instance stone tint variation.
- Chains: 6 hanging chains (merged box-link geometry, `chainIron`) suspended from alternating torch posts, swaying gently; presentation only.
- Traps are presentation only: 2 spike pits (stone ring + merged spikes) and 1 swinging blade (pivot post + slow arc). No collision, no damage, no new mechanics.
- Lighting modes and intensities are unchanged: `Off` (ambient 1.1, no key, unlit materials), `Hero` (ambient 0.25, key 0.95, hero spotlight + spell lights), `All` (ambient 0.05, key 0.95, all authored lights). Shadow `Off`/`Dynamic` behavior is unchanged.

## 5. Characters and Models

- Hero: `heroBody` tint, `heroAccent` stroke/aim/facing, bone-white core, warm aura colors preserved.
- Creeps: body tints per role (`creepBody`, `championBody`, `bossBody`, `cloneBody`), dark strokes, role point lights per the palette; sent-item stroke colors remain the rarity ladder.
- `AnimatedCharacter` converts loaded `MeshStandardMaterial`s to `MeshToonMaterial` (shared gradient map), copies color, emissive, maps, transparency, and side, and adds the dominant-mesh outline; tinting and the reflective-surge branch work for toon materials.
- Phase A (current): existing CC0 models (`hero.glb`, `creep.glb`, `champion.glb`, `boss.glb`, `orbiting-hammer.glb`) are kept and reskinned by tint and toon conversion.
- Phase B: swap in CC0 nightmare-monster GLBs per archetype from Quaternius/OpenGameArt with the same clip contracts (idle/move/attack/hit/death), same footprints, and retained procedural fallbacks. The model manifest in this spec and `public/assets/models/README.md` must list source, license, and SHA-256 for every asset.
- Procedural fallbacks (cone/circle bodies) remain for missing models or failed loads and follow the same tints.

## 6. Particles and FX

- Existing deterministic spell bursts (fixed particle IDs, pooled geometry) remain the base FX system.
- Torch embers (see Environment) are the first always-on particle surface.
- Later particle upgrades must be high quality and bright: additive ember, spark, and glow sprites from the palette, pooled, with fixed authored caps, batched or shared draw resources, and zero per-frame GPU allocation.
- Particle counts and budgets are authored constants in code; no unbounded spawning.

## 7. HUD

- HUD surfaces use the dungeon palette via CSS custom properties in `src/styles.css` and `src/devlog.css`:

| Property | Old | New |
| --- | --- | --- |
| `--bg` | `#05080c` | `#0c0a08` |
| `--panel` | `#101d21` | `#16130f` |
| `--panel-2` | `#142429` | `#1d1915` |
| `--panel-3` | `#192e34` | `#241f19` |
| `--ink` | `#dffeff` | `#e6dcc6` |
| `--ink-dim` | `#9effec` | `#a99c82` |
| `--ink-faint` | `#8fe8d9` | `#7a6f5c` |
| `--accent` | `#6fffe2` | `#ffa03c` |
| `--accent-soft` | `#3affd4` | `#ff8c2a` |
| `--accent-2` | `#9effec` | `#ffc98a` |
| `--accent-line` | `rgba(58,255,212,0.3)` | `rgba(255,160,60,0.35)` |
| `--line` | `#24454b` | `#2e2721` |
| `--line-soft` | `#1c383e` | `#262019` |
| `--ok` | `#57c46b` | `#57c46b` (keep) |
| `--danger` | `#ff5252` | `#ff5252` (keep) |
| `--gold` | `#f4cf42` | `#f4cf42` (keep) |
| `--blue` | `#45a9ff` | `#45a9ff` (keep) |
| `--purple` | `#b05cff` | `#b05cff` (keep) |
| `--muted` | `#8fb3ae` | `#9a8d75` |
| `--muted-2` | `#5f8480` | `#6f6553` |
| `--shadow` | `rgba(0,0,0,0.35)` | `rgba(0,0,0,0.5)` |
| `--shadow-lg` | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.6)` |
| `--focus` | `#6fffe2` | `#ffc98a` |

- Rarity, HP, mana, rage, XP, and status colors are unchanged.
- Hardcoded teal values in `rgba(58,255,212,…)`, `rgba(111,255,226,…)`, `#12463f`, `#3a7d75`, `#35646d`, `#071014`, `#0c171a`, `#102b31`, and `#091318` are remapped to the stone/ember equivalents above.

## 8. Assets and Licensing

- All external assets must be CC0 (or equivalent public-domain dedication) and documented in `public/assets/models/` with source URL, license, and SHA-256.
- Procedural and code-generated assets (floor texture, torches, chains, traps, gradient map) are exempt.
- Phase B model swaps follow the same licensing and documentation rules before the files are added.

## 9. Performance Contract

- New environment draw calls are bounded: floor 1, grid 2, rim ring 1, torches 24 (merged static parts + flames), embers 1, pillars 15, chains 6, traps 5 — under 55 total for static environment.
- Character outlines add at most 1 extra draw call per character model.
- No per-frame GPU buffer allocation for any particle or ember surface.
- Lighting mode `Off` remains the zero-cost path: unlit materials, no lights, no shadows.
- Torch lights, spell lights, and role lights stay within the existing authored pools.

## 10. Phases

- Phase A (current pass): spec space, palette module, renderer, environment, character toon + tints, HUD restyle, tests.
- Phase B: nightmare-monster model swaps (CC0, documented).
- Phase C: pooled GPU particle system with bright ember/spark FX.
- Phase D (optional): dungeon audio bed if requested.
