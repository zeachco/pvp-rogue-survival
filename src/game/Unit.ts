import { GameObject } from "./GameObject";
import { clamp, type StatusEffectSnapshot, type Vector2 } from "./types";
import { derivedStats, type Stats } from "../../common/progression";
import {
	equippedImmunities,
	equippedPerks,
	itemCooldownReduction,
	itemRequirementMultiplier,
	itemResourceCostReduction,
	RARITY_POWER,
	type ItemImmunity,
	type ItemInstance,
	type SkillId,
} from "../../common/items";
import type { RandomSource } from "../../common/random";
import type { CombatText, DamagePresentation } from "./CombatText";
import {
	bucklerBlockChance,
	reflectiveSurgeBlockChanceBonus,
	reflectiveSurgeDuration,
	bucklerBlockCost,
	effectiveSkillCooldown,
	manaConversionFraction,
	spellCooldownFloor,
	spiritWoundsConversionFraction,
	skillUpkeepPerSecond,
	weaponAttackSpeed,
} from "../../common/combat";
import { SKILLS } from "../../common/content";

export interface StatusEffect extends StatusEffectSnapshot {
	tick?: number;
	source?: Unit;
}

export abstract class Unit extends GameObject {
	position: Vector2;
	velocity: Vector2 = { x: 0, y: 0 };
	hp: number;
	maxHp: number;
	mana = 0;
	maxMana = 0;
	rage = 1;
	maxRage = 1;
	stats: Stats = {
		agility: 0,
		strength: 0,
		magic: 0,
		spirit: 0,
		intelligence: 0,
	};
	statuses: StatusEffect[] = [];
	enteredArena = false;
	offHand?: ItemInstance;
	mainHand?: ItemInstance;
	amulet?: ItemInstance;
	charm?: ItemInstance;
	lastDamageSourceId?: string;
	damageFloorOne = false;
	blockCooldown = 0;
	blockCooldownMax = 0;
	reflectiveSurgeRemaining = 0;
	reflectiveSurgeCooldown = 0;
	reflectiveSurgeCooldownMax = 0;
	healthRegenMultiplier = 1;
	healthRegenFlat = 0;
	readonly knownSkills = new Set<SkillId>();
	readonly skillLevels = new Map<SkillId, number>();
	private readonly suspendedUpkeep = new Set<"mana" | "rage">();
	onCombatText?: (text: CombatText) => void;
	lastHitDodged = false;
	presentationAttackVersion = 0;
	presentationAttackDuration = 0.5;
	presentationHitVersion = 0;
	damageSlowRemaining = 0;

	protected constructor(
		position: Vector2,
		readonly radius: number,
		hp: number,
	) {
		super();
		this.position = { ...position };
		this.hp = hp;
		this.maxHp = hp;
	}

	takeDamage(amount: number): void {
		const lostHp = Math.min(this.hp, Math.max(0, amount));
		if (lostHp > 0) {
			this.presentationHitVersion += 1;
			this.damageSlowRemaining = 0.35;
		}
		this.hp = Math.max(0, this.hp - amount);
		if (this.hp === 0) this.active = false;
	}

	spendLife(amount: number): void {
		this.hp = Math.max(1, this.hp - Math.max(0, amount));
	}

	get damageMovementMultiplier(): number {
		return this.damageSlowRemaining > 0 ? 0.48 : 1;
	}

	presentAttack(duration = 0.5): void {
		this.presentationAttackDuration = Math.max(0.1, duration);
		this.presentationAttackVersion += 1;
	}

	spendMana(amount: number): boolean {
		const cost = Math.max(0, amount);
		this.mana = Math.max(0, Math.min(this.maxMana, this.mana));
		if (this.mana < cost) return false;
		this.mana = Math.max(0, this.mana - cost);
		if (this.mana === 0) this.suspendedUpkeep.add("mana");
		return true;
	}

	spendRage(amount: number): boolean {
		const cost = Math.max(0, amount);
		this.rage = Math.max(0, Math.min(this.maxRage, this.rage));
		if (this.rage < cost) return false;
		this.rage = Math.max(0, this.rage - cost);
		if (this.rage === 0) this.suspendedUpkeep.add("rage");
		return true;
	}

	isSkillOperational(skill: SkillId): boolean {
		const upkeep = SKILLS[skill].upkeep;
		return (
			this.knownSkills.has(skill) &&
			(!upkeep || !this.suspendedUpkeep.has(upkeep.resource))
		);
	}

	receiveDamage(
		amount: number,
		random: RandomSource,
		source?: Unit,
		reflectable = true,
		invulnerable = false,
		presentation: DamagePresentation = { kind: "physical" },
	): number {
		this.lastHitDodged = false;
		let critical = presentation.critical ?? false;
		let incomingAmount = amount;
		if (presentation.critical === undefined && source) {
			const sourceDerived = derivedStats(source.stats);
			critical = random.next() < sourceDerived.critChance;
			if (critical) incomingAmount *= sourceDerived.critMultiplier;
		}
		const perks = equippedPerks(
			this.stats,
			this.mainHand,
			this.offHand,
			this.amulet,
			this.charm,
		);
		const immunities = equippedImmunities(
			this.stats,
			this.mainHand,
			this.offHand,
			this.amulet,
			this.charm,
		);
		if (
			reflectable &&
			random.next() <
				Math.min(
					0.5,
					Math.max(0, this.stats.agility) * 0.003 + perks.dodgeChance,
				)
		) {
			this.lastHitDodged = true;
			this.emitOutcome("dodge", "DODGE");
			return 0;
		}
		const hpBefore = this.hp;
		const immunity =
			presentation.kind === "magic" || presentation.kind === "electric"
				? "magic"
				: presentation.kind === "cold"
					? "frost"
					: presentation.kind === "fire"
						? "fire"
						: presentation.kind === "poison"
							? "poison"
							: presentation.kind === "bleed"
								? "bleed"
								: "physical";
		if (immunities.has(immunity)) return 0;
		const resistKey =
			presentation.kind === "magic" || presentation.kind === "electric"
				? "magicResist"
				: presentation.kind === "cold"
					? "frostResist"
					: presentation.kind === "fire"
						? "fireResist"
						: presentation.kind === "poison"
							? "poisonResist"
							: presentation.kind === "bleed"
								? "bleedResist"
								: "physicalResist";
		let remaining =
			Math.max(0, incomingAmount - perks.defense) *
			(1 - Math.min(0.5, perks[resistKey]));
		let blockReflection = 0;
		const buckler = this.offHand;
		const blockCost = buckler ? bucklerBlockCost(buckler, this.stats) : 0;
		if (
			source &&
			incomingAmount > 0 &&
			this.isSkillOperational("reflectiveSurge") &&
			this.reflectiveSurgeCooldown === 0 &&
			this.rage >= 3
		) {
			this.spendRage(3);
			const level = this.skillLevels.get("reflectiveSurge") ?? 1;
			this.reflectiveSurgeRemaining = reflectiveSurgeDuration(level);
			const derived = derivedStats(this.stats);
			const reduction = Math.min(
				0.6,
				derived.cooldownReduction +
					itemCooldownReduction(this.offHand, this.amulet, this.charm),
			);
			this.reflectiveSurgeCooldownMax = effectiveSkillCooldown(
				"reflectiveSurge",
				this.mainHand,
				this.stats,
				level,
				reduction,
			);
			this.reflectiveSurgeCooldown = this.reflectiveSurgeCooldownMax;
		}
		if (
			buckler?.itemKind === "buckler" &&
			this.isSkillOperational("blocking") &&
			this.blockCooldown === 0 &&
			this.rage >= blockCost
		) {
			const chance = Math.min(
				this.reflectiveSurgeRemaining > 0 ? 0.95 : 1,
				bucklerBlockChance(
					buckler,
					this.stats,
					this.skillLevels.get("blocking") ?? 0,
				) +
					(this.reflectiveSurgeRemaining > 0
						? reflectiveSurgeBlockChanceBonus(
								this.skillLevels.get("reflectiveSurge") ?? 1,
							)
						: 0),
			);
			if (random.next() < chance) {
				this.emitOutcome("block", "BLOCK");
				this.spendRage(blockCost);
				const attackSpeed = this.mainHand
					? weaponAttackSpeed(this.mainHand, this.stats)
					: 1;
				const blockingLevel = this.skillLevels.get("blocking") ?? 1;
				this.blockCooldownMax = Math.max(
					spellCooldownFloor(blockingLevel),
					buckler.reflectionComponents.includes("return")
						? 1 / Math.max(0.01, attackSpeed)
						: 1,
				);
				this.blockCooldown = this.blockCooldownMax;
				const beforeBlock = remaining;
				remaining = Math.max(
					0,
					incomingAmount - Math.min(incomingAmount, this.stats.strength),
				);
				if (this.isSkillOperational("penance"))
					this.restoreMana(
						Math.max(0, beforeBlock - remaining) *
							Math.max(0, this.stats.spirit) *
							manaConversionFraction(this.skillLevels.get("penance") ?? 1),
					);
				if (reflectable && source && buckler.reflectionComponents.length) {
					const power = RARITY_POWER[buckler.rarity];
					let reflected = 0;
					if (buckler.reflectionComponents.includes("flat")) reflected += 1;
					if (buckler.reflectionComponents.includes("strength"))
						reflected += 0.2 * this.stats.strength;
					if (buckler.reflectionComponents.includes("return"))
						reflected += incomingAmount * (0.15 + 0.004 * this.stats.agility);
					blockReflection =
						reflected * power * itemRequirementMultiplier(buckler, this.stats);
				}
			}
		}
		if (reflectable && source) {
			const reflectionEffectiveness =
				buckler?.itemKind === "buckler"
					? itemRequirementMultiplier(buckler, this.stats)
					: 1;
			const passiveReflection = this.isSkillOperational("thorns")
				? incomingAmount * 0.05 * reflectionEffectiveness
				: 0;
			const surgeBonus =
				this.reflectiveSurgeRemaining > 0
					? incomingAmount * 0.01 * reflectionEffectiveness
					: 0;
			const reflected =
				(blockReflection + passiveReflection) *
					(this.reflectiveSurgeRemaining > 0 ? 2 : 1) +
				surgeBonus;
			if (reflected > 0)
				source.receiveDamage(reflected, random, this, false, false, {
					kind: presentation.kind,
				});
		}
		if (source && "build" in source)
			this.lastDamageSourceId = (
				source as Unit & { build: { id: string } }
			).build.id;
		if (invulnerable || this.damageFloorOne)
			this.hp = Math.max(1, this.hp - remaining);
		else this.takeDamage(remaining);
		if (remaining > 0)
			this.emitCombatText(remaining, presentation.kind, critical);
		const damageDealt = Math.max(0, hpBefore - this.hp);
		if (
			critical &&
			damageDealt > 0 &&
			source?.isSkillOperational("manaDrain")
		) {
			const spiritDamage =
				damageDealt *
				spiritWoundsConversionFraction(
					source.skillLevels.get("manaDrain") ?? 1,
				);
			source.restoreMana(spiritDamage);
			if (this.active && spiritDamage > 0)
				this.receiveDamage(spiritDamage, random, source, false, false, {
					kind: "cold",
					critical: false,
				});
		}
		return damageDealt;
	}

	heal(amount: number): void {
		const before = this.hp;
		this.hp = Math.max(0, Math.min(this.maxHp, this.hp + amount));
		const restored = this.hp - before;
		if (restored > 0) this.emitCombatText(restored, "healing", false);
	}
	restoreMana(amount: number): void {
		this.mana = Math.max(
			0,
			Math.min(this.maxMana, this.mana + Math.max(0, amount)),
		);
	}
	restoreRage(amount: number): void {
		this.rage = Math.max(
			0,
			Math.min(this.maxRage, this.rage + Math.max(0, amount)),
		);
	}

	configureStats(
		stats: Stats,
		offHand?: ItemInstance,
		mainHand?: ItemInstance,
		amulet?: ItemInstance,
		charm?: ItemInstance,
	): void {
		this.stats = { ...stats };
		this.offHand = offHand;
		this.mainHand = mainHand;
		this.amulet = amulet;
		this.charm = charm;
		for (const skill of [
			...(mainHand?.skills ?? []),
			...(offHand?.skills ?? []),
			...(amulet?.skills ?? []),
			...(charm?.skills ?? []),
		])
			this.knownSkills.add(skill);
		const derived = derivedStats(stats);
		this.maxHp = derived.maxHp;
		this.hp = derived.maxHp;
		this.maxMana = derived.maxMana;
		this.mana = derived.maxMana;
		this.maxRage = derived.maxRage;
		this.rage = derived.maxRage;
	}

	updateResources(
		deltaSeconds: number,
		random?: RandomSource,
		invulnerable = false,
		regenerateRage = true,
	): void {
		this.damageSlowRemaining = Math.max(
			0,
			this.damageSlowRemaining - deltaSeconds,
		);
		if (this.mana <= 0) this.suspendedUpkeep.add("mana");
		if (this.rage <= 0) this.suspendedUpkeep.add("rage");
		this.blockCooldown = Math.max(0, this.blockCooldown - deltaSeconds);
		this.reflectiveSurgeRemaining = Math.max(
			0,
			this.reflectiveSurgeRemaining - deltaSeconds,
		);
		this.reflectiveSurgeCooldown = Math.max(
			0,
			this.reflectiveSurgeCooldown - deltaSeconds,
		);
		const derived = derivedStats(this.stats);
		let periodicDamage = 0;
		for (const status of this.statuses) {
			status.remaining -= deltaSeconds;
			status.tick = (status.tick ?? 0) + deltaSeconds;
			if (status.tick >= 1) {
				periodicDamage += status.damagePerSecond;
				status.tick -= 1;
				if (random)
					this.receiveDamage(
						status.damagePerSecond,
						random,
						status.source,
						false,
						invulnerable,
						{
							kind:
								status.kind === "poison"
									? "poison"
									: status.kind === "burn"
										? "fire"
										: "bleed",
						},
					);
			}
		}
		this.statuses = this.statuses.filter((status) => status.remaining > 0);
		if (periodicDamage > 0 && !random) this.takeDamage(periodicDamage);
		this.hp = Math.max(
			0,
			Math.min(this.maxHp, this.hp + this.healthRegen * deltaSeconds),
		);
		const manaMultiplier = this.mainHand
			? 1 +
				(this.mainHand.modifiers.manaRegenMultiplier - 1) *
					itemRequirementMultiplier(this.mainHand, this.stats)
			: 1;
		this.mana = Math.max(
			0,
			Math.min(
				this.maxMana,
				this.mana + derived.manaRegen * manaMultiplier * deltaSeconds,
			),
		);
		if (regenerateRage)
			this.rage = Math.max(
				0,
				Math.min(this.maxRage, this.rage + derived.rageRegen * deltaSeconds),
			);
		else this.rage = Math.max(0, Math.min(this.maxRage, this.rage));
		this.updateSkillUpkeep(deltaSeconds);
	}

	private updateSkillUpkeep(deltaSeconds: number): void {
		const equipped = [this.offHand, this.amulet, this.charm];
		const manaReduction = Math.min(
			0.9,
			equipped.reduce(
				(sum, item) =>
					sum +
					(item ? itemResourceCostReduction(item, "mana", this.stats) : 0),
				0,
			),
		);
		for (const resource of ["mana", "rage"] as const) {
			const current = resource === "mana" ? this.mana : this.rage;
			const rate = [...this.knownSkills].reduce((sum, skill) => {
				const upkeep = SKILLS[skill].upkeep;
				if (upkeep?.resource !== resource) return sum;
				return (
					sum +
					skillUpkeepPerSecond(
						skill,
						this.skillLevels.get(skill) ?? 1,
						manaReduction,
					)
				);
			}, 0);
			if (rate <= 0) {
				if (current >= 1) this.suspendedUpkeep.delete(resource);
				continue;
			}
			if (this.suspendedUpkeep.has(resource)) {
				if (current < 1) continue;
				this.suspendedUpkeep.delete(resource);
			}
			const cost = rate * Math.max(0, deltaSeconds);
			const paid =
				resource === "mana" ? this.spendMana(cost) : this.spendRage(cost);
			if (!paid) {
				if (resource === "mana") this.mana = 0;
				else this.rage = 0;
				this.suspendedUpkeep.add(resource);
			}
		}
	}

	get healthRegen(): number {
		const derived = derivedStats(this.stats);
		const equipped = [
			this.mainHand,
			this.offHand,
			this.amulet,
			this.charm,
		].filter(Boolean) as ItemInstance[];
		const vigorousRegen = equipped.reduce((sum, item) => {
			const multiplier =
				(item.modifiers.strengthRegenMultiplier ?? 0) *
				itemRequirementMultiplier(item, this.stats);
			return (
				sum +
				(multiplier > 0
					? (0.01 + multiplier * this.stats.strength) *
						itemRequirementMultiplier(item, this.stats)
					: 0)
			);
		}, 0);
		return (
			(derived.hpRegen + vigorousRegen) * this.healthRegenMultiplier +
			this.healthRegenFlat
		);
	}

	addStatus(status: StatusEffect): void {
		const immunities = equippedImmunities(
			this.stats,
			this.mainHand,
			this.offHand,
			this.amulet,
			this.charm,
		);
		const immunity: ItemImmunity | undefined =
			status.kind === "freeze"
				? "frost"
				: status.kind === "burn"
					? "fire"
					: status.kind === "poison"
						? "poison"
						: status.kind === "bleed"
							? "bleed"
							: undefined;
		if (immunity && immunities.has(immunity)) return;
		if (status.kind === "freeze") this.removeOneStatus("burn");
		if (status.kind === "burn") this.removeOneStatus("freeze");
		this.statuses.push(status);
		if (status.kind === "freeze" && this.freezeStacks === this.freezeThreshold)
			this.velocity = { x: 0, y: 0 };
	}
	removeOneStatus(kind: StatusEffect["kind"]): StatusEffect | undefined {
		const index = this.statuses.findIndex((status) => status.kind === kind);
		return index < 0 ? undefined : this.statuses.splice(index, 1)[0];
	}
	get stunned(): boolean {
		return this.statuses.some((status) => status.kind === "stun");
	}
	get freezeStacks(): number {
		return this.statuses.filter((status) => status.kind === "freeze").length;
	}
	get frostResistance(): number {
		return Math.min(
			1,
			equippedPerks(
				this.stats,
				this.mainHand,
				this.offHand,
				this.amulet,
				this.charm,
			).frostResist,
		);
	}
	get freezeThreshold(): number {
		return Math.round(3 + 12 * this.frostResistance);
	}
	get freezeMovementMultiplier(): number {
		return Math.max(0, 1 - this.freezeStacks / this.freezeThreshold);
	}
	get frozen(): boolean {
		return this.freezeStacks >= this.freezeThreshold;
	}
	private emitCombatText(
		amount: number,
		kind: CombatText["kind"],
		critical: boolean,
	): void {
		this.onCombatText?.({
			position: { ...this.position },
			elevation: this.radius,
			amount,
			kind,
			critical,
			age: 0,
			lifetime: 0.9,
			drift:
				Math.sin(this.position.x * 0.17 + this.position.y * 0.11 + amount) * 9,
		});
	}
	private emitOutcome(kind: "dodge" | "block", label: string): void {
		this.onCombatText?.({
			position: { ...this.position },
			elevation: this.radius,
			amount: 0,
			kind,
			label,
			critical: false,
			age: 0,
			lifetime: 0.9,
			drift: Math.sin(this.position.x * 0.17 + this.position.y * 0.11) * 9,
		});
	}

	steer(
		direction: Vector2,
		acceleration: number,
		maxSpeed: number,
		deltaSeconds: number,
	): void {
		const targetX = direction.x * maxSpeed;
		const targetY = direction.y * maxSpeed;
		const maxChange = acceleration * deltaSeconds;
		this.velocity.x = approach(this.velocity.x, targetX, maxChange);
		this.velocity.y = approach(this.velocity.y, targetY, maxChange);
		const speed = Math.hypot(this.velocity.x, this.velocity.y);
		if (speed > maxSpeed) {
			this.velocity.x = (this.velocity.x / speed) * maxSpeed;
			this.velocity.y = (this.velocity.y / speed) * maxSpeed;
		}
		this.position.x += this.velocity.x * deltaSeconds;
		this.position.y += this.velocity.y * deltaSeconds;
	}

	steerWithFriction(
		direction: Vector2,
		acceleration: number,
		maxSpeed: number,
		deltaSeconds: number,
		friction = acceleration,
	): void {
		const moving = direction.x !== 0 || direction.y !== 0;
		const targetX = direction.x * maxSpeed;
		const targetY = direction.y * maxSpeed;
		const change = (moving ? acceleration : friction) * deltaSeconds;
		this.velocity.x = approach(this.velocity.x, targetX, change);
		this.velocity.y = approach(this.velocity.y, targetY, change);
		this.position.x += this.velocity.x * deltaSeconds;
		this.position.y += this.velocity.y * deltaSeconds;
	}

	slide(deltaSeconds: number): void {
		this.position.x += this.velocity.x * deltaSeconds;
		this.position.y += this.velocity.y * deltaSeconds;
	}

	clampToBounds(width: number, height: number): void {
		this.position.x = clamp(this.position.x, this.radius, width - this.radius);
		this.position.y = clamp(this.position.y, this.radius, height - this.radius);
	}
}

function approach(value: number, target: number, change: number): number {
	return value < target
		? Math.min(target, value + change)
		: Math.max(target, value - change);
}
