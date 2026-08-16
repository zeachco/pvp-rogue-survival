import { extractableSkills, extractionCost } from "../../common/inventory";
import { MAX_SKILL_LEVEL } from "../../common/combat";
import { itemStackKey } from "../../common/items";
import type { InventoryTile, PlayerProgress } from "../../common/protocol";

export type ExtractButtonStatus =
	| "hidden"
	| "equipped-only"
	| "max-level"
	| "needs-gold"
	| "available";

export function extractionLearnsNewSkill(
	tile: InventoryTile,
	progress: PlayerProgress,
): boolean {
	return (
		tile.item.rarity === "epic" &&
		extractableSkills(tile.item).some(
			(skill) => !progress.learnedSkills.includes(skill),
		)
	);
}

export function extractButtonStatus(
	tile: InventoryTile,
	progress: PlayerProgress,
): ExtractButtonStatus {
	const skills = extractableSkills(tile.item);
	if (!skills.length) return "hidden";
	if (
		skills.some(
			(skill) => (progress.learnedSkillLevels[skill] ?? 0) >= MAX_SKILL_LEVEL,
		)
	)
		return "max-level";
	const equippedCopies =
		Number(itemStackKey(progress.mainHand) === tile.key) +
		Number(
			Boolean(progress.offHand && itemStackKey(progress.offHand) === tile.key),
		) +
		Number(
			Boolean(progress.amulet && itemStackKey(progress.amulet) === tile.key),
		) +
		Number(
			Boolean(progress.charm && itemStackKey(progress.charm) === tile.key),
		);
	if (tile.quantity <= equippedCopies) return "equipped-only";
	return progress.gold < extractionCost(progress, skills)
		? "needs-gold"
		: "available";
}
