import { describe, expect, test } from "bun:test";
import { BALANCE_PROFILES } from "../common/balance";
import type { PlayerId, ServerMessage } from "../common/protocol";
import type { RandomSource } from "../common/random";
import { InMemoryPlayerRepository } from "../server/domain";
import { GameService } from "../server/GameService";

class FixedRandom implements RandomSource { constructor(private readonly value = 0) {} next(): number { return this.value; } }
function harness() {
  const messages = new Map<PlayerId, ServerMessage[]>(); const repository = new InMemoryPlayerRepository(); let nextId = 0;
  const game = new GameService({ repository, balance: BALANCE_PROFILES.dev, random: new FixedRandom(0), createId: () => `id-${++nextId}`, send: (id, message) => messages.set(id, [...(messages.get(id) ?? []), structuredClone(message)]) });
  return { game, repository, messages };
}

describe("authoritative game service", () => {
  test("issues the opening wave and resolves a unit only once", () => {
    const { game, repository, messages } = harness(); const player = game.join("Tester");
    expect(player.waveNumber).toBe(1); expect(player.issuedUnits.size).toBe(13);
    const unitId = player.issuedUnits.keys().next().value as string;
    game.handle(player.id, { type: "creepDefeated", unitId });
    const afterFirst = repository.get(player.id)!; expect(afterFirst.score).toBe(2); expect(afterFirst.progress.xp).toBe(30);
    game.handle(player.id, { type: "creepDefeated", unitId });
    expect(afterFirst.score).toBe(2); expect(afterFirst.progress.xp).toBe(30);
    expect(messages.get(player.id)?.some((message) => message.type === "serverNotice")).toBeTrue();
  });
  test("keeps drops server-side until collection", () => {
    const { game } = harness(); const player = game.join("Looter"); const unitId = player.issuedUnits.keys().next().value as string;
    game.handle(player.id, { type: "creepDefeated", unitId }); expect(player.groundDrops.size).toBe(1);
    const dropId = player.groundDrops.keys().next().value as string;
    game.handle(player.id, { type: "collectDrop", dropId }); expect(player.groundDrops.size).toBe(0); expect(player.progress.backpack).toHaveLength(1);
    game.handle(player.id, { type: "collectDrop", dropId }); expect(player.progress.backpack).toHaveLength(1);
  });
  test("defeat halves the wave and replacement does not advance it", () => {
    const { game } = harness(); const player = game.join("Resetter"); game.dispatchWaves(); game.dispatchWaves(); game.dispatchWaves();
    expect(player.waveNumber).toBe(4); game.handle(player.id, { type: "heroDefeated" }); expect(player.waveNumber).toBe(2);
    game.handle(player.id, { type: "requestWave" }); expect(player.waveNumber).toBe(2);
  });
});
