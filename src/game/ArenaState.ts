import type { UnitBuild } from "../../common/protocol";
import type { Vector2 } from "./types";
import type { AttackArea } from "./AttackArea";
import type { Creep } from "./Creep";
import type { ItemDrop } from "./ItemDrop";
import type { Projectile } from "./Projectile";
import type { CombatText } from "./CombatText";
import type { SpellEffect } from "./SpellEffect";
import type { GroundSwamp } from "./GroundSwamp";
import type { AnimatedCharacterDeath } from "./render/AnimatedCharacter";

export interface QueuedSpawn {
	build: UnitBuild;
	spawnAt: number;
}
export type ArenaEvent =
	| { type: "creepDefeated"; unitId: string }
	| { type: "requestWave" }
	| { type: "heroDefeated" };

export class ArenaState {
	readonly creeps: Creep[] = [];
	readonly attacks: AttackArea[] = [];
	readonly projectiles: Projectile[] = [];
	readonly drops: ItemDrop[] = [];
	readonly pendingPickups = new Set<string>();
	readonly blockedPickups = new Set<string>();
	readonly defeatedPositions = new Map<string, Vector2>();
	readonly events: ArenaEvent[] = [];
	readonly combatTexts: CombatText[] = [];
	readonly spellEffects: SpellEffect[] = [];
	readonly swamps: GroundSwamp[] = [];
	readonly characterDeaths: AnimatedCharacterDeath[] = [];
	waveQueue: QueuedSpawn[] = [];

	clear(): void {
		this.creeps.length = 0;
		this.attacks.length = 0;
		this.projectiles.length = 0;
		this.drops.length = 0;
		this.pendingPickups.clear();
		this.blockedPickups.clear();
		this.defeatedPositions.clear();
		this.waveQueue.length = 0;
		this.events.length = 0;
		this.combatTexts.length = 0;
		this.spellEffects.length = 0;
		this.swamps.length = 0;
		this.characterDeaths.length = 0;
	}
	addCombatText(text: CombatText): void {
		this.combatTexts.push(text);
	}
	updateCombatTexts(deltaSeconds: number): void {
		for (const text of this.combatTexts) text.age += deltaSeconds;
		for (let index = this.combatTexts.length - 1; index >= 0; index -= 1)
			if (this.combatTexts[index].age >= this.combatTexts[index].lifetime)
				this.combatTexts.splice(index, 1);
	}
	drainEvents(): ArenaEvent[] {
		return this.events.splice(0);
	}
}
