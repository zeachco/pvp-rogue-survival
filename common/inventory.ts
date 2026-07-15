import { itemStackKey, levelUpItem, MAX_ITEM_LEVEL, starterClub, type ItemInstance, type Rarity, type SkillId } from "./items";
import type { InventoryTile, PlayerProgress } from "./protocol";
import { MAX_SKILL_LEVEL } from "./combat";

export interface InventoryResult { changed: boolean; reason: string; dropped?: ItemInstance[]; sent?: ItemInstance; created?: ItemInstance }
export function upgradeCosts(item: ItemInstance): { gold: number; scraps: number } { const attributePoints = Object.values(item.statBonuses).reduce((sum, value) => sum + Math.max(0, value ?? 0), 0); const factor = 1 + 0.1 * attributePoints; return { gold: Math.ceil(item.sellValue * 1.5 * factor), scraps: Math.ceil(2 * (item.level + 1) * factor) }; }
export const inventoryCapacity = (level: number): number => 4 + Math.ceil(level / 10);
export const occupiedInventorySlots = (progress: PlayerProgress): number => progress.inventoryTiles.filter((tile) => tile.quantity > 0).length;
export function removeEmptyInventoryTiles(progress: PlayerProgress): void { progress.inventoryTiles = progress.inventoryTiles.filter((tile) => tile.quantity > 0 || isEquippedTile(progress, tile)); }

export function collectIntoInventory(progress: PlayerProgress, item: ItemInstance, nextId: () => string, nextSeed: () => number): InventoryResult {
  let tile = progress.inventoryTiles.find((candidate) => candidate.key === itemStackKey(item));
  if (!tile) {
    if (occupiedInventorySlots(progress) >= inventoryCapacity(progress.level)) return { changed: false, reason: "Inventory slots are full." };
    tile = { id: nextId(), key: itemStackKey(item), item, quantity: 0 };
    progress.inventoryTiles.push(tile);
  }
  if (tile.quantity === 0 && occupiedInventorySlots(progress) >= inventoryCapacity(progress.level)) return { changed: false, reason: "Inventory slots are full." };
  tile.quantity += 1; void nextSeed;
  return { changed: true, reason: `Stored ${item.name}.` };
}

export function equipFromInventory(progress: PlayerProgress, tileId: string): InventoryResult {
  const tile = findTile(progress, tileId); if (!tile || tile.quantity <= 0) return missing(); const item = tile.item;
  if (progress.offHand && itemStackKey(progress.offHand) === tile.key) { progress.offHand = undefined; return { changed: true, reason: `Unequipped ${item.name}.` }; }
  if (itemStackKey(progress.mainHand) === tile.key) {
    const fallback = starterClub(); if (itemStackKey(fallback) === tile.key) return { changed: false, reason: "The starter club cannot be unequipped." };
    let fallbackTile = progress.inventoryTiles.find((candidate) => candidate.key === itemStackKey(fallback));
    if ((!fallbackTile || fallbackTile.quantity === 0) && occupiedInventorySlots(progress) >= inventoryCapacity(progress.level)) return { changed: false, reason: "No inventory slot is available for the starter club." };
    if (!fallbackTile) { fallbackTile = { id: "starter-club-tile", key: itemStackKey(fallback), item: fallback, quantity: 1 }; progress.inventoryTiles.push(fallbackTile); }
    else fallbackTile.quantity = Math.max(1, fallbackTile.quantity);
    progress.mainHand = { ...fallback, id: `${fallback.id}-equipped` }; return { changed: true, reason: `Unequipped ${item.name}; restored Plain Club.` };
  }
  if (item.itemKind !== "weapon" && progress.mainHand.hands === 2) return { changed: false, reason: "A two-handed weapon cannot use an offhand item." };
  const displaced: ItemInstance[] = [];
  if (item.itemKind !== "weapon") { if (progress.offHand) displaced.push(progress.offHand); }
  else {
    displaced.push(progress.mainHand);
    if (item.hands === 2 && progress.offHand) displaced.push(progress.offHand);
  }
  const missingItems = displaced.filter((old, index) => displaced.findIndex((candidate) => itemStackKey(candidate) === itemStackKey(old)) === index && !progress.inventoryTiles.some((candidate) => candidate.quantity > 0 && candidate.key === itemStackKey(old)));
  if (occupiedInventorySlots(progress) + missingItems.length > inventoryCapacity(progress.level)) return { changed: false, reason: "No inventory slot is available to retain the currently equipped item." };
  for (const old of missingItems) storeExisting(progress, old);
  if (item.itemKind !== "weapon") progress.offHand = { ...item, id: `${item.id}-equipped` };
  else { progress.mainHand = { ...item, id: `${item.id}-equipped` }; if (progress.mainHand.hands === 2) progress.offHand = undefined; }
  return { changed: true, reason: `Equipped ${item.name}.` };
}

export function sellFromInventory(progress: PlayerProgress, tileId: string): InventoryResult { const tile = availableTile(progress, tileId); if (!tile) return missing(); tile.quantity -= 1; progress.gold += tile.item.sellValue; removeEmptyInventoryTiles(progress); return { changed: true, reason: `Sold ${tile.item.name} for ${tile.item.sellValue} gold.` }; }
export function purgeFromInventory(progress: PlayerProgress, tileId: string): InventoryResult { const tile = availableTile(progress, tileId); if (!tile) return missing(); tile.quantity -= 1; const amount = purgeYield(tile.item); progress.scraps[tile.item.rarity] += amount; removeEmptyInventoryTiles(progress); return { changed: true, reason: `Purged ${tile.item.name} for ${amount} ${tile.item.rarity} scrap.` }; }
export function sendFromInventory(progress: PlayerProgress, tileId: string): InventoryResult { const tile = availableTile(progress, tileId); if (!tile) return missing(); tile.quantity -= 1; const result = { changed: true, reason: `Queued ${tile.item.name} for the enemy realm.`, sent: { ...tile.item, id: `${tile.item.id}-sent` } }; removeEmptyInventoryTiles(progress); return result; }

export function upgradeFromInventory(progress: PlayerProgress, tileId: string, nextId: () => string, nextSeed: () => number): InventoryResult {
  const tile = findTile(progress, tileId); if (!tile || tile.quantity <= 0) return missing();
  if (tile.item.rarity === "epic" && tile.item.level >= MAX_ITEM_LEVEL.epic) return { changed: false, reason: "Epic equipment is already at the maximum level." };
  const { gold, scraps } = upgradeCosts(tile.item);
  if (progress.gold < gold || progress.scraps[tile.item.rarity] < scraps) return { changed: false, reason: `Requires ${gold} gold and ${scraps} ${tile.item.rarity} scraps.` };
  const created = levelUpItem(tile.item, nextSeed()); const existing = progress.inventoryTiles.find((candidate) => candidate.key === itemStackKey(created));
  const outputOccupiesSlot = !existing || existing.quantity === 0; const sourceFreesSlot = tile.quantity === 1;
  if (occupiedInventorySlots(progress) - Number(sourceFreesSlot) + Number(outputOccupiesSlot) > inventoryCapacity(progress.level)) return { changed: false, reason: "No inventory slot is available for the upgraded item." };
  const upgradesEquippedCopy = tile.quantity <= equippedCopies(progress, tile); const upgradesMainHand = upgradesEquippedCopy && itemStackKey(progress.mainHand) === tile.key; const upgradesOffHand = upgradesEquippedCopy && Boolean(progress.offHand && itemStackKey(progress.offHand) === tile.key);
  tile.quantity -= 1; progress.gold -= gold; progress.scraps[tile.item.rarity] -= scraps;
  if (existing) existing.quantity += 1; else progress.inventoryTiles.push({ id: nextId(), key: itemStackKey(created), item: created, quantity: 1 });
  if (upgradesMainHand) progress.mainHand = { ...created, id: `${created.id}-equipped` };
  if (upgradesOffHand) progress.offHand = { ...created, id: `${created.id}-equipped` };
  removeEmptyInventoryTiles(progress);
  return { changed: true, reason: `Upgraded ${tile.item.name} to level ${created.level}.`, created };
}

export function extractFromInventory(progress: PlayerProgress, tileId: string): InventoryResult {
  const tile = availableTile(progress, tileId); if (!tile) return missing(); const skills = extractableSkills(tile.item);
  if (!skills.length) return { changed: false, reason: "That item has no extractable skill." }; const cost = tile.item.sellValue * 10;
  if (progress.gold < cost) return { changed: false, reason: `Extracting costs ${cost} gold.` }; progress.gold -= cost; tile.quantity -= 1;
  const universal = tile.item.rarity === "epic"; for (const skill of skills) learnSkill(progress, skill, universal); removeEmptyInventoryTiles(progress); return { changed: true, reason: `Extracted ${skills.join(", ")} for ${cost} gold${universal ? "; available with any weapon" : ""}.` };
}

export function extractableSkills(item: ItemInstance): SkillId[] { return item.skills.filter((skill) => skill !== "healing" && skill !== "blocking"); }

function storeExisting(progress: PlayerProgress, item: ItemInstance): boolean { let tile = progress.inventoryTiles.find((candidate) => candidate.key === itemStackKey(item)); if ((!tile || tile.quantity === 0) && occupiedInventorySlots(progress) >= inventoryCapacity(progress.level)) return false; if (!tile) { tile = { id: `tile-${item.id}`, key: itemStackKey(item), item, quantity: 0 }; progress.inventoryTiles.push(tile); } tile.quantity += 1; return true; }
function availableTile(progress: PlayerProgress, id: string): InventoryTile | undefined { const tile = findTile(progress, id); return tile && tile.quantity > equippedCopies(progress, tile) ? tile : undefined; }
function findTile(progress: PlayerProgress, id: string): InventoryTile | undefined { return progress.inventoryTiles.find((tile) => tile.id === id); }
export function isEquippedTile(progress: PlayerProgress, tile: InventoryTile): boolean { return equippedCopies(progress, tile) > 0; }
function equippedCopies(progress: PlayerProgress, tile: InventoryTile): number { return Number(itemStackKey(progress.mainHand) === tile.key) + Number(Boolean(progress.offHand && itemStackKey(progress.offHand) === tile.key)); }
function missing(): InventoryResult { return { changed: false, reason: "That equipment is no longer available." }; }
export function purgeYield(item: ItemInstance): number { return Math.max(1, Math.ceil(item.level / 3)); }
function learnSkill(progress: PlayerProgress, skill: SkillId, universal: boolean): void { if (!progress.learnedSkills.includes(skill)) progress.learnedSkills.push(skill); progress.learnedSkillLevels[skill] = Math.min(MAX_SKILL_LEVEL, (progress.learnedSkillLevels[skill] ?? 0) + 1); if (universal && !progress.universalSkills.includes(skill)) progress.universalSkills.push(skill); }
export function emptyScraps(): Record<Rarity, number> { return { common: 0, uncommon: 0, rare: 0, epic: 0 }; }
