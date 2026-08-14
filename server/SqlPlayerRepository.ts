import { SQL } from "bun";
import { SKILLS } from "../common/content.ts";
import {
	type ItemInstance,
	itemStackKey,
	migrateLegacyItem,
	type SkillId,
} from "../common/items.ts";
import {
	cumulativeXpForLevel,
	migrateLegacyStats,
} from "../common/progression.ts";
import type {
	HeroSummary,
	PanelTriggers,
	PlayerProgress,
} from "../common/protocol.ts";
import type { Player, PlayerRepository } from "./domain.ts";

interface HeroBlob {
	score: number;
	waveNumber: number;
	maxWaveReached?: number;
	progress: PlayerProgress;
	panelTriggers?: Partial<PanelTriggers>;
	lastPlayedAt?: number;
}
interface HeroRow {
	id: string;
	username: string;
	account_id?: string | null;
	account_username?: string | null;
	level: number;
	password_hash?: string | null;
	is_moderator?: number | boolean | null;
	hero: string;
}

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

	get(id: string): Player | undefined {
		return this.players.get(id);
	}
	getByUsername(username: string): Player | undefined {
		const key = username.toLowerCase();
		return [...this.players.values()]
			.filter((player) => player.accountName.toLowerCase() === key)
			.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)[0];
	}
	getAccountPlayers(accountId: string): Player[] {
		return [...this.players.values()].filter(
			(player) => player.accountId === accountId,
		);
	}
	getByCharacterName(name: string): Player | undefined {
		const key = name.toLowerCase();
		return [...this.players.values()].find(
			(player) => player.name.toLowerCase() === key,
		);
	}
	async findByLevel(minimum: number, maximum: number): Promise<HeroSummary[]> {
		const rows = await this.sql<
			Array<{ id: string; username: string; level: number }>
		>`SELECT id, username, level FROM heroes WHERE level BETWEEN ${minimum} AND ${maximum} ORDER BY level DESC, username ASC`;
		return rows.map((row) => ({
			...row,
			level: Number(row.level),
			souls: this.players.get(row.id)?.progress.souls ?? 0,
			connected: this.players.get(row.id)?.connected ?? false,
			receivesDeathEchoes: false,
			equipment: summaryEquipment(this.players.get(row.id)),
			spells: summarySpells(this.players.get(row.id)),
		}));
	}
	async findBossCandidate(
		minimum: number,
		maximum: number,
	): Promise<Player | undefined> {
		const rows = await this.sql<
			HeroRow[]
		>`SELECT id, username, level, password_hash, is_moderator, hero FROM heroes WHERE level BETWEEN ${minimum} AND ${maximum} ORDER BY RANDOM() LIMIT 1`;
		return rows[0] ? fromRow(rows[0]) : undefined;
	}
	async listSummaries(): Promise<HeroSummary[]> {
		const rows = await this.sql<
			Array<{ id: string; username: string; level: number }>
		>`SELECT id, username, level FROM heroes ORDER BY level DESC, username ASC`;
		return rows
			.map((row) => ({
				...row,
				level: Number(row.level),
				souls: this.players.get(row.id)?.progress.souls ?? 0,
				connected: this.players.get(row.id)?.connected ?? false,
				receivesDeathEchoes: false,
				equipment: summaryEquipment(this.players.get(row.id)),
				spells: summarySpells(this.players.get(row.id)),
			}))
			.sort(
				(a, b) => b.souls - a.souls || a.username.localeCompare(b.username),
			);
	}
	save(player: Player): void {
		this.players.set(player.id, player);
		this.markDirty(player.id);
	}
	markDirty(playerId: string): void {
		const player = this.players.get(playerId);
		if (!player) return;
		for (const sibling of this.getAccountPlayers(player.accountId)) {
			sibling.progress.gold = player.progress.gold;
			sibling.progress.souls = player.progress.souls;
			sibling.progress.scraps = { ...player.progress.scraps };
			this.dirtyPlayerIds.add(sibling.id);
		}
	}
	values(): IterableIterator<Player> {
		return this.players.values();
	}

	persist(): Promise<void> {
		const playerIds = [...this.dirtyPlayerIds];
		if (!playerIds.length) return this.writeChain;
		const rows = playerIds
			.map((id) => this.players.get(id))
			.filter(isPlayer)
			.map(toRow);
		for (const id of playerIds) this.dirtyPlayerIds.delete(id);
		this.writeChain = this.writeChain
			.catch(() => {})
			.then(async () => {
				try {
					for (const row of rows)
						await this.sql`
						  INSERT INTO heroes (id, username, level, password_hash, is_moderator, account_id, account_username, hero)
						  VALUES (${row.id}, ${row.username}, ${row.level}, ${row.password_hash}, ${row.is_moderator}, ${row.account_id}, ${row.account_username}, ${row.hero})
						  ON CONFLICT (id) DO UPDATE SET username = excluded.username, level = excluded.level, password_hash = excluded.password_hash, is_moderator = excluded.is_moderator, account_id = excluded.account_id, account_username = excluded.account_username, hero = excluded.hero
        `;
				} catch (error) {
					for (const id of playerIds) this.dirtyPlayerIds.add(id);
					throw error;
				}
			});
		return this.writeChain;
	}

	async close(): Promise<void> {
		await this.writeChain;
		await this.sql.close();
	}

	private async initialize(): Promise<void> {
		await this
			.sql`CREATE TABLE IF NOT EXISTS heroes (id TEXT PRIMARY KEY, username TEXT NOT NULL, level INTEGER NOT NULL, password_hash TEXT, is_moderator INTEGER NOT NULL DEFAULT 0, hero TEXT NOT NULL)`;
		try {
			await this.sql`ALTER TABLE heroes ADD COLUMN password_hash TEXT`;
		} catch (error) {
			const message = String(error).toLowerCase();
			if (
				!message.includes("duplicate column") &&
				!message.includes("already exists")
			)
				throw error;
		}
		try {
			await this
				.sql`ALTER TABLE heroes ADD COLUMN is_moderator INTEGER NOT NULL DEFAULT 0`;
		} catch (error) {
			const message = String(error).toLowerCase();
			if (
				!message.includes("duplicate column") &&
				!message.includes("already exists")
			)
				throw error;
		}
		for (const column of ["account_id TEXT", "account_username TEXT"]) {
			try {
				await this.sql.unsafe(`ALTER TABLE heroes ADD COLUMN ${column}`);
			} catch (error) {
				const message = String(error).toLowerCase();
				if (
					!message.includes("duplicate column") &&
					!message.includes("already exists")
				)
					throw error;
			}
		}
		await this
			.sql`CREATE UNIQUE INDEX IF NOT EXISTS heroes_username_ci ON heroes (lower(username))`;
		await this.sql`CREATE INDEX IF NOT EXISTS heroes_level ON heroes (level)`;
		await this
			.sql`CREATE INDEX IF NOT EXISTS heroes_account_id ON heroes (account_id)`;
		await this
			.sql`CREATE INDEX IF NOT EXISTS heroes_account_username_ci ON heroes (lower(account_username))`;
		const rows = await this.sql<
			HeroRow[]
		>`SELECT id, username, level, password_hash, is_moderator, account_id, account_username, hero FROM heroes`;
		for (const row of rows) {
			const player = fromRow(row);
			if (player) this.players.set(player.id, player);
		}
		for (const account of new Set(
			[...this.players.values()].map((player) => player.accountId),
		)) {
			const heroes = this.getAccountPlayers(account).sort(
				(a, b) => b.lastPlayedAt - a.lastPlayedAt,
			);
			if (heroes[0]) this.markDirty(heroes[0].id);
		}
	}
}

function isPlayer(player: Player | undefined): player is Player {
	return Boolean(player);
}

function toRow(player: Player): HeroRow {
	const blob: HeroBlob = {
		score: player.score,
		waveNumber: player.waveNumber,
		maxWaveReached: player.maxWaveReached,
		progress: player.progress,
		panelTriggers: player.panelTriggers,
		lastPlayedAt: player.lastPlayedAt,
	};
	return {
		id: player.id,
		username: player.name,
		account_id: player.accountId,
		account_username: player.accountName,
		level: player.progress.level,
		password_hash: player.passwordHash ?? null,
		is_moderator: player.isModerator ? 1 : 0,
		hero: JSON.stringify(blob),
	};
}

function fromRow(row: HeroRow): Player | undefined {
	let blob: HeroBlob;
	try {
		blob = JSON.parse(
			typeof row.hero === "string" ? row.hero : JSON.stringify(row.hero),
		) as HeroBlob;
	} catch {
		return undefined;
	}
	if (
		!blob?.progress ||
		!Number.isFinite(blob.score) ||
		!Number.isFinite(blob.waveNumber)
	)
		return undefined;
	blob.progress.level = Number(row.level);
	blob.progress.stats = migrateLegacyStats(blob.progress.stats);
	blob.progress.allocation = migrateLegacyStats(blob.progress.allocation);
	blob.progress.xp = Math.max(
		blob.progress.xp,
		cumulativeXpForLevel(blob.progress.level),
	);
	migrateLegacyEquipment(blob.progress);
	blob.progress.disabledSkills ??= [];
	if (!blob.progress.equippedSkills) {
		const disabled = new Set(blob.progress.disabledSkills);
		const available = [
			...blob.progress.learnedSkills,
			...(blob.progress.mainHand?.skills ?? []),
			...(blob.progress.offHand?.skills ?? []),
			...(blob.progress.amulet?.skills ?? []),
			...(blob.progress.charm?.skills ?? []),
		];
		blob.progress.equippedSkills = [...new Set(available)]
			.filter((skill) => !SKILLS[skill].passive && !disabled.has(skill))
			.slice(0, 6);
		blob.progress.autoFireSkills = [...blob.progress.equippedSkills];
	}
	blob.progress.autoFireSkills ??= [];
	return {
		id: row.id,
		name: row.username,
		accountId: row.account_id ?? row.id,
		accountName: row.account_username ?? row.username,
		passwordHash: row.password_hash ?? undefined,
		isModerator: row.is_moderator === true || Number(row.is_moderator) === 1,
		score: blob.score,
		waveNumber: blob.waveNumber,
		maxWaveReached: Math.max(blob.waveNumber, blob.maxWaveReached ?? 0),
		progress: blob.progress,
		panelTriggers: {
			character: blob.panelTriggers?.character ?? false,
			inventory: blob.panelTriggers?.inventory ?? false,
			multiplayer: blob.panelTriggers?.multiplayer ?? false,
		},
		connected: false,
		realmOptedIn: false,
		waitingSince: 0,
		outgoingRotation: 0,
		queueCursor: 0,
		issuedUnits: new Map(),
		groundDrops: new Map(),
		deferredItems: [],
		incomingQueues: new Map(),
		backlashQueue: [],
		deathEchoes: [],
		xpSendBuffs: [],
		lastPlayedAt: blob.lastPlayedAt ?? 0,
	};
}

function summaryEquipment(player?: Player): ItemInstance[] {
	if (!player) return [];
	return [
		player.progress.mainHand,
		player.progress.offHand,
		player.progress.amulet,
		player.progress.charm,
	].filter((item): item is ItemInstance => Boolean(item));
}

function summarySpells(player?: Player): SkillId[] {
	if (!player) return [];
	return [
		...new Set([
			...player.progress.learnedSkills,
			...summaryEquipment(player).flatMap((item) => item.skills),
		]),
	];
}

export function migrateLegacyEquipment(progress: PlayerProgress): void {
	const legacyUniqueScrap = progress.scraps.unique ?? 0;
	if (legacyUniqueScrap > 0) {
		progress.souls += legacyUniqueScrap;
		progress.scraps.unique = 0;
	}
	if (progress.mainHand) migrateLegacyItem(progress.mainHand);
	if (progress.offHand) migrateLegacyItem(progress.offHand);
	if (progress.amulet) migrateLegacyItem(progress.amulet);
	if (progress.charm) migrateLegacyItem(progress.charm);
	for (const tile of progress.inventoryTiles) {
		migrateLegacyItem(tile.item);
		tile.key = itemStackKey(tile.item);
	}
}
