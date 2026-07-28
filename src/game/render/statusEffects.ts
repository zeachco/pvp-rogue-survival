import type { StatusEffectSnapshot } from "../types";

export function renderStatusEffects(
	ctx: CanvasRenderingContext2D,
	statuses: StatusEffectSnapshot[],
	radius: number,
	time: number,
): void {
	const tint = statusTint(statuses);
	if (tint) {
		ctx.save();
		ctx.globalAlpha = 0.42;
		ctx.fillStyle = tint;
		ctx.beginPath();
		ctx.arc(0, 0, radius, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}
	if (statuses.some((status) => status.kind === "bleed")) {
		ctx.save();
		ctx.fillStyle = "#ff4858";
		for (let index = 0; index < 4; index += 1) {
			const angle = time * 3.7 + index * 2.41;
			const distance = radius + 3 + ((time * 18 + index * 5) % 7);
			ctx.globalAlpha = 0.4 + index * 0.12;
			ctx.beginPath();
			ctx.arc(
				Math.cos(angle) * distance,
				Math.sin(angle) * distance,
				1.25,
				0,
				Math.PI * 2,
			);
			ctx.fill();
		}
		ctx.restore();
	}
	if (
		statuses.some((status) => status.kind === "stun" || status.kind === "shock")
	) {
		ctx.save();
		ctx.rotate(time * 4);
		ctx.strokeStyle = "#ffffff";
		ctx.shadowColor = "#ffffff";
		ctx.shadowBlur = 5;
		ctx.lineWidth = 1.5;
		for (let arm = 0; arm < 4; arm += 1) {
			ctx.save();
			ctx.rotate((arm * Math.PI) / 2);
			ctx.beginPath();
			ctx.moveTo(0, -radius - 7);
			ctx.lineTo(0, -radius - 14);
			ctx.stroke();
			ctx.restore();
		}
		ctx.restore();
	}
}

function statusTint(statuses: StatusEffectSnapshot[]): string | undefined {
	if (statuses.some((status) => status.kind === "freeze")) return "#8de7ff";
	if (statuses.some((status) => status.kind === "burn")) return "#ff783d";
	if (statuses.some((status) => status.kind === "poison")) return "#92f58b";
	if (statuses.some((status) => status.kind === "curse")) return "#4b225e";
	return undefined;
}
