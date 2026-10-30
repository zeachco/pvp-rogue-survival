import { cappedSkillLevel, MAX_SKILL_LEVEL } from "../../common/combat";
import type { SkillId } from "../../common/items";
import type { SpellSlot } from "./types";

export function spellTooltipLevels(
	level: number,
	maxLearnedLevel: number,
): Array<{ heading: string; level: number }> {
	const current = Math.max(0, Math.min(MAX_SKILL_LEVEL, level));
	const maxLearned = Math.max(0, Math.min(MAX_SKILL_LEVEL, maxLearnedLevel));
	return [
		{ heading: "Current level", level: current },
		{ heading: "Next level", level: Math.min(MAX_SKILL_LEVEL, current + 1) },
		{ heading: "Max learned", level: maxLearned },
	];
}
export function extractedLearnedLevel(currentLearnedLevel: number): number {
	return cappedSkillLevel(currentLearnedLevel + 1);
}
export function spellCatalogResourceOrder(
	resource: SpellSlot["resource"],
): number {
	return { life: 0, rage: 1, mana: 2 }[resource];
}
export function spellRailSlots(spells: SpellSlot[]): SpellSlot[] {
	const activeSpells = spells
		.filter((spell) => spell.active && !spell.passive)
		.sort((a, b) => (b.shortcut ?? 0) - (a.shortcut ?? 0));
	const passiveSpells = spells
		.filter((spell) => spell.passive && spell.active)
		.sort(
			(a, b) =>
				Number(b.procChancesOnAttacks !== undefined) -
					Number(a.procChancesOnAttacks !== undefined) ||
				a.label.localeCompare(b.label),
		);
	return [...passiveSpells, ...activeSpells];
}
export function spellSlotKey(spell: SpellSlot): string {
	return `${spell.id}:${spell.procChancesOnAttacks === undefined ? "ordinary" : "weapon-proc"}`;
}
export function spellCatalogSlotsById(
	spells: SpellSlot[],
): Map<SkillId, SpellSlot> {
	const available = new Map<SkillId, SpellSlot>();
	for (const spell of spells) {
		const current = available.get(spell.id);
		if (!current || (current.passive && !spell.passive))
			available.set(spell.id, spell);
	}
	return available;
}
export type SpellCatalogFilter =
	| "learned"
	| "equipped"
	| "actives"
	| "passives"
	| "unavailable";
export function defaultSpellCatalogFilters(): Set<SpellCatalogFilter> {
	return new Set(["learned", "actives"]);
}
export const SPELL_CATALOG_FILTER_GROUPS: ReadonlyArray<
	ReadonlyArray<readonly [SpellCatalogFilter, string]>
> = [
	[
		["learned", "Learned"],
		["equipped", "Equipped"],
		["unavailable", "Unavailable"],
	],
	[
		["actives", "Actives"],
		["passives", "Passives"],
	],
];
export function spellCatalogFilterMatches(
	states: Readonly<Record<SpellCatalogFilter, boolean>>,
	filters: ReadonlySet<SpellCatalogFilter>,
	search = "",
	searchableText = "",
): boolean {
	const query = search.trim().toLocaleLowerCase();
	const [statusFilters, typeFilters] = SPELL_CATALOG_FILTER_GROUPS.map(
		(group) =>
			group.map(([filter]) => filter).filter((filter) => filters.has(filter)),
	);
	return (
		(statusFilters.length === 0 ||
			statusFilters.some((filter) => states[filter])) &&
		(typeFilters.length === 0 ||
			typeFilters.some((filter) => states[filter])) &&
		(!query || searchableText.toLocaleLowerCase().includes(query))
	);
}
export function spellResourceLabel(resource: SpellSlot["resource"]): string {
	return resource === "life" ? "HP" : resource === "rage" ? "Rage" : "Mana";
}
