import type { Rarity, SkillId } from "../../common/items";
import type { Stats } from "../../common/progression";
import type { PanelTrigger } from "../../common/protocol";

export interface HudCallbacks {
  onJoin(name: string): void; onAllocation(stats: Stats): void; onRespec(stats: Stats): void; onEquip(tileId: string): void; onSell(tileId: string, bulk: boolean): void;
  onPurge(tileId: string, bulk: boolean): void; onUpgrade(tileId: string, bulk: boolean): void; onSend(tileId: string, bulk: boolean): void; onExtract(tileId: string, bulk: boolean): void;
  onPromoteScrap(target: Rarity, bulk: boolean): void;
  onLeaveRealm(): void; onEnterRealm(): void; onKillPlayer(): void; onBack(): void;
  onLogout(): void; onInspectHero(heroId: string): void; onToggleSkill(skillId: SkillId): void; onDismissPanelTrigger(panel: PanelTrigger): void;
}
export type CurrencyPreview = Partial<Record<"gold" | "souls" | Rarity, number>>;
export interface SpellSlot { id: SkillId; label: string; level: number; actualLevel: number; cooldown: number; cooldownMax: number; resource: "mana" | "stamina" | "life"; costLabel: string; active: boolean; bar: "learned" | "geared" }
