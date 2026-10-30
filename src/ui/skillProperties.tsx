import { BALANCE } from "../../common/balance";
import {
	auraRadius,
	auraSlowMultiplier,
	sunburnFraction,
	sunburnInterval,
	thunderDamage,
	thunderInterval,
} from "../../common/auras";
import {
	attackProfile,
	attractionFindBonus,
	attractionSpeedMultiplier,
	blizzardDuration,
	blizzardProjectilesPerSecond,
	blizzardRadius,
	bucklerBlockCost,
	effectiveSkillCooldown,
	healingFraction,
	manaConversionFraction,
	manaShieldConversionFraction,
	MAX_SKILL_LEVEL,
	orbitingHammerDuration,
	RENDING_THROW_BLEED_DURATION,
	rapidRegenDuration,
	rapidRegenMultiplier,
	reflectiveSurgeBlockChanceBonus,
	reflectiveSurgeDuration,
	rendingThrowPierce,
	rendingThrowTargetLimit,
	skillCastTime,
	skillDamagePreview,
	skillRange,
	skillUpkeepPerSecond,
	spiritWoundsConversionFraction,
	timeHarvestCooldownReduction,
	type SkillDamagePreview,
	voodooPoisonMultiplier,
	weaponSkillTriggerChance,
	whirlwindDuration,
	whirlwindMovementSpeed,
} from "../../common/combat";
import { SKILLS } from "../../common/content";
import { capitalize, trimTo2Decimals } from "../../common/format";
import {
	itemCooldownReduction,
	statsWithItemBonuses,
	type SkillId,
} from "../../common/items";
import { derivedStats, type Stats } from "../../common/progression";
import type { PlayerProgress } from "../../common/protocol";
import { pixelsToMeters } from "../../common/units";
import { resourceReduction } from "../game/systems/HeroCombatSystem";
import { h } from "./dom";
import type { SpellSlot } from "./types";

export function formatSkillDamage(damage: SkillDamagePreview): string {
	if (damage.kind === "multiplier") return `${trimTo2Decimals(damage.value)}×`;
	if (damage.kind === "flat")
		return `${trimTo2Decimals(damage.value)} ${damage.detail}`;
	return `${trimTo2Decimals(damage.value * 100)}% ${damage.detail}`;
}

export function passiveSkillMetrics(
	skill: SkillId,
	level: number,
	stats?: Stats,
): Array<{ label: string; value: string }> {
	const effectiveStats = stats ?? {
		strength: 0,
		agility: 0,
		magic: 0,
		spirit: 0,
		intelligence: 0,
	};
	const radius = (): { label: string; value: string } => ({
		label: "Radius",
		value: `${trimTo2Decimals(pixelsToMeters(auraRadius(level, effectiveStats.spirit)))} m`,
	});
	switch (skill) {
		case "manaShield":
			return [
				{
					label: "Damage to Mana",
					value: `${trimTo2Decimals(manaShieldConversionFraction(level) * 100)}%`,
				},
			];
		case "attraction":
			return [
				{
					label: "Pull speed",
					value: `${trimTo2Decimals(
						pixelsToMeters(35 * attractionSpeedMultiplier(level)),
					)} m/s`,
				},
				{
					label: "Magic find",
					value: `+${trimTo2Decimals(attractionFindBonus(level) * 100)}%`,
				},
				{
					label: "Gold find",
					value: `+${trimTo2Decimals(attractionFindBonus(level) * 100)}%`,
				},
			];
		case "manaDrain":
			return [
				{
					label: "Mana + Cold",
					value: `${trimTo2Decimals(spiritWoundsConversionFraction(level) * 100)}% crit damage`,
				},
			];
		case "penance":
			return [
				{
					label: "Conversion",
					value: `${trimTo2Decimals(manaConversionFraction(level) * 100)}%`,
				},
				{ label: "Minimum return", value: "1% max Mana" },
			];
		case "blocking":
			return [
				{
					label: "Base block chance",
					value: `+${trimTo2Decimals(level * 0.5)}%`,
				},
			];
		case "thorns":
			return [{ label: "Damage returned", value: "5%" }];
		case "voodoo":
			return [
				{
					label: "Poison damage",
					value: `+${trimTo2Decimals((voodooPoisonMultiplier(level, effectiveStats.spirit) - 1) * 100)}%`,
				},
			];
		case "slowAura":
			return [
				{
					label: "Enemy movement",
					value: `${trimTo2Decimals(auraSlowMultiplier(level) * 100)}%`,
				},
				radius(),
			];
		case "hinderingAura":
			return [
				{
					label: "Enemy attack speed",
					value: `${trimTo2Decimals(auraSlowMultiplier(level) * 100)}%`,
				},
				radius(),
			];
		case "deathBurst":
			return [
				{ label: "Burst damage", value: "20% enemy HP" },
				{
					label: "Blast radius",
					value: `${trimTo2Decimals(
						pixelsToMeters(auraRadius(level, effectiveStats.spirit) * 0.45),
					)} m`,
				},
				radius(),
			];
		case "sunburnAura":
			return [
				{
					label: "Damage / pulse",
					value: `${trimTo2Decimals(sunburnFraction(effectiveStats.intelligence) * 100)}% enemy HP`,
				},
				{
					label: "Pulse interval",
					value: `${trimTo2Decimals(sunburnInterval(effectiveStats.spirit))}s`,
				},
				radius(),
			];
		case "thunderAura":
			return [
				{
					label: "Lightning damage",
					value: trimTo2Decimals(thunderDamage(effectiveStats.intelligence)),
				},
				{
					label: "Pulse interval",
					value: `${trimTo2Decimals(thunderInterval(level))}s`,
				},
				radius(),
			];
		case "timeHarvest":
			return [
				{
					label: "Cooldown removal",
					value: `${trimTo2Decimals(timeHarvestCooldownReduction(level))}s / kill`,
				},
			];
		default:
			return [];
	}
}

export function buildSkillPropertiesColumn(
	spell: SpellSlot,
	level: number,
	heading: string,
	progress: PlayerProgress | undefined,
): HTMLElement {
	const shownLevel = Math.max(0, Math.min(MAX_SKILL_LEVEL, level));
	const skill = SKILLS[spell.id];
	const stats = progress
		? statsWithItemBonuses(
				progress.stats,
				progress.mainHand,
				progress.offHand,
				progress.amulet,
				progress.charm,
			)
		: undefined;
	const cooldownSeconds =
		progress && stats
			? effectiveSkillCooldown(
					spell.id,
					progress.mainHand,
					stats,
					shownLevel,
					Math.min(
						0.6,
						derivedStats(stats).cooldownReduction +
							itemCooldownReduction(
								progress.offHand,
								progress.amulet,
								progress.charm,
							),
					),
				)
			: Math.max(3, skill.cooldown);
	const range =
		progress && stats
			? skillRange(spell.id, progress.mainHand, shownLevel, stats.spirit)
			: skill.range;
	const damage = skillDamagePreview(
		spell.id,
		shownLevel,
		stats ?? {
			strength: 0,
			agility: 0,
			spirit: 0,
			intelligence: 0,
		},
	);
	const castTime = skillCastTime(
		spell.id,
		shownLevel,
		stats?.agility ?? 0,
		attackProfile(
			progress?.mainHand,
			stats ?? {
				strength: 0,
				agility: 0,
				spirit: 0,
				intelligence: 0,
			},
			BALANCE,
		).attacksPerSecond,
	);
	const costLabel =
		spell.id === "blocking" && progress && stats
			? progress.offHand?.itemKind === "buckler" &&
				progress.offHand.rarity === "unique"
				? "1% max Mana / block; no cooldown; +1 Rage"
				: `${trimTo2Decimals(progress.offHand ? bucklerBlockCost(progress.offHand, stats) : 0)} Rage / block`
			: spell.costLabel;
	if (spell.procChancesOnAttacks !== undefined) {
		const procChance = weaponSkillTriggerChance(cooldownSeconds);
		return (
			<span class="spell-tooltip-property-column">
				<b>{heading}</b>
				<span class="spell-tooltip-stats">
					<span>
						<small>Level</small>
						<strong>{shownLevel}</strong>
					</span>
					<span>
						<small>Activation</small>
						<strong>
							{spell.procChancesOnDamage !== undefined
								? "Attack / damage proc"
								: "Attack proc"}
						</strong>
					</span>
					<span>
						<small>Proc chance on attacks</small>
						<strong>{trimTo2Decimals(procChance * 100)}%</strong>
					</span>
					{spell.procChancesOnDamage !== undefined ? (
						<span>
							<small>Proc chance on damage</small>
							<strong>{trimTo2Decimals(procChance * 100)}%</strong>
						</span>
					) : null}
					{damage ? (
						<span>
							<small>Damage</small>
							<strong>{formatSkillDamage(damage)}</strong>
						</span>
					) : null}
					<span>
						<small>Cooldown</small>
						<strong>{trimTo2Decimals(cooldownSeconds)}s</strong>
					</span>
					<span>
						<small>Range</small>
						<strong>
							{range ? `${trimTo2Decimals(pixelsToMeters(range))} m` : "Self"}
						</strong>
					</span>
				</span>
			</span>
		) as HTMLElement;
	}
	if (skill.passive) {
		const upkeep =
			skill.upkeep && progress && stats
				? skillUpkeepPerSecond(
						spell.id,
						shownLevel,
						resourceReduction(progress, "mana", stats),
					)
				: 0;
		return (
			<span class="spell-tooltip-property-column">
				<b>{heading}</b>
				<span class="spell-tooltip-stats">
					<span>
						<small>Level</small>
						<strong>{shownLevel}</strong>
					</span>
					<span>
						<small>Activation</small>
						<strong>
							{spell.id === "manaDrain" ? "Critical aura" : "Continuous"}
						</strong>
					</span>
					{skill.upkeep ? (
						<span>
							<small>Upkeep</small>
							<strong>
								{trimTo2Decimals(upkeep)} {capitalize(skill.upkeep.resource)}
								/s
							</strong>
						</span>
					) : null}
					{passiveSkillMetrics(spell.id, shownLevel, stats).map((metric) => (
						<span>
							<small>{metric.label}</small>
							<strong>{metric.value}</strong>
						</span>
					))}
				</span>
			</span>
		) as HTMLElement;
	}
	return (
		<span class="spell-tooltip-property-column">
			<b>{heading}</b>
			<span class="spell-tooltip-stats">
				<span>
					<small>Level</small>
					<strong>{shownLevel}</strong>
				</span>
				<span>
					<small>Cost</small>
					<strong>{costLabel}</strong>
				</span>
				{skill.upkeep && progress && stats ? (
					<span>
						<small>Upkeep</small>
						<strong>
							{trimTo2Decimals(
								skillUpkeepPerSecond(
									spell.id,
									shownLevel,
									resourceReduction(progress, "mana", stats),
								),
							)}{" "}
							{capitalize(skill.upkeep.resource)}/s
						</strong>
					</span>
				) : null}
				{damage ? (
					<span>
						<small>Damage</small>
						<strong>{formatSkillDamage(damage)}</strong>
					</span>
				) : null}
				<span>
					<small>Cooldown</small>
					<strong>{trimTo2Decimals(cooldownSeconds)}s</strong>
				</span>
				{castTime > 0 ? (
					<span>
						<small>Cast time</small>
						<strong>{trimTo2Decimals(castTime)}s</strong>
					</span>
				) : null}
				<span>
					<small>Range</small>
					<strong>
						{range ? `${trimTo2Decimals(pixelsToMeters(range))} m` : "Self"}
					</strong>
				</span>
				{spell.id === "whirlwind" ? (
					<span>
						<small>Duration</small>
						<strong>{trimTo2Decimals(whirlwindDuration(shownLevel))}s</strong>
					</span>
				) : null}
				{spell.id === "blizzard" ? (
					<span>
						<small>Duration</small>
						<strong>{trimTo2Decimals(blizzardDuration(shownLevel))}s</strong>
					</span>
				) : null}
				{spell.id === "blizzard" ? (
					<span>
						<small>Rainfall</small>
						<strong>
							{trimTo2Decimals(blizzardProjectilesPerSecond(shownLevel))}/s
						</strong>
					</span>
				) : null}
				{spell.id === "blizzard" ? (
					<span>
						<small>Impact area</small>
						<strong>
							{trimTo2Decimals(pixelsToMeters(blizzardRadius(shownLevel)))} m
						</strong>
					</span>
				) : null}
				{spell.id === "whirlwind" ? (
					<span>
						<small>Movement</small>
						<strong>
							{trimTo2Decimals(whirlwindMovementSpeed(shownLevel))}×
						</strong>
					</span>
				) : null}
				{spell.id === "orbitingHammers" ? (
					<span>
						<small>Duration</small>
						<strong>
							{trimTo2Decimals(orbitingHammerDuration(shownLevel))}s
						</strong>
					</span>
				) : null}
				{spell.id === "rapidRegen" ? (
					<span>
						<small>Duration</small>
						<strong>{trimTo2Decimals(rapidRegenDuration(shownLevel))}s</strong>
					</span>
				) : null}
				{spell.id === "reflectiveSurge" ? (
					<span>
						<small>Duration</small>
						<strong>
							{trimTo2Decimals(reflectiveSurgeDuration(shownLevel))}s
						</strong>
					</span>
				) : null}
				{spell.id === "reflectiveSurge" ? (
					<span>
						<small>Block chance</small>
						<strong>
							+
							{trimTo2Decimals(
								reflectiveSurgeBlockChanceBonus(shownLevel) * 100,
							)}
							%
						</strong>
					</span>
				) : null}
				{spell.id === "reflectiveSurge" ? (
					<span>
						<small>Block cap</small>
						<strong>100%</strong>
					</span>
				) : null}
				{spell.id === "rendingThrow" ? (
					<span>
						<small>Targets</small>
						<strong>{rendingThrowTargetLimit(shownLevel)}</strong>
					</span>
				) : null}
				{spell.id === "rendingThrow" ? (
					<span>
						<small>Pierce</small>
						<strong>{rendingThrowPierce(shownLevel)}</strong>
					</span>
				) : null}
				{spell.id === "rendingThrow" ? (
					<span>
						<small>Bleed</small>
						<strong>{RENDING_THROW_BLEED_DURATION}s at 0.25/s</strong>
					</span>
				) : null}
				{spell.id === "healing" ? (
					<span>
						<small>Current HP heal</small>
						<strong>
							{trimTo2Decimals(healingFraction(shownLevel) * 100)}%
						</strong>
					</span>
				) : null}
				{spell.id === "healing" ? (
					<span>
						<small>Auto-cast</small>
						<strong>≤50% HP</strong>
					</span>
				) : null}
				{spell.id === "rapidRegen" ? (
					<span>
						<small>Regen</small>
						<strong>
							{trimTo2Decimals(rapidRegenMultiplier(shownLevel) * 100)}% +0.1/s
						</strong>
					</span>
				) : null}
			</span>
		</span>
	) as HTMLElement;
}
