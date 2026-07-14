import type { ArenaState } from "../ArenaState";
import type { Creep } from "../Creep";
import type { Hero } from "../Hero";
import type { GameMap } from "../Map";
import { clamp, type Camera } from "../types";
import { COMBAT_TEXT_COLORS, CRITICAL_TEXT_COLOR, type CombatText } from "../CombatText";

export class CanvasRenderer {
  constructor(private readonly ctx: CanvasRenderingContext2D, private readonly map: GameMap) {}

  render(camera: Camera, hero: Hero, arena: ArenaState, hovered?: Creep, inspected?: Creep): void {
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    this.map.render(this.ctx, camera);
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
