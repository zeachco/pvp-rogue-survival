import * as THREE from "three";
import { GameObject } from "./GameObject";
import { distance, type Vector2 } from "./types";
import type { ItemInstance } from "../../common/items";
import type { SkillId } from "../../common/items";
import type { DamagePresentation } from "./CombatText";
import type { ImpactForce } from "./ImpactForce";
import { Z_ATTACK } from "./render/ThreeRenderer";

export type AttackOwner = "hero" | "creep";

export class AttackArea extends GameObject {
	private age = 0;
	private readonly sourceAttackVersion?: number;
	resolved = false;

	readonly owner: AttackOwner;
	readonly origin: Vector2;
	readonly angle: number;
	readonly range: number;
	readonly halfArc: number;
	readonly windup: number;
	readonly linger: number;
	readonly damage: number;
	readonly source?: { active: boolean; attackVersion?: number };
	readonly skill?: SkillId;
	readonly weapon?: ItemInstance;
	readonly presentation: DamagePresentation;
	readonly force?: ImpactForce;

	private readonly fillMesh: THREE.Mesh;
	private readonly strokeMesh: THREE.Mesh;

	constructor(
		owner: AttackOwner,
		origin: Vector2,
		angle: number,
		range: number,
		halfArc: number,
		windup: number,
		linger: number,
		damage: number,
		source?: { active: boolean; attackVersion?: number },
		skill?: SkillId,
		weapon?: ItemInstance,
		presentation: DamagePresentation = { kind: "physical" },
		force?: ImpactForce,
	) {
		super();
		this.owner = owner;
		this.origin = { ...origin };
		this.angle = angle;
		this.range = range;
		this.halfArc = halfArc;
		this.windup = windup;
		this.linger = linger;
		this.damage = damage;
		this.source = source;
		this.skill = skill;
		this.weapon = weapon;
		this.presentation = presentation;
		this.force = force;
		this.sourceAttackVersion = source?.attackVersion;

		if (skill === "rent") {
			this.fillMesh = new THREE.Mesh();
			this.strokeMesh = new THREE.Mesh();
			this.mesh.renderOrder = Z_ATTACK;
			return;
		}

		const shape = new THREE.Shape();
		shape.moveTo(0, 0);
		const segments = Math.max(8, Math.ceil((halfArc * 2 * range) / 10));
		const startAngle = angle - halfArc;
		const endAngle = angle + halfArc;
		for (let i = 0; i <= segments; i++) {
			const a = startAngle + (i / segments) * (endAngle - startAngle);
			shape.lineTo(Math.cos(a) * range, Math.sin(a) * range);
		}
		shape.closePath();

		this.fillMesh = new THREE.Mesh(
			new THREE.ShapeGeometry(shape),
			new THREE.MeshBasicMaterial({
				color: 0x3affd4,
				transparent: true,
				opacity: 0.12,
				side: THREE.DoubleSide,
				depthWrite: false,
			}),
		);
		this.fillMesh.renderOrder = Z_ATTACK;

		const strokePoints: number[] = [];
		for (let i = 0; i <= segments; i++) {
			const a = startAngle + (i / segments) * (endAngle - startAngle);
			strokePoints.push(Math.cos(a) * range, Math.sin(a) * range, 0);
		}
		strokePoints.push(0, 0, 0);
		const strokeGeo = new THREE.BufferGeometry();
		strokeGeo.setAttribute(
			"position",
			new THREE.Float32BufferAttribute(strokePoints, 3),
		);
		this.strokeMesh = new THREE.Line(
			strokeGeo,
			new THREE.LineBasicMaterial({
				color: 0x3affd4,
				transparent: true,
				opacity: 0.8,
			}),
		) as unknown as THREE.Mesh;
		(this.strokeMesh as unknown as THREE.Line).renderOrder = Z_ATTACK + 0.001;

		this.mesh.add(this.fillMesh);
		this.mesh.add(this.strokeMesh);
		this.mesh.renderOrder = Z_ATTACK;
	}

	update(deltaSeconds: number): void {
		this.age += deltaSeconds;
		if (this.age >= this.windup + this.linger) this.active = false;
	}

	shouldResolve(): boolean {
		if (
			!this.resolved &&
			this.owner === "creep" &&
			this.source &&
			(!this.source.active ||
				this.source.attackVersion !== this.sourceAttackVersion)
		) {
			this.active = false;
			return false;
		}
		return this.active && !this.resolved && this.age >= this.windup;
	}
	markResolved(): void {
		this.resolved = true;
	}

	contains(position: Vector2, radius = 0): boolean {
		const dx = position.x - this.origin.x;
		const dy = position.y - this.origin.y;
		if (distance(position, this.origin) > this.range + radius) return false;
		if (this.halfArc >= Math.PI) return true;
		const delta = Math.atan2(
			Math.sin(Math.atan2(dy, dx) - this.angle),
			Math.cos(Math.atan2(dy, dx) - this.angle),
		);
		return Math.abs(delta) <= this.halfArc;
	}

	override updateVisuals(_time: number): void {
		super.updateVisuals(_time);
		if (this.skill === "rent") {
			this.mesh.visible = false;
			return;
		}
		this.mesh.position.set(this.origin.x, this.origin.y, 0);

		const hero = this.owner === "hero";
		const fire = this.skill === "fireBreath";

		let fillColor: number;
		let strokeColor: number;
		let fillOpacity: number;

		if (fire) {
			fillColor = this.resolved ? 0xff501e : 0xff501e;
			strokeColor = 0xff6534;
			fillOpacity = this.resolved ? 0.38 : 0.12;
		} else if (hero) {
			fillColor = 0x3affd4;
			strokeColor = 0x3affd4;
			fillOpacity = this.resolved ? 0.32 : 0.12;
		} else {
			fillColor = 0xff4b62;
			strokeColor = 0xff4b62;
			fillOpacity = this.resolved ? 0.38 : 0.13;
		}

		(this.fillMesh.material as THREE.MeshBasicMaterial).color.set(fillColor);
		(this.fillMesh.material as THREE.MeshBasicMaterial).opacity = fillOpacity;

		const lineMat = (this.strokeMesh as unknown as THREE.Line)
			.material as THREE.LineBasicMaterial;
		if (lineMat) {
			lineMat.color.set(strokeColor);
		}
	}
}
