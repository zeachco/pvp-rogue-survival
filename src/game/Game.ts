import { type CreepKind, type CreepWave, type ServerMessage } from "../../common/protocol";
import { SocketClient } from "../net/SocketClient";
import { Hud } from "../ui/Hud";
import { AttackArea } from "./AttackArea";
import { Creep } from "./Creep";
import { Hero } from "./Hero";
import { GameMap } from "./Map";
import { Projectile } from "./Projectile";
import { clamp, distance, type Camera, type PlayerState } from "./types";

const SAVED_SESSION_KEY = "multi-line-tower.session";
const FIXED_STEP = 1 / 60;
interface SavedSession { playerId: string; name: string }

declare global {
  interface Window {
    __mltDebug?: { game: Game; getState: () => Record<string, unknown>; join: (name: string) => void; clearSession: () => void };
  }
}

export class Game {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly map = new GameMap();
  private readonly socket = new SocketClient();
  private readonly hud: Hud;
  private readonly creeps: Creep[] = [];
  private readonly attacks: AttackArea[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly keys = new Set<string>();
  private hero = new Hero(this.map.center);
  private camera: Camera = { x: 0, y: 0, width: 1, height: 1 };
  private player?: PlayerState;
  private savedSession = loadSavedSession();
  private debugName = this.savedSession?.name ?? "unjoined";
  private lastTimestamp = performance.now();
  private accumulator = 0;
  private swordCooldown = 0;
  private defeatCooldown = 0;
  private waveQueue: Array<{ kind: CreepKind; emitterId: string | "neutral"; emitterName: string; spawnAt: number }> = [];

  constructor(private readonly canvas: HTMLCanvasElement, hudRoot: HTMLDivElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable");
    this.ctx = context;
    this.hud = new Hud(hudRoot, { onJoin: (name) => this.join(name) });
    if (this.savedSession) this.hud.setJoinName(this.savedSession.name);
    this.registerDebugGlobal();
  }

  start(): void {
    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (event) => {
      if (["w", "a", "s", "d", "W", "A", "S", "D"].includes(event.key)) event.preventDefault();
      this.keys.add(event.key.toLowerCase());
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.key.toLowerCase()));
    this.socket.onOpen(() => { this.debugLog("socket open"); this.restoreSavedSession(); });
    this.socket.onClose(() => this.debugLog("socket close"));
    this.socket.onError((event) => this.debugLog("socket error", { type: event.type }));
    this.socket.onMessage((message) => this.handleServerMessage(message));
    this.socket.connect();
    requestAnimationFrame((timestamp) => this.tick(timestamp));
  }

  private join(name: string, sessionId?: string): void {
    this.debugName = name.trim() || this.debugName;
    this.socket.send({ type: "join", name, sessionId });
    this.hud.setNotice("Joining arena...");
  }

  private restoreSavedSession(): void {
    if (this.savedSession && !this.player) this.join(this.savedSession.name, this.savedSession.playerId);
  }

  private handleServerMessage(message: ServerMessage): void {
    this.debugLog("server message", message);
    if (message.type === "welcome") {
      this.player = { id: message.playerId, name: message.player.name, score: message.player.score, waveNumber: message.player.waveNumber, health: 100, maxHealth: 100, gold: 0 };
      this.debugName = this.player.name;
      this.savedSession = { playerId: message.playerId, name: message.player.name };
      saveSession(this.savedSession);
      this.hud.setPlayer(this.player); this.hud.setNeighbors(message.neighbors);
      this.hud.setNotice("Move with WASD. Your sword automatically swipes at the closest creep—step out of red attacks.");
    } else if (message.type === "neighbors") this.hud.setNeighbors(message.neighbors);
    else if (message.type === "incomingWave") {
      this.enqueueWave(message.wave);
      if (this.player) { this.player.waveNumber = message.wave.waveNumber; this.hud.setPlayer(this.player); }
      const count = message.wave.creeps.reduce((sum, group) => sum + group.count, 0);
      this.hud.showWaveBanner(`Wave ${message.wave.waveNumber}`, `${count} threats entering from the perimeter`);
    } else if (message.type === "scoreAwarded" && this.player) {
      this.player.score = message.score; this.hud.setPlayer(this.player);
    } else if (message.type === "serverNotice") this.hud.setNotice(message.message);
  }

  private enqueueWave(wave: CreepWave): void {
    let spawnIndex = 0;
    for (const group of wave.creeps) for (let index = 0; index < group.count; index += 1) {
      this.waveQueue.push({ kind: group.creepKind, emitterId: group.emitterId, emitterName: group.emitterName, spawnAt: performance.now() + wave.delayMs + spawnIndex++ * wave.spawnIntervalMs });
    }
  }

  private tick(timestamp: number): void {
    this.accumulator += Math.min(0.1, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;
    while (this.accumulator >= FIXED_STEP) { this.update(FIXED_STEP); this.accumulator -= FIXED_STEP; }
    this.render(); requestAnimationFrame((next) => this.tick(next));
  }

  private update(deltaSeconds: number): void {
    if (!this.player) { this.updateCamera(); return; }
    if (this.defeatCooldown > 0) {
      this.defeatCooldown -= deltaSeconds;
      if (this.defeatCooldown <= 0) this.resetArena();
      return;
    }

    const now = performance.now();
    for (const queued of this.waveQueue.filter((entry) => entry.spawnAt <= now)) this.spawnCreep(queued.kind, queued.emitterId, queued.emitterName);
    this.waveQueue = this.waveQueue.filter((entry) => entry.spawnAt > now);

    this.hero.attackSlow = this.attacks.some((attack) => attack.active && attack.owner === "hero");
    this.hero.move({ x: Number(this.keys.has("d")) - Number(this.keys.has("a")), y: Number(this.keys.has("s")) - Number(this.keys.has("w")) }, deltaSeconds, this.map.width, this.map.height);
    this.updateSword(deltaSeconds);

    for (const creep of this.creeps) {
      if (!creep.active) continue;
      const attack = creep.pursue(this.hero.position, deltaSeconds, this.map.width, this.map.height);
      if (attack?.type === "melee") this.attacks.push(new AttackArea("creep", attack.origin, attack.angle, 70, Math.PI, 0.2, 0.14, 14, attack.source));
      if (attack?.type === "bubble") this.projectiles.push(new Projectile(attack.origin, attack.target));
    }
    for (const attack of this.attacks) attack.update(deltaSeconds);
    for (const projectile of this.projectiles) projectile.update(deltaSeconds);
    this.resolveAttacks();
    this.resolveProjectiles();
    this.collectKills();
    removeInactive(this.attacks); removeInactive(this.projectiles); removeInactive(this.creeps);
    this.player.health = this.hero.hp;
    this.hud.setPlayer(this.player);
    if (!this.hero.active) this.handleDefeat();
    this.updateCamera();
  }

  private updateSword(deltaSeconds: number): void {
    this.swordCooldown = Math.max(0, this.swordCooldown - deltaSeconds);
    let closest: Creep | undefined;
    let closestDistance = Infinity;
    for (const creep of this.creeps) {
      if (!creep.active) continue;
      const current = distance(this.hero.position, creep.position);
      if (current < closestDistance) { closest = creep; closestDistance = current; }
    }
    if (!closest) return;
    this.hero.facing = Math.atan2(closest.position.y - this.hero.position.y, closest.position.x - this.hero.position.x);
    if (closestDistance <= 112 && this.swordCooldown === 0) {
      this.attacks.push(new AttackArea("hero", { ...this.hero.position }, this.hero.facing, 105, 0.72, 0.18, 0.13, 30, this.hero));
      this.swordCooldown = 0.62;
    }
  }

  private resolveAttacks(): void {
    for (const attack of this.attacks) {
      if (!attack.shouldResolve()) continue;
      attack.markResolved();
      if (attack.owner === "hero") {
        for (const creep of this.creeps) if (creep.active && attack.contains(creep.position, creep.radius)) creep.takeDamage(attack.damage);
      } else if (this.hero.active && attack.contains(this.hero.position, this.hero.radius)) this.hero.takeDamage(attack.damage);
    }
  }

  private resolveProjectiles(): void {
    for (const projectile of this.projectiles) {
      if (!projectile.active) continue;
      if (distance(projectile.position, this.hero.position) <= projectile.radius + this.hero.radius) {
        this.hero.takeDamage(projectile.damage); projectile.active = false;
      } else if (projectile.position.x < -40 || projectile.position.y < -40 || projectile.position.x > this.map.width + 40 || projectile.position.y > this.map.height + 40) projectile.active = false;
    }
  }

  private collectKills(): void {
    if (!this.player) return;
    for (const creep of this.creeps) if (!creep.active) {
      this.player.gold += creep.bounty;
      this.socket.send({ type: "creepKilled", creepKind: creep.kind });
      this.debugLog("creep killed", { kind: creep.kind, gold: this.player.gold });
    }
  }

  private handleDefeat(): void {
    this.defeatCooldown = 1.8;
    this.hud.showWaveBanner("Hero down", "The arena will reset");
    this.debugLog("defeat", { wave: this.player?.waveNumber });
  }

  private resetArena(): void {
    this.creeps.length = 0; this.attacks.length = 0; this.projectiles.length = 0; this.waveQueue.length = 0;
    this.hero = new Hero(this.map.center);
    if (this.player) { this.player.health = this.hero.hp; this.hud.setPlayer(this.player); }
    this.hud.setNotice("Back in the fight. Move with WASD and dodge telegraphed attacks.");
  }

  private spawnCreep(kind: CreepKind, emitterId: string | "neutral", emitterName: string): void {
    this.creeps.push(new Creep(kind, emitterId, emitterName, this.map.randomEdgeSpawn()));
    this.debugLog("spawn creep", { kind, emitterName });
  }

  private updateCamera(): void {
    this.camera.x = clamp(this.hero.position.x - this.camera.width / 2, 0, Math.max(0, this.map.width - this.camera.width));
    this.camera.y = clamp(this.hero.position.y - this.camera.height / 2, 0, Math.max(0, this.map.height - this.camera.height));
  }

  private render(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.map.render(this.ctx, this.camera);
    for (const attack of this.attacks) attack.render(this.ctx, this.camera);
    for (const creep of this.creeps) creep.render(this.ctx, this.camera);
    for (const projectile of this.projectiles) projectile.render(this.ctx, this.camera);
    this.hero.render(this.ctx, this.camera);
  }

  private resize(): void {
    const scale = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(window.innerWidth * scale); this.canvas.height = Math.floor(window.innerHeight * scale);
    this.canvas.style.width = `${window.innerWidth}px`; this.canvas.style.height = `${window.innerHeight}px`;
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this.camera.width = window.innerWidth; this.camera.height = window.innerHeight; this.updateCamera();
  }

  private registerDebugGlobal(): void {
    window.__mltDebug = {
      game: this,
      getState: () => ({ player: this.player ? { ...this.player } : null, connected: this.socket.connected, hero: { position: { ...this.hero.position }, velocity: { ...this.hero.velocity }, hp: this.hero.hp }, creepCount: this.creeps.length, attackCount: this.attacks.length, projectileCount: this.projectiles.length, queuedSpawns: this.waveQueue.length, camera: { ...this.camera } }),
      join: (name) => this.join(name),
      clearSession: () => { window.localStorage.removeItem(SAVED_SESSION_KEY); this.savedSession = undefined; }
    };
  }

  private debugLog(event: string, detail?: unknown): void { console.log(`[MLH][${this.debugName}] ${event}`, detail ?? ""); }
}

function removeInactive<T extends { active: boolean }>(items: T[]): void {
  for (let index = items.length - 1; index >= 0; index -= 1) if (!items[index].active) items.splice(index, 1);
}

function loadSavedSession(): SavedSession | undefined {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SAVED_SESSION_KEY) ?? "null") as Partial<SavedSession> | null;
    return parsed && typeof parsed.playerId === "string" && typeof parsed.name === "string" ? { playerId: parsed.playerId, name: parsed.name } : undefined;
  } catch { return undefined; }
}

function saveSession(session: SavedSession): void {
  try { window.localStorage.setItem(SAVED_SESSION_KEY, JSON.stringify(session)); } catch { /* restricted storage */ }
}
