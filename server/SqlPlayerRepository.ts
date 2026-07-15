import { SQL } from "bun";
import type { PlayerProgress } from "../common/protocol.ts";
import type { HeroSummary } from "../common/protocol.ts";
import { cumulativeXpForLevel } from "../common/progression.ts";
import type { Player, PlayerRepository } from "./domain.ts";

interface HeroBlob { score: number; waveNumber: number; maxWaveReached?: number; progress: PlayerProgress; panelTriggers?: { character: boolean; inventory: boolean } }
interface HeroRow { id: string; username: string; level: number; hero: string }

export class SqlPlayerRepository implements PlayerRepository {
  private readonly players = new Map<string, Player>();
  private readonly dirtyPlayerIds = new Set<string>();
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(private readonly sql: SQL) {}

  static async open(databaseUrl: string): Promise<SqlPlayerRepository> {
    const repository = new SqlPlayerRepository(new SQL(databaseUrl));
    await repository.initialize();
    return repository;
  }

  get(id: string): Player | undefined { return this.players.get(id); }
  getByUsername(username: string): Player | undefined { const key = username.toLowerCase(); return [...this.players.values()].find((player) => player.name.toLowerCase() === key); }
  async findByLevel(minimum: number, maximum: number): Promise<HeroSummary[]> { const rows = await this.sql<Array<{ id: string; username: string; level: number }>>`SELECT id, username, level FROM heroes WHERE level BETWEEN ${minimum} AND ${maximum} ORDER BY level DESC, username ASC`; return rows.map((row) => ({ ...row, level: Number(row.level), receivesDeathEchoes: false })); }
  async listSummaries(): Promise<HeroSummary[]> { const rows = await this.sql<Array<{ id: string; username: string; level: number }>>`SELECT id, username, level FROM heroes ORDER BY level DESC, username ASC`; return rows.map((row) => ({ ...row, level: Number(row.level), receivesDeathEchoes: false })); }
  save(player: Player): void { this.players.set(player.id, player); this.markDirty(player.id); }
  markDirty(playerId: string): void { if (this.players.has(playerId)) this.dirtyPlayerIds.add(playerId); }
  values(): IterableIterator<Player> { return this.players.values(); }

  persist(): Promise<void> {
    const playerIds = [...this.dirtyPlayerIds];
    if (!playerIds.length) return this.writeChain;
    const rows = playerIds.map((id) => this.players.get(id)).filter(isPlayer).map(toRow);
    for (const id of playerIds) this.dirtyPlayerIds.delete(id);
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      try {
        for (const row of rows) await this.sql`
          INSERT INTO heroes (id, username, level, hero)
          VALUES (${row.id}, ${row.username}, ${row.level}, ${row.hero})
          ON CONFLICT (id) DO UPDATE SET username = excluded.username, level = excluded.level, hero = excluded.hero
        `;
      } catch (error) { for (const id of playerIds) this.dirtyPlayerIds.add(id); throw error; }
    });
    return this.writeChain;
  }

  async close(): Promise<void> { await this.writeChain; await this.sql.close(); }

  private async initialize(): Promise<void> {
    await this.sql`CREATE TABLE IF NOT EXISTS heroes (id TEXT PRIMARY KEY, username TEXT NOT NULL, level INTEGER NOT NULL, hero TEXT NOT NULL)`;
    await this.sql`CREATE UNIQUE INDEX IF NOT EXISTS heroes_username_ci ON heroes (lower(username))`;
    await this.sql`CREATE INDEX IF NOT EXISTS heroes_level ON heroes (level)`;
    const rows = await this.sql<HeroRow[]>`SELECT id, username, level, hero FROM heroes`;
    for (const row of rows) { const player = fromRow(row); if (player) this.players.set(player.id, player); }
  }
}

function isPlayer(player: Player | undefined): player is Player { return Boolean(player); }

function toRow(player: Player): HeroRow {
  const blob: HeroBlob = { score: player.score, waveNumber: player.waveNumber, maxWaveReached: player.maxWaveReached, progress: player.progress, panelTriggers: player.panelTriggers };
  return { id: player.id, username: player.name, level: player.progress.level, hero: JSON.stringify(blob) };
}

function fromRow(row: HeroRow): Player | undefined {
  let blob: HeroBlob;
  try { blob = JSON.parse(typeof row.hero === "string" ? row.hero : JSON.stringify(row.hero)) as HeroBlob; } catch { return undefined; }
  if (!blob?.progress || !Number.isFinite(blob.score) || !Number.isFinite(blob.waveNumber)) return undefined;
  blob.progress.level = Number(row.level);
  blob.progress.xp = Math.max(blob.progress.xp, cumulativeXpForLevel(blob.progress.level));
  return { id: row.id, name: row.username, score: blob.score, waveNumber: blob.waveNumber, maxWaveReached: Math.max(blob.waveNumber, blob.maxWaveReached ?? 0), progress: blob.progress, panelTriggers: blob.panelTriggers ?? { character: false, inventory: false }, connected: false, realmOptedIn: false, waitingSince: 0, outgoingRotation: 0, queueCursor: 0, issuedUnits: new Map(), groundDrops: new Map(), deferredItems: [], incomingQueues: new Map(), backlashQueue: [], deathEchoes: [] };
}
