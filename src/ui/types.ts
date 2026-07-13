import type { SkillId } from "../../common/items";
import type { InventoryAutomation } from "../../common/protocol";
import type { Stats } from "../../common/progression";

export interface HudCallbacks {
  onJoin(name: string): void; onAllocation(stats: Stats): void; onEquip(tileId: string): void; onSell(tileId: string): void;
  onPurge(tileId: string): void; onMerge(tileId: string): void; onSend(tileId: string): void; onExtract(tileId: string): void;
  onAutomation(tileId: string, mode: InventoryAutomation): void; onLeaveRealm(): void; onEnterRealm(): void; onBack(): void; onStart(): void;
}
export interface SpellSlot { id: SkillId; label: string; level: number; cooldown: number; cooldownMax: number }
