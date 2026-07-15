import { extractableSkills } from "../../common/inventory";
import { itemStackKey } from "../../common/items";
import type { InventoryTile, PlayerProgress } from "../../common/protocol";

export type ExtractButtonStatus = "hidden" | "equipped-only" | "needs-gold" | "available";

export function extractButtonStatus(tile: InventoryTile, progress: PlayerProgress): ExtractButtonStatus {
  if (!extractableSkills(tile.item).length) return "hidden";
  const equippedCopies = Number(itemStackKey(progress.mainHand) === tile.key)
    + Number(Boolean(progress.offHand && itemStackKey(progress.offHand) === tile.key));
  if (tile.quantity <= equippedCopies) return "equipped-only";
  return progress.gold < tile.item.sellValue * 10 ? "needs-gold" : "available";
}
