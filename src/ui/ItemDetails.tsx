/** @jsx h */
import { bucklerBlockCost, skillLabel, weaponAttackSpeed, weaponDamage } from "../../common/combat";
import type { ItemInstance } from "../../common/items";
import { STAT_KEYS, type Stats } from "../../common/progression";
import { h } from "./dom";

export function itemDetails(item: ItemInstance, effectiveStats: Stats): HTMLElement {
  const attacks = item.itemKind === "weapon";
  const damage = attacks ? weaponDamage(item, effectiveStats) : undefined;
  const attackSpeed = attacks ? weaponAttackSpeed(item, effectiveStats) : undefined;
  const requirements = STAT_KEYS.filter((key) => (item.requirements[key] ?? 0) > 0).map((key) => `${capitalize(key)} ${fmt(item.requirements[key] ?? 0)}`).join(", "); const effects = itemEffectSummary(item, effectiveStats);
  return <div class="equipment-details">
    {damage === undefined ? null : <span><small>Attack</small><b>{fmt(damage)}</b></span>}{attackSpeed === undefined ? null : <span><small>Attack speed</small><b>{fmt(attackSpeed)}/s</b></span>}
    {item.weight > 0 ? <span><small>Weight</small><b>{item.weight}</b></span> : null}
    {effects ? <span class="equipment-detail-wide"><small>Effects</small><b>{effects}</b></span> : null}{item.skills.length ? <span class="equipment-detail-wide"><small>Skills</small><b>{item.skills.map(skillLabel).join(", ")}</b></span> : null}
    {requirements ? <span class="equipment-detail-wide"><small>Requirements</small><b>{requirements}</b></span> : null}
  </div> as HTMLElement;
}

function itemEffectSummary(item: ItemInstance, effectiveStats: Stats): string {
  const effects = item.affixes.map(capitalize);
  if (item.blockChance > 0) effects.push(`${Math.round(item.blockChance * 100)}% block`, `${fmt(bucklerBlockCost(item, effectiveStats))} stamina/block`);
  if (item.attractionSpeed > 0) effects.push(`Attraction ${fmt(item.attractionSpeed)} px/s`);
  if (item.modifiers.critChance > 0) effects.push(`${Math.round(item.modifiers.critChance * 100)}% crit`);
  if (item.modifiers.bleedChance > 0) effects.push(`${Math.round(item.modifiers.bleedChance * 100)}% bleed`);
  if (item.modifiers.poisonChance > 0) effects.push(`${Math.round(item.modifiers.poisonChance * 100)}% poison`);
  if (item.modifiers.stunChance > 0) effects.push(`${Math.round(item.modifiers.stunChance * 100)}% stun`);
  if (item.modifiers.magicAmp > 0) effects.push(`+${Math.round(item.modifiers.magicAmp * 100)}% magic`);
  if (item.modifiers.lifeStealBase > 0) effects.push(`${Math.round(item.modifiers.lifeStealBase * 100)}% + 0.1%/Spirit life steal`);
  if (item.modifiers.strengthRegenMultiplier > 0) effects.push(`Vigorous regen: 0.01 + ${fmt(item.modifiers.strengthRegenMultiplier)}× Strength/s`);
  if (item.reflectionComponents.length) effects.push(`Reflect: ${item.reflectionComponents.map(capitalize).join("/")}`);
  for (const key of STAT_KEYS) if ((item.statBonuses[key] ?? 0) !== 0) effects.push(`+${fmt(item.statBonuses[key] ?? 0)} ${capitalize(key)}`);
  return effects.join(", ");
}
function fmt(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function capitalize(value: string): string { return `${value.charAt(0).toUpperCase()}${value.slice(1)}`; }
