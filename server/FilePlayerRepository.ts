import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { itemStackKey, RARITY_POWER, type ItemInstance, type WeaponClass } from "../common/items.ts";
import { WEAPONS } from "../common/content.ts";
import { cumulativeXpForLevel, integerAllocation } from "../common/progression.ts";
import type { PlayerId, PlayerProgress } from "../common/protocol.ts";
import type { Player, PlayerRepository } from "./domain.ts";

interface PersistedPlayer { id: PlayerId; name: string; score: number; waveNumber: number; progress: PlayerProgress }
interface PlayerSnapshot { version: 1; players: PersistedPlayer[] }

export class FilePlayerRepository implements PlayerRepository {
  private readonly players = new Map<PlayerId, Player>();

  constructor(private readonly filePath: string) { this.load(); }

  get(id: PlayerId): Player | undefined { return this.players.get(id); }
  save(player: Player): void { this.players.set(player.id, player); }
  values(): IterableIterator<Player> { return this.players.values(); }

  persist(): void {
    const snapshot: PlayerSnapshot = { version: 1, players: [...this.players.values()].map(({ id, name, score, waveNumber, progress }) => ({ id, name, score, waveNumber, progress })) };
    mkdirSync(dirname(this.filePath), { recursive: true }); const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8"); renameSync(temporary, this.filePath);
  }

  private load(): void {
    let value: unknown; try { value = JSON.parse(readFileSync(this.filePath, "utf8")); } catch { return; }
    if (!isSnapshot(value)) return;
    for (const saved of value.players) {
      normalizeWeapons(saved.progress); saved.progress.allocation = integerAllocation(saved.progress.allocation); saved.progress.inventoryTiles = saved.progress.inventoryTiles.filter((tile) => tile.quantity > 0); if (!saved.progress.learnedSkills.includes("rent")) saved.progress.learnedSkills.push("rent"); saved.progress.learnedSkillLevels.rent ??= 1; saved.progress.universalSkills ??= ["healing", "rent"]; for (const skill of ["healing", "rent"] as const) if (!saved.progress.universalSkills.includes(skill)) saved.progress.universalSkills.push(skill);
      saved.progress.xp = Math.max(saved.progress.xp, cumulativeXpForLevel(saved.progress.level));
      ensureEquippedInventory(saved.progress);
      this.players.set(saved.id, { ...saved, connected: false, realmOptedIn: false, waitingSince: 0, outgoingRotation: 0, queueCursor: 0, issuedUnits: new Map(), groundDrops: new Map(), incomingQueues: new Map(), backlashQueue: [] });
    }
  }
}

function isSnapshot(value: unknown): value is PlayerSnapshot {
  if (!value || typeof value !== "object") return false; const snapshot = value as Partial<PlayerSnapshot>;
  return snapshot.version === 1 && Array.isArray(snapshot.players) && snapshot.players.every((player) => Boolean(player && typeof player.id === "string" && typeof player.name === "string" && Number.isFinite(player.score) && Number.isFinite(player.waveNumber) && isProgress(player.progress)));
}
function isProgress(value: unknown): value is PlayerProgress {
  if (!value || typeof value !== "object") return false; const progress = value as Partial<PlayerProgress>;
  return Number.isFinite(progress.level) && Number.isFinite(progress.xp) && Number.isFinite(progress.gold) && Number.isFinite(progress.souls) && Boolean(progress.stats && progress.allocation && progress.scraps && progress.mainHand) && Array.isArray(progress.inventoryTiles) && Array.isArray(progress.learnedSkills) && Boolean(progress.learnedSkillLevels);
}
function ensureEquippedInventory(progress: PlayerProgress): void { for (const item of [progress.mainHand, progress.offHand].filter(Boolean) as ItemInstance[]) { const key = itemStackKey(item); const existing = progress.inventoryTiles.find((tile) => tile.key === key); if (existing) existing.quantity = Math.max(1, existing.quantity); else progress.inventoryTiles.push({ id: `persisted-${item.id}`, key, item: { ...item }, quantity: 1 }); } }
function normalizeWeapons(progress: PlayerProgress): void { const items = [progress.mainHand, progress.offHand, ...progress.inventoryTiles.map((tile) => tile.item)].filter(Boolean) as ItemInstance[]; for (const item of items) { item.attractionSpeed ??= 0; item.modifiers.lifeStealBase ??= 0; item.modifiers.strengthRegenMultiplier ??= 0; item.modifiers.goldGain ??= item.itemKind === "buckler" ? 0.05 * RARITY_POWER[item.rarity] : 0; item.modifiers.rarityBoost ??= item.itemKind === "buckler" ? 0.02 * RARITY_POWER[item.rarity] : 0; if (item.itemKind !== "weapon") { item.weight = 0; if (item.itemKind === "buckler") { item.staminaCost = Math.max(1, item.staminaCost || 0); item.skills = ["blocking", ...(item.reflectionComponents.length && (item.rarity === "rare" || item.rarity === "epic") ? ["thorns" as const, "reflectiveSurge" as const] : [])]; } else item.skills = item.attractionSpeed > 0 ? ["gravityPull"] : []; continue; } const definition = WEAPONS[item.definitionId as WeaponClass]; item.weight = definition.weight; item.modifiers.attackSpeedMultiplier = 1 + (item.affixes.includes("swift") ? 0.12 * RARITY_POWER[item.rarity] : 0); item.skills = definition.skill ? [definition.skill, ...(item.definitionId === "staff" && (item.rarity === "rare" || item.rarity === "epic") ? ["frostOrb" as const] : [])] : []; } for (const tile of progress.inventoryTiles) tile.key = itemStackKey(tile.item); }
