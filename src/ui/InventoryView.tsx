/** @jsx h */
/** @jsxFrag Fragment */
import type { InventoryTile } from "../../common/protocol";
import { Fragment, h } from "./dom";
import type { HudCallbacks } from "./types";

export function itemTile(tile: InventoryTile, callbacks: HudCallbacks): HTMLElement {
  const item = tile.item; const node = (
    <div class={`item-card rarity-${item.rarity}${tile.quantity ? "" : " is-empty"}`}>
      <div class="item-title"><strong>{item.name}</strong><b>x{tile.quantity}</b></div>
      <small>L{item.level} · {item.itemKind === "weapon" ? `${item.hands}H` : `${Math.round(item.blockChance * 100)}% block`} · {item.rarity}</small>
      <div class="item-menu">
        <button type="button">Equip</button><button type="button">Sell {item.sellValue}g</button><button type="button">Purge</button>
        <button type="button">Merge</button><button type="button">Send</button>{item.skills.length ? <button type="button">Extract</button> : null}
      </div>
      <select aria-label={`Automation for ${item.name}`}>
        <option value="keep">Keep</option><option value="sell">Auto Sell</option><option value="merge">Auto Merge</option><option value="purge">Auto Purge</option>
      </select>
    </div>
  ) as HTMLElement;
  const buttons = [...node.querySelectorAll("button")]; buttons.forEach((button) => { (button as HTMLButtonElement).disabled = tile.quantity === 0; });
  buttons[0].onclick = () => callbacks.onEquip(tile.id); buttons[1].onclick = () => callbacks.onSell(tile.id); buttons[2].onclick = () => callbacks.onPurge(tile.id);
  buttons[3].onclick = () => callbacks.onMerge(tile.id); buttons[4].onclick = () => callbacks.onSend(tile.id); if (buttons[5]) buttons[5].onclick = () => callbacks.onExtract(tile.id);
  const select = node.querySelector("select") as HTMLSelectElement; select.value = tile.automation; select.onchange = () => callbacks.onAutomation(tile.id, select.value as InventoryTile["automation"]);
  return node;
}
