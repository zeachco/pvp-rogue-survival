import type { ArenaState } from "../ArenaState";
import type { Creep } from "../Creep";
import type { Hero } from "../Hero";
import type { GameMap } from "../Map";
import { clamp, type Camera } from "../types";
import { COMBAT_TEXT_COLORS, CRITICAL_TEXT_COLOR, type CombatText } from "../CombatText";
import { auraRadius } from "../../../common/auras";

export class CanvasRenderer {
  constructor(private readonly ctx: CanvasRenderingContext2D, private readonly map: GameMap) {}

  render(camera: Camera, hero: Hero, arena: ArenaState, hovered?: Creep, inspected?: Creep): void {
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    this.map.render(this.ctx, camera);
    this.renderAuras(hero, camera);
    for (const drop of arena.drops) drop.render(this.ctx, camera);
    for (const attack of arena.attacks) attack.render(this.ctx, camera);
    for (const creep of arena.creeps) {
      creep.render(this.ctx, camera); this.renderThreatIndicator(creep, camera);
      if (creep === hovered || creep === inspected) this.renderSelection(creep, camera);
    }
    for (const projectile of arena.projectiles) projectile.render(this.ctx, camera);
    hero.render(this.ctx, camera);
    for (const effect of arena.spellEffects) effect.render(this.ctx, camera);
    for (const text of arena.combatTexts) this.renderCombatText(text, camera);
  }

  private renderAuras(hero: Hero, camera: Camera): void {
    const x = hero.position.x - camera.x; const y = hero.position.y - camera.y; const time = performance.now() / 1000; const radius = (skill: "slowAura" | "hinderingAura" | "deathBurst" | "sunburnAura" | "thunderAura") => auraRadius(hero.skillLevels.get(skill) ?? 1, hero.stats.spirit); this.ctx.save(); this.ctx.translate(x, y);
    if (hero.knownSkills.has("slowAura")) { const r = radius("slowAura"); this.ctx.fillStyle = "rgba(50,130,255,.10)"; this.ctx.strokeStyle = "rgba(90,180,255,.42)"; this.ctx.lineWidth = 3; this.ctx.beginPath(); this.ctx.arc(0, 0, r, 0, Math.PI * 2); this.ctx.fill(); this.ctx.stroke(); }
    if (hero.knownSkills.has("hinderingAura")) { const scale = radius("hinderingAura") / 180; this.ctx.strokeStyle = "rgba(100,210,255,.30)"; this.ctx.lineWidth = 2; for (let ring = 0; ring < 4; ring += 1) { this.ctx.beginPath(); this.ctx.arc(0, 0, (45 + ring * 38 + Math.sin(time * 2 + ring) * 7) * scale, 0, Math.PI * 2); this.ctx.stroke(); } }
    if (hero.knownSkills.has("deathBurst")) { const scale = radius("deathBurst") / 180; this.ctx.fillStyle = "rgba(70,255,125,.13)"; this.ctx.beginPath(); for (let i = 0; i < 24; i += 1) { const a = i * Math.PI / 12; const r = (i % 2 ? 145 : 175) * scale; const px = Math.cos(a) * r; const py = Math.sin(a) * r; if (!i) this.ctx.moveTo(px, py); else this.ctx.lineTo(px, py); } this.ctx.closePath(); this.ctx.fill(); }
    if (hero.knownSkills.has("sunburnAura")) { const scale = radius("sunburnAura") / 180; this.ctx.fillStyle = "rgba(255,135,35,.11)"; for (let i = 0; i < 12; i += 1) { this.ctx.save(); this.ctx.rotate(i * Math.PI / 6 + time * .08); this.ctx.fillRect(55 * scale, -9, 115 * scale, 18); this.ctx.restore(); } }
    if (hero.knownSkills.has("thunderAura")) { const r = radius("thunderAura"); this.ctx.fillStyle = "rgba(255,255,255,.07)"; this.ctx.strokeStyle = "rgba(190,235,255,.65)"; this.ctx.fillRect(-r, -r, r * 2, r * 2); this.ctx.beginPath(); for (let i = 0; i < 28; i += 1) { const a = i * Math.PI * 2 / 28; const edge = r - 6 + Math.sin(time * 7 + i * 2.3) * 8; const px = Math.cos(a) * edge; const py = Math.sin(a) * edge; if (!i) this.ctx.moveTo(px, py); else this.ctx.lineTo(px, py); } this.ctx.closePath(); this.ctx.stroke(); }
    this.ctx.restore();
  }

  private renderCombatText(text: CombatText, camera: Camera): void {
    const progress = Math.min(1, text.age / text.lifetime); this.ctx.save();
    this.ctx.globalAlpha = 1 - progress; this.ctx.fillStyle = text.critical ? CRITICAL_TEXT_COLOR : COMBAT_TEXT_COLORS[text.kind];
    this.ctx.font = `${text.critical ? 700 : 600} ${text.critical ? 19 : 16}px Inter, sans-serif`; this.ctx.textAlign = "center"; this.ctx.textBaseline = "middle";
    this.ctx.shadowColor = "rgba(0,0,0,.8)"; this.ctx.shadowBlur = 3; const value = text.label ?? `${text.kind === "healing" ? "+" : ""}${formatCombatAmount(text.amount)}`; this.ctx.fillText(value, text.position.x - camera.x + text.drift * progress, text.position.y - camera.y - 22 - 38 * progress); this.ctx.restore();
  }

  private renderSelection(creep: Creep, camera: Camera): void {
    this.ctx.strokeStyle = "#fff08a"; this.ctx.lineWidth = 2; this.ctx.beginPath();
    this.ctx.arc(creep.position.x - camera.x, creep.position.y - camera.y, creep.radius + 7, 0, Math.PI * 2); this.ctx.stroke();
  }

  private renderThreatIndicator(creep: Creep, camera: Camera): void {
    const x = creep.position.x - camera.x; const y = creep.position.y - camera.y; const margin = 30;
    if (x >= margin && x <= camera.width - margin && y >= margin && y <= camera.height - margin) return;
    const indicatorX = clamp(x, margin, camera.width - margin); const indicatorY = clamp(y, margin, camera.height - margin);
    const angle = Math.atan2(y - indicatorY, x - indicatorX);
    this.ctx.save(); this.ctx.translate(indicatorX, indicatorY); this.ctx.rotate(angle); this.ctx.fillStyle = creep.build.isRival ? "#ffd166" : "#ff6f7d";
    this.ctx.beginPath(); this.ctx.moveTo(12, 0); this.ctx.lineTo(-8, -7); this.ctx.lineTo(-8, 7); this.ctx.closePath(); this.ctx.fill(); this.ctx.restore();
  }
}
function formatCombatAmount(amount: number): string { return amount < 10 ? amount.toFixed(1).replace(/\.0$/, "") : String(Math.round(amount)); }
