import * as THREE from "three";
import {
	type CreepKind,
	type EnemyRole,
	type PlayerId,
	type UnitBuild,
} from "../../common/protocol";
import { type SkillId } from "../../common/items";
import type { BalanceConfig } from "../../common/balance";
import type { RandomSource } from "../../common/random";
import { ENEMY_ARCHETYPES } from "../../common/content";
import {
	forceFieldRange,
	healingAutoCastThresholdMet,
	healingCast,
	healingCooldown,
	healingRadius,
} from "../../common/combat";
import { canvas2dContext } from "../platform/Canvas";
import { Unit } from "./Unit";
import { dropRarityColor } from "./ItemDrop";
import { SpellEffect } from "./SpellEffect";
import {
	clamp,
	distance,
	normalize,
	type CreepTimedStates,
	type Vector2,
} from "./types";
import { creepMaxHealth } from "../../common/waves";
import { Z_CREEP, Z_CREEP_OVERLAY, Z_THREAT } from "./render/ThreeRenderer";
import {
	AnimatedCharacter,
	AnimatedCharacterDeath,
	type CharacterModelKind,
} from "./render/AnimatedCharacter";

export const CREEP_RESOURCE_BAR_CAMERA_OFFSET = 2;
export const creepResourceBarAnchorY = (presentationHeight: number): number =>
	presentationHeight + 8;

export function resourceBarWidth(
	current: number,
	max: number,
	barWidth = 32,
): number {
	if (max <= 0) return 0;
	const ratio = Math.max(0, Math.min(1, current / max));
	return Math.floor(barWidth * ratio);
}

const ENEMY_ASSET_PATHS: Record<EnemyRole, string> = {
	creep: "/assets/enemies/creep.png",
	champion: "/assets/enemies/champion.png",
	invader: "/assets/enemies/invader.png",
	clone: "/assets/enemies/clone.png",
	boss: "/assets/enemies/boss.png",
};
const enemyTextures = new Map<EnemyRole, THREE.Texture>();

function enemyRole(build: UnitBuild): EnemyRole {
	return (
		build.enemyRole ??
		(build.emitterId ? "invader" : build.isRival ? "champion" : "creep")
	);
}

function enemyTexture(role: EnemyRole): THREE.Texture | undefined {
	if (typeof document === "undefined") return undefined;
	const existing = enemyTextures.get(role);
	if (existing) return existing;
	const texture = new THREE.TextureLoader().load(ENEMY_ASSET_PATHS[role]);
	texture.colorSpace = THREE.SRGBColorSpace;
	enemyTextures.set(role, texture);
	return texture;
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
	facing = 0;
	readonly bounty: number;
	readonly scoreValue: number;
	private cooldown: number;
	private windup = 0;
	private pendingAttack = false;
	private damageFlash = false;
	private bonusSkillCooldown = 1.5;
	private healingCooldown = 0;
	readonly build: UnitBuild;

	readonly healthBarGroup: THREE.Group;
	readonly labelObject?: THREE.Sprite;
	readonly selectionRing: THREE.Mesh;
	readonly attackWindupRing: THREE.Mesh;
	readonly bonusSkillRing: THREE.Mesh;
	readonly threatArrow: THREE.Mesh;

	private readonly bodyMesh: THREE.Mesh;
	private readonly bodyTexture?: THREE.Texture;
	private readonly spriteGroup = new THREE.Group();
	private readonly animatedCharacter?: AnimatedCharacter;
	private readonly modelKind?: CharacterModelKind;
	private readonly strokeMesh: THREE.Mesh;
	private readonly healthBg: THREE.Mesh;
	private readonly healthFill: THREE.Mesh;
	private readonly manaBg: THREE.Mesh;
	private readonly manaFill: THREE.Mesh;
	private readonly rageBg: THREE.Mesh;
	private readonly rageFill: THREE.Mesh;
	private readonly reflectiveSurgeIcon: THREE.Mesh;
	private readonly stateIcons: THREE.Mesh[] = [];
	private readonly bubbleEye?: THREE.Mesh;
	readonly resourceBarAnchorY: number;
	private barWidth = 32;
	private healthBarHeight = 4;
	private manaBarHeight = 2;
	private rageBarHeight = 2;
	private readonly spriteCenterHeight: number;
	private readonly presentationHeight: number;

	constructor(
		build: UnitBuild,
		readonly emitterId: PlayerId | "neutral",
		readonly emitterName: string,
		position: Vector2,
		balance: BalanceConfig,
		private readonly random: RandomSource,
		readonly movementMultiplier = 1,
	) {
		super(position, build.isRival ? 22 : 16, 1);
		this.build = build;
		this.cooldown = 0.5 + random.next() * 0.4;
		this.kind = build.kind;
		this.configureStats(
			build.stats,
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
		const texture = enemyTexture(enemyRole(build));
		this.bodyTexture = texture;
		const sentItem = [
			build.mainHand,
			build.offHand,
			build.amulet,
			build.charm,
		].find((item) => item?.id.includes("sent"));

		if (texture) {
			const visualScale =
				build.enemyRole === "boss"
					? 3.2
					: build.isRival
						? 2.8
						: build.enemyRole === "invader"
							? 2.7
							: 2.5;
			this.presentationHeight = this.radius * visualScale;
			this.spriteCenterHeight = this.presentationHeight / 2;
			this.bodyMesh = new THREE.Mesh(
				new THREE.PlaneGeometry(
					this.radius * visualScale,
					this.radius * visualScale,
				),
				new THREE.MeshStandardMaterial({
					map: texture,
					transparent: true,
					alphaTest: 0.02,
					depthWrite: false,
					color: 0xdddddd,
				}),
			);
		} else if (this.kind === "melee") {
			this.presentationHeight = this.radius * 2;
			this.spriteCenterHeight = this.radius;
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
				new THREE.MeshStandardMaterial({ color: fillColor }),
			);
		} else {
			this.presentationHeight = this.radius * 2;
			this.spriteCenterHeight = this.radius;
			this.bodyMesh = new THREE.Mesh(
				new THREE.CircleGeometry(this.radius, 24),
				new THREE.MeshStandardMaterial({ color: fillColor }),
			);
		}
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
			this.strokeMesh = new THREE.Mesh(
				new THREE.ShapeGeometry(shape),
				new THREE.MeshBasicMaterial({
					color: sentItem ? dropRarityColor(sentItem.rarity) : strokeColorStr,
					wireframe: true,
				}),
			);
		} else {
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
		this.spriteGroup.add(this.bodyMesh);
		const role = enemyRole(build);
		const modelKind: CharacterModelKind | undefined =
			role === "boss"
				? "boss"
				: role === "champion"
					? "champion"
					: role === "creep"
						? "creep"
						: undefined;
		this.modelKind = modelKind;
		if (modelKind) {
			this.animatedCharacter = new AnimatedCharacter(
				modelKind,
				this.spriteGroup,
			);
			this.mesh.add(this.animatedCharacter.root);
		}
		this.spriteGroup.add(this.strokeMesh);
		this.spriteGroup.position.z = this.spriteCenterHeight;

		if (build.kind === "bubbleShooter") {
			const eyeGeo = new THREE.CircleGeometry(5, 16);
			const eyeMat = new THREE.MeshBasicMaterial({ color: 0xdff8ff });
			this.bubbleEye = new THREE.Mesh(eyeGeo, eyeMat);
			this.bubbleEye.position.set(5, -5, 0.01);
			this.bubbleEye.renderOrder = Z_CREEP + 0.002;
			this.spriteGroup.add(this.bubbleEye);
		}
		this.mesh.add(this.spriteGroup);
		this.resourceBarAnchorY = creepResourceBarAnchorY(this.presentationHeight);

		this.healthBarGroup = new THREE.Group();
		this.healthBarGroup.renderOrder = Z_CREEP_OVERLAY;

		const hbY = this.resourceBarAnchorY;
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
			new THREE.MeshBasicMaterial({ color: 0xff3b4f }),
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
		this.reflectiveSurgeIcon = createReflectiveSurgeIcon();
		this.reflectiveSurgeIcon.position.set(
			this.barWidth / 2 + 6,
			rageY + this.rageBarHeight + 5,
			0.02,
		);
		this.reflectiveSurgeIcon.visible = false;
		this.healthBarGroup.add(this.reflectiveSurgeIcon);
		for (let index = 0; index < 8; index += 1) {
			const icon = new THREE.Mesh(
				new THREE.CircleGeometry(2.2, 12),
				new THREE.MeshBasicMaterial({ color: 0xffffff }),
			);
			icon.name = "creep-state-icon";
			icon.position.set(-this.barWidth / 2 + 2.2 + index * 4.6, hbY - 5, 0.02);
			icon.visible = false;
			this.healthBarGroup.add(icon);
			this.stateIcons.push(icon);
		}
		for (const bar of this.healthBarGroup.children) {
			if (!(bar instanceof THREE.Mesh)) continue;
			bar.renderOrder = Z_CREEP_OVERLAY;
			const material = bar.material as THREE.MeshBasicMaterial;
			material.depthTest = false;
			material.depthWrite = false;
		}

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
				depthTest: false,
				depthWrite: false,
			}),
		);
		this.threatArrow.renderOrder = Z_THREAT;
		this.threatArrow.visible = false;

		this.mesh.renderOrder = Z_CREEP;
	}

	readonly kind: CreepKind;

	override takeDamage(amount: number): void {
		const hpBefore = this.hp;
		super.takeDamage(amount);
		if (this.hp < hpBefore) this.damageFlash = true;
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
			this.state.movementSpeedMultiplier *
			this.freezeMovementMultiplier *
			this.damageMovementMultiplier;
		const acceleration = movement.acceleration;
		const profile = this.state.attack;
		const ranged = profile.projectile;
		const heroDistance = distance(this.position, hero);
		const attackSpeed =
			profile.attacksPerSecond * this.state.attackSpeedMultiplier;
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
				maxSpeed,
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
			this.facing = Math.atan2(
				hero.y - this.position.y,
				hero.x - this.position.x,
			);
			this.pendingAttack = true;
			this.windup = windup;
			this.cooldown = windup + (ranged ? 1.15 : 0.75) / attackSpeed;
			this.presentAttack(this.cooldown);
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
		if (direction.x || direction.y)
			this.facing = Math.atan2(direction.y, direction.x);
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

	castHealing(
		allies: readonly Creep[],
		effects: SpellEffect[],
		enemy?: Unit,
	): boolean {
		const level = this.skillLevels.get("healing") ?? 0;
		if (
			!this.active ||
			!this.knownSkills.has("healing") ||
			level <= 0 ||
			!healingAutoCastThresholdMet(this.hp, this.maxHp) ||
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
		const hpBeforeHeal = this.hp;
		const radius = healingRadius(level);
		for (const ally of allies)
			if (ally.active && distance(this.position, ally.position) <= radius) {
				ally.heal(
					healingCast(ally.hp, ally.maxHp, this.rage, this.maxRage, level)
						.restoredHp,
				);
			}
		const restored = this.hp - hpBeforeHeal;
		if (
			restored > 0 &&
			enemy?.active &&
			this.mainHand?.definitionId === "mace" &&
			this.mainHand.rarity === "unique" &&
			distance(this.position, enemy.position) <= radius
		)
			enemy.receiveDamage(restored * 0.25, this.random, this, false, false, {
				kind: "magic",
			});
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
		this.animatedCharacter?.update({
			time,
			facing: this.facing,
			moving: Math.hypot(this.velocity.x, this.velocity.y) > 0.01,
			attackVersion: this.presentationAttackVersion,
			attackDuration: this.presentationAttackDuration,
			hitVersion: this.presentationHitVersion,
			dead: false,
			statusTint: statusTint(this.statuses),
			flash,
			reflectiveSurge: this.reflectiveSurgeRemaining > 0,
		});
		const reflective = this.reflectiveSurgeRemaining > 0;
		const fillColor = flash
			? 0xffffff
			: reflective
				? 0x3f4448
				: (this.bodyMesh.material as THREE.MeshBasicMaterial).map
					? 0xdddddd
					: this.build.isRival
						? 0xffd166
						: this.kind === "bubbleShooter"
							? 0x8c7cff
							: 0xff6f7d;
		(this.bodyMesh.material as THREE.MeshBasicMaterial).color.set(fillColor);
		const bodyMaterial = this.bodyMesh.material as THREE.MeshStandardMaterial;
		const bodyMap = reflective ? null : (this.bodyTexture ?? null);
		if (bodyMaterial.map !== bodyMap) {
			bodyMaterial.map = bodyMap;
			bodyMaterial.needsUpdate = true;
		}
		bodyMaterial.metalness = reflective ? 0.9 : 0;
		bodyMaterial.roughness = reflective ? 0.35 : 1;

		this.healthBarGroup.position.set(this.position.x, this.position.y, 0);
		if (this.labelObject) {
			this.labelObject.position.set(
				this.position.x,
				this.position.y +
					this.resourceBarAnchorY +
					this.healthBarHeight +
					this.manaBarHeight +
					this.rageBarHeight +
					12,
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
		this.reflectiveSurgeIcon.visible = this.reflectiveSurgeRemaining > 0;
		const stateColors = [
			...new Set(this.statuses.map((status) => status.kind)),
			...(this.healthRegenMultiplier > 1 || this.healthRegenFlat > 0
				? ["regen"]
				: []),
			...(reflective ? ["reflective"] : []),
		].map(creepStateColor);
		this.stateIcons.forEach((icon, index) => {
			icon.visible = index < stateColors.length;
			if (icon.visible)
				(icon.material as THREE.MeshBasicMaterial).color.set(
					stateColors[index],
				);
		});

		this.attackWindupRing.visible = this.pendingAttack;
		this.attackWindupRing.position.set(this.position.x, this.position.y, 0);

		this.bonusSkillRing.visible = !!this.build.bonusSkills?.length;
		this.bonusSkillRing.position.set(this.position.x, this.position.y, 0);

		const isHighlighted = this === hovered || this === inspected;
		this.selectionRing.visible = isHighlighted;
		if (isHighlighted) {
			this.selectionRing.position.set(this.position.x, this.position.y, 0);
		}
	}

	timedStates(): CreepTimedStates {
		return {
			statuses: this.statuses.map(({ kind, remaining, damagePerSecond }) => ({
				kind,
				remaining,
				damagePerSecond,
			})),
			reflectiveSurgeRemaining: this.reflectiveSurgeRemaining,
			regenerating: this.healthRegenMultiplier > 1 || this.healthRegenFlat > 0,
		};
	}

	faceCamera(cameraQuaternion: THREE.Quaternion): void {
		if (!this.animatedCharacter?.modelLoaded)
			this.spriteGroup.quaternion.copy(cameraQuaternion);
		this.healthBarGroup.quaternion.copy(cameraQuaternion);
		this.healthBarGroup.translateZ(CREEP_RESOURCE_BAR_CAMERA_OFFSET);
	}

	createDeathVisual(): AnimatedCharacterDeath | undefined {
		return this.modelKind === "boss" && this.animatedCharacter
			? new AnimatedCharacterDeath("boss", this.position, this.facing)
			: undefined;
	}

	updateThreatArrow(camera: THREE.PerspectiveCamera): void {
		const world = new THREE.Vector3(
			this.position.x,
			this.position.y,
			this.spriteCenterHeight,
		);
		const projected = world.clone().project(camera);
		const cameraSpace = world.clone().applyMatrix4(camera.matrixWorldInverse);
		const behind = cameraSpace.z >= 0;
		const edge = 0.88;
		if (
			!behind &&
			projected.z >= -1 &&
			projected.z <= 1 &&
			Math.abs(projected.x) <= edge &&
			Math.abs(projected.y) <= edge
		) {
			this.threatArrow.visible = false;
			return;
		}
		let directionX = Number.isFinite(projected.x) ? projected.x : 0;
		let directionY = Number.isFinite(projected.y) ? projected.y : 1;
		if (behind) {
			directionX = -directionX;
			directionY = -directionY;
		}
		const divisor = Math.max(
			Math.abs(directionX) / edge,
			Math.abs(directionY) / edge,
			0.0001,
		);
		const ndcX = directionX / divisor;
		const ndcY = directionY / divisor;
		const worldPosition = new THREE.Vector3(ndcX, ndcY, 0.995).unproject(
			camera,
		);
		const angle = Math.atan2(directionY, directionX);
		this.threatArrow.visible = true;
		this.threatArrow.position.copy(worldPosition);
		this.threatArrow.quaternion.copy(camera.quaternion);
		this.threatArrow.rotateZ(angle);
	}
}

function createReflectiveSurgeIcon(): THREE.Mesh {
	const shape = new THREE.Shape();
	shape.moveTo(0, 5);
	shape.lineTo(5, 0);
	shape.lineTo(0, -5);
	shape.lineTo(-5, 0);
	shape.closePath();
	const icon = new THREE.Mesh(
		new THREE.ShapeGeometry(shape),
		new THREE.MeshBasicMaterial({
			color: 0xffe46b,
			transparent: true,
			opacity: 0.9,
			depthTest: false,
			depthWrite: false,
			side: THREE.DoubleSide,
		}),
	);
	icon.name = "reflective-surge-aura-icon";
	icon.renderOrder = Z_CREEP_OVERLAY + 0.02;
	return icon;
}

function statusTint(statuses: { kind: string }[]): string | undefined {
	if (statuses.some((status) => status.kind === "freeze")) return "#8de7ff";
	if (statuses.some((status) => status.kind === "burn")) return "#ff783d";
	if (statuses.some((status) => status.kind === "poison")) return "#92f58b";
	if (statuses.some((status) => status.kind === "curse")) return "#4b225e";
	return undefined;
}

function creepStateColor(kind: string): number {
	if (kind === "poison") return 0x92f58b;
	if (kind === "burn") return 0xff783d;
	if (kind === "bleed") return 0xff4858;
	if (kind === "freeze") return 0x8de7ff;
	if (kind === "stun" || kind === "shock") return 0xffffff;
	if (kind === "curse") return 0x9d60c4;
	if (kind === "regen") return 0x62e88a;
	return 0xffe46b;
}
