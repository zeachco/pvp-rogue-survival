import type { SkillId } from "../../common/items";
import type { Stats } from "../../common/progression";

export interface HudCallbacks {
  onJoin(name: string): void; onAllocation(stats: Stats): void; onRespec(stats: Stats): void; onEquip(tileId: string): void; onSell(tileId: string, bulk: boolean): void;
  onPurge(tileId: string, bulk: boolean): void; onUpgrade(tileId: string, bulk: boolean): void; onSend(tileId: string, bulk: boolean): void; onExtract(tileId: string, bulk: boolean): void;
  onLeaveRealm(): void; onEnterRealm(): void; onKillPlayer(): void; onBack(): void;
  onLogout(): void; onInspectHero(heroId: string): void; onDismissPanelTrigger(panel: "character" | "inventory"): void;
}
export type CurrencyPreview = Partial<Record<"gold" | "common" | "uncommon" | "rare" | "epic", number>>;
export interface SpellSlot { id: SkillId; label: string; level: number; cooldown: number; cooldownMax: number; resource: "mana" | "stamina" | "life" }
