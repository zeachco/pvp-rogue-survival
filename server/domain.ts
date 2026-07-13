import type { ItemInstance } from "../common/items.ts";
import type { PlayerId, PlayerProgress, UnitBuild } from "../common/protocol.ts";

export interface Player {
  id: PlayerId;
  name: string;
  score: number;
  waveNumber: number;
  progress: PlayerProgress;
  neighbors: Set<PlayerId>;
  connected: boolean;
  issuedUnits: Map<string, UnitBuild>;
  groundDrops: Map<string, ItemInstance>;
}

export interface PlayerRepository {
  get(id: PlayerId): Player | undefined;
  save(player: Player): void;
  values(): IterableIterator<Player>;
}

export class InMemoryPlayerRepository implements PlayerRepository {
  private readonly players = new Map<PlayerId, Player>();
  get(id: PlayerId): Player | undefined { return this.players.get(id); }
  save(player: Player): void { this.players.set(player.id, player); }
  values(): IterableIterator<Player> { return this.players.values(); }
}
