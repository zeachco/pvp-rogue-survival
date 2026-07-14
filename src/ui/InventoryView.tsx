/** @jsx h */
/** @jsxFrag Fragment */
import type { InventoryTile, PlayerProgress } from "../../common/protocol";
import { RARITIES, itemStackKey, statsWithItemBonuses } from "../../common/items";
import { derivedStats, STAT_KEYS } from "../../common/progression";
import { skillLabel } from "../../common/combat";
import { Fragment, h } from "./dom";
import type { HudCallbacks } from "./types";

export function orderInventoryTiles(tiles: InventoryTile[]): InventoryTile[] {
  return tiles
    .map((tile, index) => ({ tile, index }))
    .sort((left, right) => {
      const availability = Number(right.tile.quantity > 0) - Number(left.tile.quantity > 0);
      if (availability) return availability;
      const rarity = RARITIES.indexOf(left.tile.item.rarity) - RARITIES.indexOf(right.tile.item.rarity);
      return rarity || left.index - right.index;
    })
    .map(({ tile }) => tile);
}

export function itemTile(tile: InventoryTile, callbacks: HudCallbacks, progress: PlayerProgress): HTMLElement {
  const item = tile.item; const equipped = itemStackKey(progress.mainHand) === tile.key || Boolean(progress.offHand && itemStackKey(progress.offHand) === tile.key); const spare = tile.quantity - Number(equipped);
  const stats = statsWithItemBonuses(progress.stats, item); const derived = derivedStats(stats); const attacks = item.itemKind === "weapon";
  const damage = attacks ? derived.baseDamage * item.modifiers.damageMultiplier * (item.definitionId === "staff" ? derived.magicAmp + item.modifiers.magicAmp : 1) : undefined;
  const attackSpeed = attacks ? derived.attackSpeed * item.modifiers.attackSpeedMultiplier : undefined;
  const requirements = STAT_KEYS.filter((key) => (item.requirements[key] ?? 0) > 0).map((key) => `${capitalize(key)} ${fmt(item.requirements[key] ?? 0)}`).join(", ") || "None";
  const automationOptions: Array<{ value: InventoryTile["automation"]; label: string }> = [
    { value: "keep", label: "Keep" }, { value: "sell", label: "Sell" }, { value: "upgrade", label: "Upgrade" }, { value: "purge", label: "Purge" }
  ]; const node = (
    <div class={`item-card rarity-${item.rarity}${tile.quantity ? "" : " is-empty"}${equipped ? " is-equipped" : ""}`}>
      <div class="item-title"><strong>{item.name}</strong><b>{equipped ? "Equipped · " : ""}x{tile.quantity}</b></div>
      <small>L{item.level} · {item.itemKind === "weapon" ? `${item.hands}H` : `${Math.round(item.blockChance * 100)}% block`} · {item.rarity}</small>
      <div class="equipment-details">
        <span><small>Attack</small><b>{damage === undefined ? "—" : fmt(damage)}</b></span><span><small>Attack speed</small><b>{attackSpeed === undefined ? "—" : `${fmt(attackSpeed)}/s`}</b></span>
        <span class="equipment-detail-wide"><small>Effects</small><b>{itemEffects(item)}</b></span><span class="equipment-detail-wide"><small>Skills</small><b>{item.skills.map(skillLabel).join(", ") || "None"}</b></span>
        <span class="equipment-detail-wide"><small>Requirements</small><b>{requirements}</b></span>
      </div>
      <div class="item-menu">
        <button type="button">Equip</button><button type="button">Sell {item.sellValue}g</button><button type="button">Purge</button>
        <button type="button">Upgrade</button><button type="button">Send</button>{item.skills.length ? <button type="button">Extract</button> : null}
      </div>
      <div class="item-automation" role="radiogroup" aria-label={`Batch action for ${item.name}`}><small>Batch</small>{automationOptions.map((option) => <label><input type="radio" name={`automation-${tile.id}`} value={option.value} checked={tile.automation === option.value} />{option.label}</label>)}</div>
    </div>
  ) as HTMLElement;
  const buttons = [...node.querySelectorAll("button")]; buttons.forEach((button) => { (button as HTMLButtonElement).disabled = tile.quantity === 0; });
  if (equipped) { (buttons[1] as HTMLButtonElement).disabled = true; (buttons[2] as HTMLButtonElement).disabled = true; }
  if (spare <= 0) for (const index of [3, 4, 5]) if (buttons[index]) (buttons[index] as HTMLButtonElement).disabled = true;
  buttons[0].onclick = () => callbacks.onEquip(tile.id); buttons[1].onclick = () => callbacks.onSell(tile.id); buttons[2].onclick = () => callbacks.onPurge(tile.id);
  buttons[3].onclick = () => callbacks.onUpgrade(tile.id); buttons[4].onclick = () => callbacks.onSend(tile.id); if (buttons[5]) buttons[5].onclick = () => callbacks.onExtract(tile.id);
  for (const input of node.querySelectorAll<HTMLInputElement>('.item-automation input[type="radio"]')) { if (equipped && (input.value === "sell" || input.value === "purge")) input.disabled = true; input.onchange = () => { if (input.checked) callbacks.onAutomation(tile.id, input.value as InventoryTile["automation"]); }; }
  return node;
}
function itemEffects(item: InventoryTile["item"]): string { const effects = item.affixes.map(capitalize); if (item.blockChance > 0) effects.push(`${Math.round(item.blockChance * 100)}% block`); if (item.modifiers.critChance > 0) effects.push(`${Math.round(item.modifiers.critChance * 100)}% crit`); if (item.modifiers.bleedChance > 0) effects.push(`${Math.round(item.modifiers.bleedChance * 100)}% bleed`); if (item.modifiers.poisonChance > 0) effects.push(`${Math.round(item.modifiers.poisonChance * 100)}% poison`); if (item.modifiers.stunChance > 0) effects.push(`${Math.round(item.modifiers.stunChance * 100)}% stun`); if (item.modifiers.magicAmp > 0) effects.push(`+${Math.round(item.modifiers.magicAmp * 100)}% magic`); if (item.reflectionComponents.length) effects.push(`Reflect: ${item.reflectionComponents.map(capitalize).join("/")}`); return effects.join(", ") || "None"; }
function fmt(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function capitalize(value: string): string { return `${value.charAt(0).toUpperCase()}${value.slice(1)}`; }
