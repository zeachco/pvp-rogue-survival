/** @jsx h */
/** @jsxFrag Fragment */
import type { InventoryTile, PlayerProgress } from "../../common/protocol";
import { RARITIES, itemStackKey, statsWithItemBonuses } from "../../common/items";
import { Fragment, h } from "./dom";
import type { HudCallbacks } from "./types";
import { itemDetails } from "./ItemDetails";

export function orderInventoryTiles(tiles: InventoryTile[], progress: PlayerProgress): InventoryTile[] {
  const equippedKeys = new Set([itemStackKey(progress.mainHand), progress.offHand ? itemStackKey(progress.offHand) : ""]);
  return tiles
    .map((tile, index) => ({ tile, index }))
    .sort((left, right) => {
      const equipped = Number(equippedKeys.has(right.tile.key)) - Number(equippedKeys.has(left.tile.key));
      if (equipped) return equipped;
      const automationOrder: Record<InventoryTile["automation"], number> = { upgrade: 0, keep: 1, purge: 2, sell: 3 };
      const automation = automationOrder[left.tile.automation] - automationOrder[right.tile.automation];
      if (automation) return automation;
      const availability = Number(right.tile.quantity > 0) - Number(left.tile.quantity > 0);
      if (availability) return availability;
      const leftRarity = left.tile.quantity > 0 ? left.tile.item.rarity : left.tile.disposalRarity; const rightRarity = right.tile.quantity > 0 ? right.tile.item.rarity : right.tile.disposalRarity;
      const rarity = RARITIES.indexOf(leftRarity) - RARITIES.indexOf(rightRarity);
      return rarity || left.index - right.index;
    })
    .map(({ tile }) => tile);
}

export function itemTile(tile: InventoryTile, callbacks: HudCallbacks, progress: PlayerProgress): HTMLElement {
  const item = tile.item; const equipped = itemStackKey(progress.mainHand) === tile.key || Boolean(progress.offHand && itemStackKey(progress.offHand) === tile.key); const spare = tile.quantity - Number(equipped);
  const disposalBucket = tile.quantity === 0 && (tile.automation === "sell" || tile.automation === "purge");
  const stats = statsWithItemBonuses(progress.stats, item);
  const automationOptions: Array<{ value: InventoryTile["automation"]; label: string }> = [
    { value: "keep", label: "Keep" }, { value: "sell", label: "Sell" }, { value: "upgrade", label: "Upgrade" }, { value: "purge", label: "Purge" }
  ]; const node = (
    <div class={`item-card rarity-${item.rarity}${tile.quantity ? "" : " is-empty"}${equipped ? " is-equipped" : ""}`}>
      <div class="item-card-content"><div class="item-title"><strong>{item.name}</strong><b>{equipped ? "Equipped · " : ""}x{tile.quantity}</b></div>
        <small>{disposalBucket ? "All levels" : `L${item.level}`} · {item.itemKind === "weapon" ? `${item.hands}H` : item.itemKind === "buckler" ? `${Math.round(item.blockChance * 100)}% block` : "Relic"} · {disposalBucket ? `≤ ${tile.disposalRarity}` : item.rarity}</small>
        {disposalBucket ? null : itemDetails(item, stats)}
      </div>
      <div class="item-card-controls"><div class="item-menu">
        <button type="button">{equipped ? "Unequip" : "Equip"}</button><button type="button">Sell {item.sellValue}g</button><button type="button">Purge</button>
        <button type="button">Upgrade</button><button type="button">Send</button>{item.skills.length ? <button type="button">Extract</button> : null}
      </div>
      <div class="item-automation" role="radiogroup" aria-label={`Batch action for ${item.name}`}><small>Batch</small>{automationOptions.map((option) => <label class={tile.automation === option.value ? "is-selected" : ""}><input type="radio" name={`automation-${tile.id}`} value={option.value} checked={tile.automation === option.value} />{option.label}</label>)}<label class="disposal-threshold">Dispose ≤ <select aria-label={`Maximum disposal rarity for ${item.name}`} value={tile.disposalRarity}>{RARITIES.map((rarity) => <option value={rarity}>{rarity}</option>)}</select></label></div></div>
    </div>
  ) as HTMLElement;
  const buttons = [...node.querySelectorAll("button")]; buttons.forEach((button) => { (button as HTMLButtonElement).disabled = tile.quantity === 0; });
  if (equipped) { (buttons[1] as HTMLButtonElement).disabled = true; (buttons[2] as HTMLButtonElement).disabled = true; }
  if (spare <= 0) for (const index of [3, 4, 5]) if (buttons[index]) (buttons[index] as HTMLButtonElement).disabled = true;
  buttons[0].onclick = () => callbacks.onEquip(tile.id); buttons[1].onclick = () => callbacks.onSell(tile.id); buttons[2].onclick = () => callbacks.onPurge(tile.id);
  buttons[3].onclick = () => callbacks.onUpgrade(tile.id); buttons[4].onclick = () => callbacks.onSend(tile.id); if (buttons[5]) buttons[5].onclick = () => callbacks.onExtract(tile.id);
  const raritySelect = node.querySelector<HTMLSelectElement>(".disposal-threshold select")!; raritySelect.disabled = tile.automation !== "sell" && tile.automation !== "purge"; raritySelect.onchange = () => { if (tile.automation === "sell" || tile.automation === "purge") callbacks.onAutomation(tile.id, tile.automation, raritySelect.value as InventoryTile["disposalRarity"]); };
  for (const input of node.querySelectorAll<HTMLInputElement>('.item-automation input[type="radio"]')) { if (equipped && (input.value === "sell" || input.value === "purge")) input.disabled = true; input.onchange = () => { if (input.checked) callbacks.onAutomation(tile.id, input.value as InventoryTile["automation"], raritySelect.value as InventoryTile["disposalRarity"]); }; }
  return node;
}
