import * as THREE from "three";
import {
	type CreepKind,
	type PlayerId,
	type UnitBuild,
} from "../../common/protocol";
import { statsWithItemBonuses, type SkillId } from "../../common/items";
import type { BalanceConfig } from "../../common/balance";
import type { RandomSource } from "../../common/random";
import { ENEMY_ARCHETYPES } from "../../common/content";
import {
	attackProfile,
	forceFieldRange,
	healingCast,
	healingCooldown,
	healingRadius,
} from "../../common/combat";
import { canvas2dContext } from "../platform/Canvas";
import { Unit } from "./Unit";
import { dropRarityColor } from "./ItemDrop";
import { SpellEffect } from "./SpellEffect";
import { clamp, distance, normalize, type Vector2 } from "./types";
import { creepMaxHealth } from "../../common/waves";
import { Z_CREEP, Z_CREEP_OVERLAY, Z_THREAT } from "./render/ThreeRenderer";

export function resourceBarWidth(
	current: number,
	max: number,
	barWidth = 32,
): number {
	if (max <= 0) return 0;
	const ratio = Math.max(0, Math.min(1, current / max));
	return Math.floor(barWidth * ratio);
}

export type CreepAttack =
	| {
			type: "melee";
			origin: Vector2;
			angle: number;
			windup: number;
			source: Creep;
	  }
	| { type: "projectile"; origin: Vector2; target: Vector2; source: Creep }
	| { type: "fireBreath"; origin: Vector2; angle: number; source: Creep }
	| { type: "forceField"; source: Creep };

export class Creep extends Unit {
	attackVersion = 0;
	readonly bounty: number;
	readonly scoreValue: number;
	private cooldown: number;
	private windup = 0;
	private pendingAttack = false;
	private damageFlash = false;
	private bonusSkillCooldown = 1.5;
	private healingCooldown = 0;
	private auraMovementMultiplier = 1;
	private auraAttackMultiplier = 1;
	private groundMovementMultiplier = 1;
	readonly build: UnitBuild;

	readonly healthBarGroup: THREE.Group;
	readonly labelObject?: THREE.Sprite;
	readonly selectionRing: THREE.Mesh;
	readonly attackWindupRing: THREE.Mesh;
	readonly bonusSkillRing: THREE.Mesh;
	readonly threatArrow: THREE.Mesh;

	private readonly bodyMesh: THREE.Mesh;
	private readonly strokeMesh: THREE.Mesh;
	private readonly healthBg: THREE.Mesh;
	private readonly healthFill: THREE.Mesh;
	private readonly manaBg: THREE.Mesh;
	private readonly manaFill: THREE.Mesh;
	private readonly rageBg: THREE.Mesh;
	private readonly rageFill: THREE.Mesh;
	private readonly bubbleEye?: THREE.Mesh;
	private healthBarY = -28;
	private barWidth = 32;
	private healthBarHeight = 4;
	private manaBarHeight = 2;
	private rageBarHeight = 2;

	constructor(
		build: UnitBuild,
		readonly emitterId: PlayerId | "neutral",
		readonly emitterName: string,
		position: Vector2,
		private readonly balance: BalanceConfig,
		private readonly random: RandomSource,
		readonly movementMultiplier = 1,
	) {
		super(position, build.isRival ? 22 : 16, 1);
		this.build = build;
		this.cooldown = 0.5 + random.next() * 0.4;
		this.kind = build.kind;
		this.configureStats(
			statsWithItemBonuses(
				build.stats,
				build.mainHand,
				build.offHand,
				build.amulet,
				build.charm,
			),
			build.offHand,
			build.mainHand,
			build.amulet,
			build.charm,
		);
		for (const skill of [
			...(build.mainHand?.skills ?? []),
			...(build.offHand?.skills ?? []),
			...(build.amulet?.skills ?? []),
			...(build.charm?.skills ?? []),
			...(build.bonusSkills ?? []),
			...Object.keys(build.skillLevels ?? {}),
		] as SkillId[]) {
			this.knownSkills.add(skill);
			const level = build.skillLevels?.[skill];
			this.skillLevels.set(skill, level ?? 1);
		}
		const hasEquippedSentItem = [
			build.mainHand,
			build.offHand,
			build.amulet,
			build.charm,
		].some((item) => item?.id.includes("-sent"));
		this.maxHp = creepMaxHealth(
			build.level,
			this.maxHp,
			balance,
			hasEquippedSentItem,
		);
		this.hp = this.maxHp;
		this.bounty = Math.max(1, build.mainHand?.sellValue ?? 1);
		this.scoreValue = build.isRival ? 10 : 2;

		const fillColor = build.isRival
			? 0xffd166
			: build.kind === "bubbleShooter"
				? 0x8c7cff
				: 0xff6f7d;
		const strokeColorStr = build.isRival ? "#704d00" : "#501721";
		const sentItem = [
			build.mainHand,
			build.offHand,
			build.amulet,
			build.charm,
		].find((item) => item?.id.includes("sent"));

		if (this.kind === "melee") {
			const shape = new THREE.Shape();
			for (let i = 0; i < 6; i += 1) {
				const a = -Math.PI / 2 + (i * Math.PI) / 3;
				const px = Math.cos(a) * this.radius;
				const py = Math.sin(a) * this.radius;
				if (i === 0) shape.moveTo(px, py);
				else shape.lineTo(px, py);
			}
			shape.closePath();
			this.bodyMesh = new THREE.Mesh(
				new THREE.ShapeGeometry(shape),
				new THREE.MeshBasicMaterial({ color: fillColor }),
			);
			this.strokeMesh = new THREE.Mesh(
				new THREE.ShapeGeometry(shape),
				new THREE.MeshBasicMaterial({
					color: sentItem ? dropRarityColor(sentItem.rarity) : strokeColorStr,
					wireframe: true,
				}),
			);
		} else {
			this.bodyMesh = new THREE.Mesh(
				new THREE.CircleGeometry(this.radius, 24),
				new THREE.MeshBasicMaterial({ color: fillColor }),
			);
			this.strokeMesh = new THREE.Mesh(
				new THREE.RingGeometry(this.radius - 1.5, this.radius + 1.5, 24),
				new THREE.MeshBasicMaterial({
					color: sentItem ? dropRarityColor(sentItem.rarity) : strokeColorStr,
					side: THREE.DoubleSide,
				}),
			);
		}
		this.bodyMesh.renderOrder = Z_CREEP;
		this.strokeMesh.renderOrder = Z_CREEP + 0.001;
		if (sentItem) {
			(this.bodyMesh.material as THREE.MeshBasicMaterial).transparent = true;
		}
		this.mesh.add(this.bodyMesh);
		this.mesh.add(this.strokeMesh);

		if (build.kind === "bubbleShooter") {
			const eyeGeo = new THREE.CircleGeometry(5, 16);
			const eyeMat = new THREE.MeshBasicMaterial({ color: 0xdff8ff });
			this.bubbleEye = new THREE.Mesh(eyeGeo, eyeMat);
			this.bubbleEye.position.set(5, -5, 0.01);
			this.bubbleEye.renderOrder = Z_CREEP + 0.002;
			this.mesh.add(this.bubbleEye);
		}

		this.healthBarGroup = new THREE.Group();
		this.healthBarGroup.renderOrder = Z_CREEP_OVERLAY;

		const hbY = this.healthBarY;
		this.healthBg = new THREE.Mesh(
			new THREE.PlaneGeometry(this.barWidth, this.healthBarHeight),
			new THREE.MeshBasicMaterial({
				color: 0x000000,
				transparent: true,
				opacity: 0.5,
			}),
		);
		this.healthBg.position.set(0, hbY, 0);
		this.healthBarGroup.add(this.healthBg);

		this.healthFill = new THREE.Mesh(
			new THREE.PlaneGeometry(this.barWidth, this.healthBarHeight),
			new THREE.MeshBasicMaterial({ color: 0xf1fffa }),
		);
		this.healthFill.position.set(0, hbY, 0.01);
		this.healthBarGroup.add(this.healthFill);

		const manaY = hbY + this.healthBarHeight;
		this.manaBg = new THREE.Mesh(
			new THREE.PlaneGeometry(this.barWidth, this.manaBarHeight),
			new THREE.MeshBasicMaterial({
				color: 0x000000,
				transparent: true,
				opacity: 0.65,
			}),
		);
		this.manaBg.position.set(0, manaY, 0);
		this.healthBarGroup.add(this.manaBg);

		this.manaFill = new THREE.Mesh(
			new THREE.PlaneGeometry(this.barWidth, this.manaBarHeight),
			new THREE.MeshBasicMaterial({ color: 0x45a9ff }),
		);
		this.manaFill.position.set(0, manaY, 0.01);
		this.healthBarGroup.add(this.manaFill);

		const rageY = manaY + this.manaBarHeight;
		this.rageBg = new THREE.Mesh(
			new THREE.PlaneGeometry(this.barWidth, this.rageBarHeight),
			new THREE.MeshBasicMaterial({
				color: 0x000000,
				transparent: true,
				opacity: 0.65,
			}),
		);
		this.rageBg.position.set(0, rageY, 0);
		this.healthBarGroup.add(this.rageBg);

		this.rageFill = new THREE.Mesh(
			new THREE.PlaneGeometry(this.barWidth, this.rageBarHeight),
			new THREE.MeshBasicMaterial({ color: 0xffd166 }),
		);
		this.rageFill.position.set(0, rageY, 0.01);
		this.healthBarGroup.add(this.rageFill);

		if (sentItem) {
			const canvas = document.createElement("canvas");
			const ctx = canvas2dContext(canvas);
			const font = "600 12px Inter, sans-serif";
			ctx.font = font;
			const metrics = ctx.measureText(this.emitterName);
			const textWidth = Math.ceil(metrics.width);
			const textHeight = 16;
			const padding = 8;
			const w = textWidth + padding * 2;
			const h = textHeight + padding * 2;
			canvas.width = w;
			canvas.height = h;
			ctx.font = font;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.shadowColor = "rgba(0,0,0,.95)";
			ctx.shadowBlur = 4;
			ctx.fillStyle = "#eafffb";
			ctx.fillText(this.emitterName, w / 2, h / 2);
			const texture = new THREE.CanvasTexture(canvas);
			const mat = new THREE.SpriteMaterial({
				map: texture,
				depthTest: false,
				transparent: true,
			});
			const sprite = new THREE.Sprite(mat);
			sprite.renderOrder = Z_CREEP_OVERLAY + 0.01;
			sprite.scale.set(w, h, 1);
			this.labelObject = sprite;
		}

		this.selectionRing = new THREE.Mesh(
			new THREE.RingGeometry(this.radius + 5.5, this.radius + 8.5, 24),
			new THREE.MeshBasicMaterial({
				color: 0xfff08a,
				side: THREE.DoubleSide,
				depthWrite: false,
			}),
		);
		this.selectionRing.renderOrder = Z_CREEP_OVERLAY + 0.02;
		this.selectionRing.visible = false;

		this.attackWindupRing = new THREE.Mesh(
			new THREE.RingGeometry(this.radius + 5.5, this.radius + 8.5, 24),
			new THREE.MeshBasicMaterial({
				color: 0xffea77,
				side: THREE.DoubleSide,
				depthWrite: false,
			}),
		);
		this.attackWindupRing.renderOrder = Z_CREEP_OVERLAY + 0.03;
		this.attackWindupRing.visible = false;

		this.bonusSkillRing = new THREE.Mesh(
			new THREE.RingGeometry(this.radius + 8.5, this.radius + 11.5, 24),
			new THREE.MeshBasicMaterial({
				color: 0xff6534,
				side: THREE.DoubleSide,
				depthWrite: false,
			}),
		);
		this.bonusSkillRing.renderOrder = Z_CREEP_OVERLAY + 0.04;
		this.bonusSkillRing.visible = false;

		const arrowShape = new THREE.Shape();
		arrowShape.moveTo(12, 0);
		arrowShape.lineTo(-8, -7);
		arrowShape.lineTo(-8, 7);
		arrowShape.closePath();
		this.threatArrow = new THREE.Mesh(
			new THREE.ShapeGeometry(arrowShape),
			new THREE.MeshBasicMaterial({
				color: build.isRival ? 0xffd166 : 0xff6f7d,
			}),
		);
		this.threatArrow.renderOrder = Z_THREAT;
		this.threatArrow.visible = false;

		this.mesh.renderOrder = Z_CREEP;
	}

	readonly kind: CreepKind;

	override takeDamage(amount: number): void {
		super.takeDamage(amount);
		this.damageFlash = true;
	}

	pursue(
		hero: Vector2,
		deltaSeconds: number,
		width: number,
		height: number,
	): CreepAttack | undefined {
		this.updateResources(deltaSeconds, this.random);
		const movement = ENEMY_ARCHETYPES[this.build.isRival ? "rival" : this.kind];
		const rangedMovement = ENEMY_ARCHETYPES.bubbleShooter;
		const maxSpeed =
			movement.maxSpeed *
			(1 + this.stats.agility * 0.01) *
			this.movementMultiplier *
			this.auraMovementMultiplier *
			this.groundMovementMultiplier *
			this.freezeMovementMultiplier;
		const acceleration = movement.acceleration;
		const profile = attackProfile(
			this.build.mainHand,
			this.stats,
			this.balance,
		);
		const ranged = profile.projectile;
		const heroDistance = distance(this.position, hero);
		const attackSpeed = profile.attacksPerSecond * this.auraAttackMultiplier;
		this.cooldown = Math.max(0, this.cooldown - deltaSeconds);
		this.bonusSkillCooldown = Math.max(
			0,
			this.bonusSkillCooldown - deltaSeconds,
		);
		this.healingCooldown = Math.max(0, this.healingCooldown - deltaSeconds);

		if (this.pendingAttack) {
			this.windup -= deltaSeconds;
			this.moveFromVelocity(
				{ x: 0, y: 0 },
				acceleration,
				maxSpeed * 0.25,
				deltaSeconds,
			);
			if (this.windup <= 0) {
				this.pendingAttack = false;
				return ranged
					? {
							type: "projectile",
							origin: { ...this.position },
							target: { ...hero },
							source: this,
						}
					: undefined;
			}
			return undefined;
		}

		const attackRange = ranged
			? profile.range
			: this.build.mainHand
				? movement.attackRange
				: profile.range;
		if (
			this.knownSkills.has("fireBreath") &&
			this.bonusSkillCooldown === 0 &&
			this.mana >= 4 &&
			heroDistance <= 150
		) {
			this.spendMana(4);
			this.bonusSkillCooldown = 9;
			return {
				type: "fireBreath",
				origin: { ...this.position },
				angle: Math.atan2(hero.y - this.position.y, hero.x - this.position.x),
				source: this,
			};
		}
		if (
			this.knownSkills.has("gravityPull") &&
			this.bonusSkillCooldown === 0 &&
			this.mana >= 8 &&
			heroDistance < forceFieldRange(this.skillLevels.get("gravityPull") ?? 1)
		) {
			this.spendMana(8);
			this.bonusSkillCooldown = 18;
			return { type: "forceField", source: this };
		}
		if (this.cooldown === 0 && heroDistance <= attackRange) {
			const windup = (ranged ? 0.65 : 0.7) / attackSpeed;
			this.pendingAttack = true;
			this.windup = windup;
			this.cooldown = windup + (ranged ? 1.15 : 0.75) / attackSpeed;
			return ranged
				? undefined
				: {
						type: "melee",
						origin: { ...this.position },
						angle: Math.atan2(
							hero.y - this.position.y,
							hero.x - this.position.x,
						),
						windup,
						source: this,
					};
		}

		let direction = normalize({
			x: hero.x - this.position.x,
			y: hero.y - this.position.y,
		});
		const magicRanged =
			this.build.mainHand?.definitionId === "staff" ||
			this.build.mainHand?.definitionId === "scepter";
		const retreatRange = magicRanged
			? (rangedMovement.retreatRange ?? 0)
			: Math.max(0, attackRange - 75);
		const preferredRange = magicRanged
			? (rangedMovement.preferredRange ?? attackRange)
			: Math.max(retreatRange, attackRange - 30);
		if (ranged && heroDistance < retreatRange)
			direction = { x: -direction.x, y: -direction.y };
		else if (ranged && heroDistance <= preferredRange)
			direction = { x: 0, y: 0 };
		this.moveFromVelocity(
			this.stunned ? { x: 0, y: 0 } : direction,
			acceleration,
			maxSpeed,
			deltaSeconds,
		);
		this.position.x = Math.max(
			-this.radius,
			Math.min(width + this.radius, this.position.x),
		);
		this.position.y = Math.max(
			-this.radius,
			Math.min(height + this.radius, this.position.y),
		);
		return undefined;
	}

	castHealing(allies: readonly Creep[], effects: SpellEffect[]): boolean {
		const level = this.skillLevels.get("healing") ?? 0;
		if (
			!this.active ||
			!this.knownSkills.has("healing") ||
			level <= 0 ||
			this.hp >= this.maxHp * 0.75 ||
			this.healingCooldown > 0
		)
			return false;
		const cast = healingCast(
			this.hp,
			this.maxHp,
			this.rage,
			this.maxRage,
			level,
		);
		if (cast.restoredHp <= 0 || this.mana < cast.manaCost) return false;
		this.spendMana(cast.manaCost);
		const radius = healingRadius(level);
		for (const ally of allies)
			if (ally.active && distance(this.position, ally.position) <= radius) {
				ally.heal(
					healingCast(ally.hp, ally.maxHp, this.rage, this.maxRage, level)
						.restoredHp,
				);
			}
		effects.push(new SpellEffect("healing", this.position, 0, radius));
		this.healingCooldown = healingCooldown(level);
		return true;
	}

	update(): void {}

	interruptAttack(): void {
		this.attackVersion += 1;
		this.pendingAttack = false;
		this.windup = 0;
	}
	setAuraMultipliers(movement?: number, attack?: number): void {
		if (movement !== undefined) this.auraMovementMultiplier = movement;
		if (attack !== undefined) this.auraAttackMultiplier = attack;
	}
	setGroundMovementMultiplier(multiplier: number): void {
		this.groundMovementMultiplier = multiplier;
	}

	private moveFromVelocity(
		direction: Vector2,
		acceleration: number,
		maxSpeed: number,
		deltaSeconds: number,
	): void {
		if (this.frozen) this.slide(deltaSeconds);
		else
			this.steerWithFriction(
				direction,
				acceleration,
				maxSpeed,
				deltaSeconds,
				acceleration * 0.75,
			);
	}

	override updateVisuals(
		time: number,
		hovered?: Creep,
		inspected?: Creep,
	): void {
		super.updateVisuals(time);
		this.mesh.position.set(this.position.x, this.position.y, 0);

		const flash = this.damageFlash;
		this.damageFlash = false;
		const fillColor = flash
			? 0xffffff
			: this.build.isRival
				? 0xffd166
				: this.kind === "bubbleShooter"
					? 0x8c7cff
					: 0xff6f7d;
		(this.bodyMesh.material as THREE.MeshBasicMaterial).color.set(fillColor);

		this.healthBarGroup.position.set(this.position.x, this.position.y, 0);
		if (this.labelObject) {
			this.labelObject.position.set(
				this.position.x,
				this.position.y + this.radius + 28,
				Z_CREEP_OVERLAY + 0.01,
			);
		}

		const hbW = this.barWidth;
		const hpRatio = this.maxHp > 0 ? clamp(this.hp / this.maxHp, 0, 1) : 0;
		this.healthFill.scale.x = Math.max(0.001, hpRatio);
		this.healthFill.position.x = -hbW / 2 + (hbW * hpRatio) / 2;

		const manaRatio =
			this.maxMana > 0 ? clamp(this.mana / this.maxMana, 0, 1) : 0;
		this.manaFill.scale.x = Math.max(0.001, manaRatio);
		this.manaFill.position.x = -hbW / 2 + (hbW * manaRatio) / 2;

		const rageRatio =
			this.maxRage > 0 ? clamp(this.rage / this.maxRage, 0, 1) : 0;
		this.rageFill.scale.x = Math.max(0.001, rageRatio);
		this.rageFill.position.x = -hbW / 2 + (hbW * rageRatio) / 2;

		this.attackWindupRing.visible = this.pendingAttack;
		this.attackWindupRing.position.set(this.position.x, this.position.y, 0);

		this.bonusSkillRing.visible = !!this.build.bonusSkills?.length;
		this.bonusSkillRing.position.set(this.position.x, this.position.y, 0);

		const isHighlighted = this === hovered || this === inspected;
		this.selectionRing.visible = isHighlighted;
		if (isHighlighted) {
			this.selectionRing.position.set(this.position.x, this.position.y, 0);
		}

		this.updateThreatArrow();
	}

	private updateThreatArrow(): void {
		const margin = 30;
		const cam = { width: window.innerWidth, height: window.innerHeight };
		const x = this.position.x;
		const y = this.position.y;
		if (
			x >= margin &&
			x <= cam.width - margin &&
			y >= margin &&
			y <= cam.height - margin
		) {
			this.threatArrow.visible = false;
			return;
		}
		const ix = clamp(x, margin, cam.width - margin);
		const iy = clamp(y, margin, cam.height - margin);
		const angle = Math.atan2(y - iy, x - ix);
		this.threatArrow.visible = true;
		this.threatArrow.position.set(ix, iy, 0);
		this.threatArrow.rotation.z = angle;
	}
}
