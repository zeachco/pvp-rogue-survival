/** @jsx h */
import { bucklerBlockCost, skillLabel, weaponAttackSpeed, weaponDamage } from "../../common/combat";
import { itemRequirementMultiplier, ITEM_PERKS, type ItemInstance } from "../../common/items";
import { STAT_KEYS, type Stats } from "../../common/progression";
import { h } from "./dom";
import { formatPreviewValue, previewTone } from "./preview";

export function itemDetails(item: ItemInstance, effectiveStats: Stats, baselineItem?: ItemInstance, baselineStats?: Stats): HTMLElement {
  const attacks = item.itemKind === "weapon";
  const damage = attacks ? weaponDamage(item, effectiveStats) : undefined;
  const attackSpeed = attacks ? weaponAttackSpeed(item, effectiveStats) : undefined;
  const effectiveness = itemRequirementMultiplier(item, effectiveStats); const requirements = itemRequirementRows(item, effectiveStats, baselineItem); const effects = itemEffectSummary(item, effectiveStats);
  const baselineDamage = baselineItem?.itemKind === "weapon" ? weaponDamage(baselineItem, baselineStats ?? effectiveStats) : undefined; const baselineSpeed = baselineItem?.itemKind === "weapon" ? weaponAttackSpeed(baselineItem, baselineStats ?? effectiveStats) : undefined; const baselineEffects = baselineItem ? itemEffectSummary(baselineItem, baselineStats ?? effectiveStats) : effects;
  return <div class="equipment-details">
    {damage === undefined ? null : <span><small>Attack</small>{detailValue(baselineDamage ?? damage, damage, fmt)}</span>}{attackSpeed === undefined ? null : <span><small>Attack speed</small>{detailValue(baselineSpeed ?? attackSpeed, attackSpeed, (value) => `${fmt(value)}/s`)}</span>}
    {attacks ? <span><small>Stamina cost</small>{detailValue(baselineItem?.staminaCost ?? item.staminaCost, item.staminaCost, precise)}</span> : null}
    {item.weight > 0 ? <span><small>Weight</small><b>{item.weight}</b></span> : null}
    {effects || baselineEffects ? <span class="equipment-detail-wide"><small>Effects</small>{detailText(baselineEffects, effects)}</span> : null}{item.skills.length ? <span class="equipment-detail-wide"><small>Skills</small><b>{item.skills.map(skillLabel).join(", ")}</b></span> : null}
    {requirements.length ? <span class={`equipment-detail-wide requirement-detail${effectiveness < 1 ? " is-unmet" : ""}`}><small>Requirements</small><b class="requirement-values">{requirements.map((requirement, index) => <span class={`requirement-value${requirement.unmet ? " is-unmet" : requirement.currentVal !== requirement.newVal ? " is-gain-preview" : ""}`}>{index ? ", " : ""}{capitalize(requirement.key)} {formatPreviewValue(requirement, fmt)}</span>)}</b>{effectiveness < 1 ? <em tabindex="0">{precise((1 - effectiveness) * 100)}% penalty to item stats</em> : null}</span> : null}
  </div> as HTMLElement;
}

export function requirementMetStats(item: ItemInstance, stats: Stats): Stats {
  return Object.fromEntries(STAT_KEYS.map((key) => [key, Math.max(stats[key], item.requirements[key] ?? 0)])) as Stats;
}

export function bindRequirementPreview(details: HTMLElement, item: ItemInstance, stats: Stats): void {
  const trigger = details.querySelector<HTMLElement>(".requirement-detail.is-unmet em"); if (!trigger) return;
  const projected = itemDetails(item, requirementMetStats(item, stats), item, stats); const labels = new Map([...projected.querySelectorAll<HTMLElement>("small")].map((label) => [label.textContent, label]));
  const originals = [...details.querySelectorAll<HTMLElement>("small")].filter((label) => label.textContent !== "Requirements").map((label) => { const value = label.nextElementSibling as HTMLElement | null; const next = labels.get(label.textContent)?.nextElementSibling as HTMLElement | null; return value && next ? { value, html: value.innerHTML, className: value.className, next } : undefined; }).filter(Boolean) as Array<{ value: HTMLElement; html: string; className: string; next: HTMLElement }>;
  const show = (): void => { for (const entry of originals) { entry.value.innerHTML = entry.next.innerHTML; entry.value.className = entry.next.className; } };
  const restore = (): void => { for (const entry of originals) { entry.value.innerHTML = entry.html; entry.value.className = entry.className; } };
  trigger.onmouseenter = show; trigger.onmouseleave = restore; trigger.onfocus = show; trigger.onblur = restore;
}

export function itemRequirementRows(item: ItemInstance, stats: Stats, baselineItem?: ItemInstance): Array<{ key: typeof STAT_KEYS[number]; currentVal: number; newVal: number; unmet: boolean }> {
  return STAT_KEYS.filter((key) => (item.requirements[key] ?? 0) > 0 || (baselineItem?.requirements[key] ?? 0) > 0).map((key) => { const newVal = item.requirements[key] ?? 0; return { key, currentVal: baselineItem?.requirements[key] ?? newVal, newVal, unmet: newVal > stats[key] }; });
}

function detailValue(currentVal: number, newVal: number, format: (value: number) => string): HTMLElement { const tone = previewTone({ currentVal, newVal }); return <b class={tone === "gain" ? "is-gain-preview" : tone === "cost" ? "is-cost-preview" : ""}>{formatPreviewValue({ currentVal, newVal }, format)}</b> as HTMLElement; }
function detailText(currentVal: string, newVal: string): HTMLElement { return <b class={currentVal !== newVal ? "is-gain-preview" : ""}>{formatPreviewValue({ currentVal, newVal })}</b> as HTMLElement; }

function itemEffectSummary(item: ItemInstance, effectiveStats: Stats): string {
  const effects = item.affixes.map(capitalize); const effectiveness = itemRequirementMultiplier(item, effectiveStats);
  if (item.blockChance > 0) effects.push(`${precise(item.blockChance * effectiveness * 100)}% block`, `${fmt(bucklerBlockCost(item, effectiveStats))} stamina/block`);
  if (item.attractionSpeed > 0) effects.push(`Attraction ${fmt(item.attractionSpeed * effectiveness)} px/s`);
  if (item.modifiers.critChance > 0) effects.push(`${precise(item.modifiers.critChance * effectiveness * 100)}% crit`);
  if (item.modifiers.bleedChance > 0) effects.push(`${precise(item.modifiers.bleedChance * effectiveness * 100)}% bleed`);
  if (item.modifiers.poisonChance > 0) effects.push(`${precise(item.modifiers.poisonChance * effectiveness * 100)}% poison`);
  if (item.modifiers.stunChance > 0) effects.push(`${precise(item.modifiers.stunChance * effectiveness * 100)}% stun`);
  if (item.modifiers.magicAmp > 0) effects.push(`+${precise(item.modifiers.magicAmp * effectiveness * 100)}% magic`);
  if (item.modifiers.lifeStealBase > 0) effects.push(`${precise(item.modifiers.lifeStealBase * effectiveness * 100)}% + 0.1%/Spirit life steal`);
  if (item.modifiers.strengthRegenMultiplier > 0) effects.push(`Vigorous regen: 0.01 + ${precise(item.modifiers.strengthRegenMultiplier * effectiveness)}× Strength/s`);
  if (item.modifiers.goldGain > 0) effects.push(`+${precise(item.modifiers.goldGain * effectiveness * 100)}% Gold gain`);
  if (item.modifiers.rarityBoost > 0) effects.push(`+${precise(item.modifiers.rarityBoost * effectiveness * 100)}% Rarity boost`);
  if (item.reflectionComponents.length) effects.push(`Reflect: ${item.reflectionComponents.map(capitalize).join("/")}`);
  const accessory = item.accessoryBonuses; if ((accessory?.manaSkillLevels ?? 0) > 0) effects.push(`+${accessory!.manaSkillLevels} Mana skill levels`); if ((accessory?.staminaSkillLevels ?? 0) > 0) effects.push(`+${accessory!.staminaSkillLevels} Stamina skill levels`); if ((accessory?.allSkillLevels ?? 0) > 0) effects.push(`+${accessory!.allSkillLevels} All skill levels`); if ((accessory?.globalCooldownReduction ?? 0) > 0) effects.push(`${precise(accessory!.globalCooldownReduction! * effectiveness * 100)}% global cooldown reduction`); if ((accessory?.manaCostReduction ?? 0) > 0) effects.push(`${precise(accessory!.manaCostReduction! * effectiveness * 100)}% Mana cost reduction`); if ((accessory?.lifeCostReduction ?? 0) > 0) effects.push(`${precise(accessory!.lifeCostReduction! * effectiveness * 100)}% Life cost reduction`); for (const [kind, fraction] of Object.entries(accessory?.physicalDamage ?? {})) effects.push(`+${precise((fraction ?? 0) * effectiveness * 100)}% ${capitalize(kind)} damage on physical hits`);
  for (const key of STAT_KEYS) if ((item.statBonuses[key] ?? 0) !== 0) effects.push(`+${fmt((item.statBonuses[key] ?? 0) * effectiveness)} ${capitalize(key)}`);
  for (const key of ITEM_PERKS) if ((item.perks?.[key] ?? 0) > 0) effects.push(`${capitalize(key.replace(/([A-Z])/g, " $1"))} ${key === "defense" ? fmt(item.perks![key]! * effectiveness) : `${precise(item.perks![key]! * effectiveness * 100)}%`}`);
  return effects.join(", ");
}
function fmt(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function precise(value: number): string { return Number(value.toFixed(4)).toString(); }
function capitalize(value: string): string { return `${value.charAt(0).toUpperCase()}${value.slice(1)}`; }
