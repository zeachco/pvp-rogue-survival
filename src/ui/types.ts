import type { SkillId } from "../../common/items";
import type { Stats } from "../../common/progression";

export interface HudCallbacks { onJoin(name: string): void; onAllocation(stats: Stats): void; onEquip(itemId: string): void; onSell(itemId: string): void; onExtract(itemId: string): void; onBack(): void; onStart(): void }
export interface SpellSlot { id: SkillId; label: string; level: number; cooldown: number; cooldownMax: number }
