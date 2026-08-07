/** @jsx h */
import {
	bucklerBlockCost,
	effectiveSkillCooldown,
	skillStatBonusDescription,
	weaponAttackSpeed,
	weaponDamage,
	weaponSkillTriggerChance,
} from "../../common/combat";
import { SKILLS } from "../../common/content";
import {
	itemRequirementMultiplier,
	ITEM_PERKS,
	RARITY_POWER,
	type ItemInstance,
	type SkillId,
} from "../../common/items";
import { derivedStats, STAT_KEYS, type Stats } from "../../common/progression";
import { pixelsToMeters } from "../../common/units";
import { h } from "./dom";
import { formatProjectedValue, previewTone, type PreviewTone } from "./preview";

export function itemDetails(
	item: ItemInstance,
	effectiveStats: Stats,
	baselineItem?: ItemInstance,
	baselineStats?: Stats,
	showRequirementPenalty = false,
	statDeltas = false,
): HTMLElement {
	const displayStats = requirementDisplayStats(
		item,
		effectiveStats,
		showRequirementPenalty,
	);
	const baselineDisplayStats = baselineItem
		? requirementDisplayStats(
				baselineItem,
				baselineStats ?? effectiveStats,
				showRequirementPenalty,
			)
		: displayStats;
	const attacks = item.itemKind === "weapon";
	const damage = attacks ? weaponDamage(item, displayStats) : undefined;
	const attackSpeed = attacks
		? weaponAttackSpeed(item, displayStats)
		: undefined;
	const effectiveness = itemRequirementMultiplier(item, effectiveStats);
	const requirements = itemRequirementRows(item, effectiveStats, baselineItem);
	const effects = itemEffectSummary(
		item,
		displayStats,
		baselineItem,
		baselineDisplayStats,
		statDeltas,
	);
	const baselineDamage =
		baselineItem?.itemKind === "weapon"
			? weaponDamage(baselineItem, baselineDisplayStats)
			: undefined;
	const baselineSpeed =
		baselineItem?.itemKind === "weapon"
			? weaponAttackSpeed(baselineItem, baselineDisplayStats)
			: undefined;
	const baselineEffects = baselineItem
		? itemEffectSummary(baselineItem, baselineDisplayStats)
		: effects;
	const requirementText = requirements
		.map(
			(requirement) =>
				`${capitalize(requirement.key)} ${formatProjectedValue(requirement, fmt)}`,
		)
		.join(", ");
	return (
		<div class="equipment-details">
			{damage === undefined ? null : (
				<span>
					<small>Attack</small>
					{detailValue(baselineDamage ?? damage, damage, fmt)}
				</span>
			)}
			{attackSpeed === undefined ? null : (
				<span>
					<small>Attack speed</small>
					{detailValue(
						baselineSpeed ?? attackSpeed,
						attackSpeed,
						(value) => `${fmt(value)}/s`,
					)}
				</span>
			)}
			{attacks ? (
				<span>
					<small>Rage cost</small>
					{detailValue(
						baselineItem?.rageCost ?? item.rageCost,
						item.rageCost,
						precise,
					)}
				</span>
			) : null}
			{item.weight > 0 ? (
				<span>
					<small>Weight</small>
					<b>{item.weight}</b>
				</span>
			) : null}
			{effects.length || baselineEffects.length ? (
				<span class="equipment-detail-wide">
					<small>Effects</small>
					{effectList(baselineEffects, effects, statDeltas)}
				</span>
			) : null}
			{item.skills.length ? (
				<span class="equipment-detail-wide">
					<small>Skills</small>
					{skillList(
						baselineItem ?? item,
						item,
						baselineDisplayStats,
						displayStats,
					)}
				</span>
			) : null}
			{requirements.length ? (
				<span
					class={`equipment-detail-wide requirement-detail${effectiveness < 1 ? " is-unmet" : ""}`}
				>
					<small>Requirements</small>
					<span class="tile-text-anchor" tabindex="0">
						<b class="requirement-values">
							{requirements.map((requirement, index) => (
								<span
									class={`requirement-value${requirement.unmet ? " is-unmet" : requirement.currentVal !== requirement.newVal ? " is-gain-preview" : ""}`}
								>
									{index ? ", " : ""}
									{capitalize(requirement.key)}{" "}
									{formatProjectedValue(requirement, fmt)}
								</span>
							))}
						</b>
						<span class="tile-text-tooltip" role="tooltip">
							{requirementText}
						</span>
					</span>
					{effectiveness < 1 ? (
						<em tabindex="0">
							{precise((1 - effectiveness) * 100)}% penalty to item stats
						</em>
					) : null}
				</span>
			) : null}
			<span class="equipment-detail-wide">
				<small>Equip slot</small>
				<b>{equipSlotLabel(item)}</b>
			</span>
		</div>
	) as HTMLElement;
}

export function requirementMetStats(item: ItemInstance, stats: Stats): Stats {
	return Object.fromEntries(
		STAT_KEYS.map((key) => [
			key,
			Math.max(stats[key], item.requirements[key] ?? 0),
		]),
	) as Stats;
}

export function requirementDisplayStats(
	item: ItemInstance,
	stats: Stats,
	showRequirementPenalty: boolean,
): Stats {
	return showRequirementPenalty ? stats : requirementMetStats(item, stats);
}

export function bindRequirementPreview(
	details: HTMLElement,
	item: ItemInstance,
	stats: Stats,
): void {
	const trigger = details.querySelector<HTMLElement>(
		".requirement-detail.is-unmet em",
	);
	if (!trigger) return;
	const projected = itemDetails(item, stats, item, stats, true);
	const labels = new Map(
		[...projected.querySelectorAll<HTMLElement>("small")].map((label) => [
			label.textContent,
			label,
		]),
	);
	const originals = [...details.querySelectorAll<HTMLElement>("small")]
		.filter((label) => label.textContent !== "Requirements")
		.map((label) => {
			const value = label.nextElementSibling as HTMLElement | null;
			const next = labels.get(label.textContent)
				?.nextElementSibling as HTMLElement | null;
			return value && next
				? { value, html: value.innerHTML, className: value.className, next }
				: undefined;
		})
		.filter(Boolean) as Array<{
		value: HTMLElement;
		html: string;
		className: string;
		next: HTMLElement;
	}>;
	const show = (): void => {
		for (const entry of originals) {
			entry.value.innerHTML = entry.next.innerHTML;
			entry.value.className = entry.next.className;
		}
	};
	const restore = (): void => {
		for (const entry of originals) {
			entry.value.innerHTML = entry.html;
			entry.value.className = entry.className;
		}
	};
	trigger.onmouseenter = show;
	trigger.onmouseleave = restore;
	trigger.onfocus = show;
	trigger.onblur = restore;
}

export function itemRequirementRows(
	item: ItemInstance,
	stats: Stats,
	baselineItem?: ItemInstance,
): Array<{
	key: (typeof STAT_KEYS)[number];
	currentVal: number;
	newVal: number;
	unmet: boolean;
}> {
	return STAT_KEYS.filter(
		(key) =>
			(item.requirements[key] ?? 0) > 0 ||
			(baselineItem?.requirements[key] ?? 0) > 0,
	).map((key) => {
		const newVal = item.requirements[key] ?? 0;
		return {
			key,
			currentVal: baselineItem?.requirements[key] ?? newVal,
			newVal,
			unmet: newVal > stats[key],
		};
	});
}

function detailValue(
	currentVal: number,
	newVal: number,
	format: (value: number) => string,
): HTMLElement {
	const tone = previewTone({ currentVal, newVal });
	return (
		<b
			class={
				tone === "gain"
					? "is-gain-preview"
					: tone === "cost"
						? "is-cost-preview"
						: ""
			}
		>
			{formatProjectedValue({ currentVal, newVal }, format)}
		</b>
	) as HTMLElement;
}
export interface EffectRow {
	key: string;
	text: string;
	tone: PreviewTone;
}

export function statBonusDeltaRows(
	item: ItemInstance,
	effectiveStats: Stats,
	baselineItem: ItemInstance,
	baselineStats: Stats,
): EffectRow[] {
	const effectiveness = itemRequirementMultiplier(item, effectiveStats);
	const baselineEffectiveness = itemRequirementMultiplier(
		baselineItem,
		baselineStats,
	);
	const rows: EffectRow[] = [];
	for (const key of STAT_KEYS) {
		const scaled = (item.statBonuses[key] ?? 0) * effectiveness;
		const baseScaled =
			(baselineItem.statBonuses[key] ?? 0) * baselineEffectiveness;
		if (baseScaled === 0 && scaled === 0) continue;
		const delta = scaled - baseScaled;
		rows.push({
			key: `stat:${key}`,
			text:
				delta > 0
					? `+${fmt(delta)} ${capitalize(key)}`
					: delta < 0
						? `-${fmt(-delta)} ${capitalize(key)}`
						: `+${fmt(scaled)} ${capitalize(key)}`,
			tone: delta > 0 ? "gain" : delta < 0 ? "cost" : "same",
		});
	}
	return rows;
}

function effectList(
	current: EffectRow[],
	projected: EffectRow[],
	statDeltas = false,
): HTMLElement {
	const currentByKey = new Map(current.map((row) => [row.key, row]));
	const rows = projected.map((row) => {
		const baseline = currentByKey.get(row.key);
		const tone =
			row.tone !== "same"
				? row.tone
				: !baseline
					? "gain"
					: baseline.text !== row.text
						? "gain"
						: "same";
		return { row, tone };
	});
	const projectedKeys = new Set(projected.map((row) => row.key));
	const removed = statDeltas
		? current.filter((row) => !projectedKeys.has(row.key))
		: [];
	return (
		<ul class="item-effect-list">
			{rows.map(({ row, tone }) => (
				<li
					class={
						tone === "gain"
							? "is-gain-preview"
							: tone === "cost"
								? "is-cost-preview"
								: ""
					}
					tabindex="0"
				>
					<span>{row.text}</span>
					<span class="tile-text-tooltip" role="tooltip">
						{row.text}
					</span>
				</li>
			))}
			{removed.map((row) => (
				<li class="is-cost-preview" tabindex="0">
					<span>{row.text}</span>
					<span class="tile-text-tooltip" role="tooltip">
						{row.text}
					</span>
				</li>
			))}
		</ul>
	) as HTMLElement;
}
function skillList(
	currentItem: ItemInstance,
	projectedItem: ItemInstance,
	currentStats: Stats,
	projectedStats: Stats,
): HTMLElement {
	const baseline = currentItem.skills.map((skill) =>
		itemSkillLabel(currentItem, skill, currentStats),
	);
	return (
		<ul class="item-effect-list item-skill-list">
			{projectedItem.skills.map((skill, index) => {
				const row = itemSkillDescription(skill);
				const label = itemSkillLabel(projectedItem, skill, projectedStats);
				return (
					<li
						class={baseline[index] !== label ? "is-gain-preview" : ""}
						data-skill-id={skill}
						tabindex="0"
					>
						<span>{label}</span>
						<span class="tile-text-tooltip item-skill-tooltip" role="tooltip">
							<b>{row.label}</b>
							<span>{row.description}</span>
							{row.statBonuses ? <span>{row.statBonuses}</span> : null}
						</span>
					</li>
				);
			})}
		</ul>
	) as HTMLElement;
}
export function itemSkillLabel(
	item: ItemInstance,
	skill: SkillId,
	stats: Stats,
): string {
	const label = SKILLS[skill].label;
	if (item.itemKind !== "weapon" || SKILLS[skill].passive) return label;
	const cooldown = effectiveSkillCooldown(
		skill,
		item,
		stats,
		1,
		derivedStats(stats).cooldownReduction,
	);
	return `${label} (${Math.round(weaponSkillTriggerChance(cooldown) * 100)}%)`;
}
export function itemSkillDescription(skill: SkillId): {
	label: string;
	description: string;
	statBonuses?: string;
} {
	return {
		label: SKILLS[skill].label,
		description: SKILLS[skill].description,
		statBonuses: skillStatBonusDescription(skill) || undefined,
	};
}
function itemEffectSummary(
	item: ItemInstance,
	effectiveStats: Stats,
	baselineItem?: ItemInstance,
	baselineStats?: Stats,
	statDeltas = false,
): EffectRow[] {
	const effects: EffectRow[] = [];
	const effectiveness = itemRequirementMultiplier(item, effectiveStats);
	const push = (
		key: string,
		text: string,
		tone: PreviewTone = "same",
	): void => {
		effects.push({ key, text, tone });
	};
	for (const affix of item.affixes) push(`affix:${affix}`, capitalize(affix));
	if (item.blockChance > 0) {
		push("block", `${precise(item.blockChance * effectiveness * 100)}% block`);
		push(
			"blockcost",
			`${fmt(bucklerBlockCost(item, effectiveStats))} rage/block`,
		);
	}
	if (item.attractionSpeed > 0)
		push(
			"attraction",
			`Attraction ${fmt(
				pixelsToMeters(item.attractionSpeed * effectiveness),
			)} m/s`,
		);
	if (item.modifiers.critChance > 0)
		push(
			"crit",
			`${precise(item.modifiers.critChance * effectiveness * 100)}% crit`,
		);
	if (item.modifiers.bleedChance > 0)
		push(
			"bleed",
			`${precise(item.modifiers.bleedChance * effectiveness * 100)}% bleed`,
		);
	if (item.modifiers.poisonChance > 0)
		push(
			"poison",
			`${precise(item.modifiers.poisonChance * effectiveness * 100)}% poison`,
		);
	if (item.modifiers.stunChance > 0)
		push(
			"stun",
			`${precise(item.modifiers.stunChance * effectiveness * 100)}% stun`,
		);
	if (item.modifiers.magicAmp > 0)
		push(
			"magic",
			`+${precise(item.modifiers.magicAmp * effectiveness * 100)}% magic`,
		);
	if (item.modifiers.lifeStealBase > 0)
		push(
			"lifesteal",
			`${precise(item.modifiers.lifeStealBase * effectiveness * 100)}% + 0.1%/Spirit life steal`,
		);
	if (item.modifiers.strengthRegenMultiplier > 0)
		push(
			"vigorous",
			`Vigorous regen: 0.01 + ${precise(item.modifiers.strengthRegenMultiplier * effectiveness)}× Strength/s`,
		);
	if (item.modifiers.goldGain > 0)
		push(
			"gold",
			`+${precise(item.modifiers.goldGain * effectiveness * 100)}% Gold gain`,
		);
	if (item.modifiers.rarityBoost > 0)
		push(
			"rarity",
			`+${precise(item.modifiers.rarityBoost * effectiveness * 100)}% Rarity boost`,
		);
	if (item.reflectionComponents.length) {
		const power = RARITY_POWER[item.rarity];
		const parts: string[] = [];
		if (item.reflectionComponents.includes("flat"))
			parts.push(`${fmt(1 * power)}`);
		if (item.reflectionComponents.includes("strength"))
			parts.push(`${fmt(0.2 * effectiveStats.strength * power)} (20%×STR)`);
		if (item.reflectionComponents.includes("return"))
			parts.push(
				`${precise((0.15 + 0.004 * effectiveStats.agility) * power * 100)}% of incoming (15%+0.4%×AGI)`,
			);
		push("reflection", `Reflect on block: ${parts.join(" + ")}`);
	}
	const accessory = item.accessoryBonuses;
	if ((accessory?.healthOnKill ?? 0) > 0)
		push(
			"healthOnKill",
			`${fmt(accessory!.healthOnKill! * effectiveness)} HP on kill`,
		);
	if ((accessory?.manaOnKill ?? 0) > 0)
		push(
			"manaOnKill",
			`${fmt(accessory!.manaOnKill! * effectiveness)} Mana on kill`,
		);
	if ((accessory?.manaSkillLevels ?? 0) > 0)
		push("manaSkillLevels", `+${accessory!.manaSkillLevels} Mana skill levels`);
	if ((accessory?.rageSkillLevels ?? 0) > 0)
		push("rageSkillLevels", `+${accessory!.rageSkillLevels} Rage skill levels`);
	if ((accessory?.allSkillLevels ?? 0) > 0)
		push("allSkillLevels", `+${accessory!.allSkillLevels} All skill levels`);
	if ((accessory?.globalCooldownReduction ?? 0) > 0)
		push(
			"gcd",
			`${precise(accessory!.globalCooldownReduction! * effectiveness * 100)}% global cooldown reduction`,
		);
	if ((accessory?.manaCostReduction ?? 0) > 0)
		push(
			"manaCost",
			`${precise(accessory!.manaCostReduction! * effectiveness * 100)}% Mana cost reduction`,
		);
	if ((accessory?.lifeCostReduction ?? 0) > 0)
		push(
			"lifeCost",
			`${precise(accessory!.lifeCostReduction! * effectiveness * 100)}% Life cost reduction`,
		);
	for (const [kind, fraction] of Object.entries(
		accessory?.physicalDamage ?? {},
	))
		push(
			`physical:${kind}`,
			`+${precise((fraction ?? 0) * effectiveness * 100)}% ${capitalize(kind)} damage on physical hits`,
		);
	if (statDeltas && baselineItem) {
		effects.push(
			...statBonusDeltaRows(
				item,
				effectiveStats,
				baselineItem,
				baselineStats ?? effectiveStats,
			),
		);
	} else {
		for (const key of STAT_KEYS) {
			const bonus = item.statBonuses[key] ?? 0;
			if (bonus !== 0)
				push(
					`stat:${key}`,
					`+${fmt(bonus * effectiveness)} ${capitalize(key)}`,
				);
		}
	}
	for (const key of ITEM_PERKS)
		if ((item.perks?.[key] ?? 0) > 0)
			push(
				`perk:${key}`,
				`${capitalize(key.replace(/([A-Z])/g, " $1"))} ${key === "defense" ? fmt(item.perks![key]! * effectiveness) : `${precise(item.perks![key]! * effectiveness * 100)}%`}`,
			);
	for (const immunity of item.immunities ?? [])
		push(
			`immune:${immunity}`,
			effectiveness === 1
				? `Immune to ${capitalize(immunity)}`
				: `${capitalize(immunity)} immunity inactive`,
		);
	return effects;
}
function fmt(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
function precise(value: number): string {
	return Number(value.toFixed(2)).toString();
}
function capitalize(value: string): string {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
function equipSlotLabel(item: ItemInstance): string {
	return item.itemKind === "weapon"
		? "Main hand"
		: item.itemKind === "amulet"
			? "Amulet"
			: item.itemKind === "charm"
				? "Charm"
				: "Offhand";
}
