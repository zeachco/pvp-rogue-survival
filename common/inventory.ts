import {
	itemStackKey,
	levelUpItem,
	MAX_ITEM_LEVEL,
	type ItemInstance,
	type Rarity,
	type SkillId,
} from "./items";
import type { InventoryTile, PlayerProgress } from "./protocol";
import { MAX_SKILL_LEVEL } from "./combat";

export interface InventoryResult {
	changed: boolean;
	reason: string;
	dropped?: ItemInstance[];
	sent?: ItemInstance;
	created?: ItemInstance;
}
export const sellYield = (item: ItemInstance): number => item.sellValue * 10;
export const SCRAP_PROMOTION_COST = 100;
export interface ScrapPromotionResult {
	changed: boolean;
	promotions: number;
	reason: string;
}
export function upgradeCosts(item: ItemInstance): {
	gold: number;
	scraps: number;
} {
	const attributePoints = Object.values(item.statBonuses).reduce(
		(sum, value) => sum + Math.max(0, value ?? 0),
		0,
	);
	const factor = 1 + 0.1 * attributePoints;
	return {
		gold: Math.ceil(item.sellValue * 1.5 * factor),
		scraps: Math.ceil(2 * (item.level + 1) * factor),
	};
}
export const inventoryCapacity = (level: number): number =>
	10 + Math.round(level / 10);
export const occupiedInventorySlots = (progress: PlayerProgress): number =>
	progress.inventoryTiles.filter((tile) => tile.quantity > 0).length;
export function removeEmptyInventoryTiles(progress: PlayerProgress): void {
	progress.inventoryTiles = progress.inventoryTiles.filter(
		(tile) => tile.quantity > 0 || isEquippedTile(progress, tile),
	);
}
export function dropInventoryOverflow(
	progress: PlayerProgress,
): ItemInstance[] {
	const dropped: ItemInstance[] = [];
	for (
		let index = progress.inventoryTiles.length - 1;
		occupiedInventorySlots(progress) > inventoryCapacity(progress.level) &&
		index >= 0;
		index -= 1
	) {
		const tile = progress.inventoryTiles[index];
		if (isEquippedTile(progress, tile)) continue;
		for (let copy = 0; copy < tile.quantity; copy += 1)
			dropped.push({ ...tile.item, id: `${tile.item.id}-overflow-${copy}` });
		progress.inventoryTiles.splice(index, 1);
	}
	return dropped;
}

export function collectIntoInventory(
	progress: PlayerProgress,
	item: ItemInstance,
	nextId: () => string,
	nextSeed: () => number,
): InventoryResult {
	let tile = progress.inventoryTiles.find(
		(candidate) => candidate.key === itemStackKey(item),
	);
	if (!tile) {
		if (occupiedInventorySlots(progress) >= inventoryCapacity(progress.level))
			return { changed: false, reason: "Inventory slots are full." };
		tile = { id: nextId(), key: itemStackKey(item), item, quantity: 0 };
		progress.inventoryTiles.push(tile);
	}
	if (
		tile.quantity === 0 &&
		occupiedInventorySlots(progress) >= inventoryCapacity(progress.level)
	)
		return { changed: false, reason: "Inventory slots are full." };
	tile.quantity += 1;
	void nextSeed;
	return { changed: true, reason: `Stored ${item.name}.` };
}

export function equipFromInventory(
	progress: PlayerProgress,
	tileId: string,
): InventoryResult {
	const tile = findTile(progress, tileId);
	if (!tile || tile.quantity <= 0) return missing();
	const item = tile.item;
	if (progress.charm && itemStackKey(progress.charm) === tile.key) {
		progress.charm = undefined;
		return { changed: true, reason: `Unequipped ${item.name}.` };
	}
	if (progress.amulet && itemStackKey(progress.amulet) === tile.key) {
		progress.amulet = undefined;
		return { changed: true, reason: `Unequipped ${item.name}.` };
	}
	if (progress.offHand && itemStackKey(progress.offHand) === tile.key) {
		progress.offHand = undefined;
		return { changed: true, reason: `Unequipped ${item.name}.` };
	}
	if (progress.mainHand && itemStackKey(progress.mainHand) === tile.key) {
		progress.mainHand = undefined;
		return { changed: true, reason: `Unequipped ${item.name}.` };
	}
	if (
		item.itemKind !== "weapon" &&
		item.itemKind !== "amulet" &&
		item.itemKind !== "charm" &&
		progress.mainHand?.hands === 2
	)
		return {
			changed: false,
			reason: "A two-handed weapon cannot use an offhand item.",
		};
	const displaced: ItemInstance[] = [];
	if (item.itemKind === "charm") {
		if (progress.charm) displaced.push(progress.charm);
	} else if (item.itemKind === "amulet") {
		if (progress.amulet) displaced.push(progress.amulet);
	} else if (item.itemKind !== "weapon") {
		if (progress.offHand) displaced.push(progress.offHand);
	} else {
		if (progress.mainHand) displaced.push(progress.mainHand);
		if (item.hands === 2 && progress.offHand) displaced.push(progress.offHand);
	}
	const missingItems = displaced.filter(
		(old, index) =>
			displaced.findIndex(
				(candidate) => itemStackKey(candidate) === itemStackKey(old),
			) === index &&
			!progress.inventoryTiles.some(
				(candidate) =>
					candidate.quantity > 0 && candidate.key === itemStackKey(old),
			),
	);
	if (
		occupiedInventorySlots(progress) + missingItems.length >
		inventoryCapacity(progress.level)
	)
		return {
			changed: false,
			reason:
				"No inventory slot is available to retain the currently equipped item.",
		};
	for (const old of missingItems) storeExisting(progress, old);
	if (item.itemKind === "charm")
		progress.charm = { ...item, id: `${item.id}-equipped` };
	else if (item.itemKind === "amulet")
		progress.amulet = { ...item, id: `${item.id}-equipped` };
	else if (item.itemKind !== "weapon")
		progress.offHand = { ...item, id: `${item.id}-equipped` };
	else {
		progress.mainHand = { ...item, id: `${item.id}-equipped` };
		if (progress.mainHand.hands === 2) progress.offHand = undefined;
	}
	return { changed: true, reason: `Equipped ${item.name}.` };
}

export function sellFromInventory(
	progress: PlayerProgress,
	tileId: string,
): InventoryResult {
	const tile = availableTile(progress, tileId);
	if (!tile) return missing();
	const gold = sellYield(tile.item);
	tile.quantity -= 1;
	progress.gold += gold;
	removeEmptyInventoryTiles(progress);
	return { changed: true, reason: `Sold ${tile.item.name} for ${gold} gold.` };
}
export function purgeFromInventory(
	progress: PlayerProgress,
	tileId: string,
): InventoryResult {
	const tile = availableTile(progress, tileId);
	if (!tile) return missing();
	tile.quantity -= 1;
	const amount = purgeYield(tile.item);
	progress.scraps[tile.item.rarity] += amount;
	removeEmptyInventoryTiles(progress);
	return {
		changed: true,
		reason: `Purged ${tile.item.name} for ${amount} ${tile.item.rarity} scrap.`,
	};
}
export function sendFromInventory(
	progress: PlayerProgress,
	tileId: string,
): InventoryResult {
	const tile = availableTile(progress, tileId);
	if (!tile) return missing();
	tile.quantity -= 1;
	const result = {
		changed: true,
		reason: `Queued ${tile.item.name} for the enemy realm.`,
		sent: { ...tile.item, id: `${tile.item.id}-sent` },
	};
	removeEmptyInventoryTiles(progress);
	return result;
}

export function upgradeFromInventory(
	progress: PlayerProgress,
	tileId: string,
	nextId: () => string,
	nextSeed: () => number,
): InventoryResult {
	const tile = findTile(progress, tileId);
	if (!tile || tile.quantity <= 0) return missing();
	if (tile.item.rarity === "epic" && tile.item.level >= MAX_ITEM_LEVEL.epic)
		return {
			changed: false,
			reason: "Epic equipment is already at the maximum level.",
		};
	const { gold, scraps } = upgradeCosts(tile.item);
	if (progress.gold < gold || progress.scraps[tile.item.rarity] < scraps)
		return {
			changed: false,
			reason: `Requires ${gold} gold and ${scraps} ${tile.item.rarity} scraps.`,
		};
	const created = levelUpItem(tile.item, nextSeed());
	const existing = progress.inventoryTiles.find(
		(candidate) => candidate.key === itemStackKey(created),
	);
	const outputOccupiesSlot = !existing || existing.quantity === 0;
	const sourceFreesSlot = tile.quantity === 1;
	if (
		occupiedInventorySlots(progress) -
			Number(sourceFreesSlot) +
			Number(outputOccupiesSlot) >
		inventoryCapacity(progress.level)
	)
		return {
			changed: false,
			reason: "No inventory slot is available for the upgraded item.",
		};
	const upgradesEquippedCopy = tile.quantity <= equippedCopies(progress, tile);
	const upgradesMainHand =
		upgradesEquippedCopy &&
		Boolean(progress.mainHand && itemStackKey(progress.mainHand) === tile.key);
	const upgradesOffHand =
		upgradesEquippedCopy &&
		Boolean(progress.offHand && itemStackKey(progress.offHand) === tile.key);
	const upgradesAmulet =
		upgradesEquippedCopy &&
		Boolean(progress.amulet && itemStackKey(progress.amulet) === tile.key);
	const upgradesCharm =
		upgradesEquippedCopy &&
		Boolean(progress.charm && itemStackKey(progress.charm) === tile.key);
	tile.quantity -= 1;
	progress.gold -= gold;
	progress.scraps[tile.item.rarity] -= scraps;
	if (existing) existing.quantity += 1;
	else
		progress.inventoryTiles.push({
			id: nextId(),
			key: itemStackKey(created),
			item: created,
			quantity: 1,
		});
	if (upgradesMainHand)
		progress.mainHand = { ...created, id: `${created.id}-equipped` };
	if (upgradesOffHand)
		progress.offHand = { ...created, id: `${created.id}-equipped` };
	if (upgradesAmulet)
		progress.amulet = { ...created, id: `${created.id}-equipped` };
	if (upgradesCharm)
		progress.charm = { ...created, id: `${created.id}-equipped` };
	removeEmptyInventoryTiles(progress);
	return {
		changed: true,
		reason: `Upgraded ${tile.item.name} to level ${created.level}.`,
		created,
	};
}

export function extractFromInventory(
	progress: PlayerProgress,
	tileId: string,
): InventoryResult {
	const tile = availableTile(progress, tileId);
	if (!tile) return missing();
	const carriedSkills = extractableSkills(tile.item);
	if (!carriedSkills.length)
		return { changed: false, reason: "That item has no extractable skill." };
	const universal = tile.item.rarity === "epic";
	const skills = universal
		? carriedSkills
		: carriedSkills.filter((skill) => progress.learnedSkills.includes(skill));
	if (!universal && skills.length !== carriedSkills.length)
		return {
			changed: false,
			reason: `${carriedSkills.filter((skill) => !progress.learnedSkills.includes(skill)).join(", ")} must first be learned.`,
		};
	const cost = extractionCost(progress, skills);
	if (progress.gold < cost)
		return { changed: false, reason: `Extracting costs ${cost} gold.` };
	progress.gold -= cost;
	tile.quantity -= 1;
	for (const skill of skills) learnSkill(progress, skill, universal);
	removeEmptyInventoryTiles(progress);
	return {
		changed: true,
		reason: `Extracted ${skills.join(", ")} for ${cost} gold${universal ? "; available with any weapon" : ""}.`,
	};
}

export function extractableSkills(item: ItemInstance): SkillId[] {
	return [...item.skills];
}
export function extractionCost(
	progress: PlayerProgress,
	skills: SkillId[],
): number {
	return skills.reduce(
		(total, skill) =>
			total +
			10 *
				(progress.learnedSkillLevels[skill] ??
					(progress.learnedSkills.includes(skill) ? 1 : 0)),
		0,
	);
}
export function promoteScraps(
	scraps: Record<Rarity, number>,
	target: Rarity,
	bulk = false,
): ScrapPromotionResult {
	const rarities: Rarity[] = ["common", "uncommon", "rare", "epic"];
	const source = rarities[rarities.indexOf(target) - 1];
	if (!source)
		return {
			changed: false,
			promotions: 0,
			reason: "Common scrap cannot be promoted.",
		};
	const available = Math.floor(scraps[source] / SCRAP_PROMOTION_COST);
	const promotions = bulk ? available : Math.min(1, available);
	if (!promotions)
		return {
			changed: false,
			promotions: 0,
			reason: `Requires ${SCRAP_PROMOTION_COST} ${source} scrap.`,
		};
	scraps[source] -= promotions * SCRAP_PROMOTION_COST;
	scraps[target] += promotions;
	return {
		changed: true,
		promotions,
		reason: `Promoted ${promotions * SCRAP_PROMOTION_COST} ${source} scrap into ${promotions} ${target} scrap.`,
	};
}

function storeExisting(progress: PlayerProgress, item: ItemInstance): boolean {
	let tile = progress.inventoryTiles.find(
		(candidate) => candidate.key === itemStackKey(item),
	);
	if (
		(!tile || tile.quantity === 0) &&
		occupiedInventorySlots(progress) >= inventoryCapacity(progress.level)
	)
		return false;
	if (!tile) {
		tile = {
			id: `tile-${item.id}`,
			key: itemStackKey(item),
			item,
			quantity: 0,
		};
		progress.inventoryTiles.push(tile);
	}
	tile.quantity += 1;
	return true;
}
function availableTile(
	progress: PlayerProgress,
	id: string,
): InventoryTile | undefined {
	const tile = findTile(progress, id);
	return tile && tile.quantity > equippedCopies(progress, tile)
		? tile
		: undefined;
}
function findTile(
	progress: PlayerProgress,
	id: string,
): InventoryTile | undefined {
	return progress.inventoryTiles.find((tile) => tile.id === id);
}
export function isEquippedTile(
	progress: PlayerProgress,
	tile: InventoryTile,
): boolean {
	return equippedCopies(progress, tile) > 0;
}
function equippedCopies(progress: PlayerProgress, tile: InventoryTile): number {
	return (
		Number(
			Boolean(
				progress.mainHand && itemStackKey(progress.mainHand) === tile.key,
			),
		) +
		Number(
			Boolean(progress.offHand && itemStackKey(progress.offHand) === tile.key),
		) +
		Number(
			Boolean(progress.amulet && itemStackKey(progress.amulet) === tile.key),
		) +
		Number(Boolean(progress.charm && itemStackKey(progress.charm) === tile.key))
	);
}
function missing(): InventoryResult {
	return { changed: false, reason: "That equipment is no longer available." };
}
export function purgeYield(item: ItemInstance): number {
	return Math.max(1, Math.ceil(item.level / 3));
}
function learnSkill(
	progress: PlayerProgress,
	skill: SkillId,
	universal: boolean,
): void {
	if (!progress.learnedSkills.includes(skill))
		progress.learnedSkills.push(skill);
	progress.learnedSkillLevels[skill] = Math.min(
		MAX_SKILL_LEVEL,
		(progress.learnedSkillLevels[skill] ?? 0) + 1,
	);
	if (universal && !progress.universalSkills.includes(skill))
		progress.universalSkills.push(skill);
}
export function emptyScraps(): Record<Rarity, number> {
	return { common: 0, uncommon: 0, rare: 0, epic: 0 };
}
