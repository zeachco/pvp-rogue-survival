import {
	effectiveSkillCooldown,
	MAX_RAGE,
	manaConversionFraction,
	RAGE_DECAY_PER_SECOND,
	reflectiveSurgeDuration,
	skillUpkeepPerSecond,
	spiritWoundsConversionFraction,
} from "../../common/combat";
import { SKILLS } from "../../common/content";
import type { ItemImmunity, ItemInstance, SkillId } from "../../common/items";
import type { Stats } from "../../common/progression";
import type { RandomSource } from "../../common/random";
import {
	compileUnitState,
	defaultBaseState,
	RapidRegenerationEffect,
	ReflectiveSurgeEffect,
	ThornsEffect,
	UnitEffect,
	type UnitEffectTarget,
	type UnitState,
} from "../../common/unitState";
import type { CombatText, DamageKind, DamagePresentation } from "./CombatText";
import { GameObject } from "./GameObject";
import { clamp, type StatusEffectSnapshot, type Vector2 } from "./types";

export interface StatusEffect extends StatusEffectSnapshot {
	tick?: number;
	source?: Unit;
	effectSequence?: number;
}

export const MANA_OVERFILL_MULTIPLIER = 3;

class StatusUnitEffect extends UnitEffect {
	readonly type: string;
	readonly priorityOrder = 999;

	constructor(private readonly status: StatusEffect) {
		super();
		this.type = status.kind;
		this.applicationSequence = status.effectSequence ?? 0;
		this.remaining = status.remaining;
	}

	handler(
		target: UnitEffectTarget,
		_all: readonly UnitEffect[],
		delta: number,
	): void {
		if (this.status.damagePerSecond <= 0) return;
		this.status.tick = (this.status.tick ?? 0) + delta;
		while (this.status.tick >= 1) {
			target.receiveEffectDamage(
				this.status.damagePerSecond,
				this.status.kind === "burn" ? "fire" : this.status.kind,
				this.status.source,
			);
			this.status.tick -= 1;
		}
	}
}

export abstract class Unit extends GameObject implements UnitEffectTarget {
	position: Vector2;
	velocity: Vector2 = { x: 0, y: 0 };
	hp: number;
	maxHp: number;
	mana = 0;
	maxMana = 0;
	rage = 5;
	maxRage = MAX_RAGE;
	private baseStats: Stats = {
		agility: 0,
		strength: 0,
		spirit: 0,
		intelligence: 0,
	};
	state!: UnitState;
	readonly effects: UnitEffect[] = [];
	private readonly frameEffects: UnitEffect[] = [];
	private compiledEffects = new Set<UnitEffect>();
	private compiledStatuses = new Set<StatusEffect>();
	private nextEffectSequence = 1;
	private effectRandom?: RandomSource;
	private effectInvulnerable = false;
	statuses: StatusEffect[] = [];
	enteredArena = false;
	offHand?: ItemInstance;
	mainHand?: ItemInstance;
	amulet?: ItemInstance;
	charm?: ItemInstance;
	lastDamageSourceId?: string;
	damageFloorOne = false;
	reflectiveSurgeRemaining = 0;
	reflectiveSurgeCooldown = 0;
	reflectiveSurgeCooldownMax = 0;
	reflectiveSurgeAutomatic = true;
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
	immunityRemaining = 0;
	currentWave = 0;
	deathPreventionWaveUsed?: number;
	radialReflect?: (
		reflected: number,
		random: RandomSource,
		kind: DamagePresentation["kind"],
	) => void;

	protected constructor(
		position: Vector2,
		readonly radius: number,
		hp: number,
	) {
		super();
		this.position = { ...position };
		this.hp = hp;
		this.maxHp = hp;
		this.state = defaultBaseState({ baseStats: this.baseStats });
	}

	get stats(): Stats {
		return this.state.attributes;
	}

	compileState(
		deltaSeconds: number,
		random?: RandomSource,
		invulnerable = false,
	): UnitState {
		this.effectRandom = random;
		this.effectInvulnerable = invulnerable;
		this.compiledEffects = new Set(this.effects);
		this.compiledStatuses = new Set(this.statuses);
		const effects = [...this.effects, ...this.frameEffects];
		effects.push(
			...this.statuses.map((status) => new StatusUnitEffect(status)),
		);
		if (this.isSkillOperational("thorns")) effects.push(new ThornsEffect());
		if (this.reflectiveSurgeRemaining > 0)
			effects.push(
				new ReflectiveSurgeEffect(
					this.skillLevels.get("reflectiveSurge") ?? 1,
					this.reflectiveSurgeRemaining,
				),
			);
		if (this.healthRegenMultiplier !== 1 || this.healthRegenFlat !== 0)
			effects.push(
				new RapidRegenerationEffect(
					this.healthRegenMultiplier,
					this.healthRegenFlat,
					Number.POSITIVE_INFINITY,
				),
			);
		this.state = compileUnitState(
			{
				baseStats: this.baseStats,
				mainHand: this.mainHand,
				offHand: this.offHand,
				amulet: this.amulet,
				charm: this.charm,
				blockingLevel: this.skillLevels.get("blocking") ?? 0,
				attractionLevel: this.isSkillOperational("attraction")
					? (this.skillLevels.get("attraction") ?? 1)
					: 0,
				effects,
			},
			this,
			deltaSeconds,
		);
		this.maxHp = this.state.maxHp;
		this.maxMana = this.state.maxMana;
		this.maxRage = this.state.maxRage;
		this.hp = Math.min(this.hp, this.maxHp);
		this.mana = Math.min(this.mana, this.maxMana * MANA_OVERFILL_MULTIPLIER);
		this.rage = Math.min(this.rage, this.maxRage);
		return this.state;
	}

	addEffect(effect: UnitEffect): boolean {
		const existing = this.effects.find(
			(candidate) => candidate.stackKey() === effect.stackKey(),
		);
		if (existing && effect.stackPolicy !== "stack") {
			if (effect.stackPolicy === "reject") return false;
			if (effect.stackPolicy === "refresh") {
				existing.refreshFrom(effect);
				return true;
			}
			this.effects.splice(this.effects.indexOf(existing), 1);
		}
		effect.applicationSequence = this.nextEffectSequence++;
		this.effects.push(effect);
		return true;
	}

	effectRemaining(type: string): number {
		return this.effects
			.filter((effect) => effect.type === type)
			.reduce((maximum, effect) => Math.max(maximum, effect.remaining ?? 0), 0);
	}

	clearFrameEffects(): void {
		this.frameEffects.length = 0;
	}

	addFrameEffect(effect: UnitEffect): boolean {
		if (
			effect.stackPolicy !== "stack" &&
			this.frameEffects.some(
				(candidate) => candidate.stackKey() === effect.stackKey(),
			)
		)
			return false;
		effect.applicationSequence = this.nextEffectSequence++;
		this.frameEffects.push(effect);
		return true;
	}

	receiveEffectDamage(amount: number, kind: string, source?: unknown): number {
		if (!this.effectRandom) {
			const before = this.hp;
			this.takeDamage(amount);
			return Math.max(0, before - this.hp);
		}
		return this.receiveDamage(
			amount,
			this.effectRandom,
			source instanceof Unit ? source : undefined,
			false,
			this.effectInvulnerable,
			{ kind: isDamageKind(kind) ? kind : "physical" },
			false,
		);
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
		const uniqueBlocking =
			skill === "blocking" &&
			this.offHand?.itemKind === "buckler" &&
			this.offHand.rarity === "unique";
		return (
			this.knownSkills.has(skill) &&
			(uniqueBlocking || !upkeep || !this.suspendedUpkeep.has(upkeep.resource))
		);
	}

	activateReflectiveSurge(): boolean {
		if (
			!this.isSkillOperational("reflectiveSurge") ||
			this.reflectiveSurgeCooldown > 0 ||
			!this.spendRage(3)
		)
			return false;
		const level = this.skillLevels.get("reflectiveSurge") ?? 1;
		this.reflectiveSurgeRemaining = reflectiveSurgeDuration(level);
		const reduction = this.state.cooldownReduction;
		this.reflectiveSurgeCooldownMax = effectiveSkillCooldown(
			"reflectiveSurge",
			this.mainHand,
			this.stats,
			level,
			reduction,
		);
		this.reflectiveSurgeCooldown = this.reflectiveSurgeCooldownMax;
		return true;
	}

	receiveDamage(
		amount: number,
		random: RandomSource,
		source?: Unit,
		reflectable = true,
		invulnerable = false,
		presentation: DamagePresentation = { kind: "physical" },
		blockable = true,
	): number {
		if (this.immunityRemaining > 0) return 0;
		this.lastHitDodged = false;
		let critical = presentation.critical ?? false;
		let incomingAmount = amount;
		if (presentation.critical === undefined && source) {
			critical = random.next() < source.state.critChance;
			if (critical) incomingAmount *= source.state.critMultiplier;
		}
		if (reflectable && random.next() < this.state.dodgeChance) {
			this.lastHitDodged = true;
			this.grantDefensiveRage("dodge");
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
		if (this.state.immunities.has(immunity)) return 0;
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
		const resistance =
			resistKey === "magicResist"
				? this.state.resistances.magic
				: resistKey === "frostResist"
					? this.state.resistances.frost
					: resistKey === "fireResist"
						? this.state.resistances.fire
						: resistKey === "poisonResist"
							? this.state.resistances.poison
							: resistKey === "bleedResist"
								? this.state.resistances.bleed
								: this.state.resistances.physical;
		let remaining =
			Math.max(0, incomingAmount - this.state.flatDefense) * (1 - resistance);
		let blockReflection = 0;
		let blocked = false;
		const buckler = this.offHand;
		const katars =
			this.mainHand?.itemKind === "weapon" &&
			this.mainHand.definitionId === "katars";
		const blockCost = this.state.blockCost;
		const uniqueBuckler =
			buckler?.itemKind === "buckler" && buckler.rarity === "unique";
		const blockManaCost = uniqueBuckler ? this.maxMana * 0.01 : 0;
		const activateSurgeAfterHit = Boolean(
			source && incomingAmount > 0 && this.reflectiveSurgeAutomatic,
		);
		if (
			blockable &&
			((buckler?.itemKind === "buckler" &&
				this.isSkillOperational("blocking")) ||
				katars) &&
			this.rage >= blockCost &&
			this.mana >= blockManaCost
		) {
			const chance = Math.min(
				this.state.blockChanceCap,
				this.state.blockChance,
			);
			if (random.next() < chance) {
				blocked = true;
				this.emitOutcome("block", "BLOCK");
				if (uniqueBuckler) this.spendMana(blockManaCost);
				else if (!katars) this.spendRage(blockCost);
				this.grantDefensiveRage("block");
				const beforeBlock = remaining;
				remaining = Math.max(
					0,
					incomingAmount - Math.min(incomingAmount, this.stats.strength),
				);
				if (this.isSkillOperational("penance"))
					this.restoreMana(
						Math.max(
							this.maxMana * 0.01,
							Math.max(0, beforeBlock - remaining) *
								Math.max(0, this.stats.spirit) *
								manaConversionFraction(this.skillLevels.get("penance") ?? 1),
						),
					);
				if (reflectable && source)
					blockReflection =
						this.state.reflection.flat +
						this.state.reflection.strength +
						incomingAmount * this.state.reflection.incomingFraction;
			}
		}
		if (reflectable && source) {
			const reflected =
				blockReflection +
				incomingAmount *
					(this.state.reflection.thornsFraction +
						this.state.reflection.surgeFraction);
			if (reflected > 0) {
				const radial =
					buckler?.itemKind === "buckler" && buckler.rarity === "unique";
				if (radial && this.radialReflect)
					this.radialReflect(reflected, random, presentation.kind);
				else
					source.receiveDamage(reflected, random, this, false, false, {
						kind: presentation.kind,
					});
			}
		}
		if (source && "build" in source)
			this.lastDamageSourceId = (
				source as Unit & { build: { id: string } }
			).build.id;
		remaining *= 1 - voodooDamageReduction(this);
		if (invulnerable || this.damageFloorOne) {
			this.hp = Math.max(1, this.hp - remaining);
		} else if (
			reflectable &&
			this.amulet?.rarity === "unique" &&
			this.hp - remaining <= 0 &&
			this.deathPreventionWaveUsed !== this.currentWave
		) {
			this.hp = 1;
			this.immunityRemaining = 1;
			this.deathPreventionWaveUsed = this.currentWave;
		} else {
			this.takeDamage(remaining);
		}
		if (remaining > 0)
			this.emitCombatText(remaining, presentation.kind, critical);
		const damageDealt = Math.max(0, hpBefore - this.hp);
		if (damageDealt > 0 && !blocked && !this.lastHitDodged)
			this.grantDefensiveRage("damage");
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
			source.restoreMana(spiritDamage, MANA_OVERFILL_MULTIPLIER);
			if (this.active && spiritDamage > 0)
				this.receiveDamage(spiritDamage, random, source, false, false, {
					kind: "cold",
					critical: false,
				});
		}
		if (activateSurgeAfterHit) this.activateReflectiveSurge();
		return damageDealt;
	}

	heal(amount: number): void {
		const before = this.hp;
		this.hp = Math.max(0, Math.min(this.maxHp, this.hp + amount));
		const restored = this.hp - before;
		if (restored > 0) this.emitCombatText(restored, "healing", false);
	}
	restoreMana(amount: number, maximumMultiplier = 1): void {
		this.mana = Math.max(
			this.mana,
			Math.min(
				this.maxMana * Math.max(1, maximumMultiplier),
				this.mana + Math.max(0, amount),
			),
		);
	}
	restoreRage(amount: number): void {
		this.rage = Math.max(
			0,
			Math.min(this.maxRage, this.rage + Math.max(0, amount)),
		);
	}
	grantRage(amount: number): void {
		this.restoreRage(amount);
	}
	protected grantDefensiveRage(kind: "dodge" | "block" | "damage"): void {
		void kind;
	}

	configureStats(
		stats: Stats,
		offHand?: ItemInstance,
		mainHand?: ItemInstance,
		amulet?: ItemInstance,
		charm?: ItemInstance,
	): void {
		const currentRage = this.rage;
		this.baseStats = { ...stats };
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
		this.compileState(0);
		const derived = this.state.derived;
		this.maxHp = derived.maxHp;
		this.hp = derived.maxHp;
		this.maxMana = derived.maxMana;
		this.mana = derived.maxMana;
		this.maxRage = derived.maxRage;
		this.rage = Math.max(0, Math.min(this.maxRage, currentRage));
	}

	updateResources(
		deltaSeconds: number,
		_random?: RandomSource,
		_invulnerable = false,
	): void {
		this.damageSlowRemaining = Math.max(
			0,
			this.damageSlowRemaining - deltaSeconds,
		);
		this.immunityRemaining = Math.max(0, this.immunityRemaining - deltaSeconds);
		if (this.mana <= 0) this.suspendedUpkeep.add("mana");
		if (this.rage <= 0) this.suspendedUpkeep.add("rage");
		this.reflectiveSurgeCooldown = Math.max(
			0,
			this.reflectiveSurgeCooldown - deltaSeconds,
		);
		const derived = this.state.derived;
		this.hp = Math.max(
			0,
			Math.min(this.maxHp, this.hp + this.state.healthRegen * deltaSeconds),
		);
		if (this.mana < this.maxMana)
			this.mana = Math.max(
				0,
				Math.min(this.maxMana, this.mana + this.state.manaRegen * deltaSeconds),
			);
		this.updateRageResource(deltaSeconds, derived.rageRegen);
		this.updateSkillUpkeep(deltaSeconds);
	}

	advanceEffects(deltaSeconds: number): void {
		this.reflectiveSurgeRemaining = Math.max(
			0,
			this.reflectiveSurgeRemaining - deltaSeconds,
		);
		for (const status of this.statuses)
			if (this.compiledStatuses.has(status))
				status.remaining -= Math.max(0, deltaSeconds);
		this.statuses = this.statuses.filter((status) => status.remaining > 0);
		for (let index = this.effects.length - 1; index >= 0; index -= 1)
			if (
				this.compiledEffects.has(this.effects[index]!) &&
				!this.effects[index]!.advance(deltaSeconds)
			)
				this.effects.splice(index, 1);
	}

	protected updateRageResource(
		deltaSeconds: number,
		_regenPerSecond: number,
	): void {
		this.rage = Math.max(
			0,
			Math.min(this.maxRage, this.rage - RAGE_DECAY_PER_SECOND * deltaSeconds),
		);
	}

	private updateSkillUpkeep(deltaSeconds: number): void {
		const manaReduction = this.state.manaCostReduction;
		for (const resource of ["mana", "rage"] as const) {
			const current = resource === "mana" ? this.mana : this.rage;
			const rate = [...this.knownSkills].reduce((sum, skill) => {
				const upkeep = SKILLS[skill].upkeep;
				if (
					upkeep?.resource !== resource ||
					(skill === "blocking" &&
						this.offHand?.itemKind === "buckler" &&
						this.offHand.rarity === "unique")
				)
					return sum;
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
		return this.state.healthRegen;
	}

	addStatus(status: StatusEffect): void {
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
		if (immunity && this.state.immunities.has(immunity)) return;
		if (status.kind === "freeze") this.removeOneStatus("burn");
		if (status.kind === "burn") this.removeOneStatus("freeze");
		status.effectSequence ??= this.nextEffectSequence++;
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
		return this.state.resistances.frost;
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

function isDamageKind(kind: string): kind is DamageKind {
	return [
		"physical",
		"magic",
		"cold",
		"electric",
		"poison",
		"fire",
		"bleed",
	].includes(kind);
}

function voodooDamageReduction(unit: Unit): number {
	return unit.offHand?.itemKind === "relic" &&
		unit.offHand.rarity === "unique" &&
		unit.isSkillOperational("voodoo")
		? 0.2
		: 0;
}
