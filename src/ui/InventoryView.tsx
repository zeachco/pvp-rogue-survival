/** @jsx h */
/** @jsxFrag Fragment */
import type { InventoryTile } from "../../common/protocol";
import { RARITIES } from "../../common/items";
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

export function itemTile(tile: InventoryTile, callbacks: HudCallbacks): HTMLElement {
  const item = tile.item; const automationOptions: Array<{ value: InventoryTile["automation"]; label: string }> = [
    { value: "keep", label: "Keep" }, { value: "sell", label: "Sell" }, { value: "upgrade", label: "Upgrade" }, { value: "purge", label: "Purge" }
  ]; const node = (
    <div class={`item-card rarity-${item.rarity}${tile.quantity ? "" : " is-empty"}`}>
      <div class="item-title"><strong>{item.name}</strong><b>x{tile.quantity}</b></div>
      <small>L{item.level} · {item.itemKind === "weapon" ? `${item.hands}H` : `${Math.round(item.blockChance * 100)}% block`} · {item.rarity}</small>
      <div class="item-menu">
        <button type="button">Equip</button><button type="button">Sell {item.sellValue}g</button><button type="button">Purge</button>
        <button type="button">Upgrade</button><button type="button">Send</button>{item.skills.length ? <button type="button">Extract</button> : null}
      </div>
      <div class="item-automation" role="radiogroup" aria-label={`Batch action for ${item.name}`}><small>Batch</small>{automationOptions.map((option) => <label><input type="radio" name={`automation-${tile.id}`} value={option.value} checked={tile.automation === option.value} />{option.label}</label>)}</div>
    </div>
  ) as HTMLElement;
  const buttons = [...node.querySelectorAll("button")]; buttons.forEach((button) => { (button as HTMLButtonElement).disabled = tile.quantity === 0; });
  buttons[0].onclick = () => callbacks.onEquip(tile.id); buttons[1].onclick = () => callbacks.onSell(tile.id); buttons[2].onclick = () => callbacks.onPurge(tile.id);
  buttons[3].onclick = () => callbacks.onUpgrade(tile.id); buttons[4].onclick = () => callbacks.onSend(tile.id); if (buttons[5]) buttons[5].onclick = () => callbacks.onExtract(tile.id);
  for (const input of node.querySelectorAll<HTMLInputElement>('.item-automation input[type="radio"]')) input.onchange = () => { if (input.checked) callbacks.onAutomation(tile.id, input.value as InventoryTile["automation"]); };
  return node;
}
