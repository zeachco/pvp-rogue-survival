---
name: td-war-preview-driven-tweaks
description: Implement or review td-war-multiplayer gameplay, economy, inventory, equipment, progression, or HUD changes that can alter player-visible resources, attributes, advanced combat stats, equipment, or spell availability and levels. Use for game actions and hover/focus previews so every consequence appears as a consistent before-and-after projection in the panel that owns the value.
---

# TD War Preview-Driven Tweaks

1. Read `AGENTS.md` and the relevant files in `specs/`; update the owning spec before code when behavior changes.
2. List every consequence of the action across:
   - inventory-header resources: Gold, Souls, and every Scrap rarity;
   - character-sheet attributes;
   - advanced combat stats;
   - bottom-left spell availability and levels;
   - equipment slots and displaced equipment.
3. Compute one projected domain state without mutating authoritative state. Model displayed values as `{ currentVal, newVal }`; use `newVal: null` when the action removes a value or spell.
4. Use `src/ui/preview.ts` to format and color projections. Do not concatenate bespoke `current → new` strings in feature handlers.
5. Render each projection where its authoritative value already lives:
   - resources in the fixed inventory header;
   - attributes and advanced stats in the left character panel;
   - spell changes in the bottom-left spell rail.
   Do not add an action-local diff box when an owning panel exists.
6. Preview the exact action, including Equip versus Unequip, starter-club restoration, two-handed offhand displacement, skill gain/removal, costs, and unavailable outputs. Hover/focus must never mutate server state.
7. Restore authoritative values on pointer/focus exit. Keep stable DOM behavior and avoid rebuilding unrelated HUD subtrees.
8. Add focused tests for projection utilities or domain rules, then run `git diff --check`, `bun test`, and `bun run build`.
