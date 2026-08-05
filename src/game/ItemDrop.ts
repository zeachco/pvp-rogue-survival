import * as THREE from "three";
import type { Rarity } from "../../common/items";
import type { GroundDrop } from "../../common/protocol";
import { GameObject } from "./GameObject";
import type { Vector2 } from "./types";
import { Z_DROP } from "./render/ThreeRenderer";
import { canvas2dContext } from "../platform/Canvas";

const GROUND_PRESENTATION_CLEARANCE = 2;
const DIAMOND_PRESENTATION_RADIUS = 18;
const MONEY_BAG_PRESENTATION_SIZE = 28;
const COIN_PRESENTATION_SIZE = 18;

export function groundDropPresentationCenter(drop: GroundDrop): number {
	if (drop.kind !== "gold")
		return DIAMOND_PRESENTATION_RADIUS + GROUND_PRESENTATION_CLEARANCE;
	return (
		(drop.amount >= 10 ? MONEY_BAG_PRESENTATION_SIZE : COIN_PRESENTATION_SIZE) /
			2 +
		GROUND_PRESENTATION_CLEARANCE
	);
}

export class ItemDrop extends GameObject {
	readonly radius = 14;
	enteredArena = false;
	readonly velocity: Vector2 = { x: 0, y: 0 };
	escaping = false;
	readonly drop: GroundDrop;
	readonly position: Vector2;

	private readonly bodyMesh: THREE.Mesh;
	private readonly glowMesh?: THREE.Mesh;

	constructor(drop: GroundDrop, position: Vector2) {
		super();
		this.drop = drop;
		this.position = { ...position };

		if (drop.kind === "gold") {
			const sprite = drop.amount >= 10 ? moneyBagSprite() : coinSprite();
			if (sprite) {
				this.bodyMesh = sprite;
				this.mesh.add(this.bodyMesh);
			} else {
				const color = 0xf4cf42;
				this.bodyMesh = new THREE.Mesh(
					new THREE.CircleGeometry(10, 16),
					new THREE.MeshBasicMaterial({ color }),
				);
				const stroke = new THREE.Mesh(
					new THREE.RingGeometry(9, 11, 16),
					new THREE.MeshBasicMaterial({
						color: 0xfff0a0,
						side: THREE.DoubleSide,
					}),
				);
				stroke.renderOrder = 0.001;
				this.glowMesh = new THREE.Mesh(
					new THREE.CircleGeometry(16, 16),
					new THREE.MeshBasicMaterial({
						color,
						transparent: true,
						opacity: 0.35,
						depthWrite: false,
					}),
				);
				this.glowMesh.renderOrder = -0.001;
				this.mesh.add(this.glowMesh, this.bodyMesh, stroke);
			}
		} else {
			const rarity: Rarity =
				drop.kind === "item" ? drop.item.rarity : drop.rarity;
			const colorHex = dropRarityColor(rarity);
			const color = Number.parseInt(colorHex.replace("#", ""), 16);

			const square = new THREE.Mesh(
				new THREE.PlaneGeometry(18, 18),
				new THREE.MeshBasicMaterial({
					color,
					transparent: drop.kind === "scrap",
					opacity: drop.kind === "scrap" ? 0 : 1,
				}),
			);
			square.rotation.z = Math.PI / 4;
			square.renderOrder = 0;

			const strokeSquare = new THREE.LineSegments(
				new THREE.EdgesGeometry(new THREE.PlaneGeometry(18, 18)),
				new THREE.LineBasicMaterial({ color }),
			);
			strokeSquare.rotation.z = Math.PI / 4;
			strokeSquare.renderOrder = 0.001;

			this.glowMesh = new THREE.Mesh(
				new THREE.CircleGeometry(18, 16),
				new THREE.MeshBasicMaterial({
					color,
					transparent: true,
					opacity: 0.35,
					depthWrite: false,
				}),
			);
			this.glowMesh.renderOrder = -0.001;

			this.bodyMesh = square;
			this.mesh.add(this.glowMesh, this.bodyMesh, strokeSquare);
		}

		this.bodyMesh.renderOrder = Z_DROP;
		this.mesh.renderOrder = Z_DROP;
	}

	get dropId(): string {
		return this.drop.id;
	}
	update(): void {}
	pullToward(target: Vector2, speed: number, deltaSeconds: number): void {
		const dx = target.x - this.position.x;
		const dy = target.y - this.position.y;
		const distance = Math.hypot(dx, dy);
		if (distance <= 0) return;
		const travel = Math.min(distance, speed * deltaSeconds);
		this.position.x += (dx / distance) * travel;
		this.position.y += (dy / distance) * travel;
	}
	applyPush(source: Vector2, impulse: number): void {
		if (this.drop.kind !== "item") return;
		const dx = this.position.x - source.x;
		const dy = this.position.y - source.y;
		const length = Math.hypot(dx, dy);
		if (length <= 0) return;
		this.velocity.x += (dx / length) * impulse;
		this.velocity.y += (dy / length) * impulse;
		this.escaping = true;
	}
	move(deltaSeconds: number): void {
		this.position.x += this.velocity.x * deltaSeconds;
		this.position.y += this.velocity.y * deltaSeconds;
	}
	outside(width: number, height: number, margin = 40): boolean {
		return (
			this.position.x < -margin ||
			this.position.y < -margin ||
			this.position.x > width + margin ||
			this.position.y > height + margin
		);
	}

	override updateVisuals(time: number): void {
		super.updateVisuals(time);
		this.mesh.position.set(
			this.position.x,
			this.position.y,
			groundDropPresentationCenter(this.drop),
		);
		if (this.glowMesh) {
			const pulse = 0.3 + Math.sin(time * 3) * 0.1;
			(this.glowMesh.material as THREE.MeshBasicMaterial).opacity = pulse;
		}
	}

	faceCamera(cameraQuaternion: THREE.Quaternion): void {
		this.mesh.quaternion.copy(cameraQuaternion);
	}
}

function moneyBagSprite(): THREE.Mesh | undefined {
	if (typeof document === "undefined") return undefined;
	const texture = moneyBagTexture();
	return new THREE.Mesh(
		new THREE.PlaneGeometry(
			MONEY_BAG_PRESENTATION_SIZE,
			MONEY_BAG_PRESENTATION_SIZE,
		),
		new THREE.MeshBasicMaterial({
			map: texture,
			transparent: true,
			depthWrite: false,
		}),
	);
}

function coinSprite(): THREE.Mesh | undefined {
	if (typeof document === "undefined") return undefined;
	const texture = coinTexture();
	return new THREE.Mesh(
		new THREE.PlaneGeometry(COIN_PRESENTATION_SIZE, COIN_PRESENTATION_SIZE),
		new THREE.MeshBasicMaterial({
			map: texture,
			transparent: true,
			depthWrite: false,
		}),
	);
}

let cachedMoneyBagTexture: THREE.CanvasTexture | undefined;
let cachedCoinTexture: THREE.CanvasTexture | undefined;

function moneyBagTexture(): THREE.CanvasTexture {
	if (cachedMoneyBagTexture) return cachedMoneyBagTexture;

	const size = MONEY_BAG_PRESENTATION_SIZE;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas2dContext(canvas);

	const glow = ctx.createRadialGradient(
		size / 2,
		size / 2,
		3,
		size / 2,
		size / 2,
		size / 2,
	);
	glow.addColorStop(0, "rgba(244,207,66,0.5)");
	glow.addColorStop(1, "rgba(244,207,66,0)");
	ctx.fillStyle = glow;
	ctx.fillRect(0, 0, size, size);

	const cx = size / 2;
	ctx.beginPath();
	ctx.moveTo(cx - 5, 9);
	ctx.quadraticCurveTo(cx - 12, 9, cx - 12, 15);
	ctx.quadraticCurveTo(cx - 12, 24, cx, 25);
	ctx.quadraticCurveTo(cx + 12, 24, cx + 12, 15);
	ctx.quadraticCurveTo(cx + 12, 9, cx + 5, 9);
	ctx.quadraticCurveTo(cx, 12, cx - 5, 9);
	const pouchGradient = ctx.createLinearGradient(cx, 9, cx, 25);
	pouchGradient.addColorStop(0, "#ffe27a");
	pouchGradient.addColorStop(0.55, "#f4cf42");
	pouchGradient.addColorStop(1, "#d9a524");
	ctx.fillStyle = pouchGradient;
	ctx.fill();
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = "#8a6413";
	ctx.stroke();

	ctx.beginPath();
	ctx.arc(cx, 7, 2.6, 0, Math.PI * 2);
	ctx.fillStyle = "#c69a1f";
	ctx.fill();
	ctx.lineWidth = 1;
	ctx.strokeStyle = "#8a6413";
	ctx.stroke();

	ctx.beginPath();
	ctx.arc(cx - 0.8, 6.3, 0.9, 0, Math.PI * 2);
	ctx.fillStyle = "rgba(255,240,160,0.9)";
	ctx.fill();

	ctx.fillStyle = "#8a6413";
	ctx.font = "700 10px Inter, sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText("$", cx, 17);

	cachedMoneyBagTexture = new THREE.CanvasTexture(canvas);
	cachedMoneyBagTexture.colorSpace = THREE.SRGBColorSpace;
	return cachedMoneyBagTexture;
}

function coinTexture(): THREE.CanvasTexture {
	if (cachedCoinTexture) return cachedCoinTexture;

	const size = COIN_PRESENTATION_SIZE;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas2dContext(canvas);

	const glow = ctx.createRadialGradient(
		size / 2,
		size / 2,
		2,
		size / 2,
		size / 2,
		size / 2,
	);
	glow.addColorStop(0, "rgba(244,207,66,0.55)");
	glow.addColorStop(1, "rgba(244,207,66,0)");
	ctx.fillStyle = glow;
	ctx.fillRect(0, 0, size, size);

	drawCoin(ctx, size / 2, size / 2, size / 2 - 2.5);

	cachedCoinTexture = new THREE.CanvasTexture(canvas);
	cachedCoinTexture.colorSpace = THREE.SRGBColorSpace;
	return cachedCoinTexture;
}

function drawCoin(
	ctx: CanvasRenderingContext2D,
	cx: number,
	cy: number,
	r: number,
): void {
	ctx.beginPath();
	ctx.arc(cx, cy, r, 0, Math.PI * 2);
	ctx.fillStyle = "#f4cf42";
	ctx.fill();
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = "#a97a14";
	ctx.stroke();

	ctx.beginPath();
	ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
	ctx.lineWidth = 1;
	ctx.strokeStyle = "#e3b52c";
	ctx.stroke();

	ctx.beginPath();
	ctx.arc(cx - 1.5, cy - 1.5, r - 3.5, Math.PI * 1.1, Math.PI * 1.9);
	ctx.strokeStyle = "rgba(255,240,160,0.9)";
	ctx.lineWidth = 1.5;
	ctx.stroke();
}

const DROP_RARITY_COLORS: Record<Rarity, string> = {
	common: "#d8e5e8",
	uncommon: "#62e88a",
	rare: "#6ca8ff",
	epic: "#ca75ff",
	unique: "#e3b52c",
};
export function dropRarityColor(rarity: Rarity): string {
	return DROP_RARITY_COLORS[rarity] ?? DROP_RARITY_COLORS.common;
}
