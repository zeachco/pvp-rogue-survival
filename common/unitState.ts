import { BALANCE, type BalanceConfig } from "./balance";
import {
	attackProfile,
	attractionFindBonus,
	attractionSpeedMultiplier,
	bucklerBlockChance,
	bucklerBlockCost,
	reflectiveSurgeBlockChanceBonus,
	RAGE_DECAY_PER_SECOND,
} from "./combat";
import {
	equippedImmunities,
	equippedPerks,
	itemCooldownReduction,
	itemKillRestoration,
	itemRequirementMultiplier,
	itemResourceCostReduction,
	RARITY_POWER,
	statsWithItemBonuses,
	type ItemImmunity,
	type ItemInstance,
} from "./items";
import {
	derivedStats,
	heroTurnSpeedDegrees,
	type DerivedStats,
	type Stats,
} from "./progression";

export interface UnitEquipment {
	mainHand?: ItemInstance;
	offHand?: ItemInstance;
	amulet?: ItemInstance;
	charm?: ItemInstance;
}

export interface UnitState {
	attributes: Stats;
	derived: DerivedStats;
	attack: ReturnType<typeof attackProfile>;
	critChance: number;
	critMultiplier: number;
	magicAmp: number;
	cooldownReduction: number;
	turnSpeedDegrees: number;
	maxHp: number;
	maxRage: number;
	maxMana: number;
	healthRegen: number;
	manaRegen: number;
	rageRegen: number;
	rageDecay: number;
	defense: number;
	flatDefense: number;
	dodgeChance: number;
	resistances: Record<ItemImmunity, number>;
	immunities: ReadonlySet<ItemImmunity>;
	blockChance: number;
	blockChanceCap: number;
	blockCost: number;
	lifeSteal: number;
	healthOnKill: number;
	manaOnKill: number;
	manaCostReduction: number;
	lifeCostReduction: number;
	bleedChance: number;
	poisonChance: number;
	stunChance: number;
	goldGain: number;
	magicFind: number;
	attractionSpeed: number;
	attractionGoldFind: number;
	attractionMagicFind: number;
	reflection: {
		flat: number;
		strength: number;
		incomingFraction: number;
		thornsFraction: number;
		surgeFraction: number;
		effectiveness: number;
		radial: boolean;
	};
	movementSpeedMultiplier: number;
	attackSpeedMultiplier: number;
}

export type EffectStackPolicy = "stack" | "refresh" | "replace" | "reject";

export interface UnitEffectTarget {
	state: UnitState;
	hp: number;
	mana: number;
	rage: number;
	receiveEffectDamage(amount: number, kind: string, source?: unknown): number;
	heal(amount: number): void;
	addEffect(effect: UnitEffect): boolean;
}

export abstract class UnitEffect {
	abstract readonly type: string;
	abstract readonly priorityOrder: number;
	readonly isStat: boolean = false;
	readonly stackPolicy: EffectStackPolicy = "stack";
	applicationSequence = 0;
	remaining?: number;

	abstract handler(
		target: UnitEffectTarget,
		allEffects: readonly UnitEffect[],
		deltaSeconds: number,
	): void;

	stackKey(): string {
		return this.type;
	}

	refreshFrom(effect: UnitEffect): void {
		if (effect.remaining !== undefined)
			this.remaining = Math.max(this.remaining ?? 0, effect.remaining);
	}

	advance(deltaSeconds: number): boolean {
		if (this.remaining === undefined) return true;
		this.remaining -= Math.max(0, deltaSeconds);
		return this.remaining > 0;
	}

	clone(): UnitEffect {
		const clone = Object.create(Object.getPrototypeOf(this)) as UnitEffect;
		Object.assign(clone, this);
		return clone;
	}
}

export interface UnitStateInput extends UnitEquipment {
	baseStats: Stats;
	attributesAreEffective?: boolean;
	blockingLevel?: number;
	attractionLevel?: number;
	effects?: readonly UnitEffect[];
	balance?: BalanceConfig;
}

export type ProjectedAddon =
	| { kind: "attributes"; stats: Stats }
	| { kind: "equipment"; slot: keyof UnitEquipment; item?: ItemInstance }
	| { kind: "effect"; effect: UnitEffect }
	| { kind: "blockingLevel"; level: number }
	| { kind: "attractionLevel"; level: number };

export function compareUnitEffects(
	left: UnitEffect,
	right: UnitEffect,
): number {
	return (
		left.priorityOrder - right.priorityOrder ||
		left.applicationSequence - right.applicationSequence
	);
}

export function defaultBaseState(input: UnitStateInput): UnitState {
	const equipment = [
		input.mainHand,
		input.offHand,
		input.amulet,
		input.charm,
	] as const;
	const attributes = input.attributesAreEffective
		? { ...input.baseStats }
		: statsWithItemBonuses(input.baseStats, ...equipment);
	const derived = derivedStats(attributes);
	const attack = attackProfile(
		input.mainHand,
		attributes,
		input.balance ?? BALANCE,
	);
	const perks = equippedPerks(attributes, ...equipment);
	const immunities = equippedImmunities(attributes, ...equipment);
	const mainEffectiveness = input.mainHand
		? itemRequirementMultiplier(input.mainHand, attributes)
		: 1;
	const offEffectiveness = input.offHand
		? itemRequirementMultiplier(input.offHand, attributes)
		: 1;
	const buckler =
		input.offHand?.itemKind === "buckler" ? input.offHand : undefined;
	const items = equipment.filter(Boolean) as ItemInstance[];
	const vigorousRegen = items.reduce((sum, item) => {
		const effectiveness = itemRequirementMultiplier(item, attributes);
		const multiplier =
			(item.modifiers.strengthRegenMultiplier ?? 0) * effectiveness;
		return (
			sum +
			(multiplier > 0
				? (0.01 + multiplier * attributes.strength) * effectiveness
				: 0)
		);
	}, 0);
	const lifeSteal = items.reduce((sum, item) => {
		const effectiveness = itemRequirementMultiplier(item, attributes);
		const base = (item.modifiers.lifeStealBase ?? 0) * effectiveness;
		return (
			sum + (base + (base > 0 ? 0.001 * attributes.spirit : 0)) * effectiveness
		);
	}, 0);
	const onKill = itemKillRestoration(attributes, ...equipment);
	const reflectionPower = buckler
		? RARITY_POWER[buckler.rarity] * offEffectiveness
		: 0;
	const attractionLevel = input.attractionLevel ?? 0;
	return {
		attributes,
		derived,
		attack,
		critChance: Math.min(
			1,
			derived.critChance +
				(input.mainHand?.modifiers.critChance ?? 0) * mainEffectiveness,
		),
		critMultiplier: derived.critMultiplier,
		magicAmp:
			derived.magicAmp +
			(input.mainHand?.modifiers.magicAmp ?? 0) * mainEffectiveness,
		cooldownReduction: Math.min(
			0.6,
			derived.cooldownReduction +
				itemCooldownReduction(input.offHand, input.amulet, input.charm),
		),
		turnSpeedDegrees: heroTurnSpeedDegrees(attributes.agility),
		maxHp: derived.maxHp,
		maxRage: derived.maxRage,
		maxMana: derived.maxMana,
		healthRegen: derived.hpRegen + vigorousRegen,
		manaRegen:
			derived.manaRegen *
			(1 +
				((input.mainHand?.modifiers.manaRegenMultiplier ?? 1) - 1) *
					mainEffectiveness),
		rageRegen: derived.rageRegen,
		rageDecay: RAGE_DECAY_PER_SECOND,
		defense: perks.defense + (buckler ? attributes.strength : 0),
		flatDefense: perks.defense,
		dodgeChance: Math.min(
			0.5,
			Math.max(0, attributes.agility) * 0.003 + perks.dodgeChance,
		),
		resistances: {
			physical: Math.min(0.5, perks.physicalResist),
			magic: Math.min(0.5, perks.magicResist),
			fire: Math.min(0.5, perks.fireResist),
			frost: Math.min(1, perks.frostResist),
			poison: Math.min(0.5, perks.poisonResist),
			bleed: Math.min(0.5, perks.bleedResist),
		},
		immunities,
		blockChance: bucklerBlockChance(
			buckler,
			attributes,
			input.blockingLevel ?? 0,
		),
		blockChanceCap: 1,
		blockCost: buckler ? bucklerBlockCost(buckler, attributes) : 0,
		lifeSteal,
		healthOnKill: onKill.health,
		manaOnKill: onKill.mana,
		manaCostReduction: Math.min(
			0.9,
			[input.offHand, input.amulet, input.charm].reduce(
				(sum, item) =>
					sum + itemResourceCostReduction(item, "mana", attributes),
				0,
			),
		),
		lifeCostReduction: Math.min(
			0.9,
			[input.offHand, input.amulet, input.charm].reduce(
				(sum, item) =>
					sum + itemResourceCostReduction(item, "life", attributes),
				0,
			),
		),
		bleedChance:
			(input.mainHand?.modifiers.bleedChance ?? 0) * mainEffectiveness,
		poisonChance:
			(input.mainHand?.modifiers.poisonChance ?? 0) * mainEffectiveness,
		stunChance: (input.mainHand?.modifiers.stunChance ?? 0) * mainEffectiveness,
		goldGain: (buckler?.modifiers.goldGain ?? 0) * offEffectiveness,
		magicFind: Math.min(
			5,
			(buckler?.modifiers.magicFind ?? 0) +
				attractionFindBonus(attractionLevel),
		),
		attractionSpeed:
			Math.max(
				(input.mainHand?.attractionSpeed ?? 0) * mainEffectiveness,
				(input.offHand?.attractionSpeed ?? 0) * offEffectiveness,
			) * attractionSpeedMultiplier(attractionLevel),
		attractionGoldFind: attractionFindBonus(attractionLevel),
		attractionMagicFind: attractionFindBonus(attractionLevel),
		reflection: {
			flat: buckler?.reflectionComponents.includes("flat")
				? reflectionPower
				: 0,
			strength: buckler?.reflectionComponents.includes("strength")
				? 0.2 * attributes.strength * reflectionPower
				: 0,
			incomingFraction: buckler?.reflectionComponents.includes("return")
				? (0.15 + 0.004 * attributes.agility) * reflectionPower
				: 0,
			thornsFraction: 0,
			surgeFraction: 0,
			effectiveness: buckler ? offEffectiveness : 1,
			radial: buckler?.rarity === "unique",
		},
		movementSpeedMultiplier: 1,
		attackSpeedMultiplier: 1,
	};
}

export function compileUnitState(
	input: UnitStateInput,
	target: UnitEffectTarget,
	deltaSeconds: number,
	options: { statEffectsOnly?: boolean } = {},
): UnitState {
	target.state = defaultBaseState(input);
	const effects = (input.effects ?? [])
		.filter((effect) => !options.statEffectsOnly || effect.isStat)
		.map((effect) => effect)
		.sort(compareUnitEffects);
	for (const effect of effects)
		effect.handler(target, effects, Math.max(0, deltaSeconds));
	return target.state;
}

class ProjectionTarget implements UnitEffectTarget {
	state: UnitState;
	hp: number;
	mana: number;
	rage: number;
	readonly effects: UnitEffect[];

	constructor(state: UnitState, effects: readonly UnitEffect[]) {
		this.state = state;
		this.hp = state.maxHp;
		this.mana = state.maxMana;
		this.rage = state.maxRage;
		this.effects = effects.map((effect) => effect.clone());
	}

	receiveEffectDamage(amount: number): number {
		const dealt = Math.min(this.hp, Math.max(0, amount));
		this.hp -= dealt;
		return dealt;
	}

	heal(amount: number): void {
		this.hp = Math.min(this.state.maxHp, this.hp + Math.max(0, amount));
	}

	addEffect(effect: UnitEffect): boolean {
		this.effects.push(effect.clone());
		return true;
	}
}

export function projectUnitState(
	input: UnitStateInput,
	addons: readonly ProjectedAddon[] = [],
): UnitState {
	const projected: UnitStateInput = {
		...input,
		baseStats: { ...input.baseStats },
		effects: [...(input.effects ?? [])].map((effect) => effect.clone()),
	};
	for (const addon of addons) {
		if (addon.kind === "attributes") projected.baseStats = { ...addon.stats };
		else if (addon.kind === "equipment") projected[addon.slot] = addon.item;
		else if (addon.kind === "effect")
			projected.effects = [...(projected.effects ?? []), addon.effect.clone()];
		else if (addon.kind === "blockingLevel")
			projected.blockingLevel = addon.level;
		else projected.attractionLevel = addon.level;
	}
	const initial = defaultBaseState(projected);
	const target = new ProjectionTarget(initial, projected.effects ?? []);
	return compileUnitState(
		{ ...projected, effects: target.effects },
		target,
		1,
		{ statEffectsOnly: true },
	);
}

export class ThornsEffect extends UnitEffect {
	readonly type = "thorns";
	readonly priorityOrder = 300;
	override readonly isStat = true;
	override readonly stackPolicy = "reject" as const;

	handler(target: UnitEffectTarget): void {
		target.state.reflection.thornsFraction = Math.max(
			target.state.reflection.thornsFraction,
			0.05 * target.state.reflection.effectiveness,
		);
	}
}

export class ReflectiveSurgeEffect extends UnitEffect {
	readonly type = "reflectiveSurge";
	readonly priorityOrder = 400;
	override readonly isStat = true;
	override readonly stackPolicy = "refresh" as const;

	constructor(
		readonly level: number,
		remaining: number,
	) {
		super();
		this.remaining = remaining;
	}

	handler(target: UnitEffectTarget): void {
		const reflection = target.state.reflection;
		reflection.flat *= 2;
		reflection.strength *= 2;
		reflection.incomingFraction *= 2;
		reflection.thornsFraction *= 2;
		reflection.surgeFraction += 0.01 * reflection.effectiveness;
		target.state.blockChanceCap = 0.95;
		target.state.blockChance = Math.min(
			0.95,
			target.state.blockChance + reflectiveSurgeBlockChanceBonus(this.level),
		);
	}
}

export class RapidRegenerationEffect extends UnitEffect {
	readonly type = "rapidRegen";
	readonly priorityOrder = 410;
	override readonly isStat = true;
	override readonly stackPolicy = "refresh" as const;

	constructor(
		readonly multiplier: number,
		readonly flat: number,
		remaining: number,
	) {
		super();
		this.remaining = remaining;
	}

	handler(target: UnitEffectTarget): void {
		target.state.healthRegen =
			target.state.healthRegen * this.multiplier + this.flat;
	}
}

export class MovementMultiplierEffect extends UnitEffect {
	readonly priorityOrder = 350;
	override readonly isStat = true;
	override readonly stackPolicy = "reject" as const;

	constructor(
		readonly type: string,
		private readonly multiplier: number,
	) {
		super();
	}

	handler(target: UnitEffectTarget): void {
		target.state.movementSpeedMultiplier *= this.multiplier;
	}
}

export class AttackSpeedMultiplierEffect extends UnitEffect {
	readonly priorityOrder = 351;
	override readonly isStat = true;
	override readonly stackPolicy = "reject" as const;

	constructor(
		readonly type: string,
		private readonly multiplier: number,
	) {
		super();
	}

	handler(target: UnitEffectTarget): void {
		target.state.attackSpeedMultiplier *= this.multiplier;
	}
}
