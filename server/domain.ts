import type { ItemInstance } from "../common/items.ts";
import type { GroundDrop, HeroSummary, PlayerId, PlayerProgress, UnitBuild } from "../common/protocol.ts";

export interface IssuedUnit { build: UnitBuild; mode: "competitive" | "solo" | "training" }
export interface QueuedEquipment { item: ItemInstance; senderId: PlayerId; senderName: string; backlash: boolean }
export interface Player {
  id: PlayerId; name: string; score: number; waveNumber: number; progress: PlayerProgress; connected: boolean;
  panelTriggers: { character: boolean; inventory: boolean };
  realmOptedIn: boolean; realmId?: string; waitingSince: number; outgoingRotation: number; queueCursor: number;
  issuedUnits: Map<string, IssuedUnit>; groundDrops: Map<string, GroundDrop>; deferredItems: ItemInstance[];
  incomingQueues: Map<PlayerId, QueuedEquipment[]>; backlashQueue: QueuedEquipment[];
}
export interface PlayerRepository { get(id: PlayerId): Player | undefined; getByUsername(username: string): Player | undefined; findByLevel(minimum: number, maximum: number): Promise<HeroSummary[]>; listSummaries(): Promise<HeroSummary[]>; save(player: Player): void; markDirty(playerId: PlayerId): void; values(): IterableIterator<Player>; persist(): void | Promise<void>; close?(): void | Promise<void> }
export class InMemoryPlayerRepository implements PlayerRepository {
  private readonly players = new Map<PlayerId, Player>();
  get(id: PlayerId): Player | undefined { return this.players.get(id); }
  getByUsername(username: string): Player | undefined { const key = username.toLowerCase(); return [...this.players.values()].find((player) => player.name.toLowerCase() === key); }
  async findByLevel(minimum: number, maximum: number): Promise<HeroSummary[]> { return [...this.players.values()].filter((player) => player.progress.level >= minimum && player.progress.level <= maximum).map(summary); }
  async listSummaries(): Promise<HeroSummary[]> { return [...this.players.values()].map(summary).sort((a, b) => b.level - a.level || a.username.localeCompare(b.username)); }
  save(player: Player): void { this.players.set(player.id, player); }
  markDirty(_playerId: PlayerId): void { }
  values(): IterableIterator<Player> { return this.players.values(); }
  persist(): void { }
}
function summary(player: Player): HeroSummary { return { id: player.id, username: player.name, level: player.progress.level }; }
