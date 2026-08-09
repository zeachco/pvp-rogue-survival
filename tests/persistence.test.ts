import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BALANCE } from "../common/balance";
import type { RandomSource } from "../common/random";
import { GameService } from "../server/GameService";
import { SqlPlayerRepository } from "../server/SqlPlayerRepository";
import { createApp } from "../server/createApp";

class FixedRandom implements RandomSource {
	next(): number {
		return 0.5;
	}
}

describe("Bun SQL player persistence", () => {
	test("round-trips the indexed hero fields and serialized progression through SQLite", async () => {
		const directory = mkdtempSync(join(tmpdir(), "multi-line-sql-"));
		const url = `sqlite://${join(directory, "players.sqlite")}`;
		try {
			const firstRepository = await SqlPlayerRepository.open(url);
			const game = new GameService({
				repository: firstRepository,
				balance: BALANCE,
				random: new FixedRandom(),
				send: () => {},
			});
			const passwordHash = await Bun.password.hash("password123");
			const player = game.join(
				"Persistent",
				undefined,
				(_playerId, identified) => {
					identified.passwordHash = passwordHash;
				},
			);
			expect(player.isModerator).toBeFalse();
			player.score = 17;
			player.isModerator = true;
			player.waveNumber = 2;
			player.maxWaveReached = 9;
			player.progress.xp = 250;
			player.progress.level = 2;
			player.progress.gold = 88;
			player.progress.souls = 2;
			player.progress.scraps.unique = 3;
			player.panelTriggers.character = false;
			await firstRepository.persist();
			await firstRepository.close();
			const restoredRepository = await SqlPlayerRepository.open(url);
			const restored = restoredRepository.get(player.id);
			expect(restored?.name).toBe("Persistent");
			expect(restored?.passwordHash).not.toBe("password123");
			expect(
				await Bun.password.verify("password123", restored!.passwordHash!),
			).toBeTrue();
			expect(restored?.progress.level).toBe(2);
			expect(restored?.score).toBe(17);
			expect(restored?.isModerator).toBeTrue();
			expect(restored?.waveNumber).toBe(2);
			expect(restored?.maxWaveReached).toBe(9);
			expect(restored?.progress.gold).toBe(88);
			expect(restored?.progress.souls).toBe(5);
			expect(restored?.progress.scraps.unique).toBe(0);
			expect(restored?.panelTriggers).toEqual({
				character: false,
				inventory: true,
				multiplayer: true,
			});
			expect(restored?.connected).toBeFalse();
			expect(restored?.groundDrops.size).toBe(0);
			expect(restored?.incomingQueues.size).toBe(0);
			await restoredRepository.close();
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	test("looks up usernames without case and orders leaderboard by level then name", async () => {
		const repository = await SqlPlayerRepository.open(":memory:");
		const game = new GameService({
			repository,
			balance: BALANCE,
			random: new FixedRandom(),
			send: () => {},
		});
		const low = game.join("zeta");
		low.connected = false;
		const highB = game.join("Beta");
		highB.progress.level = 3;
		highB.connected = false;
		const highA = game.join("alpha");
		highA.progress.level = 3;
		expect(repository.getByUsername("BETA")?.id).toBe(highB.id);
		expect(game.leaderboard().map((hero) => hero.username)).toEqual([
			"alpha",
			"Beta",
			"zeta",
		]);
		await repository.close();
	});

	test("selects one persisted boss candidate from the requested inclusive level window", async () => {
		const repository = await SqlPlayerRepository.open(":memory:");
		const game = new GameService({
			repository,
			balance: BALANCE,
			random: new FixedRandom(),
			send: () => {},
		});
		const low = game.join("TooLow");
		low.progress.level = 1;
		const eligible = game.join("Eligible");
		eligible.progress.level = 4;
		eligible.progress.gold = 19;
		const high = game.join("TooHigh");
		high.progress.level = 8;
		repository.markDirty(low.id);
		repository.markDirty(eligible.id);
		repository.markDirty(high.id);
		await repository.persist();
		const candidate = await repository.findBossCandidate(3, 5);
		expect(candidate?.name).toBe("Eligible");
		expect(candidate?.progress.gold).toBe(19);
		await repository.close();
	});

	test("flushes only heroes marked dirty", async () => {
		const directory = mkdtempSync(join(tmpdir(), "multi-line-dirty-sql-"));
		const url = `sqlite://${join(directory, "players.sqlite")}`;
		try {
			const repository = await SqlPlayerRepository.open(url);
			const game = new GameService({
				repository,
				balance: BALANCE,
				random: new FixedRandom(),
				send: () => {},
			});
			const changed = game.join("Changed");
			const untouched = game.join("Untouched");
			await repository.persist();
			changed.progress.gold = 10;
			untouched.progress.gold = 20;
			repository.markDirty(changed.id);
			await repository.persist();
			await repository.close();
			const restored = await SqlPlayerRepository.open(url);
			expect(restored.get(changed.id)?.progress.gold).toBe(10);
			expect(restored.get(untouched.id)?.progress.gold).toBe(0);
			await restored.close();
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	test("flushes dirty hero state during idempotent graceful app shutdown", async () => {
		const directory = mkdtempSync(join(tmpdir(), "multi-line-shutdown-sql-"));
		const url = `sqlite://${join(directory, "players.sqlite")}`;
		try {
			const app = await createApp({ root: directory, databaseUrl: url });
			const player = app.game.join("ShutdownSaved");
			player.progress.gold = 321;
			app.repository.markDirty(player.id);
			const firstClose = app.close();
			expect(app.close()).toBe(firstClose);
			await firstClose;
			const restored = await SqlPlayerRepository.open(url);
			expect(restored.get(player.id)?.progress.gold).toBe(321);
			await restored.close();
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
