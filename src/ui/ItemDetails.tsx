/** @jsx h */
import { bucklerBlockCost, skillLabel, weaponAttackSpeed, weaponDamage } from "../../common/combat";
import type { ItemInstance } from "../../common/items";
import { STAT_KEYS, type Stats } from "../../common/progression";
import { h } from "./dom";
import { formatPreviewValue, previewTone } from "./preview";

export function itemDetails(item: ItemInstance, effectiveStats: Stats, baselineItem?: ItemInstance, baselineStats?: Stats): HTMLElement {
  const attacks = item.itemKind === "weapon";
  const damage = attacks ? weaponDamage(item, effectiveStats) : undefined;
  const attackSpeed = attacks ? weaponAttackSpeed(item, effectiveStats) : undefined;
  const requirements = STAT_KEYS.filter((key) => (item.requirements[key] ?? 0) > 0).map((key) => `${capitalize(key)} ${fmt(item.requirements[key] ?? 0)}`).join(", "); const effects = itemEffectSummary(item, effectiveStats);
  const baselineDamage = baselineItem?.itemKind === "weapon" ? weaponDamage(baselineItem, baselineStats ?? effectiveStats) : undefined; const baselineSpeed = baselineItem?.itemKind === "weapon" ? weaponAttackSpeed(baselineItem, baselineStats ?? effectiveStats) : undefined; const baselineEffects = baselineItem ? itemEffectSummary(baselineItem, baselineStats ?? effectiveStats) : effects; const baselineRequirements = baselineItem ? STAT_KEYS.filter((key) => (baselineItem.requirements[key] ?? 0) > 0).map((key) => `${capitalize(key)} ${fmt(baselineItem.requirements[key] ?? 0)}`).join(", ") : requirements;
  return <div class="equipment-details">
    {damage === undefined ? null : <span><small>Attack</small>{detailValue(baselineDamage ?? damage, damage, fmt)}</span>}{attackSpeed === undefined ? null : <span><small>Attack speed</small>{detailValue(baselineSpeed ?? attackSpeed, attackSpeed, (value) => `${fmt(value)}/s`)}</span>}
    {attacks ? <span><small>Stamina cost</small>{detailValue(baselineItem?.staminaCost ?? item.staminaCost, item.staminaCost, precise)}</span> : null}
    {item.weight > 0 ? <span><small>Weight</small><b>{item.weight}</b></span> : null}
    {effects || baselineEffects ? <span class="equipment-detail-wide"><small>Effects</small>{detailText(baselineEffects, effects)}</span> : null}{item.skills.length ? <span class="equipment-detail-wide"><small>Skills</small><b>{item.skills.map(skillLabel).join(", ")}</b></span> : null}
    {requirements || baselineRequirements ? <span class="equipment-detail-wide"><small>Requirements</small>{detailText(baselineRequirements, requirements)}</span> : null}
  </div> as HTMLElement;
}

function detailValue(currentVal: number, newVal: number, format: (value: number) => string): HTMLElement { const tone = previewTone({ currentVal, newVal }); return <b class={tone === "gain" ? "is-gain-preview" : tone === "cost" ? "is-cost-preview" : ""}>{formatPreviewValue({ currentVal, newVal }, format)}</b> as HTMLElement; }
function detailText(currentVal: string, newVal: string): HTMLElement { return <b class={currentVal !== newVal ? "is-gain-preview" : ""}>{formatPreviewValue({ currentVal, newVal })}</b> as HTMLElement; }

function itemEffectSummary(item: ItemInstance, effectiveStats: Stats): string {
  const effects = item.affixes.map(capitalize);
  if (item.blockChance > 0) effects.push(`${Math.round(item.blockChance * 100)}% block`, `${fmt(bucklerBlockCost(item, effectiveStats))} stamina/block`);
  if (item.attractionSpeed > 0) effects.push(`Attraction ${fmt(item.attractionSpeed)} px/s`);
  if (item.modifiers.critChance > 0) effects.push(`${precise(item.modifiers.critChance * 100)}% crit`);
  if (item.modifiers.bleedChance > 0) effects.push(`${precise(item.modifiers.bleedChance * 100)}% bleed`);
  if (item.modifiers.poisonChance > 0) effects.push(`${precise(item.modifiers.poisonChance * 100)}% poison`);
  if (item.modifiers.stunChance > 0) effects.push(`${precise(item.modifiers.stunChance * 100)}% stun`);
  if (item.modifiers.magicAmp > 0) effects.push(`+${Math.round(item.modifiers.magicAmp * 100)}% magic`);
  if (item.modifiers.lifeStealBase > 0) effects.push(`${precise(item.modifiers.lifeStealBase * 100)}% + 0.1%/Spirit life steal`);
  if (item.modifiers.strengthRegenMultiplier > 0) effects.push(`Vigorous regen: 0.01 + ${precise(item.modifiers.strengthRegenMultiplier)}× Strength/s`);
  if (item.modifiers.goldGain > 0) effects.push(`+${precise(item.modifiers.goldGain * 100)}% Gold gain`);
  if (item.modifiers.rarityBoost > 0) effects.push(`+${precise(item.modifiers.rarityBoost * 100)}% Rarity boost`);
  if (item.reflectionComponents.length) effects.push(`Reflect: ${item.reflectionComponents.map(capitalize).join("/")}`);
  for (const key of STAT_KEYS) if ((item.statBonuses[key] ?? 0) !== 0) effects.push(`+${fmt(item.statBonuses[key] ?? 0)} ${capitalize(key)}`);
  return effects.join(", ");
}
function fmt(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function precise(value: number): string { return Number(value.toFixed(4)).toString(); }
function capitalize(value: string): string { return `${value.charAt(0).toUpperCase()}${value.slice(1)}`; }
