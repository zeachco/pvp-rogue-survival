/** @jsx h */
import type { InventoryTile, PlayerProgress } from "../../common/protocol";
import { itemStackKey, levelUpItem, MAX_ITEM_LEVEL, statsWithItemBonuses } from "../../common/items";
import { h } from "./dom";
import type { CurrencyPreview, HudCallbacks } from "./types";
import { bindRequirementPreview, itemDetails } from "./ItemDetails";
import { extractableSkills, purgeYield, sellYield, upgradeCosts } from "../../common/inventory";
import { extractButtonStatus } from "./inventoryAvailability";

export function orderInventoryTiles(tiles: InventoryTile[], progress: PlayerProgress): InventoryTile[] {
  void progress; return tiles.filter((tile) => tile.quantity > 0);
}

export function itemTile(tile: InventoryTile, callbacks: HudCallbacks, progress: PlayerProgress, onPreview?: (item?: InventoryTile["item"], equipped?: boolean, action?: "card" | "upgrade") => void, onCurrencyPreview?: (preview?: CurrencyPreview) => void, onSpellPreview?: (skills?: InventoryTile["item"]["skills"]) => void, canSend = false): HTMLElement {
  const item = tile.item; const equipped = itemStackKey(progress.mainHand) === tile.key || Boolean(progress.offHand && itemStackKey(progress.offHand) === tile.key); const spare = tile.quantity - Number(equipped); const skills = extractableSkills(item); const extractCost = item.sellValue * 10; const extractStatus = extractButtonStatus(tile, progress);
  const stats = statsWithItemBonuses(progress.stats, item);
  const node = (
    <div class={`item-card rarity-${item.rarity}${equipped ? " is-equipped" : ""}`} data-tile-id={tile.id}>
      <div class="item-card-content"><div class="item-title"><strong>{item.name}</strong><b>x{tile.quantity}</b></div>
        <small class="item-subtitle">L{item.level} · {itemKindLabel(item)} · {item.rarity}</small>
        {itemDetails(item, stats)}
      </div>
      <div class="item-card-controls"><div class="item-menu">
        <button type="button">Sell {sellYield(item)}g</button><button type="button">Purge</button>
        <button type="button">Upgrade</button><button type="button">Send</button>{skills.length ? <button type="button">Extract</button> : null}
      </div></div>
    </div>
  ) as HTMLElement;
  bindRequirementPreview(node.querySelector<HTMLElement>(".equipment-details")!, item, stats);
  const buttons = [...node.querySelectorAll("button")]; buttons.forEach((button) => { (button as HTMLButtonElement).disabled = tile.quantity === 0; });
  node.onclick = (event) => { if (event.button === 0 && (!(event.target instanceof Element) || !event.target.closest("button"))) callbacks.onEquip(tile.id); };
  if (tile.quantity > 0 && onPreview) { node.onmouseenter = () => onPreview(item, equipped); node.onmouseleave = () => { onPreview(); onCurrencyPreview?.(); onSpellPreview?.(); }; }
  if (spare <= 0) for (const index of [0, 1, 3, 4]) if (buttons[index]) (buttons[index] as HTMLButtonElement).disabled = true;
  const sendButton = buttons[3] as HTMLButtonElement | undefined;
  if (sendButton && !canSend) { sendButton.disabled = true; sendButton.title = "Waiting for realm state"; }
  const costs = upgradeCosts(item); const upgradeButton = buttons[2] as HTMLButtonElement | undefined;
  if (upgradeButton && item.rarity === "epic" && item.level >= MAX_ITEM_LEVEL.epic) { upgradeButton.disabled = true; upgradeButton.title = "Maximum Epic level reached"; }
  if (upgradeButton && (progress.gold < costs.gold || progress.scraps[item.rarity] < costs.scraps)) { upgradeButton.disabled = true; upgradeButton.title = `Requires ${costs.gold} gold and ${costs.scraps} ${item.rarity} scraps`; }
  const bindBulk = (index: number, callback: (tileId: string, bulk: boolean) => void): void => { const button = buttons[index] as HTMLButtonElement | undefined; if (!button) return; if (!button.disabled) button.title = "Shift+click to repeat while possible"; button.onclick = (event) => callback(tile.id, event.shiftKey); };
  bindBulk(0, callbacks.onSell); bindBulk(1, callbacks.onPurge); bindBulk(2, callbacks.onUpgrade); bindBulk(3, callbacks.onSend); bindBulk(4, callbacks.onExtract);
  const extractButton = buttons[4] as HTMLButtonElement | undefined;
  if (extractButton && extractStatus === "needs-gold") { extractButton.disabled = true; extractButton.title = `Extracting costs ${extractCost} gold`; }
  const upgraded = levelUpItem(item, item.seed); const subtitle = node.querySelector<HTMLElement>(".item-subtitle")!; let details = node.querySelector<HTMLElement>(".equipment-details")!;
  const previewUpgradeCard = (active: boolean): void => { const shown = active ? upgraded : item; const shownStats = statsWithItemBonuses(progress.stats, shown); subtitle.textContent = active ? `L${item.level} → ${upgraded.level} · ${itemKindLabel(shown)} · ${shown.rarity}` : `L${item.level} · ${itemKindLabel(item)} · ${item.rarity}`; subtitle.classList.toggle("is-gain-preview", active); const replacement = itemDetails(shown, shownStats, active ? item : undefined, active ? stats : undefined); details.replaceWith(replacement); details = replacement; bindRequirementPreview(details, shown, shownStats); };
  const bindActionPreview = (index: number, currency?: CurrencyPreview, enter?: () => void): void => { const button = buttons[index] as HTMLButtonElement | undefined; if (!button) return; button.addEventListener("mouseenter", () => { onPreview?.(); onCurrencyPreview?.(currency); onSpellPreview?.(); enter?.(); }); button.addEventListener("mouseleave", () => { onCurrencyPreview?.(); onSpellPreview?.(); onPreview?.(item, equipped); }); };
  bindActionPreview(0, { gold: sellYield(item) }); bindActionPreview(1, { [item.rarity]: purgeYield(item) });
  const upgradePreview = buttons[2] as HTMLButtonElement | undefined; upgradePreview?.addEventListener("mouseenter", () => previewUpgradeCard(true)); upgradePreview?.addEventListener("mouseleave", () => previewUpgradeCard(false));
  bindActionPreview(2, { gold: -costs.gold, [item.rarity]: -costs.scraps }, () => { if (equipped && spare <= 0) onPreview?.(upgraded, true, "upgrade"); });
  bindActionPreview(3); bindActionPreview(4, { gold: -extractCost }, () => onSpellPreview?.(skills));
  return node;
}
function itemKindLabel(item: InventoryTile["item"]): string { return item.itemKind === "weapon" ? `${item.hands}H` : item.itemKind === "buckler" ? `${Math.round(item.blockChance * 100)}% block` : item.itemKind === "relic" ? "Relic" : item.itemKind === "amulet" ? "Amulet" : "Charm"; }
