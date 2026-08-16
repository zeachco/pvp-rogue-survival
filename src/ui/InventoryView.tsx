/** @jsx h */

import { MAX_SKILL_LEVEL } from "../../common/combat";
import { SKILLS } from "../../common/content";
import {
	extractableSkills,
	extractionCost,
	purgeYield,
	REROLL_SOUL_COST,
	sellYield,
	upgradeCosts,
} from "../../common/inventory";
import {
	itemPendingRerollSeed,
	itemStackKey,
	levelUpItem,
	MAX_ITEM_LEVEL,
	rerollItem,
	statsWithItemBonuses,
} from "../../common/items";
import type { InventoryTile, PlayerProgress } from "../../common/protocol";
import { h } from "./dom";
import { bindRequirementPreview, itemDetails } from "./ItemDetails";
import {
	extractButtonStatus,
	extractionLearnsNewSkill,
} from "./inventoryAvailability";
import { formatProjectedValue } from "./preview";
import type { CurrencyPreview, HudCallbacks } from "./types";

export type InventorySlotFilter = "all" | "mainhand" | "charms" | "offhands";

export function inventorySlotMatches(
	tile: InventoryTile,
	filter: InventorySlotFilter,
): boolean {
	if (filter === "all") return true;
	if (filter === "mainhand")
		return !["buckler", "relic", "amulet", "charm"].includes(
			tile.item.itemKind,
		);
	if (filter === "charms")
		return tile.item.itemKind === "amulet" || tile.item.itemKind === "charm";
	return tile.item.itemKind === "buckler" || tile.item.itemKind === "relic";
}

export function orderInventoryTiles(
	tiles: InventoryTile[],
	progress: PlayerProgress,
	filter: InventorySlotFilter = "all",
): InventoryTile[] {
	void progress;
	return tiles.filter(
		(tile) => tile.quantity > 0 && inventorySlotMatches(tile, filter),
	);
}

export function itemTile(
	tile: InventoryTile,
	callbacks: HudCallbacks,
	progress: PlayerProgress,
	onPreview?: (
		item?: InventoryTile["item"],
		equipped?: boolean,
		action?: "card" | "upgrade" | "reroll",
	) => void,
	onCurrencyPreview?: (preview?: CurrencyPreview) => void,
	onSpellPreview?: (skills?: InventoryTile["item"]["skills"]) => void,
	canSend = false,
	onHoverChange?: (tileId?: string, actionIndex?: number) => void,
	renderExtractionTooltip?: (
		levels: Array<{
			skill: InventoryTile["item"]["skills"][number];
			currentLevel: number;
			postExtractionLevel: number;
		}>,
	) => HTMLElement,
): HTMLElement {
	const item = tile.item;
	const equippedCopies = [
		progress.mainHand,
		progress.offHand,
		progress.amulet,
		progress.charm,
	].filter(
		(candidate) => candidate && itemStackKey(candidate) === tile.key,
	).length;
	const equipped = equippedCopies > 0;
	const spare = tile.quantity - equippedCopies;
	const skills = extractableSkills(item);
	const extractCost = extractionCost(progress, skills);
	const extractStatus = extractButtonStatus(tile, progress);
	const stats = statsWithItemBonuses(progress.stats, item);
	const extractionLevels = skills.map((skill) => {
		const currentLevel = Math.min(
			MAX_SKILL_LEVEL,
			progress.learnedSkillLevels[skill] ?? 0,
		);
		return {
			skill,
			currentLevel,
			postExtractionLevel: Math.min(MAX_SKILL_LEVEL, currentLevel + 1),
		};
	});
	const extractionTooltip = renderExtractionTooltip?.(extractionLevels);
	const node = (
		<div
			class={`item-card rarity-${item.rarity}${equipped ? " is-equipped" : ""}`}
			data-tile-id={tile.id}
			data-stack-key={tile.key}
		>
			<div class="item-card-content">
				<div class="item-title">
					<span class="tile-text-anchor item-name-anchor" tabindex="0">
						<strong>{item.name}</strong>
						<span class="tile-text-tooltip" role="tooltip">
							{item.name}
						</span>
					</span>
					<b>x{tile.quantity}</b>
				</div>
				<small class="item-subtitle">
					L{item.level} · {itemKindLabel(item)} · {item.rarity}
				</small>
				{itemDetails(item, stats)}
			</div>
			<div class="item-card-controls">
				<div class="item-menu">
					<button type="button">Sell {sellYield(item)}g</button>
					<button type="button">Purge</button>
					<button type="button">Upgrade</button>
					<button type="button">Bonk foe</button>
					<button type="button">Reroll</button>
					{skills.length ? (
						<button
							type="button"
							class={
								extractionLearnsNewSkill(tile, progress) ? "has-new-spell" : ""
							}
						>
							Extract
							{extractionTooltip ?? (
								<span class="action-tooltip" role="tooltip">
									{extractionLevels.map(({ skill, currentLevel }) => (
										<span>
											{extractLevelTooltipText(
												SKILLS[skill].label,
												currentLevel,
											)}
										</span>
									))}
								</span>
							)}
						</button>
					) : null}
				</div>
			</div>
		</div>
	) as HTMLElement;
	bindRequirementPreview(
		node.querySelector<HTMLElement>(".equipment-details")!,
		item,
		stats,
	);
	const buttons = [...node.querySelectorAll("button")];
	buttons.forEach((button) => {
		(button as HTMLButtonElement).disabled = tile.quantity === 0;
	});
	node.onclick = (event) => {
		if (
			event.button === 0 &&
			(!(event.target instanceof Element) || !event.target.closest("button"))
		)
			callbacks.onEquip(tile.id);
	};
	if (tile.quantity > 0 && onPreview) {
		node.onmouseenter = () => {
			onHoverChange?.(tile.id);
			onPreview(item, equipped);
		};
		node.onmouseleave = () => {
			onHoverChange?.();
			onPreview();
			onCurrencyPreview?.();
			onSpellPreview?.();
		};
		node.addEventListener("focusin", (event) => {
			if (!(event.target instanceof Element)) return;
			if (!event.target.closest(".item-skill-list [data-skill-id]")) return;
			onHoverChange?.(tile.id);
			onPreview(item, equipped);
		});
		node.addEventListener("focusout", (event) => {
			if (!(event.target instanceof Element)) return;
			if (!event.target.closest(".item-skill-list [data-skill-id]")) return;
			if (
				event.relatedTarget instanceof Node &&
				node.contains(event.relatedTarget)
			)
				return;
			onHoverChange?.();
			onPreview();
		});
	}
	if (spare <= 0)
		for (const index of [0, 1, 3, 5])
			if (buttons[index]) (buttons[index] as HTMLButtonElement).disabled = true;
	const sendButton = buttons[3] as HTMLButtonElement | undefined;
	if (sendButton && !canSend) {
		sendButton.disabled = true;
		sendButton.title = "Waiting for realm state";
	}
	const costs = upgradeCosts(item);
	const upgradeButton = buttons[2] as HTMLButtonElement | undefined;
	if (
		upgradeButton &&
		((item.rarity === "epic" && item.level >= MAX_ITEM_LEVEL.epic) ||
			(item.rarity === "unique" && item.level >= MAX_ITEM_LEVEL.unique))
	) {
		upgradeButton.disabled = true;
		upgradeButton.title =
			item.rarity === "unique"
				? "Maximum Unique level reached"
				: "Maximum Epic level reached";
	}
	if (
		upgradeButton &&
		(progress.gold < costs.gold ||
			progress.scraps[item.rarity] < costs.scraps ||
			progress.souls < costs.souls)
	) {
		upgradeButton.disabled = true;
		upgradeButton.title =
			costs.souls > 0
				? `Requires ${costs.souls} Soul`
				: `Requires ${costs.gold} gold and ${costs.scraps} ${item.rarity} scraps`;
	}
	const rerollButton = buttons[4] as HTMLButtonElement | undefined;
	if (rerollButton && progress.souls < REROLL_SOUL_COST) {
		rerollButton.disabled = true;
		rerollButton.title = `Requires ${REROLL_SOUL_COST} Soul`;
	}
	const bindBulk = (
		index: number,
		callback: (tileId: string, bulk: boolean) => void,
	): void => {
		const button = buttons[index] as HTMLButtonElement | undefined;
		if (!button) return;
		if (!button.disabled && index !== 5)
			button.title = "Shift+click to repeat while possible";
		button.onclick = (event) => callback(tile.id, event.shiftKey);
		bindTouchHoldAction(button, () => callback(tile.id, false));
	};
	bindBulk(0, callbacks.onSell);
	bindBulk(1, callbacks.onPurge);
	bindBulk(2, callbacks.onUpgrade);
	bindBulk(3, callbacks.onSend);
	bindBulk(4, callbacks.onReroll);
	bindBulk(5, callbacks.onExtract);
	const extractButton = buttons[5] as HTMLButtonElement | undefined;
	if (extractButton) {
		if (extractStatus === "max-level") {
			extractButton.disabled = true;
			extractButton.title = "An extractable spell is already at max level";
		} else if (extractStatus === "needs-gold") {
			extractButton.disabled = true;
			extractButton.title = `Extracting costs ${extractCost} gold`;
		}
	}
	const upgraded = levelUpItem(item, item.seed);
	const subtitle = node.querySelector<HTMLElement>(".item-subtitle")!;
	let details = node.querySelector<HTMLElement>(".equipment-details")!;
	const highlightExtractableSkills = (active: boolean): void => {
		const extractable = new Set(skills);
		for (const row of details.querySelectorAll<HTMLElement>(
			".item-skill-list [data-skill-id]",
		))
			row.classList.toggle(
				"is-extract-preview",
				active &&
					extractable.has(row.dataset.skillId as (typeof skills)[number]),
			);
	};
	const previewUpgradeCard = (active: boolean): void => {
		const shown = active ? upgraded : item;
		const shownStats = statsWithItemBonuses(progress.stats, shown);
		const level = formatProjectedValue({
			currentVal: item.level,
			newVal: shown.level,
		});
		subtitle.textContent = `L${level} · ${itemKindLabel(shown)} · ${shown.rarity}`;
		subtitle.classList.toggle("is-gain-preview", active);
		const replacement = itemDetails(
			shown,
			shownStats,
			active ? item : undefined,
			active ? stats : undefined,
		);
		details.replaceWith(replacement);
		details = replacement;
		bindRequirementPreview(details, shown, shownStats);
	};
	const bindActionPreview = (
		index: number,
		currency?: CurrencyPreview,
		enter?: () => void,
	): void => {
		const button = buttons[index] as HTMLButtonElement | undefined;
		if (!button) return;
		button.addEventListener("mouseenter", () => {
			onHoverChange?.(tile.id, index);
			onPreview?.();
			onCurrencyPreview?.(currency);
			onSpellPreview?.();
			enter?.();
		});
		button.addEventListener("mouseleave", () => {
			onHoverChange?.(tile.id);
			onCurrencyPreview?.();
			onSpellPreview?.();
			onPreview?.(item, equipped);
		});
	};
	bindActionPreview(0, { gold: sellYield(item) });
	bindActionPreview(
		1,
		item.rarity === "unique"
			? { souls: purgeYield(item) }
			: { [item.rarity]: purgeYield(item) },
	);
	const upgradePreview = buttons[2] as HTMLButtonElement | undefined;
	upgradePreview?.addEventListener("mouseenter", () =>
		previewUpgradeCard(true),
	);
	upgradePreview?.addEventListener("mouseleave", () =>
		previewUpgradeCard(false),
	);
	const upgradeCurrency: CurrencyPreview =
		costs.souls > 0
			? { souls: -costs.souls }
			: { gold: -costs.gold, [item.rarity]: -costs.scraps };
	bindActionPreview(2, upgradeCurrency, () => {
		if (equipped && spare <= 0) onPreview?.(upgraded, true, "upgrade");
	});
	bindActionPreview(3);
	const rerolled = rerollItem(item, itemPendingRerollSeed(item));
	const previewRerollCard = (active: boolean): void => {
		const shown = active ? rerolled : item;
		const shownStats = statsWithItemBonuses(progress.stats, shown);
		const level = formatProjectedValue({
			currentVal: item.level,
			newVal: shown.level,
		});
		subtitle.textContent = `L${level} · ${itemKindLabel(shown)} · ${shown.rarity}`;
		subtitle.classList.toggle("is-gain-preview", active);
		const replacement = itemDetails(
			shown,
			shownStats,
			active ? item : undefined,
			active ? stats : undefined,
			false,
			true,
		);
		details.replaceWith(replacement);
		details = replacement;
		bindRequirementPreview(details, shown, shownStats);
	};
	rerollButton?.addEventListener("mouseenter", () => previewRerollCard(true));
	rerollButton?.addEventListener("mouseleave", () => previewRerollCard(false));
	bindActionPreview(4, { souls: -REROLL_SOUL_COST }, () => {
		if (equipped && spare <= 0) onPreview?.(rerolled, true, "reroll");
	});
	bindActionPreview(5, { gold: -extractCost }, () => {
		onSpellPreview?.(skills);
		highlightExtractableSkills(true);
	});
	extractButton?.addEventListener("mouseleave", () =>
		highlightExtractableSkills(false),
	);
	extractButton?.addEventListener("blur", () =>
		highlightExtractableSkills(false),
	);
	extractButton?.addEventListener("focus", () =>
		highlightExtractableSkills(true),
	);
	return node;
}

export function extractLevelTooltipText(
	spellLabel: string,
	currentLearnedLevel: number,
): string {
	const current = Math.max(0, Math.min(MAX_SKILL_LEVEL, currentLearnedLevel));
	return `${spellLabel}: max level ${current} → ${Math.min(MAX_SKILL_LEVEL, current + 1)}`;
}

export const TOUCH_ACTION_HOLD_MS = 600;

export function bindTouchHoldAction(
	button: HTMLButtonElement,
	action: () => void,
): void {
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	let touchPress = false;
	const cancel = () => {
		if (holdTimer !== undefined) clearTimeout(holdTimer);
		holdTimer = undefined;
	};
	button.addEventListener("pointerdown", (event) => {
		if (event.pointerType !== "touch" || button.disabled) return;
		event.preventDefault();
		touchPress = true;
		button.dispatchEvent(new MouseEvent("mouseenter"));
		holdTimer = setTimeout(() => {
			holdTimer = undefined;
			action();
		}, TOUCH_ACTION_HOLD_MS);
	});
	for (const type of ["pointerup", "pointercancel", "pointerleave"] as const)
		button.addEventListener(type, cancel);
	button.addEventListener("click", (event) => {
		if (!touchPress) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		touchPress = false;
	});
}
function itemKindLabel(item: InventoryTile["item"]): string {
	return item.itemKind === "weapon"
		? `${item.hands}H`
		: item.itemKind === "buckler"
			? `${Math.round(item.blockChance * 100)}% block`
			: item.itemKind === "relic"
				? "Relic"
				: item.itemKind === "amulet"
					? "Amulet"
					: "Charm";
}
