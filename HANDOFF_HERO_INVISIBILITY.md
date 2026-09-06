# RESOLVED — Hero invisible (SkinnedMesh collapses to a point)

> **STATUS: FIXED + verified** (typecheck clean, 462 tests pass, CDP skinning math confirmed sane).
> Self-contained record of the root cause and the applied fix. Start at **TL;DR**, then **The fix**.

## TL;DR / current status
- Symptom was: the player's hero shows no 3D body in the live game (lobby and in-match; side panels + flat disc visible).
- **Confirmed root cause (skinning bind inconsistency, NOT material/asset/culling):**
  - `cloneSkeleton(gltf.scene)` (in `AnimatedCharacter.ts`) binds the hero `SkinnedMesh` with the **GLB's original `bindMatrix`** (scale `1`).
  - The app then **rotates, scales ~50x, and translates** the model (`model.rotation.x`, `model.scale.setScalar(footprint/footprint)`, `model.position.set(...)`) and re-parents it via `this.root.add(model)`.
  - In Three `AttachedBindMode`, `bindMatrixInverse` is recomputed every frame from the **current** `matrixWorld` (scale ~`1/50`), but `bindMatrix` stays **frozen** at the GLB original (scale `1`), and `boneInverses` stay frozen at the GLB bind pose.
  - The GPU skinning `transformed = bindMatrixInverse·(Σ boneMatᵢ·(bindMatrix·v))` therefore degenerates → the whole body collapses to a point.
- **Confirmed by live CDP math** (`/tmp/opencode/cdp-rebind.mjs`, exact GPU formula, `window.__mltDebug.game`):
  - **Before:** `bindMatrixScale [1,1,1]`, `bindInvScale [0.02,0.02,0.02]`, `meshWorldScale [50.18,50.18,50.18]` → skinned bbox span **`[0.03, 0.04, 0.04]`** (collapsed speck at `[-15,1,-15]`).
  - **After** `sk.bind(sk.skeleton)` (rebind with no bindMatrix): `bindMatrixScale [50.18,50.18,50.18]`, `bindInvScale [0.02,0.02,0.02]` → skinned bbox span **`[1.92, 1.73, 1.77]`**, min `[-1,-1,-1]` max `[1,1,1]` (sane full cube).
  - So making `bindMatrix` consistent with the final transform fixes the collapse. The fix is also **robust to the hero moving** (the `bindMatrix`/`boneInverses` pair stays mutually consistent; `bindMatrixInverse` tracks the current world matrix).
- The art-direction commit `9f639b8` only changed **materials** (Standard→Toon) + colors — it did **not** touch skeleton/binding/scale/placement. The material change is **not** the cause; it's a pre-existing bind-order issue exposed in the hero.

## The fix (applied)
- File: `src/game/render/AnimatedCharacter.ts` (in `load()`, immediately after the model is placed).
- Added (after `this.root.add(model)`, before the `AnimationMixer` is created so bones are still at rest):
  ```ts
  this.root.add(model);
  model.updateMatrixWorld(true);
  model.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) o.bind(o.skeleton);
  });
  ```
- Why it works: `SkinnedMesh.bind(skeleton)` with **no** `bindMatrix` calls `updateMatrixWorld(true)` + `skeleton.calculateInverses()` and then sets `bindMatrix = matrixWorld`, `bindMatrixInverse = matrixWorld.invert()`. All three (`bindMatrix`, `boneInverses`, `bindMatrixInverse`) become mutually consistent with the model's **final** transform.
- It rebinds **both** the hero body `SkinnedMesh` and the outline `SkinnedMesh` (the outline at line ~308 was already rebound with `bind(dominant.skeleton)`, but the body was not — that asymmetry is exactly why the body collapsed).
- Verified:
  - `bunx tsc --noEmit` → clean.
  - `bun test` → 462 pass, 0 fail (changelog test logs LLM-retry noise, unrelated).
  - `bunx biome format --write` → no changes needed.
  - CDP skinning math (above) → bbox span sane after rebind.

## Objective + constraints (met)
- Make the hero's 3D body render correctly. ✅ (skin math now sane)
- **Preserve the dark-dungeon / light-toon art direction** (commit `9f639b8`, `toonMaterial`, `theme.ts`). ✅ (untouched)
- Repo: `/home/olivier/dev/pvp-rogue-survival`. Vite + TS + Three.js `0.185.1`, Bun.

## Confirmed facts (how the collapse was measured)
Access the running game (see **CDP harness** at the bottom). All read live from `window.__mltDebug.game`:

- Hero group `g.hero.mesh` contains (from `Hero.ts`):
  - `bodyMesh` = flat `CircleGeometry(18,32)` disc at `z=18` (toon) — a **simple mesh, renders regardless of skinning**.
  - `animatedCharacter.root` = the **GLB SkinnedMesh** (`Enemies_EyeDrone`) — the one that was collapsing.
  - `stroke` (RingGeometry), `facingMesh`, `aimRangeMesh` (hidden), `statusTint`, aura dots/rays.
  - → "Invisible hero" = collapsed robot body; the flat disc was still there.
- Skeleton: **8 bones**, `bindMode = "attached"`. Names: `Root, Body, Eyelid_Top, Eyelid_Bottom, FrontPistonL, BackPistonL, FrontPistonR, BackPistonR` (all `localPos [0,0,0]`).
- Skin weights: `3259` vertices, each sums to 1, all on one bone, usage `{ Body:1835, Eyelid_Top:60, Eyelid_Bottom:60, FrontPistonL:326, BackPistonL:326, FrontPistonR:326, BackPistonR:326 }`.
- Geometry: `3259` positions, `10470` indices, local bbox `-1..1`, `8` bones, has `skinIndex`+`skinWeight`.
- Hero world position ≈ `[753, 750, 25]`; camera `pos [774,319,269]`, `fov 52`, `near 1`, `far 3000`.
- Materials (toon, from art-direction commit): body `MeshToonMaterial` (DoubleSide, opaque, `gradientMap` set); outline `MeshBasicMaterial` (BackSide, `0x14100c`).
- Renderer (CDP only): `SwiftShader` software WebGL. **Do not trust SwiftShader pixels as proof of a real-browser bug**, but the **skinned-position math is CPU-side and reliable** (that's what confirmed the fix).

## Ruled out (do not re-chase)
- Material/opacity/depth — body is opaque, DoubleSide, depthTest/Write on. Forcing a bright material did not help (the **geometry** collapsed).
- Off-screen / frustum culling — hero center NDC is inside `[-1,1]`.
- Degenerate asset rig — **disproven**: the same rig skins to a sane `-1..1` cube once `bindMatrix` is consistent. The asset is fine.
- `panelOcclusion` — a real zero-rect guard is already committed (`Hud.tsx:3504`), but it was **not** the hero symptom.

## [unreliable] — discard these numbers
- The `*Det` fields in `/tmp/opencode/cdp-why.mjs` come from a **buggy hand-rolled 4x4 determinant** (returns 0 for identity). **Do not use them.** Use `Matrix4.prototype.determinant()` (if present) or `decompose()` scale product.

## Gotchas (will bite the next harness)
1. **`THREE` is NOT a global** in the page. Get constructors from live objects: `const Matrix4 = sk.matrixWorld.constructor;`
2. **Tree-shaken `Matrix4` lacks `.add()`** — add matrices element-wise over the 16-long `elements`.
3. **CDP browser is NOT joined** (`window.__mltDebug.join(...)` no-ops). State is lobby/preview; the skinning repro works there regardless.
4. **Vite (5173) and server (3000) were DOWN** while the already-loaded page (title "Multi-Line Hero") stayed alive on port 9222 — `Runtime.evaluate` still worked against it. A full reload needs Vite restarted (see **Restarting services**).
5. Three.js skinning order (row convention in shader, column math in three): `transformed = (bindMatrixInverse·(boneMat·(bindMatrix·v)))`. Emulate that order when checking on the CPU.

## Remaining (nice-to-have, not blocking)
- **Visual confirmation on a real (hardware) WebGL browser**: open `http://localhost:5173` (services already restarted; see below), join a session, and confirm the hero body renders in **lobby and in-match**. (The CPU skinning math already proves the geometry is no longer collapsed; this is just a final eyes-on check.)
- **Separate minor issue (not the invisibility bug):** the hero GLB has **no matching animation clips** (`animatedCharacter.actions` is empty, `mixer` runs but does nothing). The robot is therefore a **static** rest-pose model. If the design expects an idle/move animation, the clip names in `CHARACTER_MODEL_MANIFESTS` may not match the GLB's `gltf.animations`. Unrelated to the collapse.

## FINAL confirmation (fresh load, app code path)
- After restarting Vite+server and reloading the page (so the **app code** — not a live CDP rebind — runs from scratch):
  - `bindMatrixScale [50.18,50.18,50.18]` now **matches** `meshWorldScale [50.18,50.18,50.18]` (pre-fix it was frozen at `[1,1,1]`).
  - Skinned bbox with the **exact GPU formula**: span **`[2, 1.99, 1.81]`**, `min ≈ [-1,-1,-0.89]`, `max ≈ [1,0.98,0.92]` — the full `-1..1` cube, stable across 6 samples / 2.4s. At the 50x world scale that's ~100 world units ≈ the hero's footprint. **FIX CONFIRMED end-to-end.**
- Screenshot captured to `/tmp/opencode/hero-after-fix.png` (150 KB rendered scene — not a blank/collapsed frame).

## MEASUREMENT GOTCHA (cost an extra round-trip)
- The GPU skinning order is `result = bindMatrixInverse·(boneMat·(bindMatrix·v))` — **`bindMatrix·v` comes FIRST**.
- If you emulate it on the CPU and **omit** the `bindMatrix·v` step, you get a span of only ~`0.15` (looks "small") instead of the true ~`2`. Use `cdp-correct.mjs` / `cdp-rebind.mjs` (both apply `bindMatrix·v` first) as the reference, not the earlier `cdp-verify-app.mjs` / `cdp-animate.mjs` (which dropped that step).

## Restarting services
```
cd /home/olivier/dev/pvp-rogue-survival
bun run dev        # parallel client (vite 5173) + server (3000)
# or individually:
bunx vite --host 0.0.0.0          # 5173
bun --watch server/server.ts      # 3000
```
CDP browser (Chromium) listens on `127.0.0.1:9222` (headless) if it's still up.

## Key files & line numbers
- `src/game/render/AnimatedCharacter.ts` — **fix applied here** (the rebind block right after `this.root.add(model)`, before `new THREE.AnimationMixer(model)`). Also: `CHARACTER_MODEL_MANIFESTS` (`hero.glb`, `footprint 50`), `cloneSkeleton`, outline creation (~line 303-316, outline already rebound via `bind(dominant.skeleton)`).
- `src/game/Hero.ts` — hero group composition; `bodyMesh` disc at `:108-113`; `animatedCharacter = new AnimatedCharacter("hero", this.bodyMesh, true)` at `:114`.
- `src/game/render/ThreeRenderer.ts` — camera/frustum, `updatePanelCameraFraming`.
- `src/game/theme.ts` — `THEME`, `toonMaterial`, `toonGradientMap` (art direction; untouched).
- `src/ui/Hud.tsx:3504` — `panelOcclusion()` zero-rect guard (already present, unrelated).
- `public/assets/models/hero.glb` (303 KB) — robot asset (`Enemies_EyeDrone`).
- `node_modules/three/src/objects/SkinnedMesh.js` — `bind()` / `updateMatrixWorld()` / `AttachedBindMode`.
- `node_modules/three/src/objects/Skeleton.js` — `calculateInverses()`.
- `node_modules/three/examples/jsm/utils/SkeletonUtils.js` — clone path (copies `bindMatrix`, calls `bind(skeleton, bindMatrix)`).
- `node_modules/three/src/renderers/shaders/ShaderChunk/skinning_vertex.glsl.js` — GPU skinning formula.
- CDP harness + evidence: `/tmp/opencode/` (`cdp-rebind.mjs` = decisive before/after, `cdp-fix.mjs`, `cdp-skin3.mjs`, `cdp-bones.mjs`; `hero-after-fix.png`).

## CDP harness how-to (reuse this connect pattern)
```js
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = targets.find(t => t.type === "page" && t.url.includes("localhost:5173"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
// send {id, method:"Runtime.evaluate", params:{expression, returnByValue:true}}
// expression is an IIFE (() => { ... })(); use window.__mltDebug.game
// Remember: THREE is not global; Matrix4 has no .add(); add element-wise.
```
Run scripts with `bun <file>.mjs` from `/tmp/opencode`.

## Verification (required before done) — DONE
- `bunx tsc --noEmit` → clean ✅
- `bun test` → 462 pass / 0 fail ✅
- `bunx biome format --write` → clean ✅
- CDP skinning math, **fresh load of the app code** → bbox span `[2,1.99,1.81]` (full cube) ✅ (see **FINAL confirmation**)
- **Still to do (eyes-on only):** open `http://localhost:5173` and confirm the hero body is visible in lobby + in-match on a real (hardware) WebGL browser. Services are already running (started via `bun run dev`, log at `/tmp/opencode/dev.log`).
