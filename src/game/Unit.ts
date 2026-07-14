import { GameObject } from "./GameObject";
import { clamp, type Vector2 } from "./types";
import { derivedStats, type Stats } from "../../common/progression";
import { RARITY_POWER, type ItemInstance } from "../../common/items";
import type { RandomSource } from "../../common/random";
import type { CombatText, DamagePresentation } from "./CombatText";
import { bucklerBlockCost } from "../../common/combat";

export interface StatusEffect { kind: "bleed" | "poison" | "stun"; remaining: number; damagePerSecond: number; tick?: number; source?: Unit }

export abstract class Unit extends GameObject {
  position: Vector2;
  velocity: Vector2 = { x: 0, y: 0 };
  hp: number;
  maxHp: number;
  mana = 0;
  maxMana = 0;
  stamina = 1;
  maxStamina = 1;
  stats: Stats = { agility: 0, strength: 0, magic: 0, spirit: 0, intelligence: 0 };
  statuses: StatusEffect[] = [];
  enteredArena = false;
  offHand?: ItemInstance;
  mainHand?: ItemInstance;
  lastDamageSourceId?: string;
  damageFloorOne = false;
  onCombatText?: (text: CombatText) => void;

  protected constructor(position: Vector2, readonly radius: number, hp: number) {
    super();
    this.position = { ...position };
    this.hp = hp;
    this.maxHp = hp;
  }

  takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp === 0) this.active = false;
  }

  receiveDamage(amount: number, random: RandomSource, source?: Unit, reflectable = true, invulnerable = false, presentation: DamagePresentation = { kind: "physical" }): number {
    const hpBefore = this.hp;
    let remaining = amount; const buckler = this.offHand;
    const blockCost = buckler ? bucklerBlockCost(buckler, this.stats) : 0;
    if (buckler?.itemKind === "buckler" && this.stamina >= blockCost) {
      const chance = Math.min(1, buckler.blockChance + 0.005 * (this.stats.strength + this.stats.agility));
      if (random.next() < chance) {
        this.stamina -= blockCost;
        remaining = Math.max(0, amount - Math.min(amount, this.stats.strength));
        if (reflectable && source && buckler.reflectionComponents.length) {
          const power = RARITY_POWER[buckler.rarity]; let reflected = 0;
          if (buckler.reflectionComponents.includes("flat")) reflected += 1;
          if (buckler.reflectionComponents.includes("strength")) reflected += 0.2 * this.stats.strength;
          if (buckler.reflectionComponents.includes("return")) reflected += amount * (0.15 + 0.004 * this.stats.agility);
          source.receiveDamage(reflected * power, random, this, false, false, { kind: presentation.kind });
        }
      }
    }
    if (source && "build" in source) this.lastDamageSourceId = (source as Unit & { build: { id: string } }).build.id;
    if (invulnerable || this.damageFloorOne) this.hp = Math.max(1, this.hp - remaining); else this.takeDamage(remaining);
    if (remaining > 0) this.emitCombatText(remaining, presentation.kind, Boolean(presentation.critical));
    return Math.max(0, hpBefore - this.hp);
  }

  heal(amount: number): void { const before = this.hp; this.hp = Math.min(this.maxHp, this.hp + amount); const restored = this.hp - before; if (restored > 0) this.emitCombatText(restored, "healing", false); }

  configureStats(stats: Stats, offHand?: ItemInstance, mainHand?: ItemInstance): void {
    this.stats = { ...stats };
    this.offHand = offHand;
    this.mainHand = mainHand;
    const derived = derivedStats(stats);
    this.maxHp = derived.maxHp;
    this.hp = derived.maxHp;
    this.maxMana = derived.maxMana; this.mana = derived.maxMana;
    this.maxStamina = derived.maxStamina; this.stamina = derived.maxStamina;
  }

  updateResources(deltaSeconds: number, random?: RandomSource, invulnerable = false): void {
    const derived = derivedStats(this.stats);
    let periodicDamage = 0;
    for (const status of this.statuses) { status.remaining -= deltaSeconds; status.tick = (status.tick ?? 0) + deltaSeconds; if (status.tick >= 1) { periodicDamage += status.damagePerSecond; status.tick -= 1; if (random) this.receiveDamage(status.damagePerSecond, random, status.source, true, invulnerable, { kind: status.kind === "poison" ? "poison" : "bleed" }); } }
    this.statuses = this.statuses.filter((status) => status.remaining > 0);
    if (periodicDamage > 0 && !random) this.takeDamage(periodicDamage);
    const equipped = [this.mainHand, this.offHand].filter(Boolean) as ItemInstance[]; const vigorousRegen = equipped.reduce((sum, item) => sum + (item.modifiers.strengthRegenMultiplier > 0 ? 0.01 + item.modifiers.strengthRegenMultiplier * this.stats.strength : 0), 0);
    this.hp = Math.min(this.maxHp, this.hp + (derived.hpRegen + vigorousRegen) * deltaSeconds);
    this.mana = Math.min(this.maxMana, this.mana + derived.manaRegen * deltaSeconds);
    this.stamina = Math.min(this.maxStamina, this.stamina + derived.staminaRegen * deltaSeconds);
  }

  addStatus(status: StatusEffect): void { this.statuses.push(status); }
  get stunned(): boolean { return this.statuses.some((status) => status.kind === "stun"); }
  private emitCombatText(amount: number, kind: CombatText["kind"], critical: boolean): void { this.onCombatText?.({ position: { ...this.position }, amount, kind, critical, age: 0, lifetime: 0.9, drift: Math.sin(this.position.x * 0.17 + this.position.y * 0.11 + amount) * 9 }); }

  steer(direction: Vector2, acceleration: number, maxSpeed: number, deltaSeconds: number): void {
    const targetX = direction.x * maxSpeed;
    const targetY = direction.y * maxSpeed;
    const maxChange = acceleration * deltaSeconds;
    this.velocity.x = approach(this.velocity.x, targetX, maxChange);
    this.velocity.y = approach(this.velocity.y, targetY, maxChange);
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    if (speed > maxSpeed) {
      this.velocity.x = (this.velocity.x / speed) * maxSpeed;
      this.velocity.y = (this.velocity.y / speed) * maxSpeed;
    }
    this.position.x += this.velocity.x * deltaSeconds;
    this.position.y += this.velocity.y * deltaSeconds;
  }

  clampToBounds(width: number, height: number): void {
    this.position.x = clamp(this.position.x, this.radius, width - this.radius);
    this.position.y = clamp(this.position.y, this.radius, height - this.radius);
  }
}

function approach(value: number, target: number, change: number): number {
  return value < target ? Math.min(target, value + change) : Math.max(target, value - change);
}
