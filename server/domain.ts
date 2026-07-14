import type { ItemInstance } from "../common/items.ts";
import type { GroundDrop, PlayerId, PlayerProgress, UnitBuild } from "../common/protocol.ts";

export interface IssuedUnit { build: UnitBuild; mode: "competitive" | "solo" | "training" }
export interface QueuedEquipment { item: ItemInstance; senderId: PlayerId; senderName: string; backlash: boolean }
export interface Player {
  id: PlayerId; name: string; score: number; waveNumber: number; progress: PlayerProgress; connected: boolean;
  realmOptedIn: boolean; realmId?: string; waitingSince: number; outgoingRotation: number; queueCursor: number;
  issuedUnits: Map<string, IssuedUnit>; groundDrops: Map<string, GroundDrop>; deferredItems: ItemInstance[];
  incomingQueues: Map<PlayerId, QueuedEquipment[]>; backlashQueue: QueuedEquipment[];
}
export interface PlayerRepository { get(id: PlayerId): Player | undefined; save(player: Player): void; values(): IterableIterator<Player>; persist(): void }
export class InMemoryPlayerRepository implements PlayerRepository {
  private readonly players = new Map<PlayerId, Player>();
  get(id: PlayerId): Player | undefined { return this.players.get(id); }
  save(player: Player): void { this.players.set(player.id, player); }
  values(): IterableIterator<Player> { return this.players.values(); }
  persist(): void {}
}
