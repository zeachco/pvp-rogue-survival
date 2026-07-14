import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { itemStackKey, type ItemInstance } from "../common/items.ts";
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
function ensureEquippedInventory(progress: PlayerProgress): void { for (const item of [progress.mainHand, progress.offHand].filter(Boolean) as ItemInstance[]) { const key = itemStackKey(item); const existing = progress.inventoryTiles.find((tile) => tile.key === key); if (existing) existing.quantity = Math.max(1, existing.quantity); else progress.inventoryTiles.push({ id: `persisted-${item.id}`, key, item: { ...item }, quantity: 1, automation: "keep" }); } }
