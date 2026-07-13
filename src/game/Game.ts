import { BALANCE_PROFILES, type BalanceConfig } from "../../common/balance";
import { rollWeaponDamage } from "../../common/combat";
import { systemRandom } from "../../common/random";
import type { CreepWave, ServerMessage, UnitBuild } from "../../common/protocol";
import { SocketClient } from "../net/SocketClient";
import { SessionStorage } from "../platform/SessionStorage";
import { Hud } from "../ui/Hud";
import { AttackArea } from "./AttackArea";
import { Creep } from "./Creep";
import { Hero } from "./Hero";
import { ItemDrop } from "./ItemDrop";
import { GameMap } from "./Map";
import { Projectile } from "./Projectile";
import { ArenaState, type QueuedSpawn } from "./ArenaState";
import { enqueueWave, releaseReadySpawns, removeInactive } from "./systems/lifecycle";
import { resolveCombat } from "./systems/combat";
import { HeroCombatSystem } from "./systems/HeroCombatSystem";
import { CanvasRenderer } from "./render/CanvasRenderer";
import { clamp, distance, type Camera, type PlayerState, type Vector2 } from "./types";

const FIXED_STEP = 1 / 60;

declare global { interface Window { __mltDebug?: { game: Game; getState: () => Record<string, unknown>; join: (name: string) => void; clearSession: () => void } } }

export class Game {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly map = new GameMap();
  private readonly socket = new SocketClient();
  private readonly sessionStorage = new SessionStorage();
  private readonly arena = new ArenaState();
  private readonly hud: Hud;
  private readonly renderer: CanvasRenderer;
  private readonly heroCombat = new HeroCombatSystem();
  private readonly keys = new Set<string>();
  private hero = new Hero(this.map.center);
  private camera: Camera = { x: 0, y: 0, width: 1, height: 1 };
  private player?: PlayerState;
  private savedSession = this.sessionStorage.load();
  private balance: BalanceConfig = BALANCE_PROFILES.dev;
  private debugName = this.savedSession?.name ?? "unjoined";
  private lastTimestamp = performance.now();
  private accumulator = 0;
  private defeatCooldown = 0;
  private briefingOpen = true;
  private briefingStartedAt = performance.now();
  private hovered?: Creep;
  private inspected?: Creep;
  private get creeps(): Creep[] { return this.arena.creeps; }
  private get attacks(): AttackArea[] { return this.arena.attacks; }
  private get projectiles(): Projectile[] { return this.arena.projectiles; }
  private get drops(): ItemDrop[] { return this.arena.drops; }
  private get pendingPickups(): Set<string> { return this.arena.pendingPickups; }
  private get blockedPickups(): Set<string> { return this.arena.blockedPickups; }
  private get waveQueue(): QueuedSpawn[] { return this.arena.waveQueue; }

  constructor(private readonly canvas: HTMLCanvasElement, hudRoot: HTMLDivElement) {
    const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas 2D context unavailable"); this.ctx = context;
    this.renderer = new CanvasRenderer(this.ctx, this.map);
    this.hud = new Hud(hudRoot, {
      onJoin: (name) => this.join(name), onAllocation: (allocation) => this.socket.send({ type: "updateAllocation", allocation }),
      onEquip: (itemId) => this.socket.send({ type: "equipItem", itemId }), onSell: (itemId) => this.socket.send({ type: "sellItem", itemId }), onExtract: (itemId) => this.socket.send({ type: "extractSkill", itemId }), onBack: () => this.clearInspection(), onStart: () => this.startFirstWave()
    });
    if (this.savedSession) this.hud.setJoinName(this.savedSession.name); this.registerDebugGlobal();
  }

  start(): void {
    this.resize(); window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (event) => { if (["w", "a", "s", "d"].includes(event.key.toLowerCase())) event.preventDefault(); this.keys.add(event.key.toLowerCase()); });
    window.addEventListener("keyup", (event) => this.keys.delete(event.key.toLowerCase()));
    this.canvas.addEventListener("mousemove", (event) => this.updateHover(event));
    this.canvas.addEventListener("click", (event) => this.inspectAt(event));
    this.socket.onOpen(() => { if (this.savedSession && !this.player) this.join(this.savedSession.name, this.savedSession.playerId); });
    this.socket.onMessage((message) => this.handleServerMessage(message)); this.socket.connect(); requestAnimationFrame((timestamp) => this.tick(timestamp));
  }

  private join(name: string, sessionId?: string): void { this.debugName = name.trim() || this.debugName; this.socket.send({ type: "join", name, sessionId }); this.hud.setNotice("Joining arena..."); }
  private handleServerMessage(message: ServerMessage): void {
    if (message.type === "welcome") {
      this.player = { id: message.playerId, name: message.player.name, score: message.player.score, waveNumber: message.player.waveNumber, health: 1, maxHealth: 1, mana: 0, maxMana: 0, stamina: 1, maxStamina: 1, gold: message.progress.gold, progress: message.progress };
      this.balance = message.config.balance;
      this.hero.applyProgress(message.progress); this.syncHeroState(); this.debugName = message.player.name;
      this.briefingOpen = true; this.briefingStartedAt = performance.now();
      this.savedSession = { playerId: message.playerId, name: message.player.name }; this.sessionStorage.save(this.savedSession);
      this.hud.setPlayer(this.player); this.hud.setSpells(this.heroCombat.spellSlots(message.progress)); this.hud.setNeighbors(message.neighbors); this.hud.setNotice("WASD moves. Combat and skills cast automatically. Walk over glowing item drops.");
    } else if (message.type === "neighbors") this.hud.setNeighbors(message.neighbors);
    else if (message.type === "incomingWave") this.enqueueWave(message.wave);
    else if (message.type === "creepDefeatResolved" && this.player) {
      this.player.score = message.score; this.player.progress = message.progress; this.player.gold = message.progress.gold;
      const position = this.arena.defeatedPositions.get(message.unitId); this.arena.defeatedPositions.delete(message.unitId);
      if (message.drop && position) this.drops.push(new ItemDrop(message.drop.id, message.drop.item, position));
      this.hero.applyProgress(message.progress, true); this.syncHeroState(); this.hud.setPlayer(this.player); this.hud.setNotice(message.reason);
    }
    else if (message.type === "progressionUpdated" && this.player) {
      this.player.progress = message.progress; this.player.gold = message.progress.gold; this.hero.applyProgress(message.progress, true); this.syncHeroState(); this.hud.setPlayer(this.player); this.hud.setSpells(this.heroCombat.spellSlots(message.progress)); this.hud.setNotice(message.reason);
    } else if (message.type === "scoreAwarded" && this.player) { this.player.score = message.score; this.hud.setPlayer(this.player); }
    else if (message.type === "waveAdjusted" && this.player) { this.player.waveNumber = message.waveNumber; this.hud.setPlayer(this.player); this.hud.setNotice(message.reason); }
    else if (message.type === "collectItemResult") this.handleCollectResult(message.dropId, message.collected, message.reason);
    else if (message.type === "serverNotice") this.hud.setNotice(message.message);
  }

  private enqueueWave(wave: CreepWave): void {
    enqueueWave(this.arena, wave, performance.now());
    if (this.player) { this.player.waveNumber = wave.waveNumber; this.hud.setPlayer(this.player); }
    this.hud.showWaveBanner(`Wave ${wave.waveNumber}`, `${wave.spawns.length - 1} creeps and one rival`);
  }

  private startFirstWave(): void {
    if (!this.briefingOpen) return;
    const pausedFor = performance.now() - this.briefingStartedAt;
    for (const queued of this.waveQueue) queued.spawnAt += pausedFor;
    this.briefingOpen = false;
    this.hud.setNotice("Wave starts in 3 seconds. Move with WASD; your club attacks automatically.");
  }

  private tick(timestamp: number): void {
    this.accumulator += Math.min(0.1, (timestamp - this.lastTimestamp) / 1000); this.lastTimestamp = timestamp;
    while (this.accumulator >= FIXED_STEP) { this.update(FIXED_STEP); this.accumulator -= FIXED_STEP; }
    this.render(); requestAnimationFrame((next) => this.tick(next));
  }

  private update(deltaSeconds: number): void {
    if (!this.player) return;
    if (this.briefingOpen) { this.updateCamera(); return; }
    if (this.defeatCooldown > 0) { this.defeatCooldown -= deltaSeconds; if (this.defeatCooldown <= 0) this.resetArena(); return; }
    for (const build of releaseReadySpawns(this.arena, performance.now())) this.spawnCreep(build);
    this.hero.update(deltaSeconds); this.hero.attackSlow = this.attacks.some((attack) => attack.active && attack.owner === "hero");
    const movementInput = { x: Number(this.keys.has("d")) - Number(this.keys.has("a")), y: Number(this.keys.has("s")) - Number(this.keys.has("w")) };
    this.hero.move(movementInput, deltaSeconds, this.map.width, this.map.height);
    this.heroCombat.update(deltaSeconds, movementInput, this.hero, this.arena, this.player.progress, this.balance, systemRandom);
    for (const creep of this.creeps) {
      if (!creep.active) continue;
      const attack = creep.pursue(this.hero.position, deltaSeconds, this.map.width, this.map.height);
      const damage = rollWeaponDamage(creep.build.equipped, creep.stats, "enemy", this.balance, systemRandom);
      if (attack?.type === "melee") this.attacks.push(new AttackArea("creep", attack.origin, attack.angle, 70, Math.PI, attack.windup, 0.14, damage, creep, undefined, creep.build.equipped));
      if (attack?.type === "bubble") this.projectiles.push(new Projectile(attack.origin, attack.target, damage));
    }
    for (const attack of this.attacks) attack.update(deltaSeconds); for (const projectile of this.projectiles) projectile.update(deltaSeconds);
    resolveCombat(this.arena, this.hero, this.player.progress.equipped, this.map.width, this.map.height, systemRandom); this.collectKills(); this.collectDrops();
    removeInactive(this.attacks); removeInactive(this.projectiles); removeInactive(this.creeps); removeInactive(this.drops);
    if (this.inspected && !this.inspected.active) this.clearInspection();
    this.syncHeroState(); this.hud.setPlayer(this.player); this.hud.setSpells(this.heroCombat.spellSlots(this.player.progress)); if (!this.hero.active) this.handleDefeat(); this.updateCamera();
  }

  private collectKills(): void {
    for (const creep of this.creeps) if (!creep.active) {
      this.arena.defeatedPositions.set(creep.build.id, { ...creep.position });
      this.socket.send({ type: "creepDefeated", unitId: creep.build.id });
    }
  }
  private collectDrops(): void {
    const overlapping = new Set<string>();
    for (const drop of this.drops) {
      if (!drop.active || distance(drop.position, this.hero.position) > drop.radius + this.hero.radius) continue;
      overlapping.add(drop.dropId);
      if (this.pendingPickups.has(drop.dropId) || this.blockedPickups.has(drop.dropId)) continue;
      this.pendingPickups.add(drop.dropId);
      this.socket.send({ type: "collectDrop", dropId: drop.dropId });
    }
    for (const itemId of this.blockedPickups) if (!overlapping.has(itemId)) this.blockedPickups.delete(itemId);
  }
  private handleCollectResult(dropId: string, collected: boolean, reason: string): void {
    this.pendingPickups.delete(dropId);
    if (collected) {
      const drop = this.drops.find((candidate) => candidate.dropId === dropId);
      if (drop) drop.active = false;
      this.blockedPickups.delete(dropId);
    } else this.blockedPickups.add(dropId);
    this.hud.setNotice(reason);
  }

  private spawnCreep(build: UnitBuild): void { this.creeps.push(new Creep(build, "neutral", build.name, this.map.randomEdgeSpawn(systemRandom), this.balance, systemRandom)); }
  private handleDefeat(): void { this.defeatCooldown = 1.8; this.socket.send({ type: "heroDefeated" }); this.hud.showWaveBanner("Hero down", "Wave reduced; progress and inventory retained"); }
  private resetArena(): void { this.arena.clear(); this.heroCombat.reset(); this.hero = new Hero(this.map.center); this.hero.applyProgress(this.player!.progress); this.clearInspection(); this.socket.send({ type: "requestWave" }); }
  private syncHeroState(): void { if (!this.player) return; this.player.health = this.hero.hp; this.player.maxHealth = this.hero.maxHp; this.player.mana = this.hero.mana; this.player.maxMana = this.hero.maxMana; this.player.stamina = this.hero.stamina; this.player.maxStamina = this.hero.maxStamina; this.player.gold = this.player.progress.gold; }

  private updateHover(event: MouseEvent): void { const world = this.eventWorld(event); this.hovered = this.creeps.filter((creep) => creep.active).sort((a, b) => distance(a.position, world) - distance(b.position, world))[0]; if (this.hovered && distance(this.hovered.position, world) > this.hovered.radius + 8) this.hovered = undefined; this.canvas.style.cursor = this.hovered ? "pointer" : "default"; }
  private inspectAt(event: MouseEvent): void { this.updateHover(event); this.inspected = this.hovered; this.hud.setInspection(this.inspected?.build); }
  private clearInspection(): void { this.inspected = undefined; this.hud.setInspection(); }
  private eventWorld(event: MouseEvent): Vector2 { const rect = this.canvas.getBoundingClientRect(); return { x: event.clientX - rect.left + this.camera.x, y: event.clientY - rect.top + this.camera.y }; }
  private updateCamera(): void { this.camera.x = clamp(this.hero.position.x - this.camera.width / 2, 0, Math.max(0, this.map.width - this.camera.width)); this.camera.y = clamp(this.hero.position.y - this.camera.height / 2, 0, Math.max(0, this.map.height - this.camera.height)); }
  private render(): void { this.renderer.render(this.camera, this.hero, this.arena, this.hovered, this.inspected); }
  private resize(): void { const scale = devicePixelRatio || 1; const width = this.canvas.clientWidth || innerWidth; const height = this.canvas.clientHeight || innerHeight; this.canvas.width = width * scale; this.canvas.height = height * scale; this.ctx.setTransform(scale, 0, 0, scale, 0, 0); this.camera.width = width; this.camera.height = height; this.updateCamera(); }
  private registerDebugGlobal(): void { window.__mltDebug = { game: this, getState: () => ({ player: this.player, balance: this.balance.id, hero: { hp: this.hero.hp, mana: this.hero.mana, stamina: this.hero.stamina }, creeps: this.creeps.length, drops: this.drops.length, queued: this.waveQueue.length }), join: (name) => this.join(name), clearSession: () => { this.sessionStorage.clear(); this.savedSession = undefined; } }; }
}
