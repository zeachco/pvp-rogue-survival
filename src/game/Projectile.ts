import { GameObject } from "./GameObject";
import { normalize, type Camera, type Vector2 } from "./types";
import type { Unit } from "./Unit";
import type { DamagePresentation } from "./CombatText";
import type { ItemInstance, SkillId } from "../../common/items";
import { emittedImpactForce, type ImpactForce } from "./ImpactForce";

export type ProjectileSkill = SkillId | "frostSpike";

export class Projectile extends GameObject {
  readonly position: Vector2;
  readonly radius: number = 11;
  enteredArena = false;
  readonly velocity: Vector2;
  private lifetime = 4;
  private orbitAngle = 0;
  private orbitAge = 0;
  private orbiting = false;
  private orbitAngularDrift = 0;
  private spikeTimer = 0;
  private readonly hitTargets = new Set<string>();
  private boomerang = false; private returning = false; private boomerangRange = 0; private travelled = 0; private damageDealt = 0; private healingFraction = 0; private boomerangDamageSeconds = 0;

  readonly force?: ImpactForce;
  constructor(start: Vector2, target: Vector2, readonly damage = 1, readonly owner: "hero" | "creep" = "creep", readonly skill?: ProjectileSkill, readonly source?: Unit, readonly presentation: DamagePresentation = { kind: "physical" }, readonly weapon?: ItemInstance, force = true) {
    super(); this.position = { ...start };
    const direction = normalize({ x: target.x - start.x, y: target.y - start.y });
    const speed = skill === "vampiricBoomerang" ? 90 : skill === "frostOrb" ? 75 : skill === "frostSpike" ? 235 : 245;
    this.velocity = { x: direction.x * speed, y: direction.y * speed };
    this.force = force ? emittedImpactForce(source, "linear", start, this.velocity) : undefined;
    if (skill === "vampiricBoomerang") this.radius = 33;
    if (skill === "frostOrb") this.lifetime = 4;
    if (skill === "frostSpike") { this.lifetime = 1.2; this.radius = 6; }
  }

  static orbitingHammer(source: Unit, angle: number, damage: number, presentation: DamagePresentation, angularDrift = 0, lifetime = 2.4): Projectile { const projectile = new Projectile(source.position, source.position, damage, "hero", "orbitingHammers", source, presentation, undefined, false); projectile.orbiting = true; projectile.orbitAngle = angle; projectile.orbitAngularDrift = angularDrift; projectile.orbitAge = 0; projectile.lifetime = lifetime; projectile.position.x = source.position.x + Math.cos(angle) * 28; projectile.position.y = source.position.y + Math.sin(angle) * 28; return projectile; }
  static vampiricBoomerang(source: Unit, target: Vector2, damage: number, range: number, healingFraction: number, weapon: ItemInstance): Projectile { const projectile = new Projectile(source.position, target, damage, "hero", "vampiricBoomerang", source, { kind: "physical" }, weapon); projectile.boomerang = true; projectile.boomerangRange = range; projectile.healingFraction = healingFraction; projectile.lifetime = 30; return projectile; }
  emitFrostSpikes(deltaSeconds: number): Projectile[] { if (this.skill !== "frostOrb" || !this.active) return []; this.spikeTimer -= deltaSeconds; if (this.spikeTimer > 0) return []; this.spikeTimer = 0.45; return Array.from({ length: 8 }, (_, index) => { const angle = index * Math.PI / 4; return new Projectile(this.position, { x: this.position.x + Math.cos(angle), y: this.position.y + Math.sin(angle) }, this.damage, "hero", "frostSpike", this.source, this.presentation, this.weapon); }); }
  canHit(targetId: string): boolean { return this.boomerang || !this.hitTargets.has(targetId); }
  markHit(targetId: string): void { if (!this.boomerang) this.hitTargets.add(targetId); }
  recordDamage(amount: number): void { if (this.boomerang) this.damageDealt += Math.max(0, amount); }
  get overlapDamageSeconds(): number { return this.boomerangDamageSeconds; }
  finishOverlapDamage(): void { this.boomerangDamageSeconds = 0; }

  update(deltaSeconds: number): void {
    if (this.orbiting && this.source?.active) { this.orbitAge += deltaSeconds; this.orbitAngle += deltaSeconds * (5.2 + this.orbitAngularDrift); const radius = 28 + Math.min(1, this.orbitAge / 2.4) * 162; this.position.x = this.source.position.x + Math.cos(this.orbitAngle) * radius; this.position.y = this.source.position.y + Math.sin(this.orbitAngle) * radius; }
    else if (this.boomerang) { const speed = 90; if (!this.returning) { const step = speed * deltaSeconds; this.position.x += this.velocity.x * deltaSeconds; this.position.y += this.velocity.y * deltaSeconds; this.travelled += step; if (this.travelled >= this.boomerangRange) { this.returning = true; this.hitTargets.clear(); } } else if (this.source?.active) { const dx = this.source.position.x - this.position.x; const dy = this.source.position.y - this.position.y; const distance = Math.hypot(dx, dy); const step = speed * deltaSeconds; if (distance <= step + this.source.radius) { this.source.heal(this.damageDealt * this.healingFraction); this.active = false; } else { this.position.x += dx / distance * step; this.position.y += dy / distance * step; } } else this.active = false; }
    else { this.position.x += this.velocity.x * deltaSeconds; this.position.y += this.velocity.y * deltaSeconds; }
    if (this.boomerang && this.active) this.boomerangDamageSeconds = deltaSeconds;
    this.lifetime -= deltaSeconds;
    if (this.lifetime <= 0) this.active = false;
  }

  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    ctx.save(); ctx.translate(this.position.x - camera.x, this.position.y - camera.y);
    if (this.skill === "frostOrb") { ctx.fillStyle = "rgba(122,220,255,.75)"; ctx.strokeStyle = "#e5fbff"; ctx.shadowColor = "#62cfff"; ctx.shadowBlur = 18; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore(); return; }
    if (this.skill === "frostSpike") { ctx.rotate(Math.atan2(this.velocity.y, this.velocity.x)); ctx.fillStyle = "#bdefff"; ctx.shadowColor = "#62cfff"; ctx.shadowBlur = 10; ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -4); ctx.lineTo(-2, 0); ctx.lineTo(-6, 4); ctx.closePath(); ctx.fill(); ctx.restore(); return; }
    if (this.skill === "orbitingHammers") { ctx.rotate(this.orbitAngle + this.orbitAge * 7); ctx.fillStyle = "#e9d59a"; ctx.strokeStyle = "#fff3bd"; ctx.shadowColor = "#ffd45e"; ctx.shadowBlur = 12; ctx.lineWidth = 2; ctx.fillRect(-3, -2, 6, 15); ctx.strokeRect(-3, -2, 6, 15); ctx.fillRect(-10, -8, 20, 9); ctx.strokeRect(-10, -8, 20, 9); ctx.restore(); return; }
    if (this.skill === "vampiricBoomerang") { ctx.rotate(Math.atan2(this.velocity.y, this.velocity.x) + this.lifetime * 10); ctx.strokeStyle = "#ff3152"; ctx.shadowColor = "#ff1838"; ctx.shadowBlur = 24; ctx.lineWidth = 18; ctx.beginPath(); ctx.arc(0, 0, 39, -.9, .9); ctx.stroke(); ctx.strokeStyle = "#850d26"; ctx.lineWidth = 6; ctx.stroke(); ctx.restore(); return; }
    if (this.weapon?.definitionId === "throwingAxe") { ctx.rotate(Math.atan2(this.velocity.y, this.velocity.x) + this.lifetime * 11); ctx.fillStyle = "#8a552f"; ctx.strokeStyle = "#f0d4a4"; ctx.lineWidth = 2; ctx.fillRect(-9, -2, 18, 4); ctx.beginPath(); ctx.moveTo(2, -3); ctx.quadraticCurveTo(11, -12, 12, 0); ctx.quadraticCurveTo(11, 12, 2, 3); ctx.closePath(); ctx.fillStyle = "#b9c4ca"; ctx.fill(); ctx.stroke(); ctx.restore(); return; }
    ctx.fillStyle = "rgba(143,213,255,.72)"; ctx.strokeStyle = "#d9f5ff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.beginPath(); ctx.arc(-3, -4, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}
