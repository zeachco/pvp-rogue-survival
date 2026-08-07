import type { Rarity, SkillId } from "../../common/items";
import type { Stats } from "../../common/progression";
import type { PanelTrigger, RarityAction } from "../../common/protocol";

export interface HudCallbacks {
	onJoin(name: string): void;
	onAllocation(stats: Stats): void;
	onRespec(stats: Stats): void;
	onEquip(tileId: string): void;
	onSell(tileId: string, bulk: boolean): void;
	onPurge(tileId: string, bulk: boolean): void;
	onUpgrade(tileId: string, bulk: boolean): void;
	onSend(tileId: string, bulk: boolean): void;
	onExtract(tileId: string, bulk: boolean): void;
	onReroll(tileId: string, bulk: boolean): void;
	onPromoteScrap(target: Rarity, bulk: boolean): void;
	onSetRarityAction(rarity: Rarity, action: RarityAction): void;
	onLeaveRealm(): void;
	onEnterRealm(): void;
	onBack(): void;
	onLogout(): void;
	onSetLightingMode(mode: "off" | "hero" | "all"): void;
	onSetShadowMode(mode: "off" | "dynamic"): void;
	onInspectHero(heroId: string): void;
	onSetSkillEquipped(skillId: SkillId, equipped: boolean, slot?: number): void;
	onToggleSkillAutoFire(skillId: SkillId): void;
	onDismissPanelTrigger(panel: PanelTrigger): void;
	onChat(text: string): void;
	onChattingChange(chatting: boolean): void;
}
export type CurrencyPreview = Partial<
	Record<"gold" | "souls" | Rarity, number>
>;
export interface SpellSlot {
	id: SkillId;
	label: string;
	level: number;
	actualLevel: number;
	cooldown: number;
	cooldownMax: number;
	castProgress?: number;
	affordable: boolean;
	resource: "mana" | "rage" | "life";
	costLabel: string;
	active: boolean;
	passive: boolean;
	procChancesOnAttacks?: number;
	autoFire: boolean;
	shortcut?: number;
	bar: "learned" | "geared";
}
