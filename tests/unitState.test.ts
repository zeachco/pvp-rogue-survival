import { describe, expect, test } from "bun:test";
import { generateItem } from "../common/items";
import { ZERO_STATS } from "../common/progression";
import {
	compileUnitState,
	defaultBaseState,
	projectUnitState,
	UnitEffect,
	type UnitEffectTarget,
	type UnitState,
} from "../common/unitState";
import { Hero } from "../src/game/Hero";

class TestTarget implements UnitEffectTarget {
	state: UnitState = defaultBaseState({ baseStats: ZERO_STATS });
	hp = 10;
	mana = 5;
	rage = 5;
	readonly effects: UnitEffect[] = [];

	receiveEffectDamage(amount: number): number {
		const dealt = Math.min(this.hp, Math.max(0, amount));
		this.hp -= dealt;
		return dealt;
	}

	heal(amount: number): void {
		this.hp += Math.max(0, amount);
	}

	addEffect(effect: UnitEffect): boolean {
		this.effects.push(effect);
		return true;
	}
}

class OrderedEffect extends UnitEffect {
	readonly type: string;
	readonly isStat = true;

	constructor(
		type: string,
		readonly priorityOrder: number,
		private readonly apply: (target: UnitEffectTarget) => void,
	) {
		super();
		this.type = type;
	}

	handler(target: UnitEffectTarget): void {
		this.apply(target);
	}
}

describe("unit state compiler", () => {
	test("projects passive block chance without a buckler", () => {
		const state = projectUnitState({
			baseStats: ZERO_STATS,
			blockingLevel: 6,
		});
		expect(state.blockChance).toBeCloseTo(0.03);
	});

	test("projects level-and-Agility block chance from Katars", () => {
		const katars = {
			...generateItem(20, "epic", 103, { allowedClasses: ["katars"] }),
			requirements: {},
		};
		const state = projectUnitState({
			baseStats: { ...ZERO_STATS, agility: 50 },
			mainHand: katars,
		});
		expect(state.blockChance).toBeCloseTo(0.1);
	});

	test("applies priorities first and application sequence for ties", () => {
		const target = new TestTarget();
		const multiply = new OrderedEffect("multiply", 20, (unit) => {
			unit.state.healthRegen *= 3;
		});
		multiply.applicationSequence = 1;
		const firstTie = new OrderedEffect("first-tie", 30, (unit) => {
			unit.state.healthRegen += 4;
		});
		firstTie.applicationSequence = 1;
		const secondTie = new OrderedEffect("second-tie", 30, (unit) => {
			unit.state.healthRegen *= 2;
		});
		secondTie.applicationSequence = 2;
		const set = new OrderedEffect("set", 10, (unit) => {
			unit.state.healthRegen = 2;
		});
		const state = compileUnitState(
			{
				baseStats: ZERO_STATS,
				effects: [secondTie, multiply, firstTie, set],
			},
			target,
			1 / 60,
		);
		expect(state.healthRegen).toBe(20);
	});

	test("captures the effect list so handler additions wait for another compile", () => {
		const target = new TestTarget();
		const late = new OrderedEffect("late", 2, (unit) => {
			unit.state.healthRegen += 10;
		});
		const adding = new OrderedEffect("adding", 1, (unit) => {
			unit.addEffect(late);
		});
		const first = compileUnitState(
			{ baseStats: ZERO_STATS, effects: [adding] },
			target,
			1 / 60,
		);
		expect(first.healthRegen).toBe(0.005);
		const second = compileUnitState(
			{ baseStats: ZERO_STATS, effects: [adding, ...target.effects] },
			target,
			1 / 60,
		);
		expect(second.healthRegen).toBe(10.005);
	});

	test("projects stat effects with a one-second sandbox and ignores other effects", () => {
		const stat = new OrderedEffect("stat", 1, (unit) => {
			unit.state.healthRegen += 2;
			unit.receiveEffectDamage(4, "poison");
		});
		const damageOnly = new (class extends OrderedEffect {
			override readonly isStat = false;
		})("damage", 2, (unit) => {
			unit.state.healthRegen += 100;
		});
		const projected = projectUnitState({
			baseStats: ZERO_STATS,
			effects: [damageOnly, stat],
		});
		expect(projected.healthRegen).toBe(2.005);
	});

	test("lets each effect own refresh and rejection semantics", () => {
		class RefreshEffect extends OrderedEffect {
			override readonly stackPolicy = "refresh" as const;
			constructor(remaining: number) {
				super("refresh", 1, () => {});
				this.remaining = remaining;
			}
		}
		class RejectEffect extends OrderedEffect {
			override readonly stackPolicy = "reject" as const;
			constructor() {
				super("reject", 2, () => {});
			}
		}
		const hero = new Hero({ x: 0, y: 0 });
		expect(hero.addEffect(new RefreshEffect(2))).toBeTrue();
		expect(hero.addEffect(new RefreshEffect(5))).toBeTrue();
		expect(hero.effects[0]?.remaining).toBe(5);
		expect(hero.addEffect(new RejectEffect())).toBeTrue();
		expect(hero.addEffect(new RejectEffect())).toBeFalse();
		expect(hero.effects).toHaveLength(2);
	});
});
