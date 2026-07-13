import { afterEach, describe, expect, test } from "bun:test";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createApp } from "../server/createApp";
import { parseServerMessage, type ServerMessage } from "../common/protocol";

const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => { while (apps.length) await apps.pop()!.close(); });

describe("WebSocket application", () => {
  test("joins, receives a validated wave, and rejects malformed commands", async () => {
    const app = createApp({ root: process.cwd(), balanceProfile: "dev" }); apps.push(app);
    const port = 38_000 + process.pid % 1_000;
    app.server.listen(port, "127.0.0.1"); await once(app.server, "listening");
    const address = app.server.address(); if (!address || typeof address === "string") throw new Error("Expected TCP address");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`); await once(socket, "open");
    const messages: ServerMessage[] = [];
    socket.on("message", (raw) => { const message = parseServerMessage(JSON.parse(String(raw))); if (message) messages.push(message); });
    socket.send(JSON.stringify({ type: "join", name: "Integration" }));
    await until(() => messages.some((message) => message.type === "incomingWave"));
    const welcome = messages.find((message) => message.type === "welcome");
    expect(welcome?.config.balance.id).toBe("dev"); expect(welcome?.config.protocolVersion).toBe(1);
    expect(messages.find((message) => message.type === "incomingWave")?.wave.spawns).toHaveLength(13);
    socket.send(JSON.stringify({ type: "creepKilled", unitId: "fake", xpReward: 1_000_000 }));
    await until(() => messages.some((message) => message.type === "serverNotice" && message.message.includes("invalid")));
    socket.close(); await once(socket, "close");
  });
});

async function until(condition: () => boolean): Promise<void> {
  const deadline = performance.now() + 2_000;
  while (!condition()) { if (performance.now() > deadline) throw new Error("Timed out waiting for WebSocket message"); await Bun.sleep(5); }
}
