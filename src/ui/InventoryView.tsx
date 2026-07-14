/** @jsx h */
import type { InventoryTile, PlayerProgress } from "../../common/protocol";
import { itemStackKey, statsWithItemBonuses } from "../../common/items";
import { h } from "./dom";
import type { CurrencyPreview, HudCallbacks } from "./types";
import { itemDetails } from "./ItemDetails";
import { purgeYield, upgradeCosts } from "../../common/inventory";

export function orderInventoryTiles(tiles: InventoryTile[], progress: PlayerProgress): InventoryTile[] {
  const equippedKeys = new Set([itemStackKey(progress.mainHand), progress.offHand ? itemStackKey(progress.offHand) : ""]);
  return tiles
    .filter((tile) => tile.quantity > 0)
    .map((tile, index) => ({ tile, index }))
    .sort((left, right) => {
      const equipped = Number(equippedKeys.has(right.tile.key)) - Number(equippedKeys.has(left.tile.key));
      if (equipped) return equipped;
      return left.index - right.index;
    })
    .map(({ tile }) => tile);
}

export function itemTile(tile: InventoryTile, callbacks: HudCallbacks, progress: PlayerProgress, onPreview?: (item?: InventoryTile["item"]) => void, onCurrencyPreview?: (preview?: CurrencyPreview) => void): HTMLElement {
  const item = tile.item; const equipped = itemStackKey(progress.mainHand) === tile.key || Boolean(progress.offHand && itemStackKey(progress.offHand) === tile.key); const spare = tile.quantity - Number(equipped);
  const stats = statsWithItemBonuses(progress.stats, item);
  const node = (
    <div class={`item-card rarity-${item.rarity}${equipped ? " is-equipped" : ""}`}>
      <div class="item-card-content"><div class="item-title"><strong>{item.name}</strong><b>{equipped ? "Equipped · " : ""}x{tile.quantity}</b></div>
        <small>L{item.level} · {item.itemKind === "weapon" ? `${item.hands}H` : item.itemKind === "buckler" ? `${Math.round(item.blockChance * 100)}% block` : "Relic"} · {item.rarity}</small>
        {itemDetails(item, stats)}
      </div>
      <div class="item-card-controls"><div class="item-menu">
        <button type="button">{equipped ? "Unequip" : "Equip"}</button><button type="button">Sell {item.sellValue}g</button><button type="button">Purge</button>
        <button type="button">Upgrade</button><button type="button">Send</button>{item.skills.length ? <button type="button">Extract</button> : null}
      </div></div>
    </div>
  ) as HTMLElement;
  const buttons = [...node.querySelectorAll("button")]; buttons.forEach((button) => { (button as HTMLButtonElement).disabled = tile.quantity === 0; });
  if (tile.quantity > 0 && onPreview) { node.onmouseenter = () => onPreview(item); node.onmouseleave = () => { onPreview(); onCurrencyPreview?.(); }; }
  if (equipped) { (buttons[1] as HTMLButtonElement).disabled = true; (buttons[2] as HTMLButtonElement).disabled = true; }
  if (spare <= 0) for (const index of [3, 4, 5]) if (buttons[index]) (buttons[index] as HTMLButtonElement).disabled = true;
  buttons[0].onclick = () => callbacks.onEquip(tile.id);
  const bindBulk = (index: number, callback: (tileId: string, bulk: boolean) => void): void => { const button = buttons[index] as HTMLButtonElement | undefined; if (!button) return; button.title = "Shift+click to repeat while possible"; button.onclick = (event) => callback(tile.id, event.shiftKey); };
  bindBulk(1, callbacks.onSell); bindBulk(2, callbacks.onPurge); bindBulk(3, callbacks.onUpgrade); bindBulk(4, callbacks.onSend); bindBulk(5, callbacks.onExtract);
  const previewButton = (index: number, preview: CurrencyPreview): void => { const button = buttons[index] as HTMLButtonElement | undefined; if (!button) return; button.onmouseenter = () => onCurrencyPreview?.(preview); button.onmouseleave = () => onCurrencyPreview?.(); };
  const costs = upgradeCosts(item); previewButton(1, { gold: item.sellValue }); previewButton(2, { [item.rarity]: purgeYield(item) }); previewButton(3, { gold: -costs.gold, [item.rarity]: -costs.scraps });
  return node;
}
