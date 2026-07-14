/** @jsx h */
import type { InventoryTile, PlayerProgress } from "../../common/protocol";
import { itemStackKey, levelUpItem, statsWithItemBonuses } from "../../common/items";
import { h } from "./dom";
import type { CurrencyPreview, HudCallbacks } from "./types";
import { itemDetails } from "./ItemDetails";
import { extractableSkills, purgeYield, upgradeCosts } from "../../common/inventory";

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

export function itemTile(tile: InventoryTile, callbacks: HudCallbacks, progress: PlayerProgress, onPreview?: (item?: InventoryTile["item"], equipped?: boolean, action?: "card" | "upgrade") => void, onCurrencyPreview?: (preview?: CurrencyPreview) => void, onSpellPreview?: (skills?: InventoryTile["item"]["skills"]) => void): HTMLElement {
  const item = tile.item; const equipped = itemStackKey(progress.mainHand) === tile.key || Boolean(progress.offHand && itemStackKey(progress.offHand) === tile.key); const spare = tile.quantity - Number(equipped); const skills = extractableSkills(item); const extractCost = item.sellValue * 10;
  const stats = statsWithItemBonuses(progress.stats, item);
  const node = (
    <div class={`item-card rarity-${item.rarity}${equipped ? " is-equipped" : ""}`} data-tile-id={tile.id}>
      <div class="item-card-content"><div class="item-title"><strong>{item.name}</strong><b>{equipped ? "Equipped · " : ""}x{tile.quantity}</b></div>
        <small class="item-subtitle">L{item.level} · {item.itemKind === "weapon" ? `${item.hands}H` : item.itemKind === "buckler" ? `${Math.round(item.blockChance * 100)}% block` : "Relic"} · {item.rarity}</small>
        {itemDetails(item, stats)}
      </div>
      <div class="item-card-controls"><div class="item-menu">
        <button type="button">{equipped ? "Unequip" : "Equip"}</button><button type="button">Sell {item.sellValue}g</button><button type="button">Purge</button>
        <button type="button">Upgrade</button><button type="button">Send</button>{skills.length ? <button type="button">Extract</button> : null}
      </div></div>
    </div>
  ) as HTMLElement;
  const buttons = [...node.querySelectorAll("button")]; buttons.forEach((button) => { (button as HTMLButtonElement).disabled = tile.quantity === 0; });
  if (tile.quantity > 0 && onPreview) { node.onmouseenter = () => onPreview(item, equipped); node.onmouseleave = () => { onPreview(); onCurrencyPreview?.(); onSpellPreview?.(); }; }
  if (spare <= 0) for (const index of [1, 2, 4, 5]) if (buttons[index]) (buttons[index] as HTMLButtonElement).disabled = true;
  if (equipped) for (const index of [1, 2, 4, 5]) if (buttons[index]) { (buttons[index] as HTMLButtonElement).disabled = true; (buttons[index] as HTMLButtonElement).title = "Unequip this stack first"; }
  const costs = upgradeCosts(item); const upgradeButton = buttons[3] as HTMLButtonElement | undefined;
  if (upgradeButton && (progress.gold < costs.gold || progress.scraps[item.rarity] < costs.scraps)) { upgradeButton.disabled = true; upgradeButton.title = `Requires ${costs.gold} gold and ${costs.scraps} ${item.rarity} scraps`; }
  buttons[0].onclick = () => callbacks.onEquip(tile.id);
  const bindBulk = (index: number, callback: (tileId: string, bulk: boolean) => void): void => { const button = buttons[index] as HTMLButtonElement | undefined; if (!button) return; if (!button.disabled) button.title = "Shift+click to repeat while possible"; button.onclick = (event) => callback(tile.id, event.shiftKey); };
  bindBulk(1, callbacks.onSell); bindBulk(2, callbacks.onPurge); bindBulk(3, callbacks.onUpgrade); bindBulk(4, callbacks.onSend); bindBulk(5, callbacks.onExtract);
  const extractButton = buttons[5] as HTMLButtonElement | undefined;
  if (extractButton && progress.gold < extractCost) { extractButton.disabled = true; extractButton.title = `Extracting costs ${extractCost} gold`; }
  const upgraded = levelUpItem(item, item.seed); const subtitle = node.querySelector<HTMLElement>(".item-subtitle")!; let details = node.querySelector<HTMLElement>(".equipment-details")!;
  const previewUpgradeCard = (active: boolean): void => { const shown = active ? upgraded : item; const shownStats = statsWithItemBonuses(progress.stats, shown); subtitle.textContent = active ? `L${item.level} → ${upgraded.level} · ${shown.itemKind === "weapon" ? `${shown.hands}H` : shown.itemKind === "buckler" ? `${Math.round(shown.blockChance * 100)}% block` : "Relic"} · ${shown.rarity}` : `L${item.level} · ${item.itemKind === "weapon" ? `${item.hands}H` : item.itemKind === "buckler" ? `${Math.round(item.blockChance * 100)}% block` : "Relic"} · ${item.rarity}`; subtitle.classList.toggle("is-gain-preview", active); const replacement = itemDetails(shown, shownStats, active ? item : undefined, active ? stats : undefined); details.replaceWith(replacement); details = replacement; };
  const bindActionPreview = (index: number, currency?: CurrencyPreview, enter?: () => void): void => { const button = buttons[index] as HTMLButtonElement | undefined; if (!button) return; button.addEventListener("mouseenter", () => { onPreview?.(); onCurrencyPreview?.(currency); onSpellPreview?.(); enter?.(); }); button.addEventListener("mouseleave", () => { onCurrencyPreview?.(); onSpellPreview?.(); onPreview?.(item, equipped); }); };
  bindActionPreview(1, { gold: item.sellValue }); bindActionPreview(2, { [item.rarity]: purgeYield(item) });
  const upgradePreview = buttons[3] as HTMLButtonElement | undefined; upgradePreview?.addEventListener("mouseenter", () => previewUpgradeCard(true)); upgradePreview?.addEventListener("mouseleave", () => previewUpgradeCard(false));
  bindActionPreview(3, { gold: -costs.gold, [item.rarity]: -costs.scraps }, () => { if (equipped && spare <= 0) onPreview?.(upgraded, true, "upgrade"); });
  bindActionPreview(4); bindActionPreview(5, { gold: -extractCost }, () => onSpellPreview?.(skills));
  return node;
}
