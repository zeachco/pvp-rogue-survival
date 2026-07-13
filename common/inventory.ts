import { itemStackKey, levelUpItem, meetsRequirements, type ItemInstance, type Rarity, type SkillId } from "./items";
import type { InventoryAutomation, InventoryTile, PlayerProgress } from "./protocol";

export interface InventoryResult { changed: boolean; reason: string; dropped?: ItemInstance[]; sent?: ItemInstance; created?: ItemInstance }
export const inventoryCapacity = (level: number): number => 4 + Math.ceil(level / 10);

export function collectIntoInventory(progress: PlayerProgress, item: ItemInstance, nextId: () => string, nextSeed: () => number): InventoryResult {
  let tile = progress.inventoryTiles.find((candidate) => candidate.key === itemStackKey(item));
  if (!tile) {
    if (progress.inventoryTiles.length >= inventoryCapacity(progress.level)) return { changed: false, reason: "Inventory configuration slots are full." };
    tile = { id: nextId(), key: itemStackKey(item), item, quantity: 0, automation: "keep" };
    progress.inventoryTiles.push(tile);
  }
  if (tile.automation === "sell") { progress.gold += item.sellValue; return { changed: true, reason: `Auto-sold ${item.name} for ${item.sellValue} gold.` }; }
  if (tile.automation === "purge") { const amount = purgeYield(item); progress.scraps[item.rarity] += amount; return { changed: true, reason: `Auto-purged ${item.name} for ${amount} ${item.rarity} scrap.` }; }
  tile.quantity += 1; runAutoMerges(progress, nextId, nextSeed);
  return { changed: true, reason: `Stored ${item.name}.` };
}

export function setAutomation(progress: PlayerProgress, tileId: string, automation: InventoryAutomation, nextId: () => string, nextSeed: () => number): InventoryResult {
  const tile = findTile(progress, tileId); if (!tile) return missing(); tile.automation = automation; runAutoMerges(progress, nextId, nextSeed);
  return { changed: true, reason: `${tile.item.name} set to ${automation}.` };
}

export function equipFromInventory(progress: PlayerProgress, tileId: string): InventoryResult {
  const tile = availableTile(progress, tileId); if (!tile) return missing(); const item = tile.item;
  if (!meetsRequirements(item, progress.stats)) return { changed: false, reason: "You do not meet that item's requirements." };
  if (item.itemKind === "buckler" && progress.mainHand.hands === 2) return { changed: false, reason: "A two-handed weapon cannot use a buckler." };
  const displaced: ItemInstance[] = [];
  if (item.itemKind === "buckler") { if (progress.offHand) displaced.push(progress.offHand); progress.offHand = consume(tile); }
  else {
    displaced.push(progress.mainHand); progress.mainHand = consume(tile);
    if (progress.mainHand.hands === 2 && progress.offHand) { displaced.push(progress.offHand); progress.offHand = undefined; }
  }
  const dropped = displaced.filter((old) => !storeExisting(progress, old));
  if (dropped.length) return { changed: true, reason: `Equipped ${item.name}; dropped ${dropped.map((old) => old.name).join(", ")}.`, dropped };
  return { changed: true, reason: `Equipped ${item.name}.` };
}

export function sellFromInventory(progress: PlayerProgress, tileId: string): InventoryResult { const tile = availableTile(progress, tileId); if (!tile) return missing(); tile.quantity -= 1; progress.gold += tile.item.sellValue; return { changed: true, reason: `Sold ${tile.item.name} for ${tile.item.sellValue} gold.` }; }
export function purgeFromInventory(progress: PlayerProgress, tileId: string): InventoryResult { const tile = availableTile(progress, tileId); if (!tile) return missing(); tile.quantity -= 1; const amount = purgeYield(tile.item); progress.scraps[tile.item.rarity] += amount; return { changed: true, reason: `Purged ${tile.item.name} for ${amount} ${tile.item.rarity} scrap.` }; }
export function sendFromInventory(progress: PlayerProgress, tileId: string): InventoryResult { const tile = availableTile(progress, tileId); if (!tile) return missing(); tile.quantity -= 1; return { changed: true, reason: `Queued ${tile.item.name} for the enemy realm.`, sent: { ...tile.item, id: `${tile.item.id}-sent` } }; }

export function mergeFromInventory(progress: PlayerProgress, tileId: string, nextId: () => string, nextSeed: () => number): InventoryResult {
  const tile = availableTile(progress, tileId); if (!tile || tile.quantity < 2) return { changed: false, reason: "Two matching copies are required." };
  const gold = Math.ceil(tile.item.sellValue * 2.5); const scraps = Math.ceil(tile.item.level * 3);
  if (progress.gold < gold || progress.scraps[tile.item.rarity] < scraps) return { changed: false, reason: `Requires ${gold} gold and ${scraps} ${tile.item.rarity} scraps.` };
  const created = levelUpItem(tile.item, nextSeed()); const existing = progress.inventoryTiles.find((candidate) => candidate.key === itemStackKey(created));
  if (!existing && progress.inventoryTiles.length >= inventoryCapacity(progress.level)) return { changed: false, reason: "No permanent tile is available for the leveled item." };
  tile.quantity -= 2; progress.gold -= gold; progress.scraps[tile.item.rarity] -= scraps;
  if (existing) existing.quantity += 1; else progress.inventoryTiles.push({ id: nextId(), key: itemStackKey(created), item: created, quantity: 1, automation: "keep" });
  return { changed: true, reason: `Leveled ${tile.item.name} to ${created.level}.`, created };
}

export function extractFromInventory(progress: PlayerProgress, tileId: string): InventoryResult {
  const tile = availableTile(progress, tileId); if (!tile) return missing(); const skills = tile.item.skills.filter((skill) => skill !== "healing");
  if (!skills.length) return { changed: false, reason: "That item has no extractable skill." }; const cost = tile.item.sellValue * 10;
  if (progress.gold < cost) return { changed: false, reason: `Extracting costs ${cost} gold.` }; progress.gold -= cost; tile.quantity -= 1;
  for (const skill of skills) learnSkill(progress, skill); return { changed: true, reason: `Extracted ${skills.join(", ")} for ${cost} gold.` };
}

function runAutoMerges(progress: PlayerProgress, nextId: () => string, nextSeed: () => number): void { for (const tile of [...progress.inventoryTiles]) while (tile.automation === "merge" && tile.quantity >= 2 && mergeFromInventory(progress, tile.id, nextId, nextSeed).changed) {} }
export const processAutoMerges = runAutoMerges;
function storeExisting(progress: PlayerProgress, item: ItemInstance): boolean { let tile = progress.inventoryTiles.find((candidate) => candidate.key === itemStackKey(item)); if (!tile) { if (progress.inventoryTiles.length >= inventoryCapacity(progress.level)) return false; tile = { id: `tile-${item.id}`, key: itemStackKey(item), item, quantity: 0, automation: "keep" }; progress.inventoryTiles.push(tile); } tile.quantity += 1; return true; }
function consume(tile: InventoryTile): ItemInstance { tile.quantity -= 1; return { ...tile.item, id: `${tile.item.id}-equipped` }; }
function availableTile(progress: PlayerProgress, id: string): InventoryTile | undefined { const tile = findTile(progress, id); return tile && tile.quantity > 0 ? tile : undefined; }
function findTile(progress: PlayerProgress, id: string): InventoryTile | undefined { return progress.inventoryTiles.find((tile) => tile.id === id); }
function missing(): InventoryResult { return { changed: false, reason: "That equipment is no longer available." }; }
function purgeYield(item: ItemInstance): number { return Math.max(1, Math.ceil(item.level / 3)); }
function learnSkill(progress: PlayerProgress, skill: SkillId): void { if (!progress.learnedSkills.includes(skill)) progress.learnedSkills.push(skill); progress.learnedSkillLevels[skill] = (progress.learnedSkillLevels[skill] ?? 0) + 1; }
export function emptyScraps(): Record<Rarity, number> { return { common: 0, uncommon: 0, rare: 0, epic: 0 }; }

// Transitional aliases used by older call sites while protocol v2 is composed.
export const collectIntoBackpack = collectIntoInventory;
export const equipFromBackpack = equipFromInventory;
export const sellFromBackpack = sellFromInventory;
export const extractFromBackpack = extractFromInventory;
