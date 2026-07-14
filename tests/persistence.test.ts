import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BALANCE_PROFILES } from "../common/balance";
import { generateItem, itemStackKey } from "../common/items";
import { collectIntoInventory, emptyScraps } from "../common/inventory";
import { DEFAULT_ALLOCATION, ZERO_STATS } from "../common/progression";
import type { ServerMessage } from "../common/protocol";
import type { RandomSource } from "../common/random";
import { FilePlayerRepository } from "../server/FilePlayerRepository";
import { GameService } from "../server/GameService";

class FixedRandom implements RandomSource { next(): number { return 0.5; } }

describe("player persistence", () => {
  test("drops retired empty automation buckets during migration", () => { const directory = mkdtempSync(join(tmpdir(), "multi-line-rules-")); const file = join(directory, "players.json"); try { const repository = new FilePlayerRepository(file); const player = new GameService({ repository, balance: BALANCE_PROFILES.normal, random: new FixedRandom(), send: () => {} }).join("Rules"); const item = generateItem(2, "common", 91, { fewerAffixes: true }); player.progress.inventoryTiles.push({ id: "retired-rule", key: itemStackKey(item), item, quantity: 0 }); repository.persist(); const restored = new FilePlayerRepository(file).get(player.id)!; expect(restored.progress.inventoryTiles.some((tile) => tile.id === "retired-rule")).toBeFalse(); expect(restored.progress.learnedSkills).toContain("rent"); } finally { rmSync(directory, { recursive: true, force: true }); } });
  test("atomically restores durable progression and resets transient realm state", () => {
    const directory = mkdtempSync(join(tmpdir(), "multi-line-hero-")); const file = join(directory, "players.json");
    try {
      const firstRepository = new FilePlayerRepository(file); const first = new GameService({ repository: firstRepository, balance: BALANCE_PROFILES.normal, random: new FixedRandom(), send: (_id, _message: ServerMessage) => {} });
      const player = first.join("Persistent"); player.score = 17; player.waveNumber = 9; player.progress.xp = 245; player.progress.level = 2; player.progress.gold = 88; player.progress.souls = 3; player.progress.stats.strength = 4; player.progress.allocation = { agility: 1.5, strength: 0.5, magic: 1, spirit: 1, intelligence: 1 };
      const item = generateItem(2, "rare", 123); delete (item.modifiers as Partial<typeof item.modifiers>).lifeStealBase; delete (item.modifiers as Partial<typeof item.modifiers>).strengthRegenMultiplier; player.progress.inventoryTiles.push({ id: "saved-tile", key: itemStackKey(item), item, quantity: 2 }); player.realmOptedIn = true; player.realmId = "transient"; player.groundDrops.set("drop", item);
      firstRepository.persist(); expect(existsSync(file)).toBeTrue(); expect(existsSync(`${file}.tmp`)).toBeFalse();
      const restored = new FilePlayerRepository(file).get(player.id); expect(restored?.name).toBe("Persistent"); expect(restored?.score).toBe(17); expect(restored?.waveNumber).toBe(9); expect(restored?.progress.xp).toBe(250); expect(restored?.progress.gold).toBe(88); expect(restored?.progress.souls).toBe(3); expect(restored?.progress.stats.strength).toBe(4); expect(Object.values(restored!.progress.allocation).every(Number.isInteger)).toBeTrue(); expect(Object.values(restored!.progress.allocation).reduce((sum, value) => sum + value, 0)).toBe(5); expect(restored?.progress.inventoryTiles.find((tile) => tile.id === "saved-tile")?.quantity).toBe(2); expect(restored?.progress.inventoryTiles.find((tile) => tile.id === "saved-tile")?.item.modifiers.lifeStealBase).toBe(0);
      expect(restored?.connected).toBeFalse(); expect(restored?.realmOptedIn).toBeFalse(); expect(restored?.realmId).toBeUndefined(); expect(restored?.groundDrops.size).toBe(0); expect(restored?.issuedUnits.size).toBe(0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
