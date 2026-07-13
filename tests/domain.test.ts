import { describe, expect, test } from "bun:test";
import { BALANCE_PROFILES } from "../common/balance";
import { rollWeaponDamage } from "../common/combat";
import { collectIntoBackpack, equipFromBackpack, mergeBackpackTriples } from "../common/inventory";
import { generateItem, starterClub } from "../common/items";
import { DEFAULT_ALLOCATION, ZERO_STATS } from "../common/progression";
import { parseClientMessage, type PlayerProgress } from "../common/protocol";
import { SeededRandom } from "../common/random";
import { regularCount, regularLevel, rivalLevel } from "../common/waves";

function progress(): PlayerProgress {
  return { level: 0, xp: 0, stats: { ...ZERO_STATS }, allocation: { ...DEFAULT_ALLOCATION }, gold: 0, equipped: starterClub(), backpack: [], learnedSkills: ["healing"], learnedSkillLevels: { healing: 1 } };
}

describe("balance and waves", () => {
  test("keeps the opening and applies the survival tier every two waves", () => {
    const balance = BALANCE_PROFILES.normal;
    expect(regularCount(1, balance)).toBe(12);
    expect(regularLevel(1, 0, 12, balance)).toBe(0);
    expect(regularLevel(2, 0, 14, balance)).toBe(0);
    expect(regularLevel(3, 0, 16, balance)).toBe(1);
    expect(regularLevel(5, 0, 20, balance)).toBe(2);
    expect(rivalLevel(5, 10, balance)).toBe(8);
    expect(regularCount(100, balance)).toBe(40);
  });
  test("development damage is deterministic and more forgiving", () => {
    const item = starterClub();
    const normalHero = rollWeaponDamage(item, ZERO_STATS, "hero", BALANCE_PROFILES.normal, new SeededRandom(2));
    const devHero = rollWeaponDamage(item, ZERO_STATS, "hero", BALANCE_PROFILES.dev, new SeededRandom(2));
    const devEnemy = rollWeaponDamage(item, ZERO_STATS, "enemy", BALANCE_PROFILES.dev, new SeededRandom(2));
    expect(devHero).toBeCloseTo(normalHero * 1.5); expect(devEnemy).toBeCloseTo(normalHero * 0.6);
  });
});

describe("inventory domain", () => {
  test("rejects a ninth unrelated backpack item", () => {
    const state = progress(); state.backpack = Array.from({ length: 8 }, (_, index) => generateItem(index, "common", index + 20));
    const result = collectIntoBackpack(state, generateItem(20, "epic", 999), () => 1);
    expect(result.changed).toBeFalse(); expect(state.backpack).toHaveLength(8);
  });
  test("merges triples and equips through pure transactions", () => {
    const state = progress(); const item = generateItem(0, "common", 41);
    state.backpack = [{ ...item, id: "a" }, { ...item, id: "b" }, { ...item, id: "c" }];
    expect(mergeBackpackTriples(state, () => 55)).toHaveLength(1); expect(state.backpack).toHaveLength(1);
    expect(equipFromBackpack(state, state.backpack[0].id, () => 56).changed).toBeTrue();
  });
});

describe("protocol validation", () => {
  test("accepts commands and rejects client-authored rewards", () => {
    expect(parseClientMessage({ type: "creepDefeated", unitId: "unit-1" })).toEqual({ type: "creepDefeated", unitId: "unit-1" });
    expect(parseClientMessage({ type: "creepKilled", unitId: "unit-1", xpReward: 9999 })).toBeUndefined();
    expect(parseClientMessage({ type: "updateAllocation", allocation: { agility: 5 } })).toBeUndefined();
  });
});
