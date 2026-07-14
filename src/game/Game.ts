import { BALANCE_PROFILES, type BalanceConfig } from "../../common/balance";
import { rollWeaponStrike } from "../../common/combat";
import { systemRandom } from "../../common/random";
import type { CreepWave, GroundDrop, ServerMessage, UnitBuild } from "../../common/protocol";
import { SocketClient } from "../net/SocketClient";
import { SessionStorage } from "../platform/SessionStorage";
import { Hud } from "../ui/Hud";
import { AttackArea } from "./AttackArea";
import { Creep } from "./Creep";
import { Hero } from "./Hero";
import { ItemDrop } from "./ItemDrop";
import { GameMap } from "./Map";
import { Projectile } from "./Projectile";
import { SpellEffect } from "./SpellEffect";
import { ArenaState, type QueuedSpawn } from "./ArenaState";
import { enqueueWave, releaseReadySpawns, removeInactive } from "./systems/lifecycle";
import { resolveCombat } from "./systems/combat";
import { HeroCombatSystem } from "./systems/HeroCombatSystem";
import { CanvasRenderer } from "./render/CanvasRenderer";
import { clamp, distance, type Camera, type PlayerState, type Vector2 } from "./types";
import { correctArenaBoundary } from "./bounds";

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
  private debugName = this.savedSession?.username ?? "unjoined";
  private readonly pendingPickupAt = new Map<string, number>();
  private lastTimestamp = performance.now();
  private accumulator = 0;
  private defeatCooldown = 0;
  private resizeObserver?: ResizeObserver;
  private hovered?: Creep;
  private inspected?: Creep;
  private waveMode: "competitive" | "solo" | "training" = "training";
  private realmMode: "training" | "waiting" | "competitive" = "training";
  private autoRealmTimer?: number;
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
    this.hero.onCombatText = (text) => this.arena.addCombatText(text);
    this.hud = new Hud(hudRoot, {
      onJoin: (name) => this.join(name), onAllocation: (allocation) => this.socket.send({ type: "updateAllocation", allocation }), onRespec: (allocation) => this.socket.send({ type: "respecStats", allocation }),
      onEquip: (tileId) => this.socket.send({ type: "equipItem", tileId }), onSell: (tileId, bulk) => this.socket.send({ type: "sellItem", tileId, bulk }),
      onPurge: (tileId, bulk) => this.socket.send({ type: "purgeItem", tileId, bulk }), onUpgrade: (tileId, bulk) => this.socket.send({ type: "upgradeItem", tileId, bulk }),
      onSend: (tileId, bulk) => this.socket.send({ type: "sendItem", tileId, bulk }), onExtract: (tileId, bulk) => this.socket.send({ type: "extractSkill", tileId, bulk }),
      onLeaveRealm: () => this.socket.send({ type: "leaveRealm" }),
      onEnterRealm: () => this.enterRealm(), onBack: () => this.clearInspection(), onLogout: () => this.socket.send({ type: "logout" }),
      onInspectHero: (heroId) => this.socket.send({ type: "inspectHero", heroId }), onDismissPanelTrigger: (panel) => this.socket.send({ type: "dismissPanelTrigger", panel })
    });
    if (this.savedSession) this.hud.setJoinName(this.savedSession.username); this.registerDebugGlobal();
  }

  start(): void {
    this.resize(); window.addEventListener("resize", () => this.resize()); this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(this.canvas);
    window.addEventListener("keydown", (event) => { if (["w", "a", "s", "d"].includes(event.key.toLowerCase())) event.preventDefault(); this.keys.add(event.key.toLowerCase()); });
    window.addEventListener("keyup", (event) => this.keys.delete(event.key.toLowerCase()));
    this.canvas.addEventListener("mousemove", (event) => this.updateHover(event));
    this.canvas.addEventListener("click", (event) => this.inspectAt(event));
    this.socket.onOpen(() => { if (this.savedSession) this.join("", this.savedSession.heroId); else this.socket.send({ type: "listHeroes" }); });
    this.socket.onMessage((message) => this.handleServerMessage(message)); this.socket.connect(); requestAnimationFrame((timestamp) => this.tick(timestamp));
  }

  private join(name: string, heroId?: string): void { this.debugName = name.trim() || this.debugName; this.socket.send(heroId ? { type: "join", heroId } : { type: "join", name }); this.hud.setNotice("Joining arena..."); }
  private enterRealm(): void { clearTimeout(this.autoRealmTimer); if (this.realmMode !== "training") return; this.realmMode = "waiting"; this.socket.send({ type: "enterRealm" }); }
  private scheduleAutoRealmEntry(): void { clearTimeout(this.autoRealmTimer); if (!import.meta.env.DEV || this.realmMode !== "training") return; this.autoRealmTimer = window.setTimeout(() => this.enterRealm(), 10_000); }
  private handleServerMessage(message: ServerMessage): void {
    if (message.type === "welcome") {
      this.player = { id: message.playerId, name: message.player.name, score: message.player.score, waveNumber: message.player.waveNumber, health: 1, maxHealth: 1, mana: 0, maxMana: 0, stamina: 1, maxStamina: 1, attackProgress: 1, gold: message.progress.gold, progress: message.progress };
      this.balance = message.config.balance; this.realmMode = message.realm.mode; this.scheduleAutoRealmEntry();
      this.hero.applyProgress(message.progress); this.syncHeroState(); this.debugName = message.player.name;
      this.savedSession = { heroId: message.playerId, username: message.player.name }; this.sessionStorage.save(this.savedSession);
      this.hud.configurePanelTriggers(message.panelTriggers); this.hud.setPlayer(this.player); this.hud.setPublicHero(); this.hud.setSpells(this.heroCombat.spellSlots(message.progress, this.hero)); this.hud.setRealm(message.realm); this.hud.setNotice(""); this.hud.showCenterToast("WASD moves. Combat and skills cast automatically. Walk over glowing item drops."); this.reconcileDrops();
    } else if (message.type === "loggedOut") { clearTimeout(this.autoRealmTimer); this.sessionStorage.clear(); this.savedSession = undefined; this.player = undefined; this.arena.clear(); this.pendingPickupAt.clear(); this.heroCombat.reset(); this.hud.clearPlayer(); this.hud.setPublicHero(); }
    else if (message.type === "leaderboard") this.hud.setLeaderboard(message.heroes);
    else if (message.type === "heroProfile") this.hud.setPublicHero(message.hero);
    else if (message.type === "realmUpdated") { this.realmMode = message.realm.mode; if (this.realmMode !== "training") clearTimeout(this.autoRealmTimer); this.hud.setRealm(message.realm); }
    else if (message.type === "incomingWave") this.enqueueWave(message.wave);
    else if (message.type === "creepDefeatResolved" && this.player) {
      this.player.score = message.score; this.player.progress = message.progress; this.player.gold = message.progress.gold;
      const position = this.arena.defeatedPositions.get(message.unitId); this.arena.defeatedPositions.delete(message.unitId);
      if (message.drop && position) this.drops.push(new ItemDrop(message.drop, position));
      this.hero.applyProgress(message.progress, true); this.syncHeroState(); this.hud.setPlayer(this.player);
      if (this.waveMode === "training") this.hud.showXpToast(message.reason); else this.hud.setNotice(message.reason);
    }
    else if (message.type === "progressionUpdated" && this.player) {
      this.player.progress = message.progress; this.player.gold = message.progress.gold; this.hero.applyProgress(message.progress, true); this.syncHeroState(); this.hud.setPlayer(this.player); this.hud.setSpells(this.heroCombat.spellSlots(message.progress, this.hero)); this.hud.setNotice(message.reason);
    } else if (message.type === "groundDropCreated") this.drops.push(new ItemDrop(message.drop, { ...this.hero.position }));
    else if (message.type === "scoreAwarded" && this.player) { this.player.score = message.score; this.hud.setPlayer(this.player); }
    else if (message.type === "waveAdjusted" && this.player) { this.player.waveNumber = message.waveNumber; this.hud.setPlayer(this.player); this.hud.setNotice(message.reason); }
    else if (message.type === "collectItemResult") this.handleCollectResult(message.dropId, message.collected, message.reason);
    else if (message.type === "dropsReconciled") this.handleDropsReconciled(message.drops, message.removeDropIds, message.resolvedDropIds);
    else if (message.type === "serverNotice") this.hud.setNotice(message.message);
  }

  private enqueueWave(wave: CreepWave): void {
    if (wave.mode !== this.waveMode) this.arena.clear();
    this.waveMode = wave.mode;
    enqueueWave(this.arena, wave, performance.now());
    if (this.player) { this.player.waveNumber = wave.waveNumber; this.hud.setPlayer(this.player); }
    this.hud.showWaveBanner(wave.mode === "training" ? "Training Grounds" : wave.mode === "solo" ? `Solo Wave ${wave.waveNumber}` : `Wave ${wave.waveNumber}`, `${wave.spawns.length - 1} creeps and one rival`);
  }

  private tick(timestamp: number): void {
    this.accumulator += Math.min(0.1, (timestamp - this.lastTimestamp) / 1000); this.lastTimestamp = timestamp;
    while (this.accumulator >= FIXED_STEP) { this.update(FIXED_STEP); this.accumulator -= FIXED_STEP; }
    this.render(); requestAnimationFrame((next) => this.tick(next));
  }

  private update(deltaSeconds: number): void {
    if (!this.player) return;
    if (this.defeatCooldown > 0) { this.defeatCooldown -= deltaSeconds; if (this.defeatCooldown <= 0) this.resetArena(); return; }
    for (const build of releaseReadySpawns(this.arena, performance.now())) this.spawnCreep(build);
    this.hero.update(deltaSeconds, systemRandom, this.waveMode === "training"); this.hero.attackSlow = this.attacks.some((attack) => attack.active && attack.owner === "hero");
    const movementInput = { x: Number(this.keys.has("d")) - Number(this.keys.has("a")), y: Number(this.keys.has("s")) - Number(this.keys.has("w")) };
    this.hero.move(movementInput, deltaSeconds, this.map.width, this.map.height);
    this.heroCombat.update(deltaSeconds, movementInput, this.hero, this.arena, this.player.progress, this.balance, systemRandom);
    for (const creep of this.creeps) {
      if (!creep.active) continue;
      const attack = creep.pursue(this.hero.position, deltaSeconds, this.map.width, this.map.height);
      correctArenaBoundary(creep, this.map.width, this.map.height, deltaSeconds);
      const strike = rollWeaponStrike(creep.build.mainHand, creep.stats, "enemy", this.balance, systemRandom); const presentation = { kind: creep.build.mainHand.definitionId === "staff" ? "magic" as const : "physical" as const, critical: strike.critical };
      if (attack?.type === "melee") this.attacks.push(new AttackArea("creep", attack.origin, attack.angle, 70, Math.PI, attack.windup, 0.14, strike.damage, creep, undefined, creep.build.mainHand, presentation));
      if (attack?.type === "projectile") this.projectiles.push(new Projectile(attack.origin, attack.target, strike.damage, "creep", undefined, creep, presentation, creep.build.mainHand));
      if (attack?.type === "fireBreath") { this.attacks.push(new AttackArea("creep", attack.origin, attack.angle, 150, 0.62, 0.22, 0.18, strike.damage * 1.1, creep, "fireBreath", creep.build.mainHand, { kind: "fire", critical: strike.critical })); this.arena.spellEffects.push(new SpellEffect("fireBreath", attack.origin, attack.angle)); }
    }
    for (const attack of this.attacks) attack.update(deltaSeconds);
    const emittedProjectiles: Projectile[] = [];
    for (const projectile of this.projectiles) { projectile.update(deltaSeconds); emittedProjectiles.push(...projectile.emitFrostSpikes(deltaSeconds)); correctArenaBoundary(projectile, this.map.width, this.map.height, deltaSeconds); }
    this.projectiles.push(...emittedProjectiles);
    for (const effect of this.arena.spellEffects) effect.update(deltaSeconds);
    const attractionSpeed = Math.max(this.player.progress.mainHand.attractionSpeed, this.player.progress.offHand?.attractionSpeed ?? 0);
    for (const drop of this.drops) { if (drop.escaping) { drop.move(deltaSeconds); if (drop.outside(this.map.width, this.map.height) && drop.active) { drop.active = false; this.socket.send({ type: "deferDrop", dropId: drop.dropId }); } } else { if (attractionSpeed > 0 && !this.pendingPickups.has(drop.dropId)) drop.pullToward(this.hero.position, attractionSpeed, deltaSeconds); correctArenaBoundary(drop, this.map.width, this.map.height, deltaSeconds); } }
    resolveCombat(this.arena, this.hero, this.player.progress.mainHand, this.map.width, this.map.height, systemRandom); this.collectKills(); this.collectDrops();
    if ([...this.pendingPickupAt.values()].some((sentAt) => performance.now() - sentAt >= 3000)) this.reconcileDrops();
    this.arena.updateCombatTexts(deltaSeconds);
    removeInactive(this.attacks); removeInactive(this.projectiles); removeInactive(this.creeps); removeInactive(this.drops); removeInactive(this.arena.spellEffects);
    if (this.inspected && !this.inspected.active) this.clearInspection();
    this.syncHeroState(); this.hud.setPlayer(this.player); this.hud.setSpells(this.heroCombat.spellSlots(this.player.progress, this.hero)); if (!this.hero.active) this.handleDefeat(); this.updateCamera();
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
      if (this.socket.send({ type: "collectDrop", dropId: drop.dropId })) { this.pendingPickups.add(drop.dropId); this.pendingPickupAt.set(drop.dropId, performance.now()); }
    }
    for (const itemId of this.blockedPickups) if (!overlapping.has(itemId)) this.blockedPickups.delete(itemId);
  }
  private handleCollectResult(dropId: string, collected: boolean, reason: string): void {
    this.pendingPickups.delete(dropId);
    this.pendingPickupAt.delete(dropId);
    if (collected) {
      const drop = this.drops.find((candidate) => candidate.dropId === dropId);
      if (drop) drop.active = false;
      this.blockedPickups.delete(dropId);
    } else this.blockedPickups.add(dropId);
    this.hud.setNotice(reason);
  }
  private reconcileDrops(): void { if (!this.player) return; if (this.socket.send({ type: "reconcileDrops", activeDropIds: this.drops.filter((drop) => drop.active).map((drop) => drop.dropId), pendingDropIds: [...this.pendingPickups] })) for (const id of this.pendingPickups) this.pendingPickupAt.set(id, performance.now()); }
  private handleDropsReconciled(drops: GroundDrop[], removeDropIds: string[], resolvedDropIds: string[]): void { const removed = new Set(removeDropIds); for (const drop of this.drops) if (removed.has(drop.dropId)) drop.active = false; for (const id of resolvedDropIds) { this.pendingPickups.delete(id); this.pendingPickupAt.delete(id); } const existing = new Set(this.drops.filter((drop) => drop.active).map((drop) => drop.dropId)); for (const drop of drops) if (!existing.has(drop.id)) this.drops.push(new ItemDrop(drop, { ...this.hero.position })); }

  private spawnCreep(build: UnitBuild): void { const creep = new Creep(build, build.emitterId ?? "neutral", build.emitterName ?? build.name, this.map.randomEdgeSpawn(systemRandom), this.balance, systemRandom, this.waveMode === "training" ? 0.5 : 1); creep.onCombatText = (text) => this.arena.addCombatText(text); this.creeps.push(creep); }
  private handleDefeat(): void { if (this.waveMode === "training") return; this.defeatCooldown = 1.8; this.socket.send({ type: "heroDefeated", sourceUnitId: this.hero.lastDamageSourceId }); this.hud.showWaveBanner("Hero down", "Wave reduced; progress and inventory retained"); }
  private resetArena(): void { this.arena.clear(); this.pendingPickupAt.clear(); this.heroCombat.reset(); this.hero = new Hero(this.map.center); this.hero.onCombatText = (text) => this.arena.addCombatText(text); this.hero.applyProgress(this.player!.progress); this.clearInspection(); this.socket.send({ type: "requestWave" }); }
  private syncHeroState(): void { if (!this.player) return; this.player.health = this.hero.hp; this.player.maxHealth = this.hero.maxHp; this.player.mana = this.hero.mana; this.player.maxMana = this.hero.maxMana; this.player.stamina = this.hero.stamina; this.player.maxStamina = this.hero.maxStamina; this.player.attackProgress = this.heroCombat.attackProgress; this.player.gold = this.player.progress.gold; }

  private updateHover(event: MouseEvent): void { const world = this.eventWorld(event); this.hovered = this.creeps.filter((creep) => creep.active).sort((a, b) => distance(a.position, world) - distance(b.position, world))[0]; if (this.hovered && distance(this.hovered.position, world) > this.hovered.radius + 8) this.hovered = undefined; this.canvas.style.cursor = this.hovered ? "pointer" : "default"; }
  private inspectAt(event: MouseEvent): void { this.updateHover(event); this.inspected = this.hovered; this.hud.setInspection(this.inspected?.build); }
  private clearInspection(): void { this.inspected = undefined; this.hud.setInspection(); }
  private eventWorld(event: MouseEvent): Vector2 { const rect = this.canvas.getBoundingClientRect(); return { x: event.clientX - rect.left + this.camera.x, y: event.clientY - rect.top + this.camera.y }; }
  private updateCamera(): void { this.camera.x = clamp(this.hero.position.x - this.camera.width / 2, 0, Math.max(0, this.map.width - this.camera.width)); this.camera.y = clamp(this.hero.position.y - this.camera.height / 2, 0, Math.max(0, this.map.height - this.camera.height)); }
  private render(): void { this.renderer.render(this.camera, this.hero, this.arena, this.hovered, this.inspected); }
  private resize(): void { const scale = devicePixelRatio || 1; const width = this.canvas.clientWidth || innerWidth; const height = this.canvas.clientHeight || innerHeight; this.canvas.width = width * scale; this.canvas.height = height * scale; this.ctx.setTransform(scale, 0, 0, scale, 0, 0); this.camera.width = width; this.camera.height = height; this.updateCamera(); }
  private registerDebugGlobal(): void { window.__mltDebug = { game: this, getState: () => ({ player: this.player, balance: this.balance.id, hero: { hp: this.hero.hp, mana: this.hero.mana, stamina: this.hero.stamina }, creeps: this.creeps.length, drops: this.drops.length, queued: this.waveQueue.length }), join: (name) => this.join(name), clearSession: () => { this.sessionStorage.clear(); this.savedSession = undefined; } }; }
}
