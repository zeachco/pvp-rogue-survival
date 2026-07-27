import {describe, expect, test} from "bun:test";

import {
  auraRadius,
  auraSlowMultiplier,
  sunburnFraction,
  sunburnInterval,
  thunderCritChance,
  thunderDamage,
  thunderInterval
} from "../common/auras";
import {BALANCE} from "../common/balance";
import {
  attackProfile,
  bucklerBlockCost,
  healingCast,
  healingCooldown,
  healingFraction,
  manaConversionFraction,
  orbitingHammerDuration,
  rapidRegenDuration,
  rapidRegenMultiplier,
  skillCooldown,
  skillDamagePreview,
  skillRange,
  timeHarvestCooldownReduction,
  timeHarvestItemSkillBonus,
  swampCooldown,
  swampRadius,
  weaponAttackSpeed,
  weaponDamage,
  weaponRange,
  weaponUsesProjectile,
  whirlwindDamage,
  whirlwindDuration,
  whirlwindMovementSpeed,
  whirlwindRadius
} from "../common/combat";
import {SKILLS, WEAPONS} from "../common/content";
import {
  collectIntoInventory,
  dropInventoryOverflow,
  emptyScraps,
  equipFromInventory,
  extractionCost,
  extractableSkills,
  extractFromInventory,
  inventoryCapacity,
  isEquippedTile,
  occupiedInventorySlots,
  purgeFromInventory,
  sellFromInventory,
  sendFromInventory,
  upgradeCosts,
  upgradeFromInventory
} from "../common/inventory";
import {
  AURA_SKILLS,
  equippedPerks,
  generateAccessory,
  generateBuckler,
  generateItem,
  generateRelic,
  itemCooldownReduction,
  itemRequirementMultiplier,
  itemStackKey,
  levelUpItem,
  MAX_ITEM_LEVEL,
  starterClub
} from "../common/items";
import {
  cumulativeXpForLevel,
  DEFAULT_ALLOCATION,
  derivedStats,
  lerpXpDisplay,
  levelForXp,
  STAT_KEYS,
  xpForNextLevel,
  ZERO_STATS
} from "../common/progression";
import {parseClientMessage, type PlayerProgress} from "../common/protocol";
import {
  championCount,
  creepMaxHealth,
  creepsWithSpellsCount,
  realmCloneLevel,
  regularCount,
  regularLevel,
  rivalLevel,
  rivalXpReward
} from "../common/waves";
import {
  bloodSkillDamage,
  bloodSkillLifeCost,
  actualSkillLevel,
  effectiveSkillLevel,
  forceField,
  forceFieldDamage,
  skillHealthRequirementMet
} from "../src/game/systems/HeroCombatSystem";
import {gameSocketUrl} from "../src/net/SocketClient";
import {itemRequirementRows, requirementMetStats} from "../src/ui/ItemDetails";
import {formatPreviewValue, formatProjectedValue, previewTone} from "../src/ui/preview";
import {extractButtonStatus} from "../src/ui/inventoryAvailability";
import {statusEffectSummaries} from "../src/ui/Hud";

function progress(): PlayerProgress {
  return {
    level : 0,
    xp : 0,
    stats : {...ZERO_STATS},
    allocation : {...DEFAULT_ALLOCATION},
    gold : 1000,
    souls : 0,
    scraps : emptyScraps(),
    mainHand : starterClub(),
    inventoryTiles : [],
    learnedSkills : [ "healing" ],
    learnedSkillLevels : {healing : 1},
    universalSkills : [ "healing", ...AURA_SKILLS ]
  };
}
let id = 0;

describe("balance and waves", () => {
  test("keeps capped waves and player-independent champion scaling", () => {
    const balance = BALANCE;
    expect(regularCount(0, balance)).toBe(10);
    expect(regularCount(1, balance)).toBe(12);
    expect(regularLevel(3, 0, 16, balance)).toBe(1);
    expect(rivalLevel(1, balance)).toBe(1);
    expect(rivalLevel(5, balance)).toBe(3);
    expect(rivalXpReward(3)).toBe(34);
    expect(regularCount(100, balance)).toBe(40);
    expect(championCount(1)).toBe(0);
    expect(championCount(8)).toBe(1);
    expect(championCount(23)).toBe(2);
    expect(creepsWithSpellsCount(0, 10)).toBe(0);
    expect(creepsWithSpellsCount(8, 26)).toBe(0);
    expect(creepsWithSpellsCount(9, 28)).toBe(2);
    expect(creepsWithSpellsCount(15, 40)).toBe(3);
  });
  test("divides defender level evenly across realm-attacker clones", () => {
    expect(realmCloneLevel(11, 1)).toBe(11);
    expect(realmCloneLevel(11, 2)).toBe(5);
    expect(realmCloneLevel(11, 3)).toBe(3);
    expect(realmCloneLevel(0, 2)).toBe(0);
  });
  test("gives enemy levels zero through seven exactly one through eight HP",
       () => {
         for (let level = 0; level < 8; level += 1)
           expect(creepMaxHealth(level, 99, BALANCE)).toBe(level + 1);
         expect(creepMaxHealth(8, 18, BALANCE)).toBe(18);
       });
});
describe("attack timing", () => {
  test("uses damped weight handling for physical and magic weapons", () => {
    const club = starterClub();
    expect(weaponAttackSpeed(club, ZERO_STATS)).toBeCloseTo(10 / 12);
    expect(weaponAttackSpeed(club, {...ZERO_STATS, agility : 100}))
        .toBeCloseTo(20 / 12);
    const generatedStaff =
        generateItem(0, "common", 5, {allowedClasses : [ "staff" ]});
    const staff = {
      ...generatedStaff,
      modifiers : {...generatedStaff.modifiers, attackSpeedMultiplier : 1}
    };
    expect(
        weaponAttackSpeed(staff, {...ZERO_STATS, strength : 100, spirit : 100}))
        .toBeCloseTo(20 / 16);
    expect(weaponAttackSpeed(staff, {...ZERO_STATS, agility : 1_000}))
        .toBeCloseTo(10 / 16);
  });
});
test("resolves the configured unarmed profile from effective Strength", () => {
  expect(attackProfile(undefined, {...ZERO_STATS, strength : 8}, BALANCE))
      .toMatchObject({
        kind : "unarmed",
        damage : 9,
        attacksPerSecond : 1,
        range : 70,
        staminaCost : 1,
        projectile : false
      });
});
describe("equipment requirements", () => {
  test(
      "permits under-requirement equipment and scales item output by missing stat plus one",
      () => {
        const state = progress();
        state.level = 100;
        const sword = {
          ...generateItem(5, "rare", 71, {allowedClasses : [ "sword" ]}),
          requirements : {strength : 15},
          perks : {defense : 9}
        };
        state.stats.strength = 13;
        state.inventoryTiles.push({
          id : "penalized",
          key : itemStackKey(sword),
          item : sword,
          quantity : 1
        });
        expect(itemRequirementMultiplier(sword, state.stats))
            .toBeCloseTo(1 / 3);
        expect(equipFromInventory(state, "penalized").changed).toBeTrue();
        expect(equippedPerks(state.stats, sword).defense).toBeCloseTo(3);
      });
  test("never reduces weapon damage below that weapon's level-zero value",
       () => {
         const sword = {
           ...generateItem(5, "common", 72, {allowedClasses : [ "sword" ]}),
           requirements : {strength : 100}
         };
         expect(weaponDamage(sword, ZERO_STATS))
             .toBeCloseTo(sword.modifiers.damageMultiplier / 1.125);
       });
  test(
      "never reduces weapon speed below its ordinary weight-and-handling speed",
      () => {
        const sword =
            generateItem(5, "common", 72, {allowedClasses : [ "sword" ]});
        const swiftSword = {
          ...sword,
          requirements : {strength : 100},
          modifiers : {...sword.modifiers, attackSpeedMultiplier : 1.2}
        };
        const baseSpeed = 10 / swiftSword.weight;
        expect(weaponAttackSpeed(swiftSword, ZERO_STATS))
            .toBeCloseTo(baseSpeed * (1 + 0.2 / 101));
        expect(weaponAttackSpeed({
          ...swiftSword,
          modifiers : {...swiftSword.modifiers, attackSpeedMultiplier : 1}
        },
                                 ZERO_STATS))
            .toBeCloseTo(baseSpeed);
      });
  test(
      "marks only upgrade requirements above the hero's matching stat as unmet",
      () => {
        const item = {
          ...generateItem(4, "common", 72, {allowedClasses : [ "sword" ]}),
          requirements : {strength : 15, agility : 8}
        };
        const baseline = {...item, requirements : {strength : 12, agility : 7}};
        expect(itemRequirementRows(
                   item, {...ZERO_STATS, strength : 13, agility : 9}, baseline))
            .toEqual([
              {key : "agility", currentVal : 7, newVal : 8, unmet : false},
              {key : "strength", currentVal : 12, newVal : 15, unmet : true}
            ]);
      });
  test(
      "projects the minimum attributes that fully satisfy an item's requirements",
      () => {
        const item = {
          ...generateItem(4, "common", 73, {allowedClasses : [ "axe" ]}),
          requirements : {strength : 15, agility : 8}
        };
        expect(requirementMetStats(item,
                                   {...ZERO_STATS, strength : 13, agility : 9}))
            .toEqual({...ZERO_STATS, strength : 15, agility : 9});
      });
});
test("derives health from Strength and mana from Intelligence", () => {
  const base = derivedStats(ZERO_STATS);
  expect(base.maxHp).toBe(10);
  expect(base.maxMana).toBe(5);
  const advanced =
      derivedStats({...ZERO_STATS, strength : 3, magic : 99, intelligence : 2});
  expect(advanced.maxHp).toBe(13);
  expect(advanced.maxMana).toBe(9);
});
describe("XP curve", () => {
  test("uses a quadratic cumulative curve with a 15 XP first level", () => {
    expect([ 0, 1, 2, 3, 4, 5 ].map(xpForNextLevel)).toEqual([
      15, 45, 75, 105, 135, 165
    ]);
    expect(cumulativeXpForLevel(4)).toBe(240);
    expect(levelForXp(239)).toBe(3);
    expect(levelForXp(240)).toBe(4);
  });
});

describe("permanent inventory", () => {
  test("changes extraction availability only when Gold crosses the required cost", () => {
    const state = progress();
    const item = generateItem(2, "rare", 83);
    item.skills = ["shockwave"];
    const tile = {id : "extractable", key : itemStackKey(item), item, quantity : 1};
    state.inventoryTiles.push(tile);
    state.learnedSkills.push("shockwave");
    state.learnedSkillLevels.shockwave = 4;
    expect(extractionCost(state, ["shockwave"])).toBe(40);
    state.gold = 38;
    expect(extractButtonStatus(tile, state)).toBe("needs-gold");
    state.gold += 1;
    expect(extractButtonStatus(tile, state)).toBe("needs-gold");
    state.gold += 1;
    expect(extractButtonStatus(tile, state)).toBe("available");
    state.mainHand = item;
    expect(extractButtonStatus(tile, state)).toBe("equipped-only");
  });
  test("disables extraction until every carried skill is permanently learned", () => {
    const state = progress(); const item = generateItem(1, "epic", 27, { allowedClasses: ["staff"] });
    const tile = { id: "unlearned", key: itemStackKey(item), item, quantity: 1 }; state.inventoryTiles.push(tile); state.gold = 10_000;
    expect(extractButtonStatus(tile, state)).toBe("unlearned-skill");
    expect(extractFromInventory(state, tile.id)).toMatchObject({ changed: false, reason: expect.stringContaining("must first be learned") });
  });
  test(
      "toggles an equipped weapon to an empty main hand without creating a fallback club",
      () => {
        const state = progress();
        state.level = 100;
        const clubTile = {
          id : "club",
          key : itemStackKey(state.mainHand),
          item : state.mainHand!,
          quantity : 1
        };
        state.inventoryTiles.push(clubTile);
        expect(equipFromInventory(state, clubTile.id).changed).toBeTrue();
        expect(state.mainHand).toBeUndefined();
        expect(clubTile.quantity).toBe(1);
        expect(state.inventoryTiles).toHaveLength(1);
      });
  test("toggles an equipped offhand back to unequipped", () => {
    const state = progress();
    const buckler = {...generateBuckler(0, "common", 12), requirements : {}};
    collectIntoInventory(state, buckler, () => `tile-${++id}`, () => ++id);
    const tile = state.inventoryTiles[0];
    expect(equipFromInventory(state, tile.id).changed).toBeTrue();
    expect(state.offHand).toBeDefined();
    expect(equipFromInventory(state, tile.id).changed).toBeTrue();
    expect(state.offHand).toBeUndefined();
    expect(tile.quantity).toBe(1);
  });
  test("prices percentage return above one stamina and upgrades it toward one",
       () => {
         const base = {
           ...generateBuckler(0, "rare", 18),
           reflectionComponents : [ "return" as const]
         };
         const stats = {...ZERO_STATS, agility : 50};
         const baseCost = bucklerBlockCost(base, stats);
         const upgraded = levelUpItem(base, 19);
         expect(baseCost).toBeGreaterThan(1);
         expect(bucklerBlockCost(upgraded, stats)).toBeGreaterThan(1);
         expect(bucklerBlockCost(upgraded, stats)).toBeLessThan(baseCost);
       });
  test("equips relics as offhands and preserves their attraction passive",
       () => {
         const state = progress();
         const relic = {...generateRelic(0, "rare", 12), attractionSpeed : 35};
         collectIntoInventory(state, relic, () => `tile-${++id}`, () => ++id);
         expect(equipFromInventory(state, state.inventoryTiles[0].id).changed)
             .toBeTrue();
         expect(state.offHand?.itemKind).toBe("relic");
         expect(state.offHand?.attractionSpeed).toBe(35);
       });
  test("removes empty stacks and releases their capacity immediately", () => {
    const state = progress();
    expect(inventoryCapacity(0)).toBe(8);
    for (let n = 0; n < 8; n += 1)
      expect(collectIntoInventory(state, generateItem(n, "common", 100 + n),
                                  () => `tile-${++id}`, () => ++id)
                 .changed)
          .toBeTrue();
    const tile = state.inventoryTiles[0];
    purgeFromInventory(state, tile.id);
    expect(state.inventoryTiles.some((candidate) => candidate.id === tile.id))
        .toBeFalse();
    expect(occupiedInventorySlots(state)).toBe(7);
    expect(collectIntoInventory(state, generateItem(9, "epic", 999),
                                () => `tile-${++id}`, () => ++id)
               .changed)
        .toBeTrue();
    expect(occupiedInventorySlots(state)).toBe(8);
  });
  test("upgrades one source copy without creating persistent automation",
       () => {
         const state = progress();
         const item = generateItem(1, "common", 41);
         collectIntoInventory(state, item, () => `tile-${++id}`, () => ++id);
         collectIntoInventory(state, {...item, id : "copy"},
                              () => `tile-${++id}`, () => ++id);
         state.scraps.common = 10;
         const gold = state.gold;
         const result = upgradeFromInventory(state, state.inventoryTiles[0].id,
                                             () => `tile-${++id}`, () => 55);
         expect(result.changed).toBeTrue();
         expect(result.created?.level).toBe(2);
         expect(state.inventoryTiles[0].quantity).toBe(1);
         expect(state.inventoryTiles[1].quantity).toBe(1);
         expect(state.scraps.common).toBe(10 - upgradeCosts(item).scraps);
         expect(state.gold).toBeLessThan(gold);
       });
  test(
      "uses lower upgrade bases and increases them for direct attribute points",
      () => {
        const plain = generateItem(1, "common", 41);
        const attributed = {...plain, statBonuses : {spirit : 3}};
        expect(upgradeCosts(plain))
            .toEqual({gold : Math.ceil(plain.sellValue * 1.5 * 1.1), scraps : 5});
        expect(upgradeCosts(attributed)).toEqual({
          gold : Math.ceil(plain.sellValue * 1.5 * 1.3),
          scraps : 6
        });
      });
  test("upgrades a lone equipped copy in place when resources are sufficient",
       () => {
         const state = progress();
         const item = {...generateItem(1, "common", 141), requirements : {}};
         collectIntoInventory(state, item, () => `tile-${++id}`, () => ++id);
         const tile = state.inventoryTiles.find(
             (candidate) => candidate.key === itemStackKey(item))!;
         expect(equipFromInventory(state, tile.id).changed).toBeTrue();
         state.scraps.common = 20;
         const result = upgradeFromInventory(state, tile.id,
                                             () => `tile-${++id}`, () => 155);
         expect(result.changed).toBeTrue();
         expect(state.mainHand.level).toBe(2);
         const upgraded = state.inventoryTiles.find(
             (candidate) => candidate.key === itemStackKey(state.mainHand));
         expect(upgraded?.quantity).toBe(1);
         expect(isEquippedTile(state, upgraded!)).toBeTrue();
         expect(
             state.inventoryTiles.some((candidate) => candidate.id === tile.id))
             .toBeFalse();
       });
  test("retains equipped copies and rejects destructive actions", () => {
    const state = progress();
    const item = {...generateItem(1, "rare", 71), requirements : {}};
    collectIntoInventory(state, item, () => `tile-${++id}`, () => ++id);
    const tile = state.inventoryTiles[0];
    expect(equipFromInventory(state, tile.id).changed).toBeTrue();
    expect(tile.quantity).toBe(1);
    expect(isEquippedTile(state, tile)).toBeTrue();
    expect(state.inventoryTiles.some(
               (candidate) => candidate.key === itemStackKey(starterClub())))
        .toBeTrue();
    const gold = state.gold;
    const scraps = state.scraps.rare;
    expect(sellFromInventory(state, tile.id).changed).toBeFalse();
    expect(purgeFromInventory(state, tile.id).changed).toBeFalse();
    expect(tile.quantity).toBe(1);
    expect(state.gold).toBe(gold);
    expect(state.scraps.rare).toBe(scraps);
  });
  test("allows destructive actions on spare copies in an equipped stack",
       () => {
         const state = progress();
         const item = {...generateItem(1, "rare", 71), requirements : {}};
         for (let copy = 0; copy < 4; copy += 1)
           collectIntoInventory(state, {...item, id : `spare-${copy}`},
                                () => `tile-${++id}`, () => ++id);
         const tile = state.inventoryTiles[0];
         expect(equipFromInventory(state, tile.id).changed).toBeTrue();
         expect(tile.quantity).toBe(4);
         expect(state.inventoryTiles).toContain(tile);
         expect(sellFromInventory(state, tile.id).changed).toBeTrue();
         expect(purgeFromInventory(state, tile.id).changed).toBeTrue();
         expect(sendFromInventory(state, tile.id).changed).toBeTrue();
         expect(tile.quantity).toBe(1);
         expect(isEquippedTile(state, tile)).toBeTrue();
         expect(sellFromInventory(state, tile.id).changed).toBeFalse();
       });
});

describe("protocol validation", () => {
  test(
      "accepts v20 inventory, suicide, and anonymous commands and rejects retired automation",
      () => {
        expect(parseClientMessage(
                   {type : "upgradeItem", tileId : "tile-1", bulk : true}))
            .toEqual({type : "upgradeItem", tileId : "tile-1", bulk : true});
        expect(parseClientMessage({type : "deferDrop", dropId : "drop-1"}))
            .toEqual({type : "deferDrop", dropId : "drop-1"});
        expect(parseClientMessage({type : "suicide"})?.type).toBe("suicide");
        expect(parseClientMessage({type : "join", name : "Hero_1"})?.type)
            .toBe("join");
        expect(parseClientMessage({type : "join", name : "bad name"}))
            .toBeUndefined();
        expect(parseClientMessage({type : "listHeroes"})?.type)
            .toBe("listHeroes");
        expect(parseClientMessage({
                 type : "respecStats",
                 allocation : {
                   agility : 1,
                   strength : 1,
                   magic : 1,
                   spirit : 1,
                   intelligence : 1
                 }
               })?.type)
            .toBe("respecStats");
        expect(parseClientMessage({
          type : "setStackAutomation",
          tileId : "tile-1",
          mode : "sell",
          maxRarity : "rare"
        })).toBeUndefined();
        expect(parseClientMessage({type : "mergeItem", tileId : "tile-1"}))
            .toBeUndefined();
        expect(parseClientMessage(
                   {type : "creepKilled", unitId : "unit-1", xpReward : 9999}))
            .toBeUndefined();
        expect(parseClientMessage({
          type : "updateAllocation",
          allocation : {agility : 5}
        })).toBeUndefined();
      });
});
describe("weapon skills", () => {
  test("gives every weapon class a distinct registered signature skill", () => {
    const skills = Object.values(WEAPONS).map((weapon) => weapon.skill);
    expect(new Set(skills).size).toBe(Object.keys(WEAPONS).length);
    for (const skill of skills)
      expect(skill && SKILLS[skill]).toBeDefined();
    expect(WEAPONS.mace.skill).toBe("shockwave");
    expect(WEAPONS.axe.skill).toBe("cleave");
    expect(WEAPONS.hammer.skill).toBe("orbitingHammers");
    expect(SKILLS.orbitingHammers.resource).toBe("mana");
  });
});
describe("equipped skill levels", () => {
  test(
      "temporarily adds one level and requires matching gear until universally unlocked",
      () => {
        const state = progress();
        state.level = 100;
        expect(effectiveSkillLevel(state, "bash")).toBe(1);
        state.learnedSkills.push("bash");
        state.learnedSkillLevels.bash = 3;
        expect(effectiveSkillLevel(state, "bash")).toBe(4);
        state.mainHand = {...state.mainHand, skills : []};
        expect(effectiveSkillLevel(state, "bash")).toBe(0);
        state.universalSkills.push("bash");
        expect(effectiveSkillLevel(state, "bash")).toBe(3);
        const relic = generateRelic(1, "rare", 0);
        state.offHand = relic;
        expect(relic.skills).toContain("gravityPull");
        expect(effectiveSkillLevel(state, "gravityPull")).toBe(1);
      });
});
test("caps active skill level at the hero level while retaining its actual level", () => {
  const state = progress();
  state.level = 4;
  state.mainHand = { ...state.mainHand, skills: [] };
  state.learnedSkills.push("bash");
  state.learnedSkillLevels.bash = 15;
  state.universalSkills.push("bash");
  expect(actualSkillLevel(state, "bash")).toBe(15);
  expect(effectiveSkillLevel(state, "bash")).toBe(4);
});
describe("amulets and charms", () => {
  test("rolls rarity-bounded accessories and equips amulets and charms independently", () => {
    const bounds = {
      common : [ 1, 2 ],
      uncommon : [ 1, 3 ],
      rare : [ 2, 4 ],
      epic : [ 4, 6 ]
    } as const;
    for (const rarity of ["common", "uncommon", "rare", "epic"] as const)
      for (let seed = 0; seed < 20; seed += 1) {
        const item = generateAccessory(20, rarity, seed);
        const bonus = item.accessoryBonuses ?? {};
        const count = Object.keys(item.statBonuses).length +
                      Number(bonus.manaSkillLevels !== undefined) +
                      Number(bonus.staminaSkillLevels !== undefined) +
                      Number(bonus.allSkillLevels !== undefined) +
                      Number(bonus.globalCooldownReduction !== undefined) +
                      Number(bonus.manaCostReduction !== undefined) +
                      Number(bonus.lifeCostReduction !== undefined) +
                      Number(item.attractionSpeed > 0) +
                      Number(item.skills.includes("timeHarvest")) +
                      Object.keys(bonus.physicalDamage ?? {}).length;
        expect(count).toBeGreaterThanOrEqual(bounds[rarity][0]);
        expect(count).toBeLessThanOrEqual(bounds[rarity][1]);
      }
    const state = progress();
    const charm = generateAccessory(10, "rare", 3, "charm");
    const amulet = generateAccessory(10, "rare", 4, "amulet");
    collectIntoInventory(state, charm, () => `tile-${++id}`, () => ++id);
    collectIntoInventory(state, amulet, () => `tile-${++id}`, () => ++id);
    expect(equipFromInventory(state, state.inventoryTiles[0].id).changed).toBeTrue();
    expect(equipFromInventory(state, state.inventoryTiles[1].id).changed).toBeTrue();
    expect(state.offHand).toBeUndefined();
    expect(state.charm?.itemKind).toBe("charm");
    expect(state.amulet?.itemKind).toBe("amulet");
    const staff = generateItem(10, "rare", 99, { allowedClasses: ["staff"] });
    collectIntoInventory(state, staff, () => `tile-${++id}`, () => ++id);
    expect(equipFromInventory(state, state.inventoryTiles[2].id).changed).toBeTrue();
    expect(state.mainHand?.hands).toBe(2);
    expect(state.offHand).toBeUndefined();
    expect(state.amulet?.itemKind).toBe("amulet");
    expect(state.charm?.itemKind).toBe("charm");
  });
  test(
      "adds temporary resource skill levels and caps global cooldown reduction",
      () => {
        const state = progress();
        state.level = 100;
        state.offHand = {
          ...generateAccessory(50, "epic", 8, "amulet"),
          requirements : {},
          accessoryBonuses : {
            manaSkillLevels : 5,
            staminaSkillLevels : 10,
            allSkillLevels : 3,
            globalCooldownReduction : .8
          }
        };
        expect(effectiveSkillLevel(state, "healing")).toBe(9);
        expect(effectiveSkillLevel(state, "bash")).toBe(14);
        expect(itemCooldownReduction(state.offHand)).toBe(.8);
      });
  test("rolls the extractable Time Harvest passive and scales its cooldown removal", () => {
    const amulet = generateAccessory(50, "epic", 1, "amulet");
    expect(amulet.skills).toContain("timeHarvest");
    expect(extractableSkills(amulet)).toContain("timeHarvest");
    expect(timeHarvestCooldownReduction(1)).toBe(1);
    expect(timeHarvestCooldownReduction(99)).toBe(10);
    expect(timeHarvestItemSkillBonus(0)).toBe(0);
    expect(timeHarvestItemSkillBonus(50)).toBe(99);
    const state = progress();
    state.level = 100;
    state.amulet = { ...amulet, requirements: {} };
    expect(effectiveSkillLevel(state, "timeHarvest")).toBe(99);
  });
});
test(
    "drops newest unequipped overflow stacks after a death-level capacity reduction",
    () => {
      const state = progress();
      state.level = 100;
      for (let seed = 1; seed <= 11; seed += 1)
        collectIntoInventory(
            state,
            generateItem(seed, "common", seed, {allowedClasses : [ "sword" ]}),
            () => `overflow-${seed}`, () => seed);
      const protectedTile = state.inventoryTiles[10];
      expect(equipFromInventory(state, protectedTile.id).changed).toBeTrue();
      state.level = 0;
      const dropped = dropInventoryOverflow(state);
      expect(occupiedInventorySlots(state)).toBe(inventoryCapacity(0));
      expect(
          state.inventoryTiles.some((tile) => tile.key === protectedTile.key))
          .toBeTrue();
      expect(dropped).toHaveLength(4);
    });
describe("Epic skill extraction", () => {
  test(
      "binds already learned skills globally from Epic equipment, then permits lower-rarity upgrades",
      () => {
        const rareState = progress();
        const rare =
            generateItem(1, "rare", 17, {allowedClasses : [ "staff" ]});
        rareState.inventoryTiles.push(
            {id : "rare", key : itemStackKey(rare), item : rare, quantity : 1});
        rareState.gold = 10_000;
        for (const skill of rare.skills) { if (!rareState.learnedSkills.includes(skill)) rareState.learnedSkills.push(skill); rareState.learnedSkillLevels[skill] = 1; }
        expect(extractFromInventory(rareState, "rare").changed).toBeTrue();
        expect(rareState.universalSkills).not.toContain("arcaneBolt");
        const epicState = progress();
        const epic =
            generateItem(1, "epic", 27, {allowedClasses : [ "staff" ]});
        epicState.inventoryTiles.push(
            {id : "epic", key : itemStackKey(epic), item : epic, quantity : 1});
        epicState.gold = 10_000;
        for (const skill of epic.skills) { if (!epicState.learnedSkills.includes(skill)) epicState.learnedSkills.push(skill); epicState.learnedSkillLevels[skill] = 1; }
        expect(extractFromInventory(epicState, "epic").changed).toBeTrue();
        expect(epicState.universalSkills)
            .toEqual(expect.arrayContaining([ "arcaneBolt", "frostOrb" ]));
        const upgrade =
            generateItem(1, "rare", 17, {allowedClasses : [ "staff" ]});
        epicState.inventoryTiles.push({
          id : "upgrade",
          key : itemStackKey(upgrade),
          item : upgrade,
          quantity : 1
        });
        const level = epicState.learnedSkillLevels.arcaneBolt!;
        expect(extractFromInventory(epicState, "upgrade").changed).toBeTrue();
        expect(epicState.learnedSkillLevels.arcaneBolt).toBe(level + 1);
      });
});
test("adds Healing to high-rarity maces and permits permanent Healing upgrades",
     () => {
       const rareMace =
           generateItem(5, "rare", 31, {allowedClasses : [ "mace" ]});
       expect(rareMace.skills)
           .toEqual(expect.arrayContaining([ "shockwave", "healing" ]));
       const state = progress();
       state.inventoryTiles.push({
         id : "healing-mace",
         key : itemStackKey(rareMace),
         item : rareMace,
         quantity : 1
       });
       state.gold = 100_000;
       state.learnedSkills.push("shockwave"); state.learnedSkillLevels.shockwave = 1;
       expect(extractableSkills(rareMace)).toContain("healing");
       expect(extractFromInventory(state, "healing-mace").changed).toBeTrue();
       expect(state.learnedSkillLevels.healing).toBe(2);
       expect(state.universalSkills).toContain("healing");
     });
test("does not charge or consume equipment with only reactive Blocking", () => {
  const state = progress();
  const buckler = generateBuckler(1, "common", 12);
  state.inventoryTiles.push({
    id : "buckler",
    key : itemStackKey(buckler),
    item : buckler,
    quantity : 1
  });
  const gold = state.gold;
  expect(extractableSkills(buckler)).toEqual([]);
  expect(extractFromInventory(state, "buckler")).toMatchObject({
    changed : false,
    reason : "That item has no extractable skill."
  });
  expect(state.gold).toBe(gold);
  expect(state.inventoryTiles[0].quantity).toBe(1);
});
describe("spell resources", () => {
  test("registers Rent as life and buckler blocking as stamina", () => {
    expect(SKILLS.rent.resource).toBe("life");
    expect(SKILLS.blocking.resource).toBe("stamina");
    expect(generateBuckler(0, "common", 12).skills).toEqual([ "blocking" ]);
  });
});
test("blood skills spend remaining HP, scale damage with the amount spent, and preserve one HP", () => {
  for (const skill of Object.values(SKILLS).filter(({resource}) =>
                                                       resource === "life")) {
    expect(skillHealthRequirementMet(skill.id, 1, 100)).toBeFalse();
    expect(skillHealthRequirementMet(skill.id, 1.001, 100)).toBeTrue();
  }
  expect(bloodSkillLifeCost("rent", 100)).toBe(10);
  expect(bloodSkillLifeCost("rent", 50)).toBe(5);
  expect(bloodSkillLifeCost("vampiricBoomerang", 50)).toBe(15);
  expect(bloodSkillLifeCost("vampiricBoomerang", 1.1)).toBeCloseTo(0.1);
  expect(bloodSkillLifeCost("rent", 100, 0.5)).toBe(5);
  expect(bloodSkillDamage("rent", 1, 10, 10)).toBeGreaterThan(
      bloodSkillDamage("rent", 1, 10, 5));
  expect(skillHealthRequirementMet("bash", 1, 100)).toBeTrue();
});
test("grants Gold gain and rarity boost on bucklers by rarity", () => {
  const common = generateBuckler(1, "common", 12);
  const epic = generateBuckler(1, "epic", 12);
  expect(common.modifiers.goldGain).toBeCloseTo(0.05);
  expect(common.modifiers.rarityBoost).toBeCloseTo(0.02);
  expect(epic.modifiers.goldGain).toBeGreaterThan(common.modifiers.goldGain);
  expect(epic.modifiers.rarityBoost)
      .toBeGreaterThan(common.modifiers.rarityBoost);
});
describe("Force Field", () => {
  test("always applies outward velocity and interrupts attacks", () => {
    let interrupted = 0;
    const pushed = {
      position : {x : 100, y : 0},
      velocity : {x : -400, y : 0},
      interruptAttack : () => interrupted += 1
    };
    forceField(pushed, {x : 0, y : 0}, 40);
    expect(pushed.position).toEqual({x : 100, y : 0});
    expect(pushed.velocity).toEqual({x : 40, y : 0});
    expect(interrupted).toBe(1);
    expect(SKILLS.gravityPull.label).toBe("Force Field");
    expect(forceFieldDamage(1)).toBeCloseTo(0.2);
    expect(forceFieldDamage(100)).toBeCloseTo(3.17);
  });
});
describe("hero status HUD summaries", () => {
  test("aggregates duplicate effects into stacks with their live duration and combined DPS", () => {
    expect(statusEffectSummaries([
      { kind: "poison", remaining: 1.2, damagePerSecond: .4 },
      { kind: "poison", remaining: 3, damagePerSecond: .6 },
      { kind: "stun", remaining: .35, damagePerSecond: 0 },
    ])).toEqual([
      { kind: "poison", icon: "☠", stacks: 2, remaining: 3, damagePerSecond: 1, tooltip: "Poison — 3s remaining · 2 stacks · 1 damage/s" },
      { kind: "stun", icon: "✦", stacks: 1, remaining: .35, damagePerSecond: 0, tooltip: "Stun — 0.35s remaining" },
    ]);
  });
});
describe("spell tooltip damage previews", () => {
  test("covers runtime formulas that are not spell-power multipliers", () => {
    expect(skillDamagePreview("whirlwind", 10, { ...ZERO_STATS, strength: 10 })).toEqual({ kind: "flat", value: 5, detail: "per pulse" });
    expect(skillDamagePreview("thorns", 1, ZERO_STATS)).toEqual({ kind: "percentage", value: .05, detail: "incoming" });
    expect(skillDamagePreview("deathBurst", 1, ZERO_STATS)).toEqual({ kind: "percentage", value: .2, detail: "target HP" });
    expect(skillDamagePreview("sunburnAura", 1, { ...ZERO_STATS, intelligence: 100 })?.value).toBeCloseTo(.1);
    expect(skillDamagePreview("thunderAura", 1, { ...ZERO_STATS, intelligence: 10 })).toEqual({ kind: "flat", value: 9, detail: "lightning" });
    expect(skillDamagePreview("healing", 1, ZERO_STATS)).toBeUndefined();
  });
});
describe("extractable offhand and staff skills", () => {
  test(
      "adds extractable Attraction and Force Field to attracting relics plus high-rarity offhand skills",
      () => {
        const relic = Array
                          .from({length : 50},
                                (_, seed) => generateRelic(1, "rare", seed))
                          .find((item) => item.attractionSpeed > 0)!;
        const buckler =
            Array
                .from({length : 100},
                      (_, seed) => generateBuckler(1, "rare", seed))
                .find((item) => item.reflectionComponents.length > 0)!;
        const staff =
            generateItem(1, "rare", 17, {allowedClasses : [ "staff" ]});
        expect(relic.skills)
            .toEqual(expect.arrayContaining([ "attraction", "gravityPull" ]));
        expect(extractableSkills(relic))
            .toEqual(expect.arrayContaining([ "attraction", "gravityPull" ]));
        expect(buckler.skills).toEqual(expect.arrayContaining([
          "blocking", "thorns", "reflectiveSurge"
        ]));
        expect(staff.skills)
            .toEqual(expect.arrayContaining([ "arcaneBolt", "frostOrb" ]));
        const epic = Array
                         .from({length : 50},
                               (_, seed) => generateRelic(1, "epic", seed))
                         .find((item) => item.attractionSpeed > 0)!;
        const state = progress();
        state.gold = 100_000;
        state.inventoryTiles.push(
            {id : "idol", key : itemStackKey(epic), item : epic, quantity : 1});
        for (const skill of epic.skills) { if (!state.learnedSkills.includes(skill)) state.learnedSkills.push(skill); state.learnedSkillLevels[skill] = 1; }
        expect(extractFromInventory(state, "idol").changed).toBeTrue();
        expect(state.universalSkills)
            .toEqual(expect.arrayContaining([ "attraction", "gravityPull" ]));
        expect(SKILLS.attraction.passive).toBeTrue();
        expect(SKILLS.gravityPull.cooldown).toBe(18);
        expect(SKILLS.frostOrb.cooldown).toBe(20);
      });
});
describe("aura equipment", () => {
  test(
      "generates one deterministic extractable aura per scepter or Holy Buckler",
      () => {
        const scepters =
            Array.from({length : 5},
                       (_, seed) => generateItem(
                           8, "rare", seed, {allowedClasses : [ "scepter" ]}));
        expect(scepters.every((item) => item.itemKind === "relic" &&
                                        item.hands === 0 && item.weight === 0 &&
                                        item.staminaCost === 0 &&
                                        item.modifiers.damageMultiplier === 1 &&
                                        item.statBonuses.spirit! > 0 &&
                                        item.statBonuses.intelligence! > 0 &&
                                        item.skills.length === 1 &&
                                        AURA_SKILLS.includes(item.skills[0])))
            .toBeTrue();
        expect(new Set(scepters.flatMap((item) => item.skills)))
            .toEqual(new Set(AURA_SKILLS));
        const holy =
            Array
                .from({length : 50},
                      (_, index) => generateBuckler(8, "rare", index * 5))
                .filter((item) => item.name === "Holy Buckler");
        expect(holy.length).toBeGreaterThan(0);
        expect(holy.every((item) => item.skills.length === 2 &&
                                    item.skills[0] === "blocking" &&
                                    AURA_SKILLS.includes(item.skills[1])))
            .toBeTrue();
        const equipState = progress();
        equipState.inventoryTiles.push({id : "equipped-scepter",
                                        key : itemStackKey(scepters[0]),
                                        item : scepters[0], quantity : 1});
        expect(equipFromInventory(equipState, "equipped-scepter").changed)
            .toBeTrue();
        expect(equipState.mainHand?.definitionId).toBe("club");
        expect(equipState.offHand?.definitionId).toBe("scepter");
        expect(levelUpItem(scepters[0], 99).definitionId).toBe("scepter");
        const state = progress();
        const auraItem = scepters[0];
        state.gold = 100_000;
        state.inventoryTiles.push({
          id : "aura",
          key : itemStackKey(auraItem),
          item : auraItem,
          quantity : 2
        });
        state.learnedSkills.push(auraItem.skills[0]); state.learnedSkillLevels[auraItem.skills[0]] = 1;
        expect(extractFromInventory(state, "aura").changed).toBeTrue();
        expect(extractFromInventory(state, "aura").changed).toBeTrue();
        expect(state.learnedSkillLevels[auraItem.skills[0]]).toBe(3);
        expect(state.gold).toBe(99_970);
      });
  test(
      "scales aura radius with level and Spirit plus other aura effects with level",
      () => {
        expect(auraRadius(1)).toBe(180);
        expect(auraRadius(99)).toBe(300);
        expect(auraRadius(1, 20)).toBe(190);
        expect(auraRadius(100, 20)).toBe(600);
        expect(auraSlowMultiplier(1)).toBeCloseTo(.8);
        expect(auraSlowMultiplier(99)).toBeCloseTo(.5);
        expect(sunburnInterval(100)).toBe(.5);
        expect(sunburnFraction(100)).toBeCloseTo(.1);
        expect(thunderInterval(1)).toBe(10);
        expect(thunderInterval(99)).toBe(1);
        expect(thunderDamage(10)).toBe(9);
        expect(thunderCritChance(.2)).toBeCloseTo(.3);
      });
});
describe("throwing axes", () => {
  test(
      "generates a one-handed short-ranged projectile weapon with inherent bleed",
      () => {
        const axe =
            generateItem(0, "common", 17, {allowedClasses : [ "throwingAxe" ]});
        expect(axe.hands).toBe(1);
        expect(axe.skills).toEqual([ "rendingThrow" ]);
        expect(axe.modifiers.bleedChance).toBeGreaterThanOrEqual(0.15);
        expect(weaponRange(axe)).toBe(210);
        expect(weaponUsesProjectile(axe)).toBeTrue();
      });
});
test("adds extractable Whirlwind to high-rarity axes and scales its field",
     () => {
       const axe = generateItem(8, "rare", 17, {allowedClasses : [ "axe" ]});
       expect(axe.skills)
           .toEqual(expect.arrayContaining([ "cleave", "whirlwind" ]));
       expect(extractableSkills(axe)).toContain("whirlwind");
       expect(whirlwindRadius(1)).toBeCloseTo(91.2);
       expect(whirlwindRadius(99)).toBe(208.8);
       expect(whirlwindDuration(1)).toBe(3);
       expect(whirlwindDuration(99)).toBe(30);
       expect(orbitingHammerDuration(1)).toBe(2.4);
       expect(orbitingHammerDuration(99)).toBe(30);
       expect(whirlwindMovementSpeed(1)).toBe(.5);
       expect(whirlwindMovementSpeed(99)).toBe(1.5);
       expect(whirlwindDamage(20)).toBe(9);
     });
describe("item sustain", () => {
  test("scales rolled sustain passives through upgrades", () => {
    const vampiric = generateItem(2, "rare", 8);
    expect(vampiric.modifiers.lifeStealBase).toBeCloseTo(0.021);
    const upgraded = levelUpItem(vampiric, 2);
    expect(upgraded.modifiers.lifeStealBase)
        .toBeGreaterThan(vampiric.modifiers.lifeStealBase);
    expect(upgraded.modifiers.strengthRegenMultiplier).toBe(0);
  });
});
describe("equipment upgrade trait preservation", () => {
  test("keeps rolled traits and increases exactly one direct attribute", () => {
    const base = generateItem(1, "rare", 17, {allowedClasses : [ "hammer" ]});
    const upgraded = levelUpItem(base, 999);
    expect(upgraded.perks).toEqual(base.perks);
    expect(STAT_KEYS.reduce((sum, key) => sum + (upgraded.statBonuses[key] ?? 0) - (base.statBonuses[key] ?? 0), 0)).toBe(1);
    expect(STAT_KEYS.filter((key) => upgraded.statBonuses[key] !== base.statBonuses[key])).toHaveLength(1);
    expect(upgraded.skills).toEqual(base.skills);
    expect(Object.keys(upgraded.requirements).sort())
        .toEqual(Object.keys(base.requirements).sort());
    for (const [key, value] of Object.entries(base.requirements))
      expect(upgraded.requirements[key as keyof Stats]).toBeGreaterThanOrEqual(value!);
  });
  test("does not reroll accessory bonuses during an upgrade", () => {
    const base = generateAccessory(4, "rare", 27, "amulet");
    const upgraded = levelUpItem(base, 333);
    expect(upgraded.accessoryBonuses).toEqual(base.accessoryBonuses);
    expect(STAT_KEYS.reduce((sum, key) => sum + (upgraded.statBonuses[key] ?? 0) - (base.statBonuses[key] ?? 0), 0)).toBe(1);
    expect(upgraded.attractionSpeed).toBe(base.attractionSpeed);
  });
});
test("every generated equipment type has a positive direct attribute", () => {
  const items = [
    generateItem(0, "common", 1),
    generateBuckler(0, "common", 2),
    generateRelic(0, "common", 3),
    generateAccessory(0, "common", 4, "amulet"),
    generateAccessory(0, "common", 5, "charm")
  ];
  for (const item of items)
    expect(STAT_KEYS.some((key) => (item.statBonuses[key] ?? 0) > 0)).toBeTrue();
});
test("upgrading a legacy item without attributes adds one attribute point", () => {
  const base = { ...generateItem(1, "common", 41), statBonuses: {} };
  const upgraded = levelUpItem(base, 42);
  expect(STAT_KEYS.reduce((sum, key) => sum + (upgraded.statBonuses[key] ?? 0), 0)).toBe(1);
});
describe("equipment rarity promotion", () => {
  test(
      "caps generated levels and promotes capped equipment to level one",
      () => {
        expect(generateItem(99, "common", 3).level).toBe(MAX_ITEM_LEVEL.common);
        expect(generateBuckler(99, "uncommon", 3).level)
            .toBe(MAX_ITEM_LEVEL.uncommon);
        expect(generateRelic(99, "rare", 3).level).toBe(MAX_ITEM_LEVEL.rare);
        const common =
            generateItem(10, "common", 17, {allowedClasses : [ "staff" ]});
        const promoted = levelUpItem(common, 18);
        expect(promoted.rarity).toBe("uncommon");
        expect(promoted.level).toBe(1);
        expect(promoted.definitionId).toBe(common.definitionId);
        expect(promoted.affixes).toEqual(common.affixes);
        expect(promoted.skills).toEqual(common.skills);
      });
  test(
      "rejects upgrading final-level Epic equipment without spending resources",
      () => {
        const state = progress();
        const epic = generateItem(50, "epic", 19);
        state.inventoryTiles.push({
          id : "max-epic",
          key : itemStackKey(epic),
          item : epic,
          quantity : 1
        });
        state.gold = 1_000_000;
        state.scraps.epic = 1_000;
        const result =
            upgradeFromInventory(state, "max-epic", () => "unused", () => 20);
        expect(result.changed).toBeFalse();
        expect(state.gold).toBe(1_000_000);
        expect(state.scraps.epic).toBe(1_000);
        expect(state.inventoryTiles[0].quantity).toBe(1);
      });
});
describe("XP presentation", () => {
  test("retargets easing from the current displayed value", () => {
    const towardTwenty = lerpXpDisplay(0, 20);
    expect(towardTwenty).toBe(2);
    expect(lerpXpDisplay(towardTwenty, 50)).toBeCloseTo(6.8);
  });
});
describe("HUD preview values", () => {
  test("formats projected and removed values from currentVal and nullable newVal",
       () => {
         expect(formatPreviewValue({currentVal : 10, newVal : 14}))
             .toBe("14");
         expect(formatPreviewValue({currentVal : 10, newVal : 10})).toBe("10");
         expect(formatPreviewValue({currentVal : 1, newVal : 2}))
             .toBe("2");
         expect(formatPreviewValue({currentVal : 15, newVal : 16}))
             .toBe("16");
         expect(formatPreviewValue({currentVal : "5/17", newVal : "5/19"}))
             .toBe("5/19");
         expect(formatPreviewValue({currentVal : 10, newVal : null}))
             .toBe("—");
         expect(formatProjectedValue({currentVal : 10, newVal : 14})).toBe("14");
         expect(previewTone({currentVal : 10, newVal : 14})).toBe("gain");
         expect(previewTone({currentVal : 10, newVal : 8})).toBe("cost");
       });
});
describe("spell range and recovery", () => {
  test(
      "scales skill range and cooldown slightly with weapon level while natural healing stays weak",
      () => {
        expect(skillRange("bash", starterClub(), 4, 20)).toBe(145);
        expect(skillRange("bash", starterClub(), 100, 100)).toBe(405);
        const leveled =
            generateItem(10, "rare", 17, {allowedClasses : [ "staff" ]});
        expect(skillRange("arcaneBolt", leveled, 1, 0)).toBeCloseTo(346.5);
        expect(skillCooldown("arcaneBolt", leveled)).toBeCloseTo(5 / 1.05);
        expect(derivedStats({...ZERO_STATS, spirit : 20}).hpRegen)
            .toBeCloseTo(0.105);
      });
});
describe("Healing scaling", () => {
  test("scales from level 1 to 99, adds flat plus stamina-scaled healing, and charges twice the restored HP", () => {
    expect(healingFraction(1)).toBeCloseTo(0.2);
    expect(healingFraction(99)).toBeCloseTo(0.9);
    expect(healingFraction(100)).toBeCloseTo(0.9);
    expect(healingCooldown(1)).toBeCloseTo(15);
    expect(healingCooldown(99)).toBeCloseTo(1);
    expect(healingCast(40, 100, 0, 10, 1)).toEqual({restoredHp : 13, manaCost : 26});
    expect(healingCast(40, 100, 10, 10, 1)).toEqual({restoredHp : 18, manaCost : 36});
    expect(healingCast(49, 50, 1, 1, 99)).toEqual({restoredHp : 1, manaCost : 2});
  });
});
test("divides spell cooldown by Intelligence plus Agility with a safe floor",
     () => {
       expect(skillCooldown("fireBreath", starterClub(),
                            {...ZERO_STATS, intelligence : 2, agility : 3}))
           .toBeCloseTo(9 / 5);
       expect(skillCooldown("fireBreath", starterClub(), ZERO_STATS)).toBe(9);
     });
test("registers configurable Spirit relic perks", () => {
  expect(SKILLS.fireBreath).toMatchObject({enemyEligible : true, cost : 4});
  expect(SKILLS.voodoo.passive).toBeTrue();
  expect(SKILLS.manaDrain.passive).toBeTrue();
  expect(SKILLS.penance.passive).toBeTrue();
  expect(SKILLS.rapidRegen).toMatchObject({ cost: 4, cooldown: 20 });
  expect(rapidRegenDuration(1)).toBe(10);
  expect(rapidRegenDuration(99)).toBe(30);
  expect(rapidRegenMultiplier(1)).toBeCloseTo(1.2);
  expect(rapidRegenMultiplier(99)).toBe(5);
  expect(manaConversionFraction(1)).toBeCloseTo(.01);
  expect(manaConversionFraction(99)).toBeCloseTo(.6);
  const perks = Array.from({length : 100},
                           (_, seed) => generateRelic(3, "rare", seed).skills);
  expect(perks.some((skills) => skills.includes("fireBreath"))).toBeTrue();
  expect(perks.some((skills) => skills.includes("voodoo"))).toBeTrue();
  expect(perks.some((skills) => skills.includes("swamp"))).toBeTrue();
  expect(perks.filter((skills) => skills.includes("voodoo")).every((skills) => skills.includes("swamp"))).toBeTrue();
  expect(perks.some((skills) => skills.includes("manaDrain"))).toBeTrue();
  expect(perks.some((skills) => skills.includes("penance"))).toBeTrue();
  expect(perks.some((skills) => skills.includes("rapidRegen"))).toBeTrue();
});
test("scales Gooey Swamp exactly from its level-one to level-ninety-nine endpoints", () => {
  expect(swampRadius(1)).toBe(200);
  expect(swampRadius(99)).toBe(500);
  expect(swampCooldown(1)).toBe(100);
  expect(swampCooldown(99)).toBe(15);
  expect(skillRange("swamp", starterClub(), 99, 999)).toBe(500);
  expect(skillCooldown("swamp", starterClub(), {...ZERO_STATS, intelligence: 99, agility: 99}, 99)).toBe(15);
});
test("connects WebSockets to the page origin unless server overrides it",
     () => {
       expect(gameSocketUrl(
                  {host : "localhost:3000", protocol : "http:", search : ""} as
                  Location))
           .toBe("ws://localhost:3000/ws");
       expect(gameSocketUrl(
                  {host : "game.test", protocol : "https:", search : ""} as
                  Location))
           .toBe("wss://game.test/ws");
       expect(gameSocketUrl({
         host : "localhost:3000",
         protocol : "http:",
         search : "?server=pvp.railway%3A443"
       } as Location))
           .toBe("wss://pvp.railway/ws");
       expect(gameSocketUrl({
         host : "localhost:3000",
         protocol : "http:",
         search : "?ip=pvp.up.railway.app"
       } as Location))
           .toBe("wss://pvp.up.railway.app/ws");
       expect(gameSocketUrl({
         host : "localhost:3000",
         protocol : "http:",
         search : "?server=preferred.test&ip=legacy.test"
       } as Location))
           .toBe("wss://preferred.test/ws");
       expect(gameSocketUrl({
         host : "localhost:3000",
         protocol : "http:",
         search : "?server=ws%3A%2F%2F192.168.0.13%3A3000"
       } as Location))
           .toBe("ws://192.168.0.13:3000/ws");
       expect(gameSocketUrl({
         host : "localhost:3000",
         protocol : "http:",
         search : "?server=https%3A%2F%2Fpvp.railway%2Fgame"
       } as Location))
           .toBe("wss://pvp.railway/game/ws");
       expect(gameSocketUrl({
         host : "localhost:3000",
         protocol : "http:",
         search : "?server=ftp%3A%2F%2Fbad.test"
       } as Location))
           .toBe("ws://localhost:3000/ws");
     });
test(
    "uses the production WebSocket shortcut unless an explicit endpoint is provided",
    () => {
      expect(
          gameSocketUrl(
              {host : "localhost:3000", protocol : "http:", search : "?prod"} as
              Location))
          .toBe("wss://pvp.up.railway.app/ws");
      expect(gameSocketUrl({
        host : "localhost:3000",
        protocol : "http:",
        search : "?prod&server=override.test"
      } as Location))
          .toBe("wss://override.test/ws");
      expect(gameSocketUrl({
        host : "localhost:3000",
        protocol : "http:",
        search : "?prod&ip=legacy.test"
      } as Location))
          .toBe("wss://legacy.test/ws");
    });
