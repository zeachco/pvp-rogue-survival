import type { UnitBuild } from "../../common/protocol";
import type { Vector2 } from "./types";
import type { AttackArea } from "./AttackArea";
import type { Creep } from "./Creep";
import type { ItemDrop } from "./ItemDrop";
import type { Projectile } from "./Projectile";

export interface QueuedSpawn { build: UnitBuild; spawnAt: number }
export type ArenaEvent = { type: "creepDefeated"; unitId: string } | { type: "requestWave" } | { type: "heroDefeated" };

export class ArenaState {
  readonly creeps: Creep[] = [];
  readonly attacks: AttackArea[] = [];
  readonly projectiles: Projectile[] = [];
  readonly drops: ItemDrop[] = [];
  readonly pendingPickups = new Set<string>();
  readonly blockedPickups = new Set<string>();
  readonly defeatedPositions = new Map<string, Vector2>();
  readonly events: ArenaEvent[] = [];
  waveQueue: QueuedSpawn[] = [];

  clear(): void {
    this.creeps.length = 0; this.attacks.length = 0; this.projectiles.length = 0; this.drops.length = 0;
    this.pendingPickups.clear(); this.blockedPickups.clear(); this.defeatedPositions.clear(); this.waveQueue.length = 0; this.events.length = 0;
  }
  drainEvents(): ArenaEvent[] { return this.events.splice(0); }
}
