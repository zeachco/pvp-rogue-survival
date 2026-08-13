import { extractableSkills, extractionCost } from "../../common/inventory";
import { itemStackKey } from "../../common/items";
import type { InventoryTile, PlayerProgress } from "../../common/protocol";

export type ExtractButtonStatus =
	| "hidden"
	| "equipped-only"
	| "unlearned-skill"
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
	if (
		tile.item.rarity !== "epic" &&
		tile.item.rarity !== "unique" &&
		skills.some((skill) => !progress.learnedSkills.includes(skill))
	)
		return "unlearned-skill";
	return progress.gold < extractionCost(progress, skills)
		? "needs-gold"
		: "available";
}
