import { itemMergeKey, meetsRequirements, mergeItems, type ItemInstance, type SkillId } from "./items";
import type { PlayerProgress } from "./protocol";

export interface InventoryResult { changed: boolean; reason: string; merged: ItemInstance[] }

export function collectIntoBackpack(progress: PlayerProgress, item: ItemInstance, nextSeed: () => number): InventoryResult {
  const wouldMerge = progress.backpack.filter((candidate) => itemMergeKey(candidate) === itemMergeKey(item)).length >= 2;
  if (progress.backpack.length >= 8 && !wouldMerge) return { changed: false, reason: "Backpack is full.", merged: [] };
  progress.backpack.push(item);
  const merged = mergeBackpackTriples(progress, nextSeed);
  return { changed: true, reason: merged.length ? `Merged ${merged.map((entry) => entry.name).join(", ")} into stronger gear.` : `Picked up ${item.name}.`, merged };
}

export function equipFromBackpack(progress: PlayerProgress, itemId: string, nextSeed: () => number): InventoryResult {
  const index = progress.backpack.findIndex((item) => item.id === itemId);
  if (index < 0) return { changed: false, reason: "Item is no longer in the backpack.", merged: [] };
  const item = progress.backpack[index];
  if (!meetsRequirements(item, progress.stats)) return { changed: false, reason: "You do not meet that weapon's requirements.", merged: [] };
  progress.backpack[index] = progress.equipped;
  progress.equipped = item;
  const merged = mergeBackpackTriples(progress, nextSeed);
  return { changed: true, reason: merged.length ? `Equipped ${item.name}. Merged matching backpack items.` : `Equipped ${item.name}.`, merged };
}

export function sellFromBackpack(progress: PlayerProgress, itemId: string): InventoryResult {
  const index = progress.backpack.findIndex((item) => item.id === itemId);
  if (index < 0) return { changed: false, reason: "Item is no longer in the backpack.", merged: [] };
  const [item] = progress.backpack.splice(index, 1);
  progress.gold += item.sellValue;
  return { changed: true, reason: `Sold ${item.name} for ${item.sellValue} gold.`, merged: [] };
}

export function extractFromBackpack(progress: PlayerProgress, itemId: string): InventoryResult {
  const index = progress.backpack.findIndex((item) => item.id === itemId);
  if (index < 0) return { changed: false, reason: "Item is no longer in the backpack.", merged: [] };
  const item = progress.backpack[index];
  const skills = item.skills.filter((skill) => skill !== "healing");
  if (!skills.length) return { changed: false, reason: "That weapon has no extractable skill.", merged: [] };
  const cost = item.sellValue * 10;
  if (progress.gold < cost) return { changed: false, reason: `Extracting ${skills.join(", ")} costs ${cost} gold.`, merged: [] };
  progress.gold -= cost;
  progress.backpack.splice(index, 1);
  for (const skill of skills) learnSkill(progress, skill);
  return { changed: true, reason: `Extracted ${skills.join(", ")} for ${cost} gold.`, merged: [] };
}

export function mergeBackpackTriples(progress: PlayerProgress, nextSeed: () => number): ItemInstance[] {
  const merged: ItemInstance[] = [];
  while (true) {
    const groups = new Map<string, number[]>();
    progress.backpack.forEach((item, index) => groups.set(itemMergeKey(item), [...(groups.get(itemMergeKey(item)) ?? []), index]));
    const group = [...groups.values()].find((indices) => indices.length >= 3);
    if (!group) return merged;
    const consumed = group.slice(0, 3).sort((a, b) => b - a);
    const base = progress.backpack[consumed[0]];
    for (const index of consumed) progress.backpack.splice(index, 1);
    const item = mergeItems(base, nextSeed());
    progress.backpack.push(item);
    merged.push(item);
  }
}

function learnSkill(progress: PlayerProgress, skill: SkillId): void {
  if (!progress.learnedSkills.includes(skill)) progress.learnedSkills.push(skill);
  progress.learnedSkillLevels[skill] = (progress.learnedSkillLevels[skill] ?? 0) + 1;
}
