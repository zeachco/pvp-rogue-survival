import * as THREE from "three";
import { canvas2dContext } from "../../platform/Canvas";
import type { ArenaState } from "../ArenaState";
import type { Creep } from "../Creep";
import type { Hero } from "../Hero";
import type { CombatText } from "../CombatText";
import {
	combatTextScale,
	COMBAT_TEXT_COLORS,
	CRITICAL_TEXT_COLOR,
} from "../CombatText";
import { clamp } from "../types";

const MIN_ZOOM = 0.65;
const MAX_ZOOM = 1.8;
export const DEFAULT_CAMERA_ZOOM = 0.9;
const ZOOM_SPEED = 0.0012;
export const MIN_CAMERA_TILT_RADIANS = THREE.MathUtils.degToRad(8);
export const MAX_CAMERA_TILT_RADIANS = THREE.MathUtils.degToRad(85);
const TILT_SPEED = 0.0012;
const ORBIT_TILT_SENSITIVITY = 0.005;
const DEFAULT_CAMERA_TILT_RADIANS = THREE.MathUtils.degToRad(32);
const CAMERA_DISTANCE = 330;
const CAMERA_LOOK_AHEAD = 115;
const CAMERA_SHOULDER_OFFSET = 24;
const ORBIT_SENSITIVITY = 0.005;
const MAP_Z = -0.1;
const MAP_LAYER_STEP = 0.01;
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

export function adjustedCameraTilt(
	current: number,
	wheelDelta: number,
): number {
	return clamp(
		current + wheelDelta * TILT_SPEED,
		MIN_CAMERA_TILT_RADIANS,
		MAX_CAMERA_TILT_RADIANS,
	);
}

export function adjustedCameraTiltFromDrag(
	current: number,
	deltaY: number,
): number {
	return clamp(
		current + deltaY * ORBIT_TILT_SENSITIVITY,
		MIN_CAMERA_TILT_RADIANS,
		MAX_CAMERA_TILT_RADIANS,
	);
}

export function cameraOffsetForTilt(tilt: number): {
	y: number;
	z: number;
} {
	const distance = CAMERA_DISTANCE;
	return { y: -Math.cos(tilt) * distance, z: Math.sin(tilt) * distance };
}

export function cameraRelativeMovement(
	input: { x: number; y: number },
	yaw: number,
): { x: number; y: number } {
	const sin = Math.sin(yaw);
	const cos = Math.cos(yaw);
	return {
		x: input.x * cos + input.y * sin,
		y: -input.x * sin + input.y * cos,
	};
}

export function cameraFacingAngle(yaw: number): number {
	return Math.PI / 2 - yaw;
}

export class ThreeRenderer {
	readonly renderer: THREE.WebGLRenderer;
	readonly scene: THREE.Scene;
	readonly camera: THREE.PerspectiveCamera;
	private _zoomLevel = DEFAULT_CAMERA_ZOOM;
	private _tilt = DEFAULT_CAMERA_TILT_RADIANS;
	private yaw = 0;
	private readonly tracked = new Set<THREE.Object3D>();
	private readonly combatTextObjects = new Map<CombatText, THREE.Sprite>();
	private readonly canvas: HTMLCanvasElement;
	private width = 1;
	private height = 1;
	private focusX = 0;
	private focusY = 0;
	private readonly pointerRay = new THREE.Raycaster();
	private readonly arenaPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		this.renderer.setClearColor(0x0b1116);
		this.renderer.setPixelRatio(devicePixelRatio);
		this.scene = new THREE.Scene();
		this.scene.add(new THREE.HemisphereLight(0xbfe8ff, 0x111820, 1.8));
		const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
		keyLight.position.set(-80, -120, 220);
		this.scene.add(keyLight);
		this.camera = new THREE.PerspectiveCamera(52, 1, 1, 3000);
		this.updateCameraTransform();
	}

	async init(): Promise<void> {
		// Kept asynchronous for a future WebGPU retry once loaded models are compatible.
	}

	resize(w: number, h: number): void {
		this.width = w;
		this.height = h;
		this.renderer.setSize(w, h, false);
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

	applyTilt(delta: number): void {
		this._tilt = adjustedCameraTilt(this._tilt, delta);
		this.updateCameraTransform();
	}

	setZoom(level: number): void {
		this._zoomLevel = clamp(level, MIN_ZOOM, MAX_ZOOM);
		this.updateCameraFrustum();
	}

	get zoomLevel(): number {
		return this._zoomLevel;
	}

	orbit(deltaX: number, deltaY: number): void {
		this.yaw += deltaX * ORBIT_SENSITIVITY;
		this._tilt = adjustedCameraTiltFromDrag(this._tilt, deltaY);
		this.updateCameraTransform();
	}

	movementForCamera(input: { x: number; y: number }): { x: number; y: number } {
		return cameraRelativeMovement(input, this.yaw);
	}

	cameraFacing(): number {
		return cameraFacingAngle(this.yaw);
	}

	isWorldPositionInView(position: { x: number; y: number }): boolean {
		const projected = new THREE.Vector3(position.x, position.y, 0).project(
			this.camera,
		);
		return (
			projected.z >= -1 &&
			projected.z <= 1 &&
			projected.x >= -1 &&
			projected.x <= 1 &&
			projected.y >= -1 &&
			projected.y <= 1
		);
	}

	aimAt(
		source: { x: number; y: number },
		target: { x: number; y: number },
	): void {
		this.yaw = Math.atan2(target.x - source.x, target.y - source.y);
		this.updateCameraTransform();
	}

	private updateCameraFrustum(): void {
		this.camera.aspect = this.width / this.height;
		this.camera.updateProjectionMatrix();
	}

	updateCameraPosition(heroX: number, heroY: number): void {
		this.focusX = heroX;
		this.focusY = heroY;
		this.updateCameraTransform();
	}

	private updateCameraTransform(): void {
		const offset = cameraOffsetForTilt(this._tilt);
		const sin = Math.sin(this.yaw);
		const cos = Math.cos(this.yaw);
		const offsetDistance = offset.y / this._zoomLevel;
		const forwardX = sin;
		const forwardY = cos;
		const rightX = cos;
		const rightY = -sin;
		this.camera.position.set(
			this.focusX + forwardX * offsetDistance + rightX * CAMERA_SHOULDER_OFFSET,
			this.focusY + forwardY * offsetDistance + rightY * CAMERA_SHOULDER_OFFSET,
			offset.z / this._zoomLevel,
		);
		this.camera.up.set(0, 0, 1);
		this.camera.lookAt(
			this.focusX + forwardX * CAMERA_LOOK_AHEAD,
			this.focusY + forwardY * CAMERA_LOOK_AHEAD,
			0,
		);
		this.camera.updateMatrixWorld();
	}

	eventWorld(event: MouseEvent, worldZ = 0): { x: number; y: number } {
		const rect = this.canvas.getBoundingClientRect();
		const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
		this.pointerRay.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
		this.arenaPlane.constant = -worldZ;
		const hit = this.pointerRay.ray.intersectPlane(
			this.arenaPlane,
			new THREE.Vector3(),
		);
		return hit ? { x: hit.x, y: hit.y } : { x: this.focusX, y: this.focusY };
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
		for (const blizzard of arena.blizzards) current.add(blizzard.mesh);
		for (const death of arena.characterDeaths) current.add(death.mesh);

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
		hero.faceCamera(this.camera.quaternion);
		for (const creep of arena.creeps) {
			creep.updateVisuals(time, hovered, inspected);
			creep.faceCamera(this.camera.quaternion);
			creep.updateThreatArrow(this.camera);
		}
		for (const drop of arena.drops) {
			drop.updateVisuals(time);
			drop.faceCamera(this.camera.quaternion);
		}
		for (const attack of arena.attacks) attack.updateVisuals(time);
		for (const projectile of arena.projectiles) {
			projectile.updateVisuals(time);
			projectile.faceCamera(this.camera.quaternion);
		}
		for (const effect of arena.spellEffects) effect.updateVisuals(time);
		for (const swamp of arena.swamps) swamp.updateVisuals(time);
		for (const blizzard of arena.blizzards) blizzard.updateVisuals(time);
		for (const death of arena.characterDeaths) death.updateVisuals(time);
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
			const fontSize = 19;
			const sizeScale = combatTextScale(text.critical);
			const value =
				text.label ??
				`${text.kind === "healing" ? "+" : ""}${formatCombatAmount(text.amount)}`;

			const canvas = document.createElement("canvas");
			const ctx = canvas2dContext(canvas);
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
				text.position.y,
				(text.elevation ?? 0) + 38 * progress,
			);
			sprite.scale.set(w * sizeScale, h * sizeScale, 1);
		}
	}

	render(): void {
		this.renderer.render(this.scene, this.camera);
	}

	dispose(): void {
		this.renderer.dispose();
	}
}

function formatCombatAmount(amount: number): string {
	return amount < 10
		? amount.toFixed(1).replace(/\.0$/, "")
		: String(Math.round(amount));
}

export {
	MAP_Z,
	MAP_LAYER_STEP,
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
