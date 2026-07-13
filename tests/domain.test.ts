import { describe, expect, test } from "bun:test";
import { BALANCE_PROFILES } from "../common/balance";
import { rollWeaponDamage } from "../common/combat";
import { collectIntoInventory, emptyScraps, inventoryCapacity, mergeFromInventory, purgeFromInventory, setAutomation } from "../common/inventory";
import { generateBuckler, generateItem, itemStackKey, starterClub } from "../common/items";
import { DEFAULT_ALLOCATION, ZERO_STATS } from "../common/progression";
import { parseClientMessage, type PlayerProgress } from "../common/protocol";
import { SeededRandom } from "../common/random";
import { regularCount, regularLevel, rivalLevel } from "../common/waves";

function progress(): PlayerProgress { return { level: 0, xp: 0, stats: { ...ZERO_STATS }, allocation: { ...DEFAULT_ALLOCATION }, gold: 1000, scraps: emptyScraps(), mainHand: starterClub(), inventoryTiles: [], learnedSkills: ["healing"], learnedSkillLevels: { healing: 1 } }; }
let id = 0;

describe("balance and waves", () => {
  test("keeps capped wave scaling", () => { const balance = BALANCE_PROFILES.normal; expect(regularCount(1, balance)).toBe(12); expect(regularLevel(3, 0, 16, balance)).toBe(1); expect(rivalLevel(5, 10, balance)).toBe(8); expect(regularCount(100, balance)).toBe(40); });
  test("development damage is deterministic", () => { const item = starterClub(); const normal = rollWeaponDamage(item, ZERO_STATS, "hero", BALANCE_PROFILES.normal, new SeededRandom(2)); expect(rollWeaponDamage(item, ZERO_STATS, "hero", BALANCE_PROFILES.dev, new SeededRandom(2))).toBeCloseTo(normal * 1.5); });
});

describe("permanent inventory", () => {
  test("keeps zero tiles and enforces level capacity", () => { const state = progress(); expect(inventoryCapacity(0)).toBe(4); for (let n = 0; n < 4; n += 1) expect(collectIntoInventory(state, generateItem(n, "common", 100 + n), () => `tile-${++id}`, () => ++id).changed).toBeTrue(); const tile = state.inventoryTiles[0]; purgeFromInventory(state, tile.id); expect(tile.quantity).toBe(0); expect(state.inventoryTiles).toHaveLength(4); expect(collectIntoInventory(state, generateItem(9, "epic", 999), () => `tile-${++id}`, () => ++id).changed).toBeFalse(); });
  test("stacks exact configurations and performs paid level-up", () => { const state = progress(); const item = generateItem(1, "common", 41); collectIntoInventory(state, item, () => `tile-${++id}`, () => ++id); collectIntoInventory(state, { ...item, id: "copy" }, () => `tile-${++id}`, () => ++id); expect(state.inventoryTiles).toHaveLength(1); state.scraps.common = 10; const result = mergeFromInventory(state, state.inventoryTiles[0].id, () => `tile-${++id}`, () => 55); expect(result.changed).toBeTrue(); expect(result.created?.level).toBe(2); expect(state.inventoryTiles).toHaveLength(2); });
  test("automates matching pickups and generates buckler metadata", () => { const state = progress(); const item = generateItem(0, "common", 51); collectIntoInventory(state, item, () => `tile-${++id}`, () => ++id); setAutomation(state, state.inventoryTiles[0].id, "sell", () => `tile-${++id}`, () => ++id); const gold = state.gold; collectIntoInventory(state, { ...item, id: "copy" }, () => `tile-${++id}`, () => ++id); expect(state.gold).toBe(gold + item.sellValue); const buckler = generateBuckler(4, "rare", 7); expect(buckler.itemKind).toBe("buckler"); expect(itemStackKey(buckler)).toContain("blockChance"); });
});

describe("protocol validation", () => { test("accepts v2 commands and rejects authored rewards", () => { expect(parseClientMessage({ type: "sendItem", tileId: "tile-1" })).toEqual({ type: "sendItem", tileId: "tile-1" }); expect(parseClientMessage({ type: "creepKilled", unitId: "unit-1", xpReward: 9999 })).toBeUndefined(); expect(parseClientMessage({ type: "updateAllocation", allocation: { agility: 5 } })).toBeUndefined(); }); });
