import * as THREE from "three";
import type { SkillId } from "../../common/items";
import { GameObject } from "./GameObject";
import type { Vector2 } from "./types";
import { Z_EFFECT } from "./render/ThreeRenderer";

export type SpellEffectKind = Exclude<SkillId, "healing"> | "healing";

export class SpellEffect extends GameObject {
	private age = 0;
	private readonly lifetime: number;
	readonly position: Vector2;
	readonly kind: SpellEffectKind;
	readonly facing: number;
	private readonly range: number;
	private readonly source?: { position: Vector2 };

	private readonly effectGroup: THREE.Group;

	constructor(
		kind: SpellEffectKind,
		position: Vector2,
		facing = 0,
		range = 0,
		lifetime?: number,
		source?: { position: Vector2 },
	) {
		super();
		this.kind = kind;
		this.position = { ...position };
		this.facing = facing;
		this.range = range;
		this.source = source;
		this.lifetime =
			lifetime ??
			(kind === "healing"
				? 0.9
				: kind === "arcaneBolt"
					? 0.65
					: kind === "orbitingHammers"
						? 0.8
						: kind === "rent"
							? 0.7
							: 0.55);

		this.effectGroup = new THREE.Group();
		this.effectGroup.renderOrder = Z_EFFECT;
		this.mesh.add(this.effectGroup);
		this.mesh.renderOrder = Z_EFFECT;
	}

	update(deltaSeconds: number): void {
		this.age += deltaSeconds;
		if (this.source) {
			this.position.x = this.source.position.x;
			this.position.y = this.source.position.y;
		}
		if (this.age >= this.lifetime) this.active = false;
	}

	override updateVisuals(_time: number): void {
		super.updateVisuals(_time);
		const progress = Math.min(1, this.age / this.lifetime);

		while (this.effectGroup.children.length > 0) {
			const child = this.effectGroup.children[0];
			this.effectGroup.remove(child);
			if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
				child.geometry.dispose();
				if (child.material instanceof THREE.Material) child.material.dispose();
			}
		}

		this.mesh.position.set(this.position.x, this.position.y, 0);
		if (this.kind === "rent") {
			this.mesh.rotation.z = progress * Math.PI * 5;
		} else {
			this.mesh.rotation.z = this.facing;
		}

		if (this.kind === "bash") {
			impact(this.effectGroup, progress, "#e7c889", 76, 8);
		} else if (this.kind === "sweep") {
			crescent(this.effectGroup, progress);
		} else if (this.kind === "flurry") {
			flurry(this.effectGroup, progress);
		} else if (this.kind === "shockwave") {
			shockwave(this.effectGroup, progress);
		} else if (this.kind === "cleave") {
			cleave(this.effectGroup, progress);
		} else if (this.kind === "orbitingHammers") {
			hammerCast(this.effectGroup, progress);
		} else if (this.kind === "arcaneBolt") {
			arcane(this.effectGroup, progress);
		} else if (this.kind === "gravityPull") {
			impact(this.effectGroup, progress, "#b98cff", 180, 12);
		} else if (this.kind === "frostOrb") {
			impact(this.effectGroup, progress, "#8de7ff", 70, 10);
		} else if (this.kind === "reflectiveSurge") {
			impact(this.effectGroup, progress, "#ffe46b", 55, 8);
		} else if (this.kind === "fireBreath") {
			fireBreath(this.effectGroup, progress);
		} else if (this.kind === "rent") {
			rentEdge(this.effectGroup, progress, this.range);
		} else if (this.kind === "whirlwind") {
			whirlwind(this.effectGroup, progress, this.range);
		} else {
			healing(this.effectGroup, progress);
		}
	}
}

function hexToThree(hex: string): number {
	return Number.parseInt(hex.replace("#", ""), 16);
}

function impact(
	group: THREE.Group,
	progress: number,
	color: string,
	radius: number,
	particles: number,
): void {
	const colorVal = hexToThree(color);
	const ringRadius = 18 + radius * progress;
	const ring = new THREE.Mesh(
		new THREE.RingGeometry(ringRadius - 2.5, ringRadius + 2.5, 32),
		new THREE.MeshBasicMaterial({
			color: colorVal,
			transparent: true,
			opacity: 1 - progress,
			side: THREE.DoubleSide,
			depthWrite: false,
		}),
	);
	ring.renderOrder = Z_EFFECT;
	group.add(ring);

	const dotMat = new THREE.MeshBasicMaterial({
		color: colorVal,
		transparent: true,
		opacity: 1 - progress,
		depthWrite: false,
	});
	for (let i = 0; i < particles; i += 1) {
		const angle = (i * Math.PI * 2) / particles;
		const dist = 20 + radius * progress * (0.55 + (i % 3) * 0.12);
		const dot = new THREE.Mesh(
			new THREE.CircleGeometry(3 * (1 - progress) + 1, 8),
			dotMat,
		);
		dot.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist, 0);
		dot.renderOrder = Z_EFFECT + 0.001;
		group.add(dot);
	}
}

function crescent(group: THREE.Group, progress: number): void {
	const radius = 46 + 48 * progress;
	const arc = new THREE.Mesh(
		new THREE.RingGeometry(
			radius - 6 * (1 - progress) - 1,
			radius + 6 * (1 - progress) + 1,
			32,
			1,
			-1.15 + progress * 0.35,
			2.3 + progress * 0.7,
		),
		new THREE.MeshBasicMaterial({
			color: 0xbafcff,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 1 - progress * 0.3,
			depthWrite: false,
		}),
	);
	arc.renderOrder = Z_EFFECT;
	group.add(arc);
}

function cleave(group: THREE.Group, progress: number): void {
	const radius = 42 + 70 * progress;
	const arc = new THREE.Mesh(
		new THREE.RingGeometry(
			radius - 7 * (1 - progress) - 1,
			radius + 7 * (1 - progress) + 1,
			32,
			1,
			-0.95,
			1.9,
		),
		new THREE.MeshBasicMaterial({
			color: 0xffcf76,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 1 - progress * 0.3,
			depthWrite: false,
		}),
	);
	arc.renderOrder = Z_EFFECT;
	group.add(arc);
}

function hammerCast(group: THREE.Group, progress: number): void {
	for (let index = 0; index < 3; index += 1) {
		const angle = (index * Math.PI * 2) / 3 + progress * 2.2;
		const radius = 22 + progress * 42;
		const dot = new THREE.Mesh(
			new THREE.RingGeometry(5.5, 8.5, 16),
			new THREE.MeshBasicMaterial({
				color: 0xffe49a,
				side: THREE.DoubleSide,
				transparent: true,
				opacity: 1 - progress,
				depthWrite: false,
			}),
		);
		dot.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
		dot.renderOrder = Z_EFFECT;
		group.add(dot);
	}
}

function flurry(group: THREE.Group, progress: number): void {
	const mat = new THREE.LineBasicMaterial({
		color: 0xd9c2ff,
		transparent: true,
		opacity: 1 - progress,
	});
	for (let i = -2; i <= 2; i += 1) {
		const angle = i * 0.26 + (i % 2) * 0.08;
		const start = 16 + progress * 12;
		const end = 70 + progress * 35;
		const geo = new THREE.BufferGeometry();
		geo.setAttribute(
			"position",
			new THREE.Float32BufferAttribute(
				[
					Math.cos(angle) * start,
					Math.sin(angle) * start,
					0,
					Math.cos(angle) * end,
					Math.sin(angle) * end,
					0,
				],
				3,
			),
		);
		const line = new THREE.Line(geo, mat);
		line.renderOrder = Z_EFFECT;
		group.add(line);
	}
}

function shockwave(group: THREE.Group, progress: number): void {
	for (let ring = 0; ring < 2; ring += 1) {
		const phase = Math.max(0, Math.min(1, progress * 1.35 - ring * 0.22));
		const r = 20 + phase * 112;
		const m = new THREE.Mesh(
			new THREE.RingGeometry(r - 3, r + 3, 32),
			new THREE.MeshBasicMaterial({
				color: 0xffd36a,
				side: THREE.DoubleSide,
				transparent: true,
				opacity: 1 - phase,
				depthWrite: false,
			}),
		);
		m.renderOrder = Z_EFFECT + ring * 0.001;
		group.add(m);
	}

	const dotMat = new THREE.MeshBasicMaterial({
		color: 0xfff0ad,
		transparent: true,
		opacity: 1 - progress,
		depthWrite: false,
	});
	for (let i = 0; i < 12; i += 1) {
		const angle = (i * Math.PI) / 6;
		const dist = 28 + progress * 98;
		const dot = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), dotMat);
		dot.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist, 0);
		dot.renderOrder = Z_EFFECT + 0.002;
		group.add(dot);
	}
}

function arcane(group: THREE.Group, progress: number): void {
	const dotMat = new THREE.MeshBasicMaterial({
		color: 0x8fe9ff,
		transparent: true,
		opacity: 1 - progress * 0.5,
		depthWrite: false,
	});
	for (let i = 0; i < 10; i += 1) {
		const angle = i * 2.399 + progress * 2;
		const radius = (1 - progress) * (24 + (i % 4) * 8);
		const forward = progress * 42;
		const dot = new THREE.Mesh(
			new THREE.CircleGeometry(2.5 + (i % 2), 8),
			dotMat,
		);
		dot.position.set(
			forward + Math.cos(angle) * radius,
			Math.sin(angle) * radius,
			0,
		);
		dot.renderOrder = Z_EFFECT;
		group.add(dot);
	}

	const ring = new THREE.Mesh(
		new THREE.RingGeometry(
			12 + progress * 22 - 1.5 * (1 - progress),
			12 + progress * 22 + 1.5 * (1 - progress),
			20,
		),
		new THREE.MeshBasicMaterial({
			color: 0xd4f7ff,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 1 - progress,
			depthWrite: false,
		}),
	);
	ring.position.x = progress * 30;
	ring.renderOrder = Z_EFFECT + 0.001;
	group.add(ring);
}

function healing(group: THREE.Group, progress: number): void {
	const dotMat = new THREE.MeshBasicMaterial({
		color: 0x72f2a7,
		transparent: true,
		opacity: 1 - progress * 0.4,
		depthWrite: false,
	});
	for (let i = 0; i < 9; i += 1) {
		const angle = i * 2.399;
		const radius = 12 + (i % 3) * 9;
		const x = Math.cos(angle) * radius * (1 - progress * 0.35);
		const y = Math.sin(angle) * radius - progress * (35 + i * 2);
		const dot = new THREE.Mesh(
			new THREE.CircleGeometry(2.5 + (i % 2), 8),
			dotMat,
		);
		dot.position.set(x, y, 0);
		dot.renderOrder = Z_EFFECT;
		group.add(dot);
	}
}

function fireBreath(group: THREE.Group, progress: number): void {
	for (let index = 0; index < 5; index += 1) {
		const phase = Math.max(0, Math.min(1, progress * 1.7 - index * 0.12));
		const x = 18 + phase * (65 + index * 13);
		const radius = 10 + phase * (12 + index * 2);
		const arc = new THREE.Mesh(
			new THREE.RingGeometry(radius - 3.5, radius + 3.5, 16, 1, -0.9, 1.8),
			new THREE.MeshBasicMaterial({
				color: 0xff6534,
				side: THREE.DoubleSide,
				transparent: true,
				opacity: (1 - phase) * (1 - index * 0.08),
				depthWrite: false,
			}),
		);
		arc.position.x = x;
		arc.renderOrder = Z_EFFECT + index * 0.001;
		group.add(arc);
	}
}

function rentEdge(group: THREE.Group, _progress: number, range: number): void {
	const colors = [0xc91532, 0xfff7ee, 0xc91532];
	for (let index = 0; index < colors.length; index += 1) {
		const rx = Math.max(20, range - 4 + index * 4);
		const ry = Math.max(14, range * 0.62 - 4 + index * 4);
		const ellipse = new THREE.Mesh(
			new THREE.RingGeometry(Math.min(rx, ry) - 1, Math.max(rx, ry) + 1, 32),
			new THREE.MeshBasicMaterial({
				color: colors[index],
				side: THREE.DoubleSide,
				transparent: true,
				opacity: 0.8,
				depthWrite: false,
			}),
		);
		ellipse.scale.set(rx / Math.max(rx, ry), ry / Math.max(rx, ry), 1);
		ellipse.renderOrder = Z_EFFECT + index * 0.001;
		group.add(ellipse);
	}
}

function whirlwind(group: THREE.Group, progress: number, range: number): void {
	for (let edge = 0; edge < 6; edge += 1) {
		const angle = progress * Math.PI * 20 + (edge * Math.PI) / 3;
		const arcColor = edge % 2 ? 0xfff1dc : 0xdb3d2f;
		const r = range - (edge % 3) * 7;
		const arc = new THREE.Mesh(
			new THREE.RingGeometry(r - 1.5, r + 1.5, 16, 1, -0.42, 0.84),
			new THREE.MeshBasicMaterial({
				color: arcColor,
				side: THREE.DoubleSide,
				transparent: true,
				opacity: 0.9,
				depthWrite: false,
			}),
		);
		arc.rotation.z = angle;
		arc.renderOrder = Z_EFFECT + edge * 0.001;
		group.add(arc);
	}
}
