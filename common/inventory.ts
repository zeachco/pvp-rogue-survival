import { itemAutomationKey, itemStackKey, levelUpItem, meetsRequirements, type ItemInstance, type Rarity, type SkillId } from "./items";
import type { InventoryAutomation, InventoryTile, PlayerProgress } from "./protocol";

export interface InventoryResult { changed: boolean; reason: string; dropped?: ItemInstance[]; sent?: ItemInstance; created?: ItemInstance }
export const inventoryCapacity = (level: number): number => 4 + Math.ceil(level / 10);
export const occupiedInventorySlots = (progress: PlayerProgress): number => progress.inventoryTiles.filter((tile) => tile.quantity > 0).length;

export function collectIntoInventory(progress: PlayerProgress, item: ItemInstance, nextId: () => string, nextSeed: () => number): InventoryResult {
  let tile = progress.inventoryTiles.find((candidate) => isLevelAgnosticAutomation(candidate.automation) && itemAutomationKey(candidate.item) === itemAutomationKey(item));
  tile ??= progress.inventoryTiles.find((candidate) => candidate.key === itemStackKey(item));
  if (!tile) {
    if (occupiedInventorySlots(progress) >= inventoryCapacity(progress.level)) return { changed: false, reason: "Inventory slots are full." };
    tile = { id: nextId(), key: itemStackKey(item), item, quantity: 0, automation: "keep" };
    progress.inventoryTiles.push(tile);
  }
  if (tile.automation === "sell") { progress.gold += item.sellValue; runAutoUpgrades(progress, nextId, nextSeed); return { changed: true, reason: `Auto-sold ${item.name} for ${item.sellValue} gold.` }; }
  if (tile.automation === "purge") { const amount = purgeYield(item); progress.scraps[item.rarity] += amount; runAutoUpgrades(progress, nextId, nextSeed); return { changed: true, reason: `Auto-purged ${item.name} for ${amount} ${item.rarity} scrap.` }; }
  if (tile.quantity === 0 && occupiedInventorySlots(progress) >= inventoryCapacity(progress.level)) return { changed: false, reason: "Inventory slots are full." };
  tile.quantity += 1; runAutoUpgrades(progress, nextId, nextSeed);
  return { changed: true, reason: `Stored ${item.name}.` };
}

export function setAutomation(progress: PlayerProgress, tileId: string, automation: InventoryAutomation, nextId: () => string, nextSeed: () => number): InventoryResult {
  const tile = findTile(progress, tileId); if (!tile) return missing();
  if ((automation === "sell" || automation === "purge") && isEquippedTile(progress, tile)) return { changed: false, reason: "Equipped items cannot be auto-sold or auto-purged." };
  tile.automation = automation;
  let reason = `${tile.item.name} set to ${automation === "upgrade" ? "Auto Upgrade" : automation}.`;
  if (automation === "sell" && tile.quantity > 0) { const quantity = tile.quantity; const gold = quantity * tile.item.sellValue; tile.quantity = 0; progress.gold += gold; reason = `Auto-sold ${quantity} ${tile.item.name} for ${gold} gold.`; }
  if (automation === "purge" && tile.quantity > 0) { const quantity = tile.quantity; const scraps = quantity * purgeYield(tile.item); tile.quantity = 0; progress.scraps[tile.item.rarity] += scraps; reason = `Auto-purged ${quantity} ${tile.item.name} for ${scraps} ${tile.item.rarity} scrap.`; }
  runAutoUpgrades(progress, nextId, nextSeed); return { changed: true, reason };
}

export function equipFromInventory(progress: PlayerProgress, tileId: string): InventoryResult {
  const tile = findTile(progress, tileId); if (!tile || tile.quantity <= 0) return missing(); const item = tile.item;
  if (!meetsRequirements(item, progress.stats)) return { changed: false, reason: "You do not meet that item's requirements." };
  if (item.itemKind === "buckler" && progress.mainHand.hands === 2) return { changed: false, reason: "A two-handed weapon cannot use a buckler." };
  const displaced: ItemInstance[] = [];
  if (item.itemKind === "buckler") { if (progress.offHand) displaced.push(progress.offHand); }
  else {
    displaced.push(progress.mainHand);
    if (item.hands === 2 && progress.offHand) displaced.push(progress.offHand);
  }
  const missingItems = displaced.filter((old, index) => displaced.findIndex((candidate) => itemStackKey(candidate) === itemStackKey(old)) === index && !progress.inventoryTiles.some((candidate) => candidate.quantity > 0 && candidate.key === itemStackKey(old)));
  if (occupiedInventorySlots(progress) + missingItems.length > inventoryCapacity(progress.level)) return { changed: false, reason: "No inventory slot is available to retain the currently equipped item." };
  for (const old of missingItems) storeExisting(progress, old);
  if (item.itemKind === "buckler") progress.offHand = { ...item, id: `${item.id}-equipped` };
  else { progress.mainHand = { ...item, id: `${item.id}-equipped` }; if (progress.mainHand.hands === 2) progress.offHand = undefined; }
  return { changed: true, reason: `Equipped ${item.name}.` };
}

export function sellFromInventory(progress: PlayerProgress, tileId: string): InventoryResult { const tile = findTile(progress, tileId); if (!tile || tile.quantity <= 0) return missing(); if (isEquippedTile(progress, tile)) return { changed: false, reason: "Equipped items cannot be sold." }; tile.quantity -= 1; progress.gold += tile.item.sellValue; return { changed: true, reason: `Sold ${tile.item.name} for ${tile.item.sellValue} gold.` }; }
export function purgeFromInventory(progress: PlayerProgress, tileId: string): InventoryResult { const tile = findTile(progress, tileId); if (!tile || tile.quantity <= 0) return missing(); if (isEquippedTile(progress, tile)) return { changed: false, reason: "Equipped items cannot be purged." }; tile.quantity -= 1; const amount = purgeYield(tile.item); progress.scraps[tile.item.rarity] += amount; return { changed: true, reason: `Purged ${tile.item.name} for ${amount} ${tile.item.rarity} scrap.` }; }
export function sendFromInventory(progress: PlayerProgress, tileId: string): InventoryResult { const tile = availableTile(progress, tileId); if (!tile) return missing(); tile.quantity -= 1; return { changed: true, reason: `Queued ${tile.item.name} for the enemy realm.`, sent: { ...tile.item, id: `${tile.item.id}-sent` } }; }

export function upgradeFromInventory(progress: PlayerProgress, tileId: string, nextId: () => string, nextSeed: () => number): InventoryResult {
  const tile = availableTile(progress, tileId); if (!tile) return missing();
  const gold = Math.ceil(tile.item.sellValue * 2.5); const scraps = 3 * (tile.item.level + 1);
  if (progress.gold < gold || progress.scraps[tile.item.rarity] < scraps) return { changed: false, reason: `Requires ${gold} gold and ${scraps} ${tile.item.rarity} scraps.` };
  const created = levelUpItem(tile.item, nextSeed()); const existing = progress.inventoryTiles.find((candidate) => candidate.key === itemStackKey(created));
  const outputOccupiesSlot = !existing || existing.quantity === 0; const sourceFreesSlot = tile.quantity === 1;
  if (occupiedInventorySlots(progress) - Number(sourceFreesSlot) + Number(outputOccupiesSlot) > inventoryCapacity(progress.level)) return { changed: false, reason: "No inventory slot is available for the upgraded item." };
  tile.quantity -= 1; progress.gold -= gold; progress.scraps[tile.item.rarity] -= scraps;
  if (existing) existing.quantity += 1; else progress.inventoryTiles.push({ id: nextId(), key: itemStackKey(created), item: created, quantity: 1, automation: tile.automation });
  return { changed: true, reason: `Upgraded ${tile.item.name} to level ${created.level}.`, created };
}

export function extractFromInventory(progress: PlayerProgress, tileId: string): InventoryResult {
  const tile = availableTile(progress, tileId); if (!tile) return missing(); const skills = tile.item.skills.filter((skill) => skill !== "healing");
  if (!skills.length) return { changed: false, reason: "That item has no extractable skill." }; const cost = tile.item.sellValue * 10;
  if (progress.gold < cost) return { changed: false, reason: `Extracting costs ${cost} gold.` }; progress.gold -= cost; tile.quantity -= 1;
  for (const skill of skills) learnSkill(progress, skill); return { changed: true, reason: `Extracted ${skills.join(", ")} for ${cost} gold.` };
}

function runAutoUpgrades(progress: PlayerProgress, nextId: () => string, nextSeed: () => number): void {
  let upgraded = true;
  while (upgraded) {
    upgraded = false;
    for (const tile of [...progress.inventoryTiles]) {
      if (tile.automation !== "upgrade" || tile.quantity <= 0) continue;
      if (upgradeFromInventory(progress, tile.id, nextId, nextSeed).changed) { upgraded = true; break; }
    }
  }
}
export const processAutoUpgrades = runAutoUpgrades;
function storeExisting(progress: PlayerProgress, item: ItemInstance): boolean { let tile = progress.inventoryTiles.find((candidate) => candidate.key === itemStackKey(item)); if ((!tile || tile.quantity === 0) && occupiedInventorySlots(progress) >= inventoryCapacity(progress.level)) return false; if (!tile) { tile = { id: `tile-${item.id}`, key: itemStackKey(item), item, quantity: 0, automation: "keep" }; progress.inventoryTiles.push(tile); } tile.quantity += 1; return true; }
function availableTile(progress: PlayerProgress, id: string): InventoryTile | undefined { const tile = findTile(progress, id); return tile && tile.quantity > equippedCopies(progress, tile) ? tile : undefined; }
function findTile(progress: PlayerProgress, id: string): InventoryTile | undefined { return progress.inventoryTiles.find((tile) => tile.id === id); }
export function isEquippedTile(progress: PlayerProgress, tile: InventoryTile): boolean { return equippedCopies(progress, tile) > 0; }
function equippedCopies(progress: PlayerProgress, tile: InventoryTile): number { return Number(itemStackKey(progress.mainHand) === tile.key) + Number(Boolean(progress.offHand && itemStackKey(progress.offHand) === tile.key)); }
function missing(): InventoryResult { return { changed: false, reason: "That equipment is no longer available." }; }
function isLevelAgnosticAutomation(automation: InventoryAutomation): boolean { return automation === "sell" || automation === "purge"; }
function purgeYield(item: ItemInstance): number { return Math.max(1, Math.ceil(item.level / 3)); }
function learnSkill(progress: PlayerProgress, skill: SkillId): void { if (!progress.learnedSkills.includes(skill)) progress.learnedSkills.push(skill); progress.learnedSkillLevels[skill] = (progress.learnedSkillLevels[skill] ?? 0) + 1; }
export function emptyScraps(): Record<Rarity, number> { return { common: 0, uncommon: 0, rare: 0, epic: 0 }; }
