import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BALANCE_PROFILES } from "../common/balance";
import { generateItem, itemStackKey } from "../common/items";
import type { ServerMessage } from "../common/protocol";
import type { RandomSource } from "../common/random";
import { FilePlayerRepository } from "../server/FilePlayerRepository";
import { GameService } from "../server/GameService";

class FixedRandom implements RandomSource { next(): number { return 0.5; } }

describe("player persistence", () => {
  test("atomically restores durable progression and resets transient realm state", () => {
    const directory = mkdtempSync(join(tmpdir(), "multi-line-hero-")); const file = join(directory, "players.json");
    try {
      const firstRepository = new FilePlayerRepository(file); const first = new GameService({ repository: firstRepository, balance: BALANCE_PROFILES.normal, random: new FixedRandom(), send: (_id, _message: ServerMessage) => {} });
      const player = first.join("Persistent"); player.score = 17; player.waveNumber = 9; player.progress.xp = 245; player.progress.level = 2; player.progress.gold = 88; player.progress.souls = 3; player.progress.stats.strength = 4;
      const item = generateItem(2, "rare", 123); player.progress.inventoryTiles.push({ id: "saved-tile", key: itemStackKey(item), item, quantity: 2, automation: "upgrade" }); player.realmOptedIn = true; player.realmId = "transient"; player.groundDrops.set("drop", item);
      firstRepository.persist(); expect(existsSync(file)).toBeTrue(); expect(existsSync(`${file}.tmp`)).toBeFalse();
      const restored = new FilePlayerRepository(file).get(player.id); expect(restored?.name).toBe("Persistent"); expect(restored?.score).toBe(17); expect(restored?.waveNumber).toBe(9); expect(restored?.progress.xp).toBe(245); expect(restored?.progress.gold).toBe(88); expect(restored?.progress.souls).toBe(3); expect(restored?.progress.stats.strength).toBe(4); expect(restored?.progress.inventoryTiles.find((tile) => tile.id === "saved-tile")?.automation).toBe("upgrade"); expect(restored?.progress.inventoryTiles.find((tile) => tile.id === "saved-tile")?.quantity).toBe(2);
      expect(restored?.connected).toBeFalse(); expect(restored?.realmOptedIn).toBeFalse(); expect(restored?.realmId).toBeUndefined(); expect(restored?.groundDrops.size).toBe(0); expect(restored?.issuedUnits.size).toBe(0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
