import { rapidRegenMultiplier } from "../../common/combat";
import { percent, trimTo2Decimals } from "../../common/format";
import type { ItemInstance, SkillId } from "../../common/items";
import type { PlayerProgress } from "../../common/protocol";
import type { Stats } from "../../common/progression";
import {
	projectUnitState,
	RapidRegenerationEffect,
	ReflectiveSurgeEffect,
	ThornsEffect,
	type UnitEffect,
} from "../../common/unitState";
import { pixelsToMeters } from "../../common/units";
import { effectiveSkillLevel } from "../game/systems/HeroCombatSystem";
import type { PlayerState } from "../game/types";
import { h } from "./dom";
import { formatPreviewValue, previewTone } from "./preview";

export interface ActiveStatBuffs {
	reflectiveSurge?: { level: number };
	rapidRegen?: { multiplier: number; flat: number };
}

export function hasThornsSkill(
	learnedSkills: SkillId[],
	items: Array<ItemInstance | undefined>,
): boolean {
	return (
		learnedSkills.includes("thorns") ||
		items.some((item) => item?.skills.includes("thorns"))
	);
}

export function activeStatBuffs(
	player: PlayerState | undefined,
	progress: PlayerProgress,
): ActiveStatBuffs | undefined {
	const buffs: ActiveStatBuffs = {};
	if ((player?.reflectiveSurgeRemaining ?? 0) > 0) {
		const level = effectiveSkillLevel(progress, "reflectiveSurge");
		if (level > 0) buffs.reflectiveSurge = { level };
	}
	if ((player?.rapidRegenRemaining ?? 0) > 0) {
		const level = effectiveSkillLevel(progress, "rapidRegen");
		if (level > 0)
			buffs.rapidRegen = {
				multiplier: rapidRegenMultiplier(level),
				flat: 0.1,
			};
	}
	return buffs.reflectiveSurge || buffs.rapidRegen ? buffs : undefined;
}

export function statEffects(
	buffs: ActiveStatBuffs | undefined,
	thornsActive: boolean,
): UnitEffect[] {
	const effects: UnitEffect[] = [];
	if (thornsActive) effects.push(new ThornsEffect());
	if (buffs?.reflectiveSurge)
		effects.push(
			new ReflectiveSurgeEffect(
				buffs.reflectiveSurge.level,
				Number.POSITIVE_INFINITY,
			),
		);
	if (buffs?.rapidRegen)
		effects.push(
			new RapidRegenerationEffect(
				buffs.rapidRegen.multiplier,
				buffs.rapidRegen.flat,
				Number.POSITIVE_INFINITY,
			),
		);
	return effects;
}

export function effectiveStatRows(
	main: ItemInstance | undefined,
	off: ItemInstance | undefined,
	amulet: ItemInstance | undefined,
	charm: ItemInstance | undefined,
	stats: Stats,
	maxHp?: number,
	blockingLevel = 0,
	attractionLevel = 0,
	buffs?: ActiveStatBuffs,
	thornsActive = false,
): Array<[string, string]> {
	const buckler = off?.itemKind === "buckler" ? off : undefined;
	const effects = statEffects(buffs, thornsActive);
	const state = projectUnitState({
		baseStats: stats,
		attributesAreEffective: true,
		mainHand: main,
		offHand: off,
		amulet,
		charm,
		blockingLevel,
		attractionLevel,
		effects,
	});
	const reflection = state.reflection;
	const surge = buffs?.reflectiveSurge;
	return [
		["Damage", trimTo2Decimals(state.attack.damage)],
		["Attacks/s", trimTo2Decimals(state.attack.attacksPerSecond)],
		["Attack cost", `${trimTo2Decimals(state.attack.rageCost)} rage`],
		[
			"Attack range",
			`${trimTo2Decimals(pixelsToMeters(state.attack.range))} m`,
		],
		["Crit chance", percent(state.critChance)],
		["Crit damage", percent(state.critMultiplier)],
		["Magic amp", percent(Math.max(0, state.magicAmp - 1))],
		["Cooldown reduction", percent(state.cooldownReduction)],
		["Turn speed", `${trimTo2Decimals(state.turnSpeedDegrees)}°/s`],
		[
			"Spell range/Lv",
			`+${trimTo2Decimals(pixelsToMeters(0.5 * state.attributes.spirit))} m`,
		],
		["Spell power/Lv", "+15%"],
		["Max health", trimTo2Decimals(maxHp ?? state.maxHp)],
		["Max rage", trimTo2Decimals(state.maxRage)],
		["Max mana", trimTo2Decimals(state.maxMana)],
		["Defense", trimTo2Decimals(state.defense)],
		["Dodge chance", percent(state.dodgeChance)],
		[
			"Physical resist",
			state.immunities.has("physical")
				? "Immune"
				: percent(state.resistances.physical),
		],
		[
			"Magic resist",
			state.immunities.has("magic")
				? "Immune"
				: percent(state.resistances.magic),
		],
		[
			"Fire resist",
			state.immunities.has("fire") ? "Immune" : percent(state.resistances.fire),
		],
		[
			"Frost resist",
			state.immunities.has("frost")
				? "Immune"
				: percent(state.resistances.frost),
		],
		[
			"Poison resist",
			state.immunities.has("poison")
				? "Immune"
				: percent(state.resistances.poison),
		],
		[
			"Bleed resist",
			state.immunities.has("bleed")
				? "Immune"
				: percent(state.resistances.bleed),
		],
		[
			"Block chance",
			percent(Math.min(state.blockChanceCap, state.blockChance)),
		],
		[
			"Block cost",
			buckler?.rarity === "unique"
				? "1% max mana; no cooldown; +1 rage"
				: buckler
					? `${trimTo2Decimals(state.blockCost)} rage`
					: "0",
		],
		["Health regen", `${trimTo2Decimals(state.healthRegen)}/s`],
		["Mana regen", `${trimTo2Decimals(state.manaRegen)}/s`],
		["Rage decay", `−${trimTo2Decimals(state.rageDecay)}/s`],
		["Bonus XP", percent(state.bonusXp)],
		["HP on kill", trimTo2Decimals(state.healthOnKill)],
		["Mana on kill", trimTo2Decimals(state.manaOnKill)],
		["Life steal", percent(state.lifeSteal)],
		["Mana cost reduction", percent(state.manaCostReduction)],
		["Life cost reduction", percent(state.lifeCostReduction)],
		["Bleed chance", percent(state.bleedChance)],
		["Poison chance", percent(state.poisonChance)],
		["Stun chance", percent(state.stunChance)],
		["Gold gain", percent(state.goldGain)],
		["Magic find", percent(state.magicFind)],
		["Attraction Gold find", percent(state.attractionGoldFind)],
		[
			"Attraction",
			`${trimTo2Decimals(pixelsToMeters(state.attractionSpeed))} m/s`,
		],
		[
			"Reflection",
			buckler?.reflectionComponents.length || thornsActive
				? (() => {
						const parts: string[] = [];
						if (buckler?.reflectionComponents.includes("flat"))
							parts.push(trimTo2Decimals(reflection.flat));
						if (buckler?.reflectionComponents.includes("strength"))
							parts.push(`${trimTo2Decimals(reflection.strength)} (20%×STR)`);
						if (buckler?.reflectionComponents.includes("return"))
							parts.push(
								`${trimTo2Decimals(reflection.incomingFraction * 100)}% inc. (15%+0.4%×AGI)`,
							);
						if (thornsActive)
							parts.push(
								`${trimTo2Decimals(reflection.thornsFraction * 100)}% inc. (Thorns)`,
							);
						if (surge) parts.push("1% inc. (Surge)");
						return `Reflect: ${parts.join(" + ")}${surge ? " · 2× Surge" : ""}`;
					})()
				: "None",
		],
	];
}

export function effectiveStatSheet(
	main: ItemInstance | undefined,
	off: ItemInstance | undefined,
	amulet: ItemInstance | undefined,
	charm: ItemInstance | undefined,
	stats: Stats,
	baseline?: Array<[string, string]>,
	maxHp?: number,
	blockingLevel = 0,
	attractionLevel = 0,
	buffs?: ActiveStatBuffs,
	thornsActive = false,
): HTMLElement {
	const previous = new Map(baseline);
	const rows = effectiveStatRows(
		main,
		off,
		amulet,
		charm,
		stats,
		maxHp,
		blockingLevel,
		attractionLevel,
		buffs,
		thornsActive,
	);
	const offensive = new Set([
		"Damage",
		"Attacks/s",
		"Attack cost",
		"Attack range",
		"Crit chance",
		"Crit damage",
		"Magic amp",
		"Bleed chance",
		"Poison chance",
		"Stun chance",
	]);
	const defensive = new Set([
		"Max health",
		"Max rage",
		"Defense",
		"Dodge chance",
		"Physical resist",
		"Magic resist",
		"Fire resist",
		"Frost resist",
		"Poison resist",
		"Bleed resist",
		"Block chance",
		"Block cost",
		"Reflection",
	]);
	const groups: Array<[string, (label: string) => boolean]> = [
		["Offensive", (label) => offensive.has(label)],
		["Defensive", (label) => defensive.has(label)],
		["Utility", (label) => !offensive.has(label) && !defensive.has(label)],
	];
	const renderRow = ([label, newValue]: [string, string]) => {
		const currentVal = previous.get(label) ?? newValue;
		const changed = Boolean(baseline && currentVal !== newValue);
		const lowerIsBetter = label === "Attack cost" || label === "Block cost";
		const currentNumber = Number.parseFloat(currentVal);
		const newNumber = Number.parseFloat(newValue);
		const tone = !changed
			? "same"
			: Number.isFinite(currentNumber) && Number.isFinite(newNumber)
				? previewTone(
						{ currentVal: currentNumber, newVal: newNumber },
						!lowerIsBetter,
					)
				: "gain";
		return (
			<span>
				<small>{label}</small>
				<b
					class={
						tone === "gain"
							? "is-gain-preview"
							: tone === "cost"
								? "is-cost-preview"
								: ""
					}
				>
					{formatPreviewValue({
						currentVal,
						newVal: baseline ? newValue : currentVal,
					})}
				</b>
			</span>
		);
	};
	return (
		<div class={`combat-stat-grid${baseline ? " is-previewing" : ""}`}>
			{groups.map(([title, includes]) => (
				<section class="combat-stat-group">
					<strong>{title}</strong>
					<div class="combat-stat-section">
						{rows.filter(([label]) => includes(label)).map(renderRow)}
					</div>
				</section>
			))}
		</div>
	) as HTMLElement;
}

export const SOULS_TOOLTIP =
	"Purge Unique items to earn Souls. Every real death removes up to 1 Soul; a player killer always gains 1 Soul, even when the defeated player has none. Spend Souls to upgrade Unique items or reroll item properties.";
export const GOLD_TOOLTIP =
	"Used with matching Scrap to upgrade non-Unique items.";
export const scrapTooltip = (rarity: string): string =>
	`${rarity} Scrap is used with Gold to upgrade ${rarity} items.`;

export function currencyCell(
	label: string,
	value: number,
	kind: string,
	tooltip?: string,
): HTMLElement {
	return (
		<div
			class={`currency-cell currency-${kind}${tooltip ? " has-tooltip" : ""}`}
			data-currency={kind}
			tabindex={tooltip ? "0" : undefined}
			aria-label={tooltip ? `${label}. ${tooltip}` : undefined}
		>
			<small>{label}</small>
			<strong>{value}</strong>
			{tooltip ? <span role="tooltip">{tooltip}</span> : null}
		</div>
	) as HTMLElement;
}
