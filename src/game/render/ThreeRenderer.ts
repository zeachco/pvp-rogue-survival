import * as THREE from "three";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { ArenaState } from "../ArenaState";
import type { Creep } from "../Creep";
import type { Hero } from "../Hero";
import type { GameMap } from "../Map";
import type { CombatText } from "../CombatText";
import { COMBAT_TEXT_COLORS, CRITICAL_TEXT_COLOR } from "../CombatText";
import { clamp } from "../types";

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3;
const ZOOM_SPEED = 0.0012;
const MAP_Z = -1;
const Z_SWAMP = 10;
const Z_DROP = 20;
const Z_ATTACK = 30;
const Z_CREEP = 40;
const Z_HERO = 50;
const Z_PROJECTILE = 60;
const Z_EFFECT = 70;
const Z_CREEP_OVERLAY = 75;
const Z_AURA = 80;
const Z_TEXT = 90;
const Z_SELECTION = 95;
const Z_THREAT = 96;

export class ThreeRenderer {
	readonly renderer: THREE.WebGLRenderer;
	readonly scene: THREE.Scene;
	readonly camera: THREE.OrthographicCamera;
	readonly labelRenderer: CSS2DRenderer;
	private _zoomLevel = 1;
	private readonly tracked = new Set<THREE.Object3D>();
	private readonly combatTextObjects = new Map<CombatText, THREE.Sprite>();
	private readonly canvas: HTMLCanvasElement;
	private width = 1;
	private height = 1;

	constructor(
		canvas: HTMLCanvasElement,
		private readonly map: GameMap,
	) {
		this.canvas = canvas;
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		this.renderer.setClearColor(0x0b1116);
		this.renderer.setPixelRatio(devicePixelRatio);
		this.scene = new THREE.Scene();
		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1000);
		this.camera.position.z = 100;
		this.labelRenderer = new CSS2DRenderer();
		this.labelRenderer.domElement.style.position = "fixed";
		this.labelRenderer.domElement.style.pointerEvents = "none";
		this.labelRenderer.domElement.style.zIndex = "1";
		document.body.appendChild(this.labelRenderer.domElement);
	}

	resize(w: number, h: number): void {
		this.width = w;
		this.height = h;
		this.renderer.setSize(w, h, false);
		this.labelRenderer.setSize(w, h);
		const rect = this.canvas.getBoundingClientRect();
		this.labelRenderer.domElement.style.top = `${rect.top}px`;
		this.labelRenderer.domElement.style.left = `${rect.left}px`;
		this.labelRenderer.domElement.style.width = `${rect.width}px`;
		this.labelRenderer.domElement.style.height = `${rect.height}px`;
		this.updateCameraFrustum();
	}

	applyZoom(delta: number): void {
		this._zoomLevel = clamp(
			this._zoomLevel * (1 - delta * ZOOM_SPEED),
			MIN_ZOOM,
			MAX_ZOOM,
		);
		this.updateCameraFrustum();
	}

	setZoom(level: number): void {
		this._zoomLevel = clamp(level, MIN_ZOOM, MAX_ZOOM);
		this.updateCameraFrustum();
	}

	get zoomLevel(): number {
		return this._zoomLevel;
	}

	private updateCameraFrustum(): void {
		const halfW = this.width / 2 / this._zoomLevel;
		const halfH = this.height / 2 / this._zoomLevel;
		this.camera.left = -halfW;
		this.camera.right = halfW;
		this.camera.top = halfH;
		this.camera.bottom = -halfH;
		this.camera.updateProjectionMatrix();
	}

	updateCameraPosition(heroX: number, heroY: number): void {
		const halfW = this.width / 2 / this._zoomLevel;
		const halfH = this.height / 2 / this._zoomLevel;
		const cx =
			halfW >= this.map.width
				? this.map.width / 2
				: clamp(heroX, halfW, this.map.width - halfW);
		const cy =
			halfH >= this.map.height
				? this.map.height / 2
				: clamp(heroY, halfH, this.map.height - halfH);
		this.camera.position.x = cx;
		this.camera.position.y = cy;
	}

	eventWorld(event: MouseEvent): { x: number; y: number } {
		const rect = this.canvas.getBoundingClientRect();
		const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
		const halfW = this.width / 2 / this._zoomLevel;
		const halfH = this.height / 2 / this._zoomLevel;
		return {
			x: this.camera.position.x + ndcX * halfW,
			y: this.camera.position.y + ndcY * halfH,
		};
	}

	syncScene(
		hero: Hero,
		arena: ArenaState,
		hovered?: Creep,
		inspected?: Creep,
	): void {
		const time = performance.now() / 1000;
		const current = new Set<THREE.Object3D>();
		current.add(hero.mesh);

		for (const creep of arena.creeps) {
			current.add(creep.mesh);
			if (creep.healthBarGroup) current.add(creep.healthBarGroup);
			if (creep.labelObject) current.add(creep.labelObject);
			if (creep === hovered || creep === inspected)
				if (creep.selectionRing) current.add(creep.selectionRing);
			if (creep.attackWindupRing) current.add(creep.attackWindupRing);
			if (creep.bonusSkillRing) current.add(creep.bonusSkillRing);
			if (creep.threatArrow) current.add(creep.threatArrow);
		}

		for (const drop of arena.drops) current.add(drop.mesh);
		for (const attack of arena.attacks) current.add(attack.mesh);
		for (const projectile of arena.projectiles) current.add(projectile.mesh);
		for (const effect of arena.spellEffects) current.add(effect.mesh);
		for (const swamp of arena.swamps) current.add(swamp.mesh);

		if (hero.auraGroup) current.add(hero.auraGroup);

		for (const obj of this.tracked) {
			if (!current.has(obj)) {
				this.scene.remove(obj);
				this.tracked.delete(obj);
			}
		}
		for (const obj of current) {
			if (!this.tracked.has(obj)) {
				this.scene.add(obj);
				this.tracked.add(obj);
			}
		}

		hero.updateVisuals(time);
		for (const creep of arena.creeps)
			creep.updateVisuals(time, hovered, inspected);
		for (const drop of arena.drops) drop.updateVisuals(time);
		for (const attack of arena.attacks) attack.updateVisuals(time);
		for (const projectile of arena.projectiles) projectile.updateVisuals(time);
		for (const effect of arena.spellEffects) effect.updateVisuals(time);
		for (const swamp of arena.swamps) swamp.updateVisuals(time);
		if (hero.auraGroup) hero.updateAuraVisuals(time);

		this.syncCombatText(arena.combatTexts);
	}

	private syncCombatText(texts: CombatText[]): void {
		const active = new Set(texts);
		for (const [text, sprite] of this.combatTextObjects) {
			if (!active.has(text)) {
				this.scene.remove(sprite);
				sprite.material.map?.dispose();
				sprite.material.dispose();
				this.combatTextObjects.delete(text);
			}
		}
		for (const text of texts) {
			let sprite = this.combatTextObjects.get(text);
			const progress = Math.min(1, text.age / text.lifetime);
			const color = text.critical
				? CRITICAL_TEXT_COLOR
				: COMBAT_TEXT_COLORS[text.kind];
			const weight = text.critical ? 700 : 600;
			const fontSize = text.critical ? 19 : 16;
			const value =
				text.label ??
				`${text.kind === "healing" ? "+" : ""}${formatCombatAmount(text.amount)}`;

			const canvas = document.createElement("canvas");
			const ctx = canvas.getContext("2d")!;
			const font = `${weight} ${fontSize}px Inter, sans-serif`;
			ctx.font = font;
			const metrics = ctx.measureText(value);
			const textWidth = Math.ceil(metrics.width);
			const textHeight = fontSize + 4;
			const padding = 6;
			const w = textWidth + padding * 2;
			const h = textHeight + padding * 2;
			canvas.width = w;
			canvas.height = h;
			ctx.font = font;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.shadowColor = "rgba(0,0,0,.8)";
			ctx.shadowBlur = 3;
			ctx.fillStyle = color;
			ctx.globalAlpha = 1 - progress;
			ctx.fillText(value, w / 2, h / 2);

			if (!sprite) {
				const texture = new THREE.CanvasTexture(canvas);
				const mat = new THREE.SpriteMaterial({
					map: texture,
					depthTest: false,
					transparent: true,
				});
				sprite = new THREE.Sprite(mat);
				sprite.layers.set(0);
				this.scene.add(sprite);
				this.combatTextObjects.set(text, sprite);
			} else {
				sprite.material.map!.image = canvas;
				sprite.material.map!.needsUpdate = true;
				sprite.material.opacity = 1;
			}

			sprite.position.set(
				text.position.x + text.drift * progress,
				text.position.y - 22 - 38 * progress,
				Z_TEXT,
			);
			sprite.scale.set(w, h, 1);
		}
	}

	render(): void {
		this.renderer.render(this.scene, this.camera);
		this.labelRenderer.render(this.scene, this.camera);
	}

	dispose(): void {
		this.renderer.dispose();
		this.labelRenderer.domElement.remove();
	}
}

function formatCombatAmount(amount: number): string {
	return amount < 10
		? amount.toFixed(1).replace(/\.0$/, "")
		: String(Math.round(amount));
}

export {
	MAP_Z,
	Z_SWAMP,
	Z_DROP,
	Z_ATTACK,
	Z_CREEP,
	Z_HERO,
	Z_PROJECTILE,
	Z_EFFECT,
	Z_CREEP_OVERLAY,
	Z_AURA,
	Z_TEXT,
	Z_SELECTION,
	Z_THREAT,
};
