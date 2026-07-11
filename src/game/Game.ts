import type { ItemInstance } from "../../common/items";
import { derivedStats, type Stats } from "../../common/progression";
import type { CreepWave, ServerMessage, UnitBuild } from "../../common/protocol";
import { SocketClient } from "../net/SocketClient";
import { Hud } from "../ui/Hud";
import { AttackArea } from "./AttackArea";
import { Creep } from "./Creep";
import { Hero } from "./Hero";
import { ItemDrop } from "./ItemDrop";
import { GameMap } from "./Map";
import { Projectile } from "./Projectile";
import { clamp, distance, type Camera, type PlayerState, type Vector2 } from "./types";

const SAVED_SESSION_KEY = "multi-line-tower.session";
const FIXED_STEP = 1 / 60;
interface SavedSession { playerId: string; name: string }
interface QueuedSpawn { build: UnitBuild; spawnAt: number }

declare global { interface Window { __mltDebug?: { game: Game; getState: () => Record<string, unknown>; join: (name: string) => void; clearSession: () => void } } }

export class Game {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly map = new GameMap();
  private readonly socket = new SocketClient();
  private readonly hud: Hud;
  private readonly creeps: Creep[] = [];
  private readonly attacks: AttackArea[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly drops: ItemDrop[] = [];
  private readonly keys = new Set<string>();
  private hero = new Hero(this.map.center);
  private camera: Camera = { x: 0, y: 0, width: 1, height: 1 };
  private player?: PlayerState;
  private savedSession = loadSavedSession();
  private debugName = this.savedSession?.name ?? "unjoined";
  private lastTimestamp = performance.now();
  private accumulator = 0;
  private attackCooldown = 0;
  private healingCooldown = 0;
  private weaponSkillCooldown = 0;
  private defeatCooldown = 0;
  private briefingOpen = true;
  private briefingStartedAt = performance.now();
  private hovered?: Creep;
  private inspected?: Creep;
  private waveQueue: QueuedSpawn[] = [];

  constructor(private readonly canvas: HTMLCanvasElement, hudRoot: HTMLDivElement) {
    const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas 2D context unavailable"); this.ctx = context;
    this.hud = new Hud(hudRoot, {
      onJoin: (name) => this.join(name), onAllocation: (allocation) => this.socket.send({ type: "updateAllocation", allocation }),
      onEquip: (itemId) => this.socket.send({ type: "equipItem", itemId }), onSell: (itemId) => this.socket.send({ type: "sellItem", itemId }), onBack: () => this.clearInspection(), onStart: () => this.startFirstWave()
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
      this.hero.applyProgress(message.progress); this.syncHeroState(); this.debugName = message.player.name;
      this.briefingOpen = true; this.briefingStartedAt = performance.now();
      this.savedSession = { playerId: message.playerId, name: message.player.name }; saveSession(this.savedSession);
      this.hud.setPlayer(this.player); this.hud.setNeighbors(message.neighbors); this.hud.setNotice("WASD moves. Combat and skills cast automatically. Walk over glowing item drops.");
    } else if (message.type === "neighbors") this.hud.setNeighbors(message.neighbors);
    else if (message.type === "incomingWave") this.enqueueWave(message.wave);
    else if (message.type === "progressionUpdated" && this.player) {
      this.player.progress = message.progress; this.player.gold = message.progress.gold; this.hero.applyProgress(message.progress, true); this.syncHeroState(); this.hud.setPlayer(this.player); this.hud.setNotice(message.reason);
    } else if (message.type === "scoreAwarded" && this.player) { this.player.score = message.score; this.hud.setPlayer(this.player); }
    else if (message.type === "waveAdjusted" && this.player) { this.player.waveNumber = message.waveNumber; this.hud.setPlayer(this.player); this.hud.setNotice(message.reason); }
    else if (message.type === "serverNotice") this.hud.setNotice(message.message);
  }

  private enqueueWave(wave: CreepWave): void {
    const now = performance.now(); this.waveQueue.push(...wave.spawns.map((spawn) => ({ build: spawn.build, spawnAt: now + spawn.spawnAtMs })));
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
    const now = performance.now(); for (const queued of this.waveQueue.filter((entry) => entry.spawnAt <= now)) this.spawnCreep(queued.build);
    this.waveQueue = this.waveQueue.filter((entry) => entry.spawnAt > now);
    this.hero.update(deltaSeconds); this.hero.attackSlow = this.attacks.some((attack) => attack.active && attack.owner === "hero");
    const movementInput = { x: Number(this.keys.has("d")) - Number(this.keys.has("a")), y: Number(this.keys.has("s")) - Number(this.keys.has("w")) };
    this.hero.move(movementInput, deltaSeconds, this.map.width, this.map.height);
    this.updateHeroCombat(deltaSeconds, movementInput);
    for (const creep of this.creeps) {
      if (!creep.active) continue;
      const attack = creep.pursue(this.hero.position, deltaSeconds, this.map.width, this.map.height);
      const damage = this.rollDamage(creep.build.equipped, creep.stats);
      if (attack?.type === "melee") this.attacks.push(new AttackArea("creep", attack.origin, attack.angle, 70, Math.PI, attack.windup, 0.14, damage, creep, undefined, creep.build.equipped));
      if (attack?.type === "bubble") this.projectiles.push(new Projectile(attack.origin, attack.target, damage));
    }
    for (const attack of this.attacks) attack.update(deltaSeconds); for (const projectile of this.projectiles) projectile.update(deltaSeconds);
    this.resolveAttacks(); this.resolveProjectiles(); this.collectKills(); this.collectDrops();
    removeInactive(this.attacks); removeInactive(this.projectiles); removeInactive(this.creeps); removeInactive(this.drops);
    if (this.inspected && !this.inspected.active) this.clearInspection();
    this.syncHeroState(); this.hud.setPlayer(this.player); if (!this.hero.active) this.handleDefeat(); this.updateCamera();
  }

  private updateHeroCombat(deltaSeconds: number, movementInput: Vector2): void {
    this.attackCooldown = Math.max(0, this.attackCooldown - deltaSeconds); this.healingCooldown = Math.max(0, this.healingCooldown - deltaSeconds); this.weaponSkillCooldown = Math.max(0, this.weaponSkillCooldown - deltaSeconds);
    const progress = this.player!.progress; const item = progress.equipped; const derived = derivedStats(progress.stats);
    if (progress.learnedSkills.includes("healing") && this.hero.hp < this.hero.maxHp * 0.5 && this.healingCooldown === 0 && this.hero.mana >= 2) {
      this.hero.mana -= 2; this.hero.hp = Math.min(this.hero.maxHp, this.hero.hp + (0.5 + progress.stats.spirit * 1.2) * derived.magicAmp); this.healingCooldown = 8 * (1 - derived.cooldownReduction);
    }
    let target: Creep | undefined; let targetDistance = Infinity;
    for (const creep of this.creeps) if (creep.active) { const current = distance(this.hero.position, creep.position); if (current < targetDistance) { target = creep; targetDistance = current; } }
    if (!target) {
      if (movementInput.x !== 0 || movementInput.y !== 0) this.hero.facing = Math.atan2(movementInput.y, movementInput.x);
      return;
    }
    this.hero.facing = Math.atan2(target.position.y - this.hero.position.y, target.position.x - this.hero.position.x);
    const ranged = item.definitionId === "staff"; const range = ranged ? 330 : 105;
    if (targetDistance <= range + target.radius && this.attackCooldown === 0 && this.hero.stamina >= item.staminaCost) {
      const skill = this.weaponSkillCooldown === 0 ? item.skills[0] : undefined;
      const magicSkill = skill === "arcaneBolt" && this.hero.mana >= 1;
      const physicalSkill = skill === "bash" || skill === "sweep" || skill === "flurry";
      const canSkill = magicSkill || (physicalSkill && this.hero.stamina >= item.staminaCost + 0.35);
      const activeSkill = canSkill ? skill : undefined;
      this.hero.stamina -= item.staminaCost + (physicalSkill && canSkill ? 0.35 : 0);
      if (magicSkill) this.hero.mana -= 1;
      const damage = this.rollDamage(item, progress.stats) * (activeSkill === "bash" ? 1.5 : activeSkill === "sweep" ? 1.25 : activeSkill === "flurry" ? 0.8 : activeSkill === "arcaneBolt" ? 1.7 : 1);
      if (ranged) this.projectiles.push(new Projectile(this.hero.position, target.position, damage, "hero", activeSkill === "arcaneBolt" ? activeSkill : undefined));
      else this.attacks.push(new AttackArea("hero", { ...this.hero.position }, this.hero.facing, activeSkill === "sweep" ? 135 : range, activeSkill === "sweep" || item.definitionId === "mace" || item.definitionId === "club" ? Math.PI : activeSkill === "flurry" ? 1.1 : 0.72, 0.18, 0.13, damage, this.hero, activeSkill && activeSkill !== "arcaneBolt" ? activeSkill : undefined, item));
      if (activeSkill) this.weaponSkillCooldown = (activeSkill === "flurry" ? 2.5 : 5) * (1 - derived.cooldownReduction);
      this.attackCooldown = (activeSkill === "flurry" ? 0.2 : 0.7) / (derived.attackSpeed * item.modifiers.attackSpeedMultiplier);
    }
  }

  private rollDamage(item: ItemInstance, stats: Stats): number {
    const derived = derivedStats(stats); let damage = derived.baseDamage * item.modifiers.damageMultiplier;
    if (item.definitionId === "staff") damage *= derived.magicAmp + item.modifiers.magicAmp;
    if (Math.random() < derived.critChance + item.modifiers.critChance) damage *= derived.critMultiplier;
    return damage;
  }

  private resolveAttacks(): void {
    for (const attack of this.attacks) {
      if (!attack.shouldResolve()) continue; attack.markResolved();
      if (attack.owner === "hero") {
        for (const creep of this.creeps) if (creep.active && attack.contains(creep.position, creep.radius)) { creep.takeDamage(attack.damage); if (attack.weapon) this.applyWeaponEffects(creep, attack.weapon); if (attack.skill === "bash") creep.addStatus({ kind: "stun", remaining: 1.1, damagePerSecond: 0 }); if (attack.skill === "sweep") creep.addStatus({ kind: "bleed", remaining: 3, damagePerSecond: 0.35 }); }
      } else if (this.hero.active && attack.contains(this.hero.position, this.hero.radius)) {
        this.hero.takeDamage(attack.damage);
        const source = attack.source;
        if (attack.weapon) this.applyWeaponEffects(this.hero, attack.weapon);
      }
    }
  }
  private resolveProjectiles(): void {
    for (const projectile of this.projectiles) {
      if (!projectile.active) continue;
      if (projectile.owner === "hero") {
        const hit = this.creeps.find((creep) => creep.active && distance(projectile.position, creep.position) <= projectile.radius + creep.radius);
        if (hit) { hit.takeDamage(projectile.damage); this.applyWeaponEffects(hit, this.player!.progress.equipped); if (projectile.skill === "arcaneBolt") hit.addStatus({ kind: "stun", remaining: 0.35, damagePerSecond: 0 }); projectile.active = false; }
      } else if (distance(projectile.position, this.hero.position) <= projectile.radius + this.hero.radius) { this.hero.takeDamage(projectile.damage); projectile.active = false; }
      if (projectile.position.x < -40 || projectile.position.y < -40 || projectile.position.x > this.map.width + 40 || projectile.position.y > this.map.height + 40) projectile.active = false;
    }
  }
  private applyWeaponEffects(target: Hero | Creep, item: ItemInstance): void {
    if (Math.random() < item.modifiers.bleedChance) target.addStatus({ kind: "bleed", remaining: 3, damagePerSecond: 0.25 });
    if (Math.random() < item.modifiers.poisonChance) target.addStatus({ kind: "poison", remaining: 4, damagePerSecond: 0.2 + target.stats.spirit * 0.02 });
    if (Math.random() < item.modifiers.stunChance) target.addStatus({ kind: "stun", remaining: 0.7, damagePerSecond: 0 });
  }

  private collectKills(): void {
    for (const creep of this.creeps) if (!creep.active) {
      const candidates = [creep.build.equipped, ...creep.build.backpack]; const item = candidates.find((candidate) => Math.random() < candidate.dropChance);
      if (item) this.drops.push(new ItemDrop({ ...item, id: `${item.id}-drop-${crypto.randomUUID()}` }, { ...creep.position }));
      this.socket.send({ type: "creepKilled", unitId: creep.build.id, isRival: creep.build.isRival, xpReward: creep.build.xpReward });
    }
  }
  private collectDrops(): void { for (const drop of this.drops) if (drop.active && distance(drop.position, this.hero.position) <= drop.radius + this.hero.radius) { this.socket.send({ type: "collectItem", item: drop.item }); drop.active = false; } }

  private spawnCreep(build: UnitBuild): void { this.creeps.push(new Creep(build, "neutral", build.name, this.map.randomEdgeSpawn())); }
  private handleDefeat(): void { this.defeatCooldown = 1.8; this.socket.send({ type: "heroDefeated" }); this.hud.showWaveBanner("Hero down", "Wave reduced; progress and inventory retained"); }
  private resetArena(): void { this.creeps.length = 0; this.attacks.length = 0; this.projectiles.length = 0; this.drops.length = 0; this.waveQueue.length = 0; this.hero = new Hero(this.map.center); this.hero.applyProgress(this.player!.progress); this.clearInspection(); this.socket.send({ type: "requestWave" }); }
  private syncHeroState(): void { if (!this.player) return; this.player.health = this.hero.hp; this.player.maxHealth = this.hero.maxHp; this.player.mana = this.hero.mana; this.player.maxMana = this.hero.maxMana; this.player.stamina = this.hero.stamina; this.player.maxStamina = this.hero.maxStamina; this.player.gold = this.player.progress.gold; }

  private updateHover(event: MouseEvent): void { const world = this.eventWorld(event); this.hovered = this.creeps.filter((creep) => creep.active).sort((a, b) => distance(a.position, world) - distance(b.position, world))[0]; if (this.hovered && distance(this.hovered.position, world) > this.hovered.radius + 8) this.hovered = undefined; this.canvas.style.cursor = this.hovered ? "pointer" : "default"; }
  private inspectAt(event: MouseEvent): void { this.updateHover(event); this.inspected = this.hovered; this.hud.setInspection(this.inspected?.build); }
  private clearInspection(): void { this.inspected = undefined; this.hud.setInspection(); }
  private eventWorld(event: MouseEvent): Vector2 { const rect = this.canvas.getBoundingClientRect(); return { x: event.clientX - rect.left + this.camera.x, y: event.clientY - rect.top + this.camera.y }; }
  private updateCamera(): void { this.camera.x = clamp(this.hero.position.x - this.camera.width / 2, 0, Math.max(0, this.map.width - this.camera.width)); this.camera.y = clamp(this.hero.position.y - this.camera.height / 2, 0, Math.max(0, this.map.height - this.camera.height)); }
  private render(): void { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this.map.render(this.ctx, this.camera); for (const drop of this.drops) drop.render(this.ctx, this.camera); for (const attack of this.attacks) attack.render(this.ctx, this.camera); for (const creep of this.creeps) { creep.render(this.ctx, this.camera); this.renderThreatIndicator(creep); if (creep === this.hovered || creep === this.inspected) { this.ctx.strokeStyle = "#fff08a"; this.ctx.lineWidth = 2; this.ctx.beginPath(); this.ctx.arc(creep.position.x - this.camera.x, creep.position.y - this.camera.y, creep.radius + 7, 0, Math.PI * 2); this.ctx.stroke(); } } for (const projectile of this.projectiles) projectile.render(this.ctx, this.camera); this.hero.render(this.ctx, this.camera); }
  private renderThreatIndicator(creep: Creep): void {
    const x = creep.position.x - this.camera.x; const y = creep.position.y - this.camera.y; const margin = 30;
    if (x >= margin && x <= this.camera.width - margin && y >= margin && y <= this.camera.height - margin) return;
    const indicatorX = clamp(x, margin, this.camera.width - margin); const indicatorY = clamp(y, margin, this.camera.height - margin);
    const angle = Math.atan2(y - indicatorY, x - indicatorX);
    this.ctx.save(); this.ctx.translate(indicatorX, indicatorY); this.ctx.rotate(angle); this.ctx.fillStyle = creep.build.isRival ? "#ffd166" : "#ff6f7d";
    this.ctx.beginPath(); this.ctx.moveTo(12, 0); this.ctx.lineTo(-8, -7); this.ctx.lineTo(-8, 7); this.ctx.closePath(); this.ctx.fill(); this.ctx.restore();
  }
  private resize(): void { const scale = devicePixelRatio || 1; this.canvas.width = innerWidth * scale; this.canvas.height = innerHeight * scale; this.canvas.style.width = `${innerWidth}px`; this.canvas.style.height = `${innerHeight}px`; this.ctx.setTransform(scale, 0, 0, scale, 0, 0); this.camera.width = innerWidth; this.camera.height = innerHeight; this.updateCamera(); }
  private registerDebugGlobal(): void { window.__mltDebug = { game: this, getState: () => ({ player: this.player, hero: { hp: this.hero.hp, mana: this.hero.mana, stamina: this.hero.stamina }, creeps: this.creeps.length, drops: this.drops.length, queued: this.waveQueue.length }), join: (name) => this.join(name), clearSession: () => { localStorage.removeItem(SAVED_SESSION_KEY); this.savedSession = undefined; } }; }
}

function removeInactive<T extends { active: boolean }>(items: T[]): void { for (let index = items.length - 1; index >= 0; index -= 1) if (!items[index].active) items.splice(index, 1); }
function loadSavedSession(): SavedSession | undefined { try { const parsed = JSON.parse(localStorage.getItem(SAVED_SESSION_KEY) ?? "null") as SavedSession | null; return parsed?.playerId && parsed.name ? parsed : undefined; } catch { return undefined; } }
function saveSession(session: SavedSession): void { try { localStorage.setItem(SAVED_SESSION_KEY, JSON.stringify(session)); } catch { /* restricted */ } }
