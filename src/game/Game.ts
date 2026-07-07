import { CREEP_DEFINITIONS, type CreepKind, type CreepWave, type ServerMessage } from "../../common/protocol";
import { GameMap } from "./Map";
import { Creep } from "./Creep";
import { Tower } from "./Tower";
import { Projectile } from "./Projectile";
import { SocketClient } from "../net/SocketClient";
import { Hud } from "../ui/Hud";
import type { Camera, PlayerState } from "./types";

export class Game {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly map = new GameMap();
  private readonly socket = new SocketClient();
  private readonly hud: Hud;
  private readonly creeps: Creep[] = [];
  private readonly towers: Tower[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly keys = new Set<string>();
  private camera: Camera = { x: 0, y: 0, width: 1, height: 1 };
  private player?: PlayerState;
  private lastTimestamp = performance.now();
  private spawnTimer = 1;
  private incomeTimer = 0;
  private waveQueue: Array<{ wave: CreepWave; spawnAt: number }> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    hudRoot: HTMLDivElement
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable");
    this.ctx = context;
    this.hud = new Hud(hudRoot, {
      onJoin: (name) => this.join(name),
      onBuyCreep: (kind) => this.buyCreep(kind)
    });
  }

  start(): void {
    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (event) => this.keys.add(event.key));
    window.addEventListener("keyup", (event) => this.keys.delete(event.key));
    this.canvas.addEventListener("click", (event) => this.handleCanvasClick(event));

    this.socket.onMessage((message) => this.handleServerMessage(message));
    this.socket.connect();
    requestAnimationFrame((timestamp) => this.tick(timestamp));
  }

  private join(name: string): void {
    this.socket.send({ type: "join", name });
    this.hud.setNotice("Joining matchmaking...");
  }

  private buyCreep(kind: CreepKind): void {
    const definition = CREEP_DEFINITIONS[kind];
    if (!this.player) return;
    if (this.player.gold < definition.cost) {
      this.hud.setNotice(`Need ${definition.cost} gold for ${definition.label}.`);
      return;
    }

    this.player.gold -= definition.cost;
    this.player.income += definition.incomeGain;
    this.hud.setPlayer(this.player);
    this.socket.send({ type: "buyCreep", creepKind: kind });
  }

  private handleServerMessage(message: ServerMessage): void {
    if (message.type === "welcome") {
      this.player = {
        id: message.playerId,
        name: message.player.name,
        score: message.player.score,
        income: message.player.income,
        gold: 120,
        lives: 30
      };
      this.hud.setPlayer(this.player);
      this.hud.setNeighbors(message.neighbors);
      this.hud.setNotice("Click cyan build pads to place towers. Arrow keys move the camera.");
      return;
    }

    if (message.type === "neighbors") {
      this.hud.setNeighbors(message.neighbors);
      return;
    }

    if (message.type === "incomingWave") {
      this.enqueueWave(message.wave);
      this.hud.setNotice(`${message.wave.emitterName} sent ${message.wave.count} ${message.wave.creepKind} creeps.`);
      return;
    }

    if (message.type === "purchaseAccepted" && this.player) {
      this.player.income = message.income;
      this.hud.setPlayer(this.player);
      return;
    }

    if (message.type === "scoreAwarded" && this.player) {
      this.player.score = message.score;
      this.hud.setPlayer(this.player);
      return;
    }

    if (message.type === "serverNotice") {
      this.hud.setNotice(message.message);
    }
  }

  private enqueueWave(wave: CreepWave): void {
    const now = performance.now();
    for (let index = 0; index < wave.count; index += 1) {
      this.waveQueue.push({ wave, spawnAt: now + wave.delayMs + index * 520 });
    }
  }

  private tick(timestamp: number): void {
    const deltaSeconds = Math.min(0.05, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;
    this.update(deltaSeconds);
    this.render();
    requestAnimationFrame((nextTimestamp) => this.tick(nextTimestamp));
  }

  private update(deltaSeconds: number): void {
    this.updateCamera(deltaSeconds);
    this.updateIncome(deltaSeconds);
    this.updateSpawning(deltaSeconds);

    for (const queued of this.waveQueue.filter((entry) => entry.spawnAt <= performance.now())) {
      this.spawnCreep(queued.wave.creepKind, queued.wave.emitterId, queued.wave.emitterName);
    }
    this.waveQueue = this.waveQueue.filter((entry) => entry.spawnAt > performance.now());

    for (const tower of this.towers) {
      tower.update(deltaSeconds);
      tower.attack(this.creeps);
    }

    for (const object of [...this.creeps, ...this.projectiles]) {
      object.update(deltaSeconds);
    }

    for (const creep of this.creeps) {
      if (creep.hasLeaked()) {
        this.handleLeak(creep);
      } else if (!creep.active && this.player) {
        this.player.gold += creep.bounty;
      }
    }

    removeInactive(this.creeps);
    removeInactive(this.projectiles);
    if (this.player) this.hud.setPlayer(this.player);
  }

  private updateIncome(deltaSeconds: number): void {
    if (!this.player) return;
    this.incomeTimer += deltaSeconds;
    if (this.incomeTimer < 8) return;
    this.incomeTimer = 0;
    this.player.gold += this.player.income;
  }

  private updateSpawning(deltaSeconds: number): void {
    this.spawnTimer -= deltaSeconds;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = 4.5;
    if (this.waveQueue.length === 0) {
      this.spawnCreep("basic", "neutral", "Neutral");
    }
  }

  private spawnCreep(kind: CreepKind, emitterId: string | "neutral", emitterName: string): void {
    this.creeps.push(new Creep(kind, emitterId, emitterName, this.map.getWaypoints()));
  }

  private handleLeak(creep: Creep): void {
    if (!this.player) return;
    this.player.lives = Math.max(0, this.player.lives - 1);
    if (creep.emitterId !== "neutral" && creep.emitterId !== this.player.id) {
      this.socket.send({ type: "creepLeaked", emitterId: creep.emitterId, creepKind: creep.kind });
    }
  }

  private handleCanvasClick(event: MouseEvent): void {
    if (!this.player) return;
    const rect = this.canvas.getBoundingClientRect();
    const world = {
      x: event.clientX - rect.left + this.camera.x,
      y: event.clientY - rect.top + this.camera.y
    };
    const pad = this.map.findPadAt(world);
    if (!pad) return;
    const cost = 55;
    if (this.player.gold < cost) {
      this.hud.setNotice(`Need ${cost} gold for a tower.`);
      return;
    }
    pad.occupied = true;
    this.player.gold -= cost;
    this.towers.push(new Tower(this.map.tileCenter(pad.x, pad.y), this.projectiles));
  }

  private updateCamera(deltaSeconds: number): void {
    const speed = 420 * deltaSeconds;
    if (this.keys.has("ArrowLeft")) this.camera.x -= speed;
    if (this.keys.has("ArrowRight")) this.camera.x += speed;
    if (this.keys.has("ArrowUp")) this.camera.y -= speed;
    if (this.keys.has("ArrowDown")) this.camera.y += speed;
    this.camera.x = clamp(this.camera.x, 0, Math.max(0, this.map.width - this.camera.width));
    this.camera.y = clamp(this.camera.y, 0, Math.max(0, this.map.height - this.camera.height));
  }

  private render(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.map.render(this.ctx, this.camera);
    for (const tower of this.towers) tower.render(this.ctx, this.camera);
    for (const creep of this.creeps) creep.render(this.ctx, this.camera);
    for (const projectile of this.projectiles) projectile.render(this.ctx, this.camera);
  }

  private resize(): void {
    const scale = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(window.innerWidth * scale);
    this.canvas.height = Math.floor(window.innerHeight * scale);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this.camera.width = window.innerWidth;
    this.camera.height = window.innerHeight;
  }
}

function removeInactive<T extends { active: boolean }>(items: T[]): void {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!items[index].active) items.splice(index, 1);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
