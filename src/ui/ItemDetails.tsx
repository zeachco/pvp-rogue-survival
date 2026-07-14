/** @jsx h */
import { skillLabel } from "../../common/combat";
import type { ItemInstance } from "../../common/items";
import { STAT_KEYS, derivedStats, type Stats } from "../../common/progression";
import { h } from "./dom";

export function itemDetails(item: ItemInstance, effectiveStats: Stats): HTMLElement {
  const derived = derivedStats(effectiveStats); const attacks = item.itemKind === "weapon";
  const damage = attacks ? derived.baseDamage * item.modifiers.damageMultiplier * (item.definitionId === "staff" ? derived.magicAmp + item.modifiers.magicAmp : 1) : undefined;
  const attackSpeed = attacks ? derived.attackSpeed * item.modifiers.attackSpeedMultiplier : undefined;
  const requirements = STAT_KEYS.filter((key) => (item.requirements[key] ?? 0) > 0).map((key) => `${capitalize(key)} ${fmt(item.requirements[key] ?? 0)}`).join(", ") || "None";
  return <div class="equipment-details">
    <span><small>Attack</small><b>{damage === undefined ? "—" : fmt(damage)}</b></span><span><small>Attack speed</small><b>{attackSpeed === undefined ? "—" : `${fmt(attackSpeed)}/s`}</b></span>
    <span class="equipment-detail-wide"><small>Effects</small><b>{itemEffectSummary(item)}</b></span><span class="equipment-detail-wide"><small>Skills</small><b>{item.skills.map(skillLabel).join(", ") || "None"}</b></span>
    <span class="equipment-detail-wide"><small>Requirements</small><b>{requirements}</b></span>
  </div> as HTMLElement;
}

function itemEffectSummary(item: ItemInstance): string {
  const effects = item.affixes.map(capitalize);
  if (item.blockChance > 0) effects.push(`${Math.round(item.blockChance * 100)}% block`);
  if (item.modifiers.critChance > 0) effects.push(`${Math.round(item.modifiers.critChance * 100)}% crit`);
  if (item.modifiers.bleedChance > 0) effects.push(`${Math.round(item.modifiers.bleedChance * 100)}% bleed`);
  if (item.modifiers.poisonChance > 0) effects.push(`${Math.round(item.modifiers.poisonChance * 100)}% poison`);
  if (item.modifiers.stunChance > 0) effects.push(`${Math.round(item.modifiers.stunChance * 100)}% stun`);
  if (item.modifiers.magicAmp > 0) effects.push(`+${Math.round(item.modifiers.magicAmp * 100)}% magic`);
  if (item.reflectionComponents.length) effects.push(`Reflect: ${item.reflectionComponents.map(capitalize).join("/")}`);
  return effects.join(", ") || "None";
}
function fmt(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function capitalize(value: string): string { return `${value.charAt(0).toUpperCase()}${value.slice(1)}`; }
