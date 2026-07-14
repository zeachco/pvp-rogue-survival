import type { SkillId } from "../../common/items";
import { GameObject } from "./GameObject";
import type { Camera, Vector2 } from "./types";

export type SpellEffectKind = Exclude<SkillId, "healing"> | "healing";

export class SpellEffect extends GameObject {
  private age = 0;
  private readonly lifetime: number;
  constructor(readonly kind: SpellEffectKind, readonly position: Vector2, readonly facing = 0) { super(); this.position = { ...position }; this.lifetime = kind === "healing" ? 0.9 : kind === "arcaneBolt" ? 0.65 : 0.55; }
  update(deltaSeconds: number): void { this.age += deltaSeconds; if (this.age >= this.lifetime) this.active = false; }
  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const progress = Math.min(1, this.age / this.lifetime); ctx.save(); ctx.translate(this.position.x - camera.x, this.position.y - camera.y); ctx.rotate(this.facing); ctx.globalAlpha = 1 - progress;
    if (this.kind === "bash") impact(ctx, progress, "#e7c889", 76, 8);
    else if (this.kind === "sweep") crescent(ctx, progress);
    else if (this.kind === "flurry") flurry(ctx, progress);
    else if (this.kind === "shockwave") shockwave(ctx, progress);
    else if (this.kind === "arcaneBolt") arcane(ctx, progress);
    else healing(ctx, progress);
    ctx.restore();
  }
}

function impact(ctx: CanvasRenderingContext2D, progress: number, color: string, radius: number, particles: number): void { ctx.strokeStyle = color; ctx.lineWidth = 5 * (1 - progress) + 1; ctx.beginPath(); ctx.arc(0, 0, 18 + radius * progress, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = color; for (let i = 0; i < particles; i += 1) { const angle = i * Math.PI * 2 / particles; const distance = 20 + radius * progress * (0.55 + (i % 3) * 0.12); ctx.beginPath(); ctx.arc(Math.cos(angle) * distance, Math.sin(angle) * distance, 3 * (1 - progress) + 1, 0, Math.PI * 2); ctx.fill(); } }
function crescent(ctx: CanvasRenderingContext2D, progress: number): void { const radius = 46 + 48 * progress; ctx.strokeStyle = "#bafcff"; ctx.shadowColor = "#43e6ff"; ctx.shadowBlur = 12; ctx.lineWidth = 12 * (1 - progress) + 2; ctx.beginPath(); ctx.arc(0, 0, radius, -1.15 + progress * 0.35, 1.15 + progress * 0.35); ctx.stroke(); }
function flurry(ctx: CanvasRenderingContext2D, progress: number): void { ctx.strokeStyle = "#d9c2ff"; ctx.shadowColor = "#9b72ff"; ctx.shadowBlur = 9; ctx.lineWidth = 4 * (1 - progress) + 1; for (let i = -2; i <= 2; i += 1) { const angle = i * 0.26 + (i % 2) * 0.08; const start = 16 + progress * 12; const end = 70 + progress * 35; ctx.beginPath(); ctx.moveTo(Math.cos(angle) * start, Math.sin(angle) * start); ctx.lineTo(Math.cos(angle) * end, Math.sin(angle) * end); ctx.stroke(); } }
function shockwave(ctx: CanvasRenderingContext2D, progress: number): void { ctx.strokeStyle = "#ffd36a"; ctx.shadowColor = "#ff9f43"; ctx.shadowBlur = 10; for (let ring = 0; ring < 2; ring += 1) { const phase = Math.max(0, Math.min(1, progress * 1.35 - ring * 0.22)); ctx.globalAlpha = 1 - phase; ctx.lineWidth = 6 * (1 - phase) + 1; ctx.beginPath(); ctx.arc(0, 0, 20 + phase * 112, 0, Math.PI * 2); ctx.stroke(); } ctx.globalAlpha = 1 - progress; ctx.fillStyle = "#fff0ad"; for (let i = 0; i < 12; i += 1) { const angle = i * Math.PI / 6; const distance = 28 + progress * 98; ctx.fillRect(Math.cos(angle) * distance - 2, Math.sin(angle) * distance - 2, 4, 4); } }
function arcane(ctx: CanvasRenderingContext2D, progress: number): void { ctx.fillStyle = "#8fe9ff"; ctx.shadowColor = "#53a8ff"; ctx.shadowBlur = 13; for (let i = 0; i < 10; i += 1) { const angle = i * 2.399 + progress * 2; const radius = (1 - progress) * (24 + (i % 4) * 8); const forward = progress * 42; ctx.beginPath(); ctx.arc(forward + Math.cos(angle) * radius, Math.sin(angle) * radius, 2.5 + (i % 2), 0, Math.PI * 2); ctx.fill(); } ctx.strokeStyle = "#d4f7ff"; ctx.lineWidth = 3 * (1 - progress) + 1; ctx.beginPath(); ctx.arc(progress * 30, 0, 12 + progress * 22, 0, Math.PI * 2); ctx.stroke(); }
function healing(ctx: CanvasRenderingContext2D, progress: number): void { ctx.fillStyle = "#72f2a7"; ctx.shadowColor = "#38d984"; ctx.shadowBlur = 9; for (let i = 0; i < 9; i += 1) { const angle = i * 2.399; const radius = 12 + (i % 3) * 9; const x = Math.cos(angle) * radius * (1 - progress * 0.35); const y = Math.sin(angle) * radius - progress * (35 + i * 2); ctx.beginPath(); ctx.arc(x, y, 2.5 + (i % 2), 0, Math.PI * 2); ctx.fill(); } }
