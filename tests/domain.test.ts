import { describe, expect, test } from "bun:test";
import {
	adjustedCameraTilt,
	adjustedCameraTiltFromDrag,
	cameraFacingAngle,
	cameraRelativeMovement,
	cameraOffsetForTilt,
	DEFAULT_CAMERA_ZOOM,
	MAX_CAMERA_TILT_RADIANS,
	MIN_CAMERA_TILT_RADIANS,
} from "../src/game/render/ThreeRenderer";
import { HERO_TURN_SPEED, turnAngleTowards } from "../src/game/Hero";
import { viewportTooltipPosition } from "../src/ui/tooltipPosition";
import { panelShortcut, panelToggleTooltip } from "../src/ui/Hud";

import {
	auraRadius,
	auraSlowMultiplier,
	sunburnFraction,
	sunburnInterval,
	thunderCritChance,
	thunderDamage,
	thunderInterval,
} from "../common/auras";
import { BALANCE } from "../common/balance";
import {
	LOGICAL_PIXELS_PER_METER,
	metersToPixels,
	pixelsToMeters,
} from "../common/units";
import {
	attackProfile,
	bashCooldown,
	bucklerBlockChance,
	bucklerBlockCost,
	cleaveHalfArc,
	cleaveCooldown,
	cleaveRange,
	cooldownScale,
	effectiveSkillCooldown,
	forceFieldRange,
	flurryCooldown,
	HEALING_MAX_RADIUS,
	HEALING_MIN_RADIUS,
	healingBaseManaCost,
	healingCast,
	healingCooldown,
	healingFraction,
	healingRadius,
	manaConversionFraction,
	orbitingHammerDuration,
	rapidRegenDuration,
	rapidRegenMultiplier,
	rendingThrowPierce,
	rendingThrowTargetLimit,
	reflectiveSurgeBlockChanceBonus,
	reflectiveSurgeCooldown,
	reflectiveSurgeDuration,
	RENDING_THROW_BLEED_DURATION,
	skillCastTime,
	skillCooldown,
	skillDamagePreview,
	skillImpactForceScale,
	skillRange,
	skillStatBonusDescription,
	skillUpkeepPerSecond,
	spellCooldownFloor,
	timeHarvestCooldownReduction,
	timeHarvestItemSkillBonus,
	swampCooldown,
	swampRadius,
	weaponAttackSpeed,
	weaponDamage,
	weaponRange,
	weaponUsesProjectile,
	weaponSkillTriggerChance,
	whirlwindDamage,
	whirlwindDuration,
	whirlwindMovementSpeed,
	whirlwindRadius,
} from "../common/combat";
import { SKILLS, WEAPONS } from "../common/content";
import { SPELL_SOURCES } from "../common/spellSources";
import {
	inventorySlotMatches,
	orderInventoryTiles,
} from "../src/ui/InventoryView";
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
	upgradeFromInventory,
} from "../common/inventory";
import {
	AURA_SKILLS,
	equippedImmunities,
	equippedPerks,
	generateAccessory,
	generateBuckler,
	generateItem,
	generateRelic,
	itemCooldownReduction,
	migrateLegacyItem,
	itemRequirementMultiplier,
	itemStackKey,
	levelUpItem,
	MAX_ITEM_LEVEL,
	starterClub,
} from "../common/items";
import {
	cumulativeXpForLevel,
	DEFAULT_ALLOCATION,
	derivedStats,
	heroTurnSpeedDegrees,
	lerpXpDisplay,
	levelForXp,
	STAT_KEYS,
	xpForNextLevel,
	ZERO_STATS,
} from "../common/progression";
import { parseClientMessage, type PlayerProgress } from "../common/protocol";
import {
	championCount,
	creepMaxHealth,
	creepsWithSpellsCount,
	realmCloneLevel,
	regularCount,
	regularLevel,
	rivalLevel,
	rivalXpReward,
} from "../common/waves";
import {
	bloodSkillDamage,
	bloodSkillLifeCost,
	activeSkillIds,
	actualSkillLevel,
	effectiveSkillLevel,
	forceField,
	forceFieldFalloff,
	forceFieldDamage,
	isSkillActive,
	isSkillAvailable,
	shouldAutoCastHealing,
	weaponProcSkills,
	skillHealthRequirementMet,
} from "../src/game/systems/HeroCombatSystem";
import { gameSocketUrl } from "../src/net/SocketClient";
import {
	itemRequirementRows,
	itemSkillDescription,
	requirementDisplayStats,
	requirementMetStats,
} from "../src/ui/ItemDetails";
import {
	formatPreviewValue,
	formatProjectedValue,
	previewTone,
} from "../src/ui/preview";
import { extractButtonStatus } from "../src/ui/inventoryAvailability";
import {
	effectiveStatRows,
	extractedLearnedLevel,
	passiveSkillMetrics,
	spellCatalogFilterMatches,
	spellCatalogResourceOrder,
	spellInitials,
	spellTooltipLevels,
	statusEffectSummaries,
	xpSendBuffSummary,
} from "../src/ui/Hud";

function progress(): PlayerProgress {
	return {
		level: 0,
		xp: 0,
		stats: { ...ZERO_STATS },
		allocation: { ...DEFAULT_ALLOCATION },
		gold: 1000,
		souls: 0,
		scraps: emptyScraps(),
		mainHand: starterClub(),
		inventoryTiles: [],
		learnedSkills: ["healing"],
		learnedSkillLevels: { healing: 1 },
		universalSkills: ["healing", ...AURA_SKILLS],
		equippedSkills: ["healing"],
		autoFireSkills: ["healing"],
	};
}
let id = 0;

describe("third-person camera", () => {
	test("uses camera forward as the right-button aiming direction", () => {
		expect(cameraFacingAngle(0)).toBeCloseTo(Math.PI / 2);
		expect(cameraFacingAngle(Math.PI / 2)).toBeCloseTo(0);
		expect(cameraFacingAngle(-Math.PI / 2)).toBeCloseTo(Math.PI);
	});
	test("starts at a close RPG chase distance", () => {
		expect(DEFAULT_CAMERA_ZOOM).toBe(0.9);
	});
	test("places the chase camera behind and above the hero", () => {
		expect(adjustedCameraTilt(0, 100)).toBe(MIN_CAMERA_TILT_RADIANS);
		expect(adjustedCameraTilt(0, -100)).toBe(MIN_CAMERA_TILT_RADIANS);
		expect(adjustedCameraTilt(0, 100_000)).toBe(MAX_CAMERA_TILT_RADIANS);
		const offset = cameraOffsetForTilt(MAX_CAMERA_TILT_RADIANS);
		expect(offset.y).toBeLessThan(0);
		expect(offset.z).toBeGreaterThan(0);
	});

	test("clamps vertical left-drag orbiting above ground and below overturn", () => {
		expect(adjustedCameraTiltFromDrag(0, 100_000)).toBe(
			MAX_CAMERA_TILT_RADIANS,
		);
		expect(adjustedCameraTiltFromDrag(0, -100_000)).toBe(
			MIN_CAMERA_TILT_RADIANS,
		);
		expect(adjustedCameraTiltFromDrag(Math.PI / 4, 10)).toBeGreaterThan(
			Math.PI / 4,
		);
	});

	test("rotates WASD input with the camera orbit", () => {
		expect(cameraRelativeMovement({ x: 0, y: 1 }, 0)).toEqual({ x: 0, y: 1 });
		const rightFacing = cameraRelativeMovement({ x: 0, y: 1 }, Math.PI / 2);
		expect(rightFacing.x).toBeCloseTo(1);
		expect(rightFacing.y).toBeCloseTo(0);
		const strafe = cameraRelativeMovement({ x: 1, y: 0 }, Math.PI / 2);
		expect(strafe.x).toBeCloseTo(0);
		expect(strafe.y).toBeCloseTo(-1);
	});
});

describe("Healing auto-fire", () => {
	test("waits for fifty percent HP while including the threshold", () => {
		expect(shouldAutoCastHealing(51, 100)).toBeFalse();
		expect(shouldAutoCastHealing(50, 100)).toBeTrue();
		expect(shouldAutoCastHealing(1, 100)).toBeTrue();
	});
});

test("sorts the spell catalog by HP, Rage, then Mana", () => {
	expect(
		(["mana", "life", "rage"] as const).sort(
			(a, b) => spellCatalogResourceOrder(a) - spellCatalogResourceOrder(b),
		),
	).toEqual(["life", "rage", "mana"]);
});

test("uses word initials for multi-word spell badges", () => {
	expect(spellInitials("Rending Throw")).toBe("RT");
	expect(spellInitials("Reflective Surge")).toBe("RS");
	expect(spellInitials("Voodoo")).toBe("VO");
});

test("shows current, next, and maximum spell tooltip levels", () => {
	expect(spellTooltipLevels(7, 12)).toEqual([
		{ heading: "Current level", level: 7 },
		{ heading: "Next level", level: 8 },
		{ heading: "Max learned", level: 12 },
	]);
	expect(spellTooltipLevels(99, 120)).toEqual([
		{ heading: "Current level", level: 99 },
		{ heading: "Next level", level: 99 },
		{ heading: "Max learned", level: 99 },
	]);
	expect(spellTooltipLevels(4, 0)).toEqual([
		{ heading: "Current level", level: 4 },
		{ heading: "Next level", level: 5 },
		{ heading: "Max learned", level: 0 },
	]);
});

test("previews extraction from the permanent learned maximum", () => {
	expect(extractedLearnedLevel(0)).toBe(1);
	expect(extractedLearnedLevel(5)).toBe(6);
	expect(extractedLearnedLevel(99)).toBe(99);
});

test("combines spell type and learning-state catalog filters", () => {
	expect(
		spellCatalogFilterMatches("passive", "learned", "both", "both"),
	).toBeTrue();
	expect(
		spellCatalogFilterMatches("passive", "learned", "passive", "learned"),
	).toBeTrue();
	expect(
		spellCatalogFilterMatches("active", "learned", "passive", "both"),
	).toBeFalse();
	expect(
		spellCatalogFilterMatches("passive", "not-learned", "both", "learned"),
	).toBeFalse();
	expect(
		spellCatalogFilterMatches(
			"active",
			"learned",
			"both",
			"both",
			"frost",
			"frostOrb Frozen Orb launches ice Mana",
		),
	).toBeTrue();
	expect(
		spellCatalogFilterMatches(
			"active",
			"learned",
			"both",
			"both",
			"poison",
			"frostOrb Frozen Orb launches ice Mana",
		),
	).toBeFalse();
});

test("defines a concrete acquisition source for every catalog spell", () => {
	expect(Object.keys(SPELL_SOURCES).sort()).toEqual(Object.keys(SKILLS).sort());
	for (const source of Object.values(SPELL_SOURCES))
		expect(source).not.toBe("");
});

test("keeps inventory chronology while applying the slot filter as an AND clause", () => {
	const state = progress();
	const oldMain = {
		id: "old-main",
		key: "old-main",
		item: starterClub(),
		quantity: 1,
	};
	const charmItem = generateAccessory(1, "common", 3, "charm");
	const newCharm = {
		id: "new-charm",
		key: "new-charm",
		item: charmItem,
		quantity: 1,
	};
	const removed = { ...oldMain, id: "removed", quantity: 0 };
	state.inventoryTiles = [oldMain, removed, newCharm];
	expect(
		orderInventoryTiles(state.inventoryTiles, state).map(({ id }) => id),
	).toEqual(["old-main", "new-charm"]);
	expect(
		orderInventoryTiles(state.inventoryTiles, state, "charms").map(
			({ id }) => id,
		),
	).toEqual(["new-charm"]);
	expect(inventorySlotMatches(newCharm, "mainhand")).toBeFalse();
});

test("gates Orbiting Hammers and Frozen Orb at their authored hero levels", () => {
	const state = progress();
	state.learnedSkills.push("orbitingHammers", "frostOrb");
	state.learnedSkillLevels.orbitingHammers = 3;
	state.learnedSkillLevels.frostOrb = 2;
	state.level = 9;
	expect(isSkillAvailable(state, "orbitingHammers")).toBeFalse();
	state.level = 10;
	expect(isSkillAvailable(state, "orbitingHammers")).toBeTrue();
	expect(isSkillAvailable(state, "frostOrb")).toBeFalse();
	state.level = 20;
	expect(isSkillAvailable(state, "frostOrb")).toBeTrue();
});

describe("hero auto-facing", () => {
	test("scales from the current turn speed to the capped near-instant rate", () => {
		expect(heroTurnSpeedDegrees(0)).toBe(300);
		expect(heroTurnSpeedDegrees(50)).toBe(3150);
		expect(heroTurnSpeedDegrees(100)).toBe(6000);
		expect(heroTurnSpeedDegrees(150)).toBe(6000);
	});

	test("turns toward a target at a bounded speed", () => {
		expect(turnAngleTowards(0, Math.PI, HERO_TURN_SPEED / 60)).toBeCloseTo(
			HERO_TURN_SPEED / 60,
		);
	});

	test("uses the shortest path across the angle seam and settles exactly", () => {
		const current = Math.PI - 0.05;
		const target = -Math.PI + 0.05;
		expect(turnAngleTowards(current, target, 0.02)).toBeCloseTo(current + 0.02);
		expect(turnAngleTowards(current, target, 0.2)).toBe(target);
	});
});

describe("viewport tooltip positioning", () => {
	test("keeps a top skill tooltip inside the viewport", () => {
		expect(
			viewportTooltipPosition(
				{ left: 48, right: 104, bottom: 60 },
				510,
				300,
				1280,
				720,
			),
		).toEqual({ left: 114, top: 8 });
	});

	test("flips left and clamps to the bottom edge when needed", () => {
		expect(
			viewportTooltipPosition(
				{ left: 900, right: 956, bottom: 700 },
				400,
				250,
				1000,
				720,
			),
		).toEqual({ left: 490, top: 450 });
	});
});

describe("balance and waves", () => {
	test("keeps capped waves and player-independent champion scaling", () => {
		const balance = BALANCE;
		expect(regularCount(0, balance)).toBe(10);
		expect(regularCount(1, balance)).toBe(10);
		expect(regularCount(2, balance)).toBe(12);
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
	test("keeps introductory enemy HP fixed, scales later HP by twelve percent, and doubles sent-item carriers", () => {
		for (let level = 0; level < 8; level += 1)
			expect(creepMaxHealth(level, 99, BALANCE)).toBe(10 + level);
		expect(creepMaxHealth(0, 99, BALANCE)).toBe(10);
		expect(creepMaxHealth(8, 18, BALANCE)).toBe(90);
		expect(creepMaxHealth(9, 18, BALANCE)).toBeCloseTo(90 * 1.12);
		expect(creepMaxHealth(20, 30, BALANCE)).toBeCloseTo(150 * 1.12 ** 12);
		expect(creepMaxHealth(50, 60, BALANCE)).toBeCloseTo(300 * 1.12 ** 42);
		expect(creepMaxHealth(9.9, 18, BALANCE)).toBeCloseTo(90 * 1.12);
		expect(creepMaxHealth(28, 54.333, BALANCE)).toBeCloseTo(
			271.665 * 1.12 ** 20,
		);
		expect(creepMaxHealth(45, 55, BALANCE)).toBeCloseTo(275 * 1.12 ** 37);
		expect(creepMaxHealth(45, 55, BALANCE, true)).toBeCloseTo(550 * 1.12 ** 37);
		const doubled = {
			...BALANCE,
			combat: { ...BALANCE.combat, enemyHealthMultiplier: 2 },
		};
		expect(creepMaxHealth(20, 30, doubled)).toBeCloseTo(300 * 1.12 ** 12);
		expect(creepMaxHealth(20, 30, BALANCE, true)).toBeCloseTo(300 * 1.12 ** 12);
		expect(
			new Map(
				effectiveStatRows(
					undefined,
					undefined,
					undefined,
					undefined,
					ZERO_STATS,
					3642.75,
				),
			).get("Max health"),
		).toBe("3642.75");
	});
});
describe("attack timing", () => {
	test("uses damped weight handling for physical and magic weapons", () => {
		const club = starterClub();
		expect(weaponAttackSpeed(club, ZERO_STATS)).toBeCloseTo(10 / 12);
		expect(
			weaponAttackSpeed(club, { ...ZERO_STATS, agility: 100 }),
		).toBeCloseTo(20 / 12);
		const generatedStaff = generateItem(0, "common", 5, {
			allowedClasses: ["staff"],
		});
		const staff = {
			...generatedStaff,
			modifiers: { ...generatedStaff.modifiers, attackSpeedMultiplier: 1 },
		};
		expect(
			weaponAttackSpeed(staff, { ...ZERO_STATS, strength: 100, spirit: 100 }),
		).toBeCloseTo(20 / 16);
		expect(
			weaponAttackSpeed(staff, { ...ZERO_STATS, agility: 1_000 }),
		).toBeCloseTo(10 / 16);
	});
});
test("accelerates skill casts with Agility and level while capping them at two attack intervals", () => {
	const baseline = skillCastTime("gravityPull", 1, 0, 1);
	expect(baseline).toBe(0.5);
	expect(skillCastTime("gravityPull", 50, 20, 1)).toBeLessThan(baseline);
	expect(skillCastTime("gravityPull", 1, 0, 10)).toBe(0.2);
	expect(skillCastTime("penance", 99, 999, 10)).toBe(0);
});
test("resolves the configured unarmed profile from effective Strength", () => {
	expect(
		attackProfile(undefined, { ...ZERO_STATS, strength: 8 }, BALANCE),
	).toMatchObject({
		kind: "unarmed",
		damage: 9,
		attacksPerSecond: 1,
		range: 70,
		rageCost: 0,
		projectile: false,
	});
});
describe("equipment requirements", () => {
	test("rolls and preserves requirement-active immunities only from generated level-25+ items", () => {
		const lowLevel = Array.from({ length: 500 }, (_, seed) =>
			generateItem(24, "rare", seed),
		);
		expect(
			lowLevel.every((item) => (item.immunities?.length ?? 0) === 0),
		).toBeTrue();
		const immune = Array.from({ length: 500 }, (_, seed) =>
			generateItem(25, "rare", seed),
		).find((item) => item.immunities?.length);
		expect(immune?.immunities?.length).toBeGreaterThan(0);
		expect(levelUpItem(immune!, 999).immunities).toEqual(immune!.immunities);
		const frostWard = {
			...starterClub(),
			immunities: ["frost" as const],
			requirements: { intelligence: 5 },
		};
		expect(
			equippedImmunities({ ...ZERO_STATS, intelligence: 5 }, frostWard).has(
				"frost",
			),
		).toBeTrue();
		expect(
			equippedImmunities({ ...ZERO_STATS, intelligence: 4 }, frostWard).has(
				"frost",
			),
		).toBeFalse();
		expect(
			new Map(
				effectiveStatRows(frostWard, undefined, undefined, undefined, {
					...ZERO_STATS,
					intelligence: 5,
				}),
			).get("Frost resist"),
		).toBe("Immune");
	});
	test("permits under-requirement equipment and scales item output by missing stat plus one", () => {
		const state = progress();
		state.level = 100;
		const sword = {
			...generateItem(5, "rare", 71, { allowedClasses: ["sword"] }),
			requirements: { strength: 15 },
			perks: { defense: 9 },
		};
		state.stats.strength = 13;
		state.inventoryTiles.push({
			id: "penalized",
			key: itemStackKey(sword),
			item: sword,
			quantity: 1,
		});
		expect(itemRequirementMultiplier(sword, state.stats)).toBeCloseTo(1 / 3);
		expect(equipFromInventory(state, "penalized").changed).toBeTrue();
		expect(equippedPerks(state.stats, sword).defense).toBeCloseTo(3);
	});
	test("never reduces weapon damage below that weapon's level-zero value", () => {
		const sword = {
			...generateItem(5, "common", 72, { allowedClasses: ["sword"] }),
			requirements: { strength: 100 },
		};
		expect(weaponDamage(sword, ZERO_STATS)).toBeCloseTo(
			sword.modifiers.damageMultiplier / 1.125,
		);
	});
	test("never reduces weapon speed below its ordinary weight-and-handling speed", () => {
		const sword = generateItem(5, "common", 72, { allowedClasses: ["sword"] });
		const swiftSword = {
			...sword,
			requirements: { strength: 100 },
			modifiers: { ...sword.modifiers, attackSpeedMultiplier: 1.2 },
		};
		const baseSpeed = 10 / swiftSword.weight;
		expect(weaponAttackSpeed(swiftSword, ZERO_STATS)).toBeCloseTo(
			baseSpeed * 1.02,
		);
		expect(
			weaponAttackSpeed(
				{
					...swiftSword,
					modifiers: { ...swiftSword.modifiers, attackSpeedMultiplier: 1 },
				},
				ZERO_STATS,
			),
		).toBeCloseTo(baseSpeed);
	});
	test("marks only upgrade requirements above the hero's matching stat as unmet", () => {
		const item = {
			...generateItem(4, "common", 72, { allowedClasses: ["sword"] }),
			requirements: { strength: 15, agility: 8 },
		};
		const baseline = { ...item, requirements: { strength: 12, agility: 7 } };
		expect(
			itemRequirementRows(
				item,
				{ ...ZERO_STATS, strength: 13, agility: 9 },
				baseline,
			),
		).toEqual([
			{ key: "agility", currentVal: 7, newVal: 8, unmet: false },
			{ key: "strength", currentVal: 12, newVal: 15, unmet: true },
		]);
	});
	test("projects the minimum attributes that fully satisfy an item's requirements", () => {
		const item = {
			...generateItem(4, "common", 73, { allowedClasses: ["axe"] }),
			requirements: { strength: 15, agility: 8 },
		};
		expect(
			requirementMetStats(item, { ...ZERO_STATS, strength: 13, agility: 9 }),
		).toEqual({ ...ZERO_STATS, strength: 15, agility: 9 });
	});
	test("shows unpenalized stats normally and current stats during penalty hover", () => {
		const item = {
			...generateItem(4, "common", 73, { allowedClasses: ["axe"] }),
			requirements: { strength: 15, agility: 8 },
		};
		const stats = { ...ZERO_STATS, strength: 13, agility: 9 };
		expect(requirementDisplayStats(item, stats, false)).toEqual({
			...ZERO_STATS,
			strength: 15,
			agility: 9,
		});
		expect(requirementDisplayStats(item, stats, true)).toBe(stats);
	});
});
test("derives health from Strength and mana from Intelligence", () => {
	const base = derivedStats(ZERO_STATS);
	expect(base.maxHp).toBe(10);
	expect(base.maxMana).toBe(5);
	expect(base.rageRegen).toBe(0.05);
	const advanced = derivedStats({
		...ZERO_STATS,
		strength: 3,
		magic: 99,
		intelligence: 2,
	});
	expect(advanced.maxHp).toBe(13);
	expect(advanced.maxMana).toBe(9);
	expect(derivedStats({ ...ZERO_STATS, spirit: 10 }).rageRegen).toBe(0.3);
});

test("keeps attribute roles distinct and caps critical and cooldown scaling", () => {
	const stats = derivedStats({
		agility: 100,
		strength: 0,
		magic: 20,
		spirit: 0,
		intelligence: 100,
	});
	expect(stats.critChance).toBe(0.5);
	expect(stats.critMultiplier).toBe(3.5);
	expect(stats.cooldownReduction).toBe(0.4);
	expect(stats.magicAmp).toBe(1.5);
});
describe("XP curve", () => {
	test("uses a quadratic cumulative curve with a 15 XP first level", () => {
		expect([0, 1, 2, 3, 4, 5].map(xpForNextLevel)).toEqual([
			15, 45, 75, 105, 135, 165,
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
		const tile = {
			id: "extractable",
			key: itemStackKey(item),
			item,
			quantity: 1,
		};
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
	test("disables non-Epic extraction until every carried skill is permanently learned", () => {
		const state = progress();
		const item = generateItem(1, "rare", 27, { allowedClasses: ["staff"] });
		const tile = {
			id: "unlearned",
			key: itemStackKey(item),
			item,
			quantity: 1,
		};
		state.inventoryTiles.push(tile);
		state.gold = 10_000;
		expect(extractButtonStatus(tile, state)).toBe("unlearned-skill");
		expect(extractFromInventory(state, tile.id)).toMatchObject({
			changed: false,
			reason: expect.stringContaining("must first be learned"),
		});
	});
	test("allows Epic extraction to learn and universally bind unlearned skills", () => {
		const state = progress();
		const item = generateItem(1, "epic", 27, { allowedClasses: ["staff"] });
		const tile = {
			id: "epic-unlearned",
			key: itemStackKey(item),
			item,
			quantity: 1,
		};
		state.inventoryTiles.push(tile);
		state.gold = 0;
		expect(extractButtonStatus(tile, state)).toBe("available");
		expect(extractFromInventory(state, tile.id)).toMatchObject({
			changed: true,
		});
		for (const skill of item.skills) {
			expect(state.learnedSkills).toContain(skill);
			expect(state.universalSkills).toContain(skill);
			expect(state.learnedSkillLevels[skill]).toBe(1);
		}
	});
	test("toggles an equipped weapon to an empty main hand without creating a fallback club", () => {
		const state = progress();
		state.level = 100;
		const clubTile = {
			id: "club",
			key: itemStackKey(state.mainHand),
			item: state.mainHand!,
			quantity: 1,
		};
		state.inventoryTiles.push(clubTile);
		expect(equipFromInventory(state, clubTile.id).changed).toBeTrue();
		expect(state.mainHand).toBeUndefined();
		expect(clubTile.quantity).toBe(1);
		expect(state.inventoryTiles).toHaveLength(1);
	});
	test("toggles an equipped offhand back to unequipped", () => {
		const state = progress();
		const buckler = { ...generateBuckler(0, "common", 12), requirements: {} };
		collectIntoInventory(
			state,
			buckler,
			() => `tile-${++id}`,
			() => ++id,
		);
		const tile = state.inventoryTiles[0];
		expect(equipFromInventory(state, tile.id).changed).toBeTrue();
		expect(state.offHand).toBeDefined();
		expect(equipFromInventory(state, tile.id).changed).toBeTrue();
		expect(state.offHand).toBeUndefined();
		expect(tile.quantity).toBe(1);
	});
	test("prices percentage return above one rage and upgrades it toward one", () => {
		const base = {
			...generateBuckler(0, "rare", 18),
			reflectionComponents: ["return" as const],
		};
		const stats = { ...ZERO_STATS, agility: 50 };
		const baseCost = bucklerBlockCost(base, stats);
		const upgraded = levelUpItem(base, 19);
		expect(baseCost).toBeGreaterThan(1);
		expect(bucklerBlockCost(upgraded, stats)).toBeGreaterThan(1);
		expect(bucklerBlockCost(upgraded, stats)).toBeLessThan(baseCost);
	});
	test("equips relics as offhands and preserves their attraction passive", () => {
		const state = progress();
		const relic = { ...generateRelic(0, "rare", 12), attractionSpeed: 35 };
		collectIntoInventory(
			state,
			relic,
			() => `tile-${++id}`,
			() => ++id,
		);
		expect(
			equipFromInventory(state, state.inventoryTiles[0].id).changed,
		).toBeTrue();
		expect(state.offHand?.itemKind).toBe("relic");
		expect(state.offHand?.attractionSpeed).toBe(35);
	});
	test("removes empty stacks and releases their capacity immediately", () => {
		const state = progress();
		expect(inventoryCapacity(0)).toBe(10);
		expect(inventoryCapacity(4)).toBe(10);
		expect(inventoryCapacity(5)).toBe(11);
		expect(inventoryCapacity(15)).toBe(12);
		for (let n = 0; n < 8; n += 1)
			expect(
				collectIntoInventory(
					state,
					generateItem(n, "common", 100 + n),
					() => `tile-${++id}`,
					() => ++id,
				).changed,
			).toBeTrue();
		const tile = state.inventoryTiles[0];
		purgeFromInventory(state, tile.id);
		expect(
			state.inventoryTiles.some((candidate) => candidate.id === tile.id),
		).toBeFalse();
		expect(occupiedInventorySlots(state)).toBe(7);
		expect(
			collectIntoInventory(
				state,
				generateItem(9, "epic", 999),
				() => `tile-${++id}`,
				() => ++id,
			).changed,
		).toBeTrue();
		expect(occupiedInventorySlots(state)).toBe(8);
	});
	test("upgrades one source copy without creating persistent automation", () => {
		const state = progress();
		const item = generateItem(1, "common", 41);
		collectIntoInventory(
			state,
			item,
			() => `tile-${++id}`,
			() => ++id,
		);
		collectIntoInventory(
			state,
			{ ...item, id: "copy" },
			() => `tile-${++id}`,
			() => ++id,
		);
		state.scraps.common = 10;
		const gold = state.gold;
		const result = upgradeFromInventory(
			state,
			state.inventoryTiles[0].id,
			() => `tile-${++id}`,
			() => 55,
		);
		expect(result.changed).toBeTrue();
		expect(result.created?.level).toBe(2);
		expect(state.inventoryTiles[0].quantity).toBe(1);
		expect(state.inventoryTiles[1].quantity).toBe(1);
		expect(state.scraps.common).toBe(10 - upgradeCosts(item).scraps);
		expect(state.gold).toBeLessThan(gold);
	});
	test("uses lower upgrade bases and increases them for direct attribute points", () => {
		const plain = generateItem(1, "common", 41);
		const attributed = { ...plain, statBonuses: { spirit: 3 } };
		expect(upgradeCosts(plain)).toEqual({
			gold: Math.ceil(plain.sellValue * 1.5 * 1.1),
			scraps: 5,
		});
		expect(upgradeCosts(attributed)).toEqual({
			gold: Math.ceil(plain.sellValue * 1.5 * 1.3),
			scraps: 6,
		});
	});
	test("upgrades a lone equipped copy in place when resources are sufficient", () => {
		const state = progress();
		const item = { ...generateItem(1, "common", 141), requirements: {} };
		collectIntoInventory(
			state,
			item,
			() => `tile-${++id}`,
			() => ++id,
		);
		const tile = state.inventoryTiles.find(
			(candidate) => candidate.key === itemStackKey(item),
		)!;
		expect(equipFromInventory(state, tile.id).changed).toBeTrue();
		state.scraps.common = 20;
		const result = upgradeFromInventory(
			state,
			tile.id,
			() => `tile-${++id}`,
			() => 155,
		);
		expect(result.changed).toBeTrue();
		expect(state.mainHand.level).toBe(2);
		const upgraded = state.inventoryTiles.find(
			(candidate) => candidate.key === itemStackKey(state.mainHand),
		);
		expect(upgraded?.quantity).toBe(1);
		expect(isEquippedTile(state, upgraded!)).toBeTrue();
		expect(
			state.inventoryTiles.some((candidate) => candidate.id === tile.id),
		).toBeFalse();
	});
	test("retains equipped copies and rejects destructive actions", () => {
		const state = progress();
		const item = { ...generateItem(1, "rare", 71), requirements: {} };
		collectIntoInventory(
			state,
			item,
			() => `tile-${++id}`,
			() => ++id,
		);
		const tile = state.inventoryTiles[0];
		expect(equipFromInventory(state, tile.id).changed).toBeTrue();
		expect(tile.quantity).toBe(1);
		expect(isEquippedTile(state, tile)).toBeTrue();
		expect(
			state.inventoryTiles.some(
				(candidate) => candidate.key === itemStackKey(starterClub()),
			),
		).toBeTrue();
		const gold = state.gold;
		const scraps = state.scraps.rare;
		expect(sellFromInventory(state, tile.id).changed).toBeFalse();
		expect(purgeFromInventory(state, tile.id).changed).toBeFalse();
		expect(tile.quantity).toBe(1);
		expect(state.gold).toBe(gold);
		expect(state.scraps.rare).toBe(scraps);
	});
	test("allows destructive actions on spare copies in an equipped stack", () => {
		const state = progress();
		const item = { ...generateItem(1, "rare", 71), requirements: {} };
		for (let copy = 0; copy < 4; copy += 1)
			collectIntoInventory(
				state,
				{ ...item, id: `spare-${copy}` },
				() => `tile-${++id}`,
				() => ++id,
			);
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
	test("accepts v20 inventory, suicide, and anonymous commands and rejects retired automation", () => {
		expect(
			parseClientMessage({ type: "upgradeItem", tileId: "tile-1", bulk: true }),
		).toEqual({ type: "upgradeItem", tileId: "tile-1", bulk: true });
		expect(parseClientMessage({ type: "deferDrop", dropId: "drop-1" })).toEqual(
			{ type: "deferDrop", dropId: "drop-1" },
		);
		expect(parseClientMessage({ type: "suicide" })?.type).toBe("suicide");
		expect(parseClientMessage({ type: "join", name: "Hero_1" })?.type).toBe(
			"join",
		);
		expect(
			parseClientMessage({ type: "join", name: "bad name" }),
		).toBeUndefined();
		expect(parseClientMessage({ type: "listHeroes" })?.type).toBe("listHeroes");
		expect(
			parseClientMessage({
				type: "respecStats",
				allocation: {
					agility: 1,
					strength: 1,
					magic: 1,
					spirit: 1,
					intelligence: 1,
				},
			})?.type,
		).toBe("respecStats");
		expect(
			parseClientMessage({
				type: "setStackAutomation",
				tileId: "tile-1",
				mode: "sell",
				maxRarity: "rare",
			}),
		).toBeUndefined();
		expect(
			parseClientMessage({ type: "mergeItem", tileId: "tile-1" }),
		).toBeUndefined();
		expect(
			parseClientMessage({
				type: "creepKilled",
				unitId: "unit-1",
				xpReward: 9999,
			}),
		).toBeUndefined();
		expect(
			parseClientMessage({
				type: "updateAllocation",
				allocation: { agility: 5 },
			}),
		).toBeUndefined();
	});
});
describe("weapon skills", () => {
	test("gives every weapon class a distinct registered signature skill", () => {
		const skills = Object.values(WEAPONS).map((weapon) => weapon.skill);
		expect(new Set(skills).size).toBe(Object.keys(WEAPONS).length);
		for (const skill of skills) expect(skill && SKILLS[skill]).toBeDefined();
		expect(WEAPONS.mace.skill).toBe("shockwave");
		expect(WEAPONS.axe.skill).toBe("cleave");
		expect(WEAPONS.hammer.skill).toBe("orbitingHammers");
		expect(SKILLS.orbitingHammers.resource).toBe("mana");
	});
});
describe("equipped skill levels", () => {
	test("temporarily adds one level while learned skills remain active without matching gear", () => {
		const state = progress();
		state.level = 100;
		expect(effectiveSkillLevel(state, "bash")).toBe(0);
		state.learnedSkills.push("bash");
		state.learnedSkillLevels.bash = 3;
		expect(effectiveSkillLevel(state, "bash")).toBe(4);
		state.mainHand = { ...state.mainHand, skills: [] };
		expect(effectiveSkillLevel(state, "bash")).toBe(3);
		const relic = generateRelic(1, "rare", 0);
		state.offHand = relic;
		expect(relic.skills).toContain("gravityPull");
		expect(effectiveSkillLevel(state, "gravityPull")).toBe(1);
	});
});
test("keeps unlearned weapon actives off the rail while retaining them as cooldown-weighted procs", () => {
	const state = progress();
	state.level = 20;
	state.mainHand = { ...state.mainHand!, skills: ["bash", "thorns"] };
	expect(effectiveSkillLevel(state, "bash")).toBe(0);
	expect(effectiveSkillLevel(state, "thorns")).toBe(1);
	expect(weaponProcSkills(state)).toEqual([{ id: "bash", level: 1 }]);
	expect(weaponSkillTriggerChance(10)).toBe(0.1);
	expect(weaponSkillTriggerChance(1)).toBe(1);
	expect(weaponSkillTriggerChance(0.5)).toBe(1);
});

test("scales Reflective Surge cooldown, duration, and block bonus to exact endpoints", () => {
	expect(reflectiveSurgeCooldown(1)).toBe(30);
	expect(reflectiveSurgeCooldown(99)).toBe(20);
	expect(reflectiveSurgeDuration(1)).toBe(5);
	expect(reflectiveSurgeDuration(99)).toBe(19);
	expect(reflectiveSurgeBlockChanceBonus(1)).toBe(0.1);
	expect(reflectiveSurgeBlockChanceBonus(99)).toBeCloseTo(0.3);
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
test("limits active spells to the editable loadout while passives remain active", () => {
	const state = progress();
	state.level = 5;
	state.mainHand = { ...state.mainHand!, skills: ["bash", "sweep"] };
	state.universalSkills.push("bash", "sweep");
	state.learnedSkills.push("bash", "sweep");
	state.learnedSkillLevels.bash = 1;
	state.learnedSkillLevels.sweep = 1;
	state.equippedSkills = ["sweep"];
	expect(activeSkillIds(state)).toEqual(["sweep"]);
	state.learnedSkills.push("attraction");
	state.learnedSkillLevels.attraction = 1;
	expect(activeSkillIds(state)).toEqual(["sweep", "attraction"]);
});
test("keeps unequipped active spells visible but excludes them from activation", () => {
	const state = progress();
	state.equippedSkills = [];
	expect(activeSkillIds(state)).not.toContain("healing");
	expect(isSkillActive(state, "healing")).toBeFalse();
	state.equippedSkills = ["healing"];
	expect(isSkillActive(state, "healing")).toBeTrue();
});
describe("amulets and charms", () => {
	test("migrates persisted Stamina item fields to Rage", () => {
		const legacy = generateAccessory(20, "epic", 4, "amulet") as ReturnType<
			typeof generateAccessory
		> & {
			staminaCost?: number;
			accessoryBonuses: NonNullable<
				ReturnType<typeof generateAccessory>["accessoryBonuses"]
			> & { staminaSkillLevels?: number };
		};
		delete (legacy as Partial<typeof legacy>).rageCost;
		legacy.staminaCost = 2.5;
		legacy.accessoryBonuses = { staminaSkillLevels: 7 };

		migrateLegacyItem(legacy);

		expect(legacy.rageCost).toBe(2.5);
		expect(legacy.accessoryBonuses.rageSkillLevels).toBe(7);
		expect("staminaCost" in legacy).toBeFalse();
		expect("staminaSkillLevels" in legacy.accessoryBonuses).toBeFalse();
	});

	test("rolls rarity-bounded accessories and equips amulets and charms independently", () => {
		const bounds = {
			common: [1, 2],
			uncommon: [1, 3],
			rare: [2, 4],
			epic: [4, 6],
		} as const;
		for (const rarity of ["common", "uncommon", "rare", "epic"] as const)
			for (let seed = 0; seed < 20; seed += 1) {
				const item = generateAccessory(20, rarity, seed);
				const bonus = item.accessoryBonuses ?? {};
				const count =
					Object.keys(item.statBonuses).length +
					Number(bonus.manaSkillLevels !== undefined) +
					Number(bonus.rageSkillLevels !== undefined) +
					Number(bonus.allSkillLevels !== undefined) +
					Number(bonus.globalCooldownReduction !== undefined) +
					Number(bonus.manaCostReduction !== undefined) +
					Number(bonus.lifeCostReduction !== undefined) +
					Number(bonus.healthOnKill !== undefined) +
					Number(bonus.manaOnKill !== undefined) +
					Number(item.attractionSpeed > 0) +
					Number(item.skills.includes("timeHarvest")) +
					Object.keys(bonus.physicalDamage ?? {}).length;
				expect(count).toBeGreaterThanOrEqual(bounds[rarity][0]);
				expect(count).toBeLessThanOrEqual(bounds[rarity][1]);
			}
		const rolled = Array.from({ length: 500 }, (_, seed) => [
			generateAccessory(20, "epic", seed, "amulet"),
			generateAccessory(20, "epic", seed, "charm"),
		]).flat();
		const healthRolls = rolled.flatMap(
			(item) => item.accessoryBonuses?.healthOnKill ?? [],
		);
		const manaRolls = rolled.flatMap(
			(item) => item.accessoryBonuses?.manaOnKill ?? [],
		);
		expect(healthRolls.length).toBeGreaterThan(0);
		expect(manaRolls.length).toBeGreaterThan(0);
		expect(
			healthRolls.every(
				(value) => Number.isInteger(value) && value >= 1 && value <= 25,
			),
		).toBeTrue();
		expect(
			manaRolls.every(
				(value) => Number.isInteger(value) && value >= 1 && value <= 50,
			),
		).toBeTrue();
		const state = progress();
		const charm = generateAccessory(10, "rare", 3, "charm");
		const amulet = generateAccessory(10, "rare", 4, "amulet");
		collectIntoInventory(
			state,
			charm,
			() => `tile-${++id}`,
			() => ++id,
		);
		collectIntoInventory(
			state,
			amulet,
			() => `tile-${++id}`,
			() => ++id,
		);
		expect(
			equipFromInventory(state, state.inventoryTiles[0].id).changed,
		).toBeTrue();
		expect(
			equipFromInventory(state, state.inventoryTiles[1].id).changed,
		).toBeTrue();
		expect(state.offHand).toBeUndefined();
		expect(state.charm?.itemKind).toBe("charm");
		expect(state.amulet?.itemKind).toBe("amulet");
		const staff = generateItem(10, "rare", 99, { allowedClasses: ["staff"] });
		collectIntoInventory(
			state,
			staff,
			() => `tile-${++id}`,
			() => ++id,
		);
		expect(
			equipFromInventory(state, state.inventoryTiles[2].id).changed,
		).toBeTrue();
		expect(state.mainHand?.hands).toBe(2);
		expect(state.offHand).toBeUndefined();
		expect(state.amulet?.itemKind).toBe("amulet");
		expect(state.charm?.itemKind).toBe("charm");
	});
	test("adds temporary resource skill levels and caps global cooldown reduction", () => {
		const state = progress();
		state.level = 100;
		state.offHand = {
			...generateAccessory(50, "epic", 8, "amulet"),
			requirements: {},
			accessoryBonuses: {
				manaSkillLevels: 5,
				rageSkillLevels: 10,
				allSkillLevels: 3,
				globalCooldownReduction: 0.8,
			},
		};
		expect(effectiveSkillLevel(state, "healing")).toBe(9);
		expect(effectiveSkillLevel(state, "bash")).toBe(0);
		expect(itemCooldownReduction(state.offHand)).toBe(0.8);
	});
	test("rolls the extractable Time Harvest passive and scales its cooldown removal", () => {
		const amulet = Array.from({ length: 100 }, (_, seed) =>
			generateAccessory(50, "epic", seed, "amulet"),
		).find((item) => item.skills.includes("timeHarvest"))!;
		expect(amulet.skills).toContain("timeHarvest");
		expect(extractableSkills(amulet)).toContain("timeHarvest");
		expect(timeHarvestCooldownReduction(1)).toBe(0.25);
		expect(timeHarvestCooldownReduction(99)).toBe(2);
		expect(timeHarvestItemSkillBonus(0)).toBe(0);
		expect(timeHarvestItemSkillBonus(50)).toBe(99);
		const state = progress();
		state.level = 100;
		state.amulet = { ...amulet, requirements: {} };
		expect(effectiveSkillLevel(state, "timeHarvest")).toBe(99);
	});
});
test("drops newest unequipped overflow stacks after a death-level capacity reduction", () => {
	const state = progress();
	state.level = 100;
	for (let seed = 1; seed <= 11; seed += 1)
		collectIntoInventory(
			state,
			generateItem(seed, "common", seed, { allowedClasses: ["sword"] }),
			() => `overflow-${seed}`,
			() => seed,
		);
	const protectedTile = state.inventoryTiles[10];
	expect(equipFromInventory(state, protectedTile.id).changed).toBeTrue();
	state.level = 0;
	const dropped = dropInventoryOverflow(state);
	expect(occupiedInventorySlots(state)).toBe(inventoryCapacity(0));
	expect(
		state.inventoryTiles.some((tile) => tile.key === protectedTile.key),
	).toBeTrue();
	expect(dropped).toHaveLength(2);
});
describe("Epic skill extraction", () => {
	test("binds already learned skills globally from Epic equipment, then permits lower-rarity upgrades", () => {
		const rareState = progress();
		const rare = generateItem(1, "rare", 17, { allowedClasses: ["staff"] });
		rareState.inventoryTiles.push({
			id: "rare",
			key: itemStackKey(rare),
			item: rare,
			quantity: 1,
		});
		rareState.gold = 10_000;
		for (const skill of rare.skills) {
			if (!rareState.learnedSkills.includes(skill))
				rareState.learnedSkills.push(skill);
			rareState.learnedSkillLevels[skill] = 1;
		}
		expect(extractFromInventory(rareState, "rare").changed).toBeTrue();
		expect(rareState.universalSkills).not.toContain("arcaneBolt");
		const epicState = progress();
		const epic = generateItem(1, "epic", 27, { allowedClasses: ["staff"] });
		epicState.inventoryTiles.push({
			id: "epic",
			key: itemStackKey(epic),
			item: epic,
			quantity: 1,
		});
		epicState.gold = 10_000;
		for (const skill of epic.skills) {
			if (!epicState.learnedSkills.includes(skill))
				epicState.learnedSkills.push(skill);
			epicState.learnedSkillLevels[skill] = 1;
		}
		expect(extractFromInventory(epicState, "epic").changed).toBeTrue();
		expect(epicState.universalSkills).toEqual(
			expect.arrayContaining(["arcaneBolt", "frostOrb"]),
		);
		const upgrade = generateItem(1, "rare", 17, { allowedClasses: ["staff"] });
		epicState.inventoryTiles.push({
			id: "upgrade",
			key: itemStackKey(upgrade),
			item: upgrade,
			quantity: 1,
		});
		const level = epicState.learnedSkillLevels.arcaneBolt!;
		expect(extractFromInventory(epicState, "upgrade").changed).toBeTrue();
		expect(epicState.learnedSkillLevels.arcaneBolt).toBe(level + 1);
	});
});
test("adds Healing to high-rarity maces and permits permanent Healing upgrades", () => {
	const rareMace = generateItem(5, "rare", 31, { allowedClasses: ["mace"] });
	expect(rareMace.skills).toEqual(
		expect.arrayContaining(["shockwave", "healing"]),
	);
	const state = progress();
	state.inventoryTiles.push({
		id: "healing-mace",
		key: itemStackKey(rareMace),
		item: rareMace,
		quantity: 1,
	});
	state.gold = 100_000;
	state.learnedSkills.push("shockwave");
	state.learnedSkillLevels.shockwave = 1;
	expect(extractableSkills(rareMace)).toContain("healing");
	expect(extractFromInventory(state, "healing-mace").changed).toBeTrue();
	expect(state.learnedSkillLevels.healing).toBe(2);
	expect(state.universalSkills).toContain("healing");
});
test("extracts Blocking and adds half a base block percentage point per effective level", () => {
	const state = progress();
	const buckler = generateBuckler(1, "common", 12);
	state.inventoryTiles.push({
		id: "buckler",
		key: itemStackKey(buckler),
		item: buckler,
		quantity: 1,
	});
	state.learnedSkills.push("blocking");
	state.learnedSkillLevels.blocking = 3;
	state.gold = 1_000;
	expect(extractableSkills(buckler)).toEqual(["blocking"]);
	expect(extractFromInventory(state, "buckler").changed).toBeTrue();
	expect(state.gold).toBe(970);
	expect(state.learnedSkillLevels.blocking).toBe(4);
	expect(state.inventoryTiles).toHaveLength(0);
	expect(
		bucklerBlockChance(buckler, ZERO_STATS, 3) -
			bucklerBlockChance(buckler, ZERO_STATS, 0),
	).toBeCloseTo(0.015);
});
describe("spell resources", () => {
	test("registers Rent as life and buckler blocking as rage", () => {
		expect(SKILLS.rent.resource).toBe("life");
		expect(SKILLS.blocking.resource).toBe("rage");
		expect(SKILLS.blocking.passive).toBeTrue();
		expect(generateBuckler(0, "common", 12).skills).toEqual(["blocking"]);
	});
});

test("defines exact level-scaled passive upkeep tiers and applies Mana-cost reduction", () => {
	expect(skillUpkeepPerSecond("attraction", 10)).toBeCloseTo(0.01);
	expect(skillUpkeepPerSecond("penance", 10)).toBeCloseTo(0.02);
	expect(skillUpkeepPerSecond("thorns", 10)).toBeCloseTo(0.05);
	expect(skillUpkeepPerSecond("sunburnAura", 10)).toBeCloseTo(0.1);
	expect(skillUpkeepPerSecond("blocking", 10)).toBeCloseTo(0.01);
	expect(skillUpkeepPerSecond("sunburnAura", 99, 0.9)).toBeCloseTo(0.099);
	expect(SKILLS.thorns.upkeep).toEqual({
		resource: "mana",
		perLevelPerSecond: 0.005,
	});
	expect(SKILLS.penance).toMatchObject({
		resource: "rage",
		upkeep: { resource: "rage", perLevelPerSecond: 0.002 },
	});
	expect(SKILLS.blocking.upkeep).toEqual({
		resource: "rage",
		perLevelPerSecond: 0.001,
	});
});
test("blood skills spend remaining HP, scale damage with the amount spent, and preserve one HP", () => {
	for (const skill of Object.values(SKILLS).filter(
		({ resource }) => resource === "life",
	)) {
		expect(skillHealthRequirementMet(skill.id, 1, 100)).toBeFalse();
		expect(skillHealthRequirementMet(skill.id, 1.001, 100)).toBeTrue();
	}
	expect(bloodSkillLifeCost("rent", 100)).toBe(10);
	expect(bloodSkillLifeCost("rent", 50)).toBe(5);
	expect(bloodSkillLifeCost("vampiricBoomerang", 50)).toBe(1.5);
	expect(bloodSkillLifeCost("vampiricBoomerang", 20)).toBe(1);
	expect(bloodSkillLifeCost("vampiricBoomerang", 1.1)).toBeCloseTo(0.1);
	expect(bloodSkillLifeCost("rent", 100, 0.5)).toBe(5);
	expect(bloodSkillDamage("rent", 1, 10, 10)).toBeGreaterThan(
		bloodSkillDamage("rent", 1, 10, 5),
	);
	expect(bloodSkillDamage("vampiricBoomerang", 10, 20, 3)).toBe(26);
	expect(bloodSkillDamage("vampiricBoomerang", 99, 20, 3)).toBe(52.7);
	expect(skillHealthRequirementMet("bash", 1, 100)).toBeTrue();
});
test("grants Gold gain and rarity boost on bucklers by rarity", () => {
	const common = generateBuckler(1, "common", 12);
	const epic = generateBuckler(1, "epic", 12);
	expect(common.modifiers.goldGain).toBeCloseTo(0.05);
	expect(common.modifiers.rarityBoost).toBeCloseTo(0.02);
	expect(epic.modifiers.goldGain).toBeGreaterThan(common.modifiers.goldGain);
	expect(epic.modifiers.rarityBoost).toBeGreaterThan(
		common.modifiers.rarityBoost,
	);
});
describe("Force Field", () => {
	test("always applies outward velocity and interrupts attacks", () => {
		let interrupted = 0;
		const pushed = {
			position: { x: 100, y: 0 },
			velocity: { x: -400, y: 0 },
			interruptAttack: () => (interrupted += 1),
		};
		forceField(pushed, { x: 0, y: 0 }, 40);
		expect(pushed.position).toEqual({ x: 100, y: 0 });
		expect(pushed.velocity).toEqual({ x: 40, y: 0 });
		expect(interrupted).toBe(1);
		expect(SKILLS.gravityPull.label).toBe("Force Field");
		expect(forceFieldRange(1)).toBe(200);
		expect(forceFieldRange(99)).toBe(800);
		expect(forceFieldFalloff(99, 800)).toBe(0);
		expect(forceFieldFalloff(99, 700)).toBeCloseTo(0.125);
		expect(forceFieldFalloff(99, 100)).toBeCloseTo(0.875);
		expect(forceFieldDamage(1)).toBeCloseTo(0.6);
		expect(forceFieldDamage(100)).toBeCloseTo(9.51);
	});
});
describe("hero status HUD summaries", () => {
	test("aggregates duplicate effects into stacks with their live duration and combined DPS", () => {
		expect(
			statusEffectSummaries([
				{ kind: "poison", remaining: 1.2, damagePerSecond: 0.4 },
				{ kind: "poison", remaining: 3, damagePerSecond: 0.6 },
				{ kind: "stun", remaining: 0.35, damagePerSecond: 0 },
			]),
		).toEqual([
			{
				kind: "poison",
				icon: "☠",
				stacks: 2,
				remaining: 3,
				damagePerSecond: 1,
				tooltip: "Poison — 3s remaining · 2 stacks · 1 damage/s",
			},
			{
				kind: "stun",
				icon: "✦",
				stacks: 1,
				remaining: 0.35,
				damagePerSecond: 0,
				tooltip: "Stun — 0.35s remaining",
			},
		]);
	});
	test("shows only the current queued XP-send bonus with its live remaining time", () => {
		expect(
			xpSendBuffSummary(
				[
					{ multiplier: 2, expiresAt: 21_000 },
					{ multiplier: 3, expiresAt: 31_000 },
				],
				1_500,
			),
		).toEqual({
			multiplier: 2,
			remaining: 20,
			label: "200% XP · 20s",
			tooltip: "XP Send bonus — 200% XP for 20s remaining",
		});
		expect(
			xpSendBuffSummary(
				[
					{ multiplier: 2, expiresAt: 21_000 },
					{ multiplier: 3, expiresAt: 31_000 },
				],
				21_000,
			),
		).toEqual({
			multiplier: 3,
			remaining: 10,
			label: "300% XP · 10s",
			tooltip: "XP Send bonus — 300% XP for 10s remaining",
		});
	});
});
describe("spell tooltip damage previews", () => {
	test("covers runtime formulas that are not spell-power multipliers", () => {
		expect(
			skillDamagePreview("whirlwind", 10, { ...ZERO_STATS, strength: 10 }),
		).toEqual({ kind: "flat", value: 5, detail: "per pulse" });
		expect(skillDamagePreview("thorns", 1, ZERO_STATS)).toEqual({
			kind: "percentage",
			value: 0.05,
			detail: "incoming",
		});
		expect(skillDamagePreview("deathBurst", 1, ZERO_STATS)).toEqual({
			kind: "percentage",
			value: 0.2,
			detail: "target HP",
		});
		expect(
			skillDamagePreview("sunburnAura", 1, { ...ZERO_STATS, magic: 100 })
				?.value,
		).toBeCloseTo(0.02);
		expect(
			skillDamagePreview("thunderAura", 1, { ...ZERO_STATS, magic: 10 }),
		).toEqual({ kind: "flat", value: 6.5, detail: "lightning" });
		expect(skillDamagePreview("healing", 1, ZERO_STATS)).toBeUndefined();
	});
});
describe("extractable offhand and staff skills", () => {
	test("adds extractable Attraction and Force Field to attracting relics plus high-rarity offhand skills", () => {
		const relic = Array.from({ length: 50 }, (_, seed) =>
			generateRelic(1, "rare", seed),
		).find((item) => item.attractionSpeed > 0)!;
		const buckler = Array.from({ length: 100 }, (_, seed) =>
			generateBuckler(1, "rare", seed),
		).find((item) => item.reflectionComponents.length > 0)!;
		const staff = generateItem(1, "rare", 17, { allowedClasses: ["staff"] });
		expect(relic.skills).toEqual(
			expect.arrayContaining(["attraction", "gravityPull"]),
		);
		expect(extractableSkills(relic)).toEqual(
			expect.arrayContaining(["attraction", "gravityPull"]),
		);
		expect(buckler.skills).toEqual(
			expect.arrayContaining(["blocking", "thorns", "reflectiveSurge"]),
		);
		expect(staff.skills).toEqual(
			expect.arrayContaining(["arcaneBolt", "frostOrb"]),
		);
		const epic = Array.from({ length: 50 }, (_, seed) =>
			generateRelic(1, "epic", seed),
		).find((item) => item.attractionSpeed > 0)!;
		const state = progress();
		state.gold = 100_000;
		state.inventoryTiles.push({
			id: "idol",
			key: itemStackKey(epic),
			item: epic,
			quantity: 1,
		});
		for (const skill of epic.skills) {
			if (!state.learnedSkills.includes(skill)) state.learnedSkills.push(skill);
			state.learnedSkillLevels[skill] = 1;
		}
		expect(extractFromInventory(state, "idol").changed).toBeTrue();
		expect(state.universalSkills).toEqual(
			expect.arrayContaining(["attraction", "gravityPull"]),
		);
		expect(SKILLS.attraction.passive).toBeTrue();
		expect(SKILLS.gravityPull.cooldown).toBe(18);
		expect(SKILLS.frostOrb.cooldown).toBe(20);
	});
});
describe("aura equipment", () => {
	test("generates one deterministic extractable aura per scepter or Holy Buckler", () => {
		const scepters = Array.from({ length: 5 }, (_, seed) =>
			generateItem(8, "rare", seed, { allowedClasses: ["scepter"] }),
		);
		expect(
			scepters.every(
				(item) =>
					item.itemKind === "relic" &&
					item.hands === 0 &&
					item.weight === 0 &&
					item.rageCost === 0 &&
					item.modifiers.damageMultiplier === 1 &&
					item.statBonuses.spirit! > 0 &&
					item.statBonuses.intelligence! > 0 &&
					item.skills.length === 1 &&
					AURA_SKILLS.includes(item.skills[0]),
			),
		).toBeTrue();
		expect(new Set(scepters.flatMap((item) => item.skills))).toEqual(
			new Set(AURA_SKILLS),
		);
		const holy = Array.from({ length: 50 }, (_, index) =>
			generateBuckler(8, "rare", index * 5),
		).filter((item) => item.name === "Holy Buckler");
		expect(holy.length).toBeGreaterThan(0);
		expect(
			holy.every(
				(item) =>
					item.skills.length === 2 &&
					item.skills[0] === "blocking" &&
					AURA_SKILLS.includes(item.skills[1]),
			),
		).toBeTrue();
		expect(generateBuckler(8, "rare", 0, false).skills).toEqual(["blocking"]);
		const equipState = progress();
		equipState.inventoryTiles.push({
			id: "equipped-scepter",
			key: itemStackKey(scepters[0]),
			item: scepters[0],
			quantity: 1,
		});
		expect(
			equipFromInventory(equipState, "equipped-scepter").changed,
		).toBeTrue();
		expect(equipState.mainHand?.definitionId).toBe("club");
		expect(equipState.offHand?.definitionId).toBe("scepter");
		expect(levelUpItem(scepters[0], 99).definitionId).toBe("scepter");
		const state = progress();
		const auraItem = scepters[0];
		state.gold = 100_000;
		state.inventoryTiles.push({
			id: "aura",
			key: itemStackKey(auraItem),
			item: auraItem,
			quantity: 2,
		});
		state.learnedSkills.push(auraItem.skills[0]);
		state.learnedSkillLevels[auraItem.skills[0]] = 1;
		expect(extractFromInventory(state, "aura").changed).toBeTrue();
		expect(extractFromInventory(state, "aura").changed).toBeTrue();
		expect(state.learnedSkillLevels[auraItem.skills[0]]).toBe(3);
		expect(state.gold).toBe(99_970);
	});
	test("scales aura radius with level and Spirit plus other aura effects with level", () => {
		expect(auraRadius(1)).toBe(180);
		expect(auraRadius(99)).toBe(300);
		expect(auraRadius(1, 20)).toBe(190);
		expect(auraRadius(100, 20)).toBe(600);
		expect(auraSlowMultiplier(1)).toBeCloseTo(0.8);
		expect(auraSlowMultiplier(99)).toBeCloseTo(0.5);
		expect(sunburnInterval(100)).toBe(2);
		expect(sunburnFraction(100)).toBeCloseTo(0.02);
		expect(thunderInterval(1)).toBe(10);
		expect(thunderInterval(99)).toBe(3);
		expect(thunderDamage(10)).toBe(6.5);
		expect(thunderCritChance(0.2)).toBeCloseTo(0.3);
	});
});
describe("throwing axes", () => {
	test("generates a one-handed short-ranged projectile weapon with inherent bleed", () => {
		const axe = generateItem(0, "common", 17, {
			allowedClasses: ["throwingAxe"],
		});
		expect(axe.hands).toBe(1);
		expect(axe.skills).toEqual(["rendingThrow"]);
		expect(axe.modifiers.bleedChance).toBeGreaterThanOrEqual(0.15);
		expect(weaponRange(axe)).toBe(210);
		expect(weaponUsesProjectile(axe)).toBeTrue();
	});
});
test("adds extractable Whirlwind to high-rarity axes and scales its field", () => {
	const axe = generateItem(8, "rare", 17, { allowedClasses: ["axe"] });
	expect(axe.skills).toEqual(expect.arrayContaining(["cleave", "whirlwind"]));
	expect(extractableSkills(axe)).toContain("whirlwind");
	expect(whirlwindRadius(1)).toBeCloseTo(91.2);
	expect(whirlwindRadius(99)).toBe(208.8);
	expect(whirlwindDuration(1)).toBe(3);
	expect(whirlwindDuration(99)).toBe(12);
	expect(orbitingHammerDuration(1)).toBe(2.4);
	expect(orbitingHammerDuration(99)).toBe(10);
	expect(whirlwindMovementSpeed(1)).toBe(0.5);
	expect(whirlwindMovementSpeed(99)).toBe(1.5);
	expect(whirlwindDamage(20)).toBe(9);
});
describe("item sustain", () => {
	test("scales rolled sustain passives through upgrades", () => {
		const vampiric = generateItem(2, "rare", 8);
		expect(vampiric.modifiers.lifeStealBase).toBeCloseTo(0.021);
		const upgraded = levelUpItem(vampiric, 2);
		expect(upgraded.modifiers.lifeStealBase).toBeGreaterThan(
			vampiric.modifiers.lifeStealBase,
		);
		expect(upgraded.modifiers.strengthRegenMultiplier).toBe(0);
	});
});
describe("equipment upgrade trait preservation", () => {
	test("keeps rolled traits and increases exactly one direct attribute", () => {
		const base = generateItem(1, "rare", 17, { allowedClasses: ["hammer"] });
		const upgraded = levelUpItem(base, 999);
		expect(upgraded.perks).toEqual(base.perks);
		expect(
			STAT_KEYS.reduce(
				(sum, key) =>
					sum + (upgraded.statBonuses[key] ?? 0) - (base.statBonuses[key] ?? 0),
				0,
			),
		).toBe(1);
		expect(
			STAT_KEYS.filter(
				(key) => upgraded.statBonuses[key] !== base.statBonuses[key],
			),
		).toHaveLength(1);
		expect(upgraded.skills).toEqual(base.skills);
		expect(Object.keys(upgraded.requirements).sort()).toEqual(
			Object.keys(base.requirements).sort(),
		);
		for (const [key, value] of Object.entries(base.requirements))
			expect(upgraded.requirements[key as keyof Stats]).toBeGreaterThanOrEqual(
				value!,
			);
	});
	test("does not reroll accessory bonuses during an upgrade", () => {
		const base = generateAccessory(4, "rare", 27, "amulet");
		const upgraded = levelUpItem(base, 333);
		expect(upgraded.accessoryBonuses).toEqual(base.accessoryBonuses);
		expect(
			STAT_KEYS.reduce(
				(sum, key) =>
					sum + (upgraded.statBonuses[key] ?? 0) - (base.statBonuses[key] ?? 0),
				0,
			),
		).toBe(1);
		expect(upgraded.attractionSpeed).toBe(base.attractionSpeed);
	});
});
test("every generated equipment type has a positive direct attribute", () => {
	const items = [
		generateItem(0, "common", 1),
		generateBuckler(0, "common", 2),
		generateRelic(0, "common", 3),
		generateAccessory(0, "common", 4, "amulet"),
		generateAccessory(0, "common", 5, "charm"),
	];
	for (const item of items)
		expect(
			STAT_KEYS.some((key) => (item.statBonuses[key] ?? 0) > 0),
		).toBeTrue();
});
test("upgrading a legacy item without attributes adds one attribute point", () => {
	const base = { ...generateItem(1, "common", 41), statBonuses: {} };
	const upgraded = levelUpItem(base, 42);
	expect(
		STAT_KEYS.reduce((sum, key) => sum + (upgraded.statBonuses[key] ?? 0), 0),
	).toBe(1);
});
describe("equipment rarity promotion", () => {
	test("caps generated levels and promotes capped equipment to level one", () => {
		expect(generateItem(99, "common", 3).level).toBe(MAX_ITEM_LEVEL.common);
		expect(generateBuckler(99, "uncommon", 3).level).toBe(
			MAX_ITEM_LEVEL.uncommon,
		);
		expect(generateRelic(99, "rare", 3).level).toBe(MAX_ITEM_LEVEL.rare);
		const common = generateItem(10, "common", 17, {
			allowedClasses: ["staff"],
		});
		const promoted = levelUpItem(common, 18);
		expect(promoted.rarity).toBe("uncommon");
		expect(promoted.level).toBe(1);
		expect(promoted.definitionId).toBe(common.definitionId);
		expect(promoted.affixes).toEqual(common.affixes);
		expect(promoted.skills).toEqual(common.skills);
	});
	test("rejects upgrading final-level Epic equipment without spending resources", () => {
		const state = progress();
		const epic = generateItem(50, "epic", 19);
		state.inventoryTiles.push({
			id: "max-epic",
			key: itemStackKey(epic),
			item: epic,
			quantity: 1,
		});
		state.gold = 1_000_000;
		state.scraps.epic = 1_000;
		const result = upgradeFromInventory(
			state,
			"max-epic",
			() => "unused",
			() => 20,
		);
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
	test("formats projected and removed values from currentVal and nullable newVal", () => {
		expect(formatPreviewValue({ currentVal: 10, newVal: 14 })).toBe("14");
		expect(formatPreviewValue({ currentVal: 10, newVal: 10 })).toBe("10");
		expect(formatPreviewValue({ currentVal: 1, newVal: 2 })).toBe("2");
		expect(formatPreviewValue({ currentVal: 15, newVal: 16 })).toBe("16");
		expect(formatPreviewValue({ currentVal: "5/17", newVal: "5/19" })).toBe(
			"5/19",
		);
		expect(formatPreviewValue({ currentVal: 10, newVal: null })).toBe("—");
		expect(formatProjectedValue({ currentVal: 10, newVal: 14 })).toBe("14");
		expect(previewTone({ currentVal: 10, newVal: 14 })).toBe("gain");
		expect(previewTone({ currentVal: 10, newVal: 8 })).toBe("cost");
	});
});
describe("spell range and recovery", () => {
	test("converts simulation pixels to player-facing meters without changing distance", () => {
		expect(LOGICAL_PIXELS_PER_METER).toBe(50);
		expect(pixelsToMeters(150)).toBe(3);
		expect(metersToPixels(3)).toBe(150);
	});
	test("scales skill range and cooldown slightly with weapon level while natural healing stays weak", () => {
		expect(skillRange("bash", starterClub(), 4, 20)).toBe(145);
		expect(skillRange("bash", starterClub(), 100, 100)).toBe(405);
		const leveled = generateItem(10, "rare", 17, { allowedClasses: ["staff"] });
		expect(skillRange("arcaneBolt", leveled, 1, 0)).toBeCloseTo(346.5);
		expect(skillRange("healing", leveled, 1, 999)).toBe(HEALING_MIN_RADIUS);
		expect(skillRange("healing", leveled, 99, 999)).toBe(HEALING_MAX_RADIUS);
		expect(skillCooldown("arcaneBolt", leveled)).toBeCloseTo(5 / 1.05);
		expect(derivedStats({ ...ZERO_STATS, spirit: 20 }).hpRegen).toBeCloseTo(
			0.105,
		);
	});
	test("scales Cleave base range from one to ten meters", () => {
		expect(cleaveRange(1)).toBe(metersToPixels(1));
		expect(cleaveRange(99)).toBe(metersToPixels(10));
		expect(skillRange("cleave", starterClub(), 1, 0)).toBe(metersToPixels(1));
		expect(skillRange("cleave", starterClub(), 99, 0)).toBe(metersToPixels(10));
		expect(cleaveHalfArc(1) * 2).toBeCloseTo((45 * Math.PI) / 180);
		expect(cleaveHalfArc(50) * 2).toBeCloseTo((157.5 * Math.PI) / 180);
		expect(cleaveHalfArc(99) * 2).toBeCloseTo((270 * Math.PI) / 180);
		expect(SKILLS.cleave.damageMultiplier).toBe(0.3625);
		expect(SKILLS.cleave.cooldown).toBe(6);
		expect(cleaveCooldown(1)).toBe(6);
		expect(cleaveCooldown(99)).toBe(3);
		expect(
			skillCooldown(
				"cleave",
				generateItem(50, "epic", 91, { allowedClasses: ["axe"] }),
				{ ...ZERO_STATS, agility: 500, intelligence: 500 },
				1,
			),
		).toBe(6);
		expect(
			skillCooldown(
				"cleave",
				generateItem(50, "epic", 91, { allowedClasses: ["axe"] }),
				{ ...ZERO_STATS, agility: 500, intelligence: 500 },
				99,
			),
		).toBe(3);
		expect(skillImpactForceScale("cleave")).toBe(2);
		expect(skillImpactForceScale("bash")).toBe(1);
	});
});
test("scales Flurry cooldown directly from six to three seconds", () => {
	expect(flurryCooldown(1)).toBe(6);
	expect(flurryCooldown(99)).toBe(3);
	const dagger = generateItem(50, "epic", 37, { allowedClasses: ["dagger"] });
	const boosted = { ...ZERO_STATS, agility: 500, intelligence: 500 };
	expect(skillCooldown("flurry", dagger, boosted, 1)).toBe(6);
	expect(skillCooldown("flurry", dagger, boosted, 99)).toBe(3);
});
test("scales Bash cooldown directly from six to three seconds", () => {
	expect(bashCooldown(1)).toBe(6);
	expect(bashCooldown(50)).toBe(4.5);
	expect(bashCooldown(99)).toBe(3);
	const club = generateItem(50, "epic", 37, { allowedClasses: ["club"] });
	const boosted = { ...ZERO_STATS, agility: 500, intelligence: 500 };
	expect(skillCooldown("bash", club, boosted, 1)).toBe(6);
	expect(skillCooldown("bash", club, boosted, 99)).toBe(3);
});

test("scales Rending Throw pierce every third level after level two", () => {
	expect(SKILLS.rendingThrow.damageMultiplier).toBe(0.45);
	expect(RENDING_THROW_BLEED_DURATION).toBe(18);
	expect(rendingThrowPierce(1)).toBe(0);
	expect(rendingThrowTargetLimit(1)).toBe(1);
	expect(rendingThrowPierce(2)).toBe(1);
	expect(rendingThrowTargetLimit(2)).toBe(2);
	expect(rendingThrowPierce(4)).toBe(1);
	expect(rendingThrowPierce(5)).toBe(2);
	expect(rendingThrowPierce(8)).toBe(3);
	expect(rendingThrowPierce(99)).toBe(33);
	expect(rendingThrowTargetLimit(99)).toBe(34);
});
describe("Healing scaling", () => {
	test("scales healing and charges a level base plus mana per HP restored", () => {
		expect(healingFraction(1)).toBeCloseTo(0.4);
		expect(healingFraction(99)).toBeCloseTo(1);
		expect(healingFraction(100)).toBeCloseTo(1);
		expect(healingCooldown(1)).toBeCloseTo(18);
		expect(healingCooldown(99)).toBeCloseTo(6);
		expect(healingRadius(1)).toBe(150);
		expect(healingRadius(99)).toBe(600);
		expect(healingBaseManaCost(1)).toBe(7);
		expect(healingCast(40, 100, 0, 10, 1)).toEqual({
			restoredHp: 21,
			manaCost: 12.25,
		});
		expect(healingCast(40, 100, 10, 10, 1)).toEqual({
			restoredHp: 26,
			manaCost: 13.5,
		});
		expect(healingCast(49, 50, 1, 1, 99)).toEqual({
			restoredHp: 1,
			manaCost: 203.25,
		});
		expect(healingCast(49, 50, 1, 1, 100)).toEqual({
			restoredHp: 1,
			manaCost: 203.25,
		});
	});
});
test("does not divide base cooldown by Intelligence plus Agility", () => {
	expect(
		skillCooldown("fireBreath", starterClub(), {
			...ZERO_STATS,
			intelligence: 2,
			agility: 3,
		}),
	).toBeCloseTo(9);
	expect(skillCooldown("fireBreath", starterClub(), ZERO_STATS)).toBe(9);
	expect(cooldownScale(99, 1)).toBe(0.4);
});

test("floors every active and reactive spell at three seconds at level one and one second at level ninety-nine", () => {
	const weapon = { ...starterClub(), level: 50 };
	for (const skill of Object.values(SKILLS).filter(
		(definition) => !definition.passive,
	)) {
		expect(
			effectiveSkillCooldown(skill.id, weapon, ZERO_STATS, 1, 0.6),
		).toBeGreaterThanOrEqual(3);
		expect(
			effectiveSkillCooldown(skill.id, weapon, ZERO_STATS, 99, 0.6),
		).toBeGreaterThanOrEqual(1);
	}
	expect(spellCooldownFloor(1)).toBe(3);
	expect(spellCooldownFloor(99)).toBe(1);
	expect(effectiveSkillCooldown("healing", weapon, ZERO_STATS, 99, 0.6)).toBe(
		6,
	);
	expect(
		effectiveSkillCooldown("gravityPull", weapon, ZERO_STATS, 1, 0.6),
	).toBeGreaterThan(3);
});
test("registers configurable Spirit relic perks", () => {
	expect(SKILLS.fireBreath).toMatchObject({ enemyEligible: true, cost: 4 });
	expect(SKILLS.voodoo.passive).toBeTrue();
	expect(SKILLS.manaDrain.passive).toBeTrue();
	expect(SKILLS.manaDrain.label).toBe("Spirit Wounds");
	expect(SKILLS.manaDrain.upkeep).toBeUndefined();
	expect(SKILLS.manaDrain.description).toContain(
		"Critical damage from attacks, spells, projectiles, auras, reflection, statuses, and continuous effects",
	);
	expect(passiveSkillMetrics("manaDrain", 9, ZERO_STATS)).toEqual([
		{ label: "Mana + Cold", value: "2.96% crit damage" },
	]);
	expect(SKILLS.penance.passive).toBeTrue();
	expect(SKILLS.thorns.passive).toBeTrue();
	expect(SKILLS.penance.description).toContain(
		"blocked damage × Spirit × level conversion",
	);
	expect(passiveSkillMetrics("penance", 9, ZERO_STATS)).toEqual([
		{ label: "Conversion", value: "3.37%" },
	]);
	expect(passiveSkillMetrics("timeHarvest", 99, ZERO_STATS)).toEqual([
		{ label: "Cooldown removal", value: "2s / kill" },
	]);
	expect(SKILLS.rapidRegen).toMatchObject({ cost: 4, cooldown: 20 });
	expect(rapidRegenDuration(1)).toBe(10);
	expect(rapidRegenDuration(99)).toBe(30);
	expect(rapidRegenMultiplier(1)).toBeCloseTo(1.2);
	expect(rapidRegenMultiplier(99)).toBe(5);
	expect(manaConversionFraction(1)).toBeCloseTo(0.01);
	expect(manaConversionFraction(99)).toBeCloseTo(0.3);
	const perks = Array.from(
		{ length: 100 },
		(_, seed) => generateRelic(3, "rare", seed).skills,
	);
	expect(perks.some((skills) => skills.includes("fireBreath"))).toBeTrue();
	expect(perks.some((skills) => skills.includes("voodoo"))).toBeTrue();
	expect(perks.some((skills) => skills.includes("swamp"))).toBeTrue();
	expect(
		perks
			.filter((skills) => skills.includes("voodoo"))
			.every((skills) => skills.includes("swamp")),
	).toBeTrue();
	expect(perks.some((skills) => skills.includes("manaDrain"))).toBeTrue();
	expect(perks.some((skills) => skills.includes("penance"))).toBeTrue();
	expect(perks.some((skills) => skills.includes("rapidRegen"))).toBeTrue();
});
test("item skill rows reuse the skillbar descriptions", () => {
	expect(itemSkillDescription("reflectiveSurge")).toEqual({
		label: SKILLS.reflectiveSurge.label,
		description: SKILLS.reflectiveSurge.description,
		statBonuses: skillStatBonusDescription("reflectiveSurge"),
	});
});
test("scales Gooey Swamp exactly from its level-one to level-ninety-nine endpoints", () => {
	expect(swampRadius(1)).toBe(200);
	expect(swampRadius(99)).toBe(500);
	expect(swampCooldown(1)).toBe(45);
	expect(swampCooldown(99)).toBe(15);
	expect(skillRange("swamp", starterClub(), 99, 999)).toBe(500);
	expect(
		skillCooldown(
			"swamp",
			starterClub(),
			{ ...ZERO_STATS, intelligence: 99, agility: 99 },
			99,
		),
	).toBe(15);
});
test("connects WebSockets to the page origin unless server overrides it", () => {
	expect(
		gameSocketUrl({
			host: "localhost:3000",
			protocol: "http:",
			search: "",
		} as Location),
	).toBe("ws://localhost:3000/ws");
	expect(
		gameSocketUrl({
			host: "game.test",
			protocol: "https:",
			search: "",
		} as Location),
	).toBe("wss://game.test/ws");
	expect(
		gameSocketUrl({
			host: "localhost:3000",
			protocol: "http:",
			search: "?server=pvp.railway%3A443",
		} as Location),
	).toBe("wss://pvp.railway/ws");
	expect(
		gameSocketUrl({
			host: "localhost:3000",
			protocol: "http:",
			search: "?ip=pvp.up.railway.app",
		} as Location),
	).toBe("wss://pvp.up.railway.app/ws");
	expect(
		gameSocketUrl({
			host: "localhost:3000",
			protocol: "http:",
			search: "?server=preferred.test&ip=legacy.test",
		} as Location),
	).toBe("wss://preferred.test/ws");
	expect(
		gameSocketUrl({
			host: "localhost:3000",
			protocol: "http:",
			search: "?server=ws%3A%2F%2F192.168.0.13%3A3000",
		} as Location),
	).toBe("ws://192.168.0.13:3000/ws");
	expect(
		gameSocketUrl({
			host: "localhost:3000",
			protocol: "http:",
			search: "?server=https%3A%2F%2Fpvp.railway%2Fgame",
		} as Location),
	).toBe("wss://pvp.railway/game/ws");
	expect(
		gameSocketUrl({
			host: "localhost:3000",
			protocol: "http:",
			search: "?server=wss%3A%2F%2Fpvp.railway%2Fgame%2Fws%2F",
		} as Location),
	).toBe("wss://pvp.railway/game/ws");
	expect(
		gameSocketUrl({
			host: "localhost:3000",
			protocol: "http:",
			search: "?server=ftp%3A%2F%2Fbad.test",
		} as Location),
	).toBe("ws://localhost:3000/ws");
});
test("uses the production WebSocket shortcut unless an explicit endpoint is provided", () => {
	expect(
		gameSocketUrl({
			host: "localhost:3000",
			protocol: "http:",
			search: "?prod",
		} as Location),
	).toBe("wss://pvp.up.railway.app/ws");
	expect(
		gameSocketUrl({
			host: "localhost:3000",
			protocol: "http:",
			search: "?prod&server=override.test",
		} as Location),
	).toBe("wss://override.test/ws");
	expect(
		gameSocketUrl({
			host: "localhost:3000",
			protocol: "http:",
			search: "?prod&ip=legacy.test",
		} as Location),
	).toBe("wss://legacy.test/ws");
});

test("maps unmodified character and inventory panel shortcuts", () => {
	expect(panelShortcut("c")).toBe("character");
	expect(panelShortcut("C")).toBe("character");
	expect(panelShortcut("i")).toBe("inventory");
	expect(panelShortcut("I")).toBe("inventory");
	expect(panelShortcut("v")).toBe("inventory");
	expect(panelShortcut("V")).toBe("inventory");
	expect(panelShortcut("x")).toBeUndefined();
	expect(panelShortcut("c", true)).toBeUndefined();
});

test("describes panel toggle actions with their primary shortcuts", () => {
	expect(panelToggleTooltip("character", false)).toBe(
		"Collapse character sheet (C)",
	);
	expect(panelToggleTooltip("character", true)).toBe(
		"Expand character sheet (C)",
	);
	expect(panelToggleTooltip("inventory", false)).toBe("Collapse inventory (V)");
	expect(panelToggleTooltip("inventory", true)).toBe("Expand inventory (V)");
});
