import { describe, expect, test } from "bun:test";
import { BALANCE } from "../common/balance";
import { parseClientMessage, parseServerMessage, type ServerMessage } from "../common/protocol";
import type { RandomSource } from "../common/random";
import { InMemoryPlayerRepository } from "../server/domain";
import { GameService } from "../server/GameService";
import { broadcastAnonymousLeaderboard } from "../server/createApp";
import { WebSocket } from "ws";

class FixedRandom implements RandomSource { next(): number { return 0; } }

describe("server protocol integration", () => {
  test("joins, emits protocol-v34 waves, and rejects malformed commands", () => {
    const repository = new InMemoryPlayerRepository(); const messages: ServerMessage[] = []; let id = 0;
    const game = new GameService({ repository, balance: BALANCE, random: new FixedRandom(), createId: () => `id-${++id}`, send: (_playerId, message) => messages.push(message) });
    const join = parseClientMessage({ type: "join", name: "Integration" }); expect(join?.type).toBe("join");
    if (!join || join.type !== "join") throw new Error("Expected validated join command.");
    game.join(join.name!);
    const roundTripped = messages.map((message) => parseServerMessage(JSON.parse(JSON.stringify(message))));
    const welcome = roundTripped.find((message) => message?.type === "welcome"); const wave = roundTripped.find((message) => message?.type === "incomingWave");
    expect(welcome?.config.balance.id).toBe("normal"); expect(welcome?.config.protocolVersion).toBe(34); expect(welcome?.realm.mode).toBe("training");
    expect(wave?.wave.mode).toBe("training"); expect(wave?.wave.waveNumber).toBe(0); expect(wave?.wave.spawns).toHaveLength(10);
    expect(parseClientMessage({ type: "toggleSkill", skillId: "healing" })?.type).toBe("toggleSkill");
    expect(parseClientMessage({ type: "creepKilled", unitId: "fake", xpReward: 1_000_000 })).toBeUndefined();
  });

  test("pushes current presence only to anonymous hero lists", () => {
    const repository = new InMemoryPlayerRepository(); const game = new GameService({ repository, balance: BALANCE, random: new FixedRandom(), send: () => {} }); const hero = game.join("Presence"); const anonymousMessages: string[] = []; const joinedMessages: string[] = [];
    broadcastAnonymousLeaderboard([{ readyState: WebSocket.OPEN, send: (data) => { anonymousMessages.push(String(data)); } }, { playerId: hero.id, readyState: WebSocket.OPEN, send: (data) => { joinedMessages.push(String(data)); } }], game);
    const online = parseServerMessage(JSON.parse(anonymousMessages.at(-1)!)); expect(online?.type === "leaderboard" ? online.heroes.find(({ username }) => username === "Presence")?.connected : undefined).toBeTrue(); expect(joinedMessages).toHaveLength(0);
    game.disconnect(hero.id); broadcastAnonymousLeaderboard([{ readyState: WebSocket.OPEN, send: (data) => { anonymousMessages.push(String(data)); } }], game); const offline = parseServerMessage(JSON.parse(anonymousMessages.at(-1)!)); expect(offline?.type === "leaderboard" ? offline.heroes.find(({ username }) => username === "Presence")?.connected : undefined).toBeFalse();
  });
});
