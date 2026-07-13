import { describe, expect, test } from "bun:test";
import { BALANCE_PROFILES } from "../common/balance";
import { parseClientMessage, parseServerMessage, type ServerMessage } from "../common/protocol";
import type { RandomSource } from "../common/random";
import { InMemoryPlayerRepository } from "../server/domain";
import { GameService } from "../server/GameService";

class FixedRandom implements RandomSource { next(): number { return 0; } }

describe("server protocol integration", () => {
  test("joins, emits protocol-v3 waves, and rejects malformed commands", () => {
    const repository = new InMemoryPlayerRepository(); const messages: ServerMessage[] = []; let id = 0;
    const game = new GameService({ repository, balance: BALANCE_PROFILES.dev, random: new FixedRandom(), createId: () => `id-${++id}`, send: (_playerId, message) => messages.push(message) });
    const join = parseClientMessage({ type: "join", name: "Integration" }); expect(join?.type).toBe("join");
    if (!join || join.type !== "join") throw new Error("Expected validated join command.");
    game.join(join.name, join.sessionId);
    const roundTripped = messages.map((message) => parseServerMessage(JSON.parse(JSON.stringify(message))));
    const welcome = roundTripped.find((message) => message?.type === "welcome"); const wave = roundTripped.find((message) => message?.type === "incomingWave");
    expect(welcome?.config.balance.id).toBe("dev"); expect(welcome?.config.protocolVersion).toBe(3); expect(welcome?.realm.mode).toBe("training");
    expect(wave?.wave.mode).toBe("training"); expect(wave?.wave.spawns).toHaveLength(13);
    expect(parseClientMessage({ type: "creepKilled", unitId: "fake", xpReward: 1_000_000 })).toBeUndefined();
  });
});
