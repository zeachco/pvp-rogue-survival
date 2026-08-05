/** @jsx h */
import type { InventoryTile, PlayerProgress } from "../../common/protocol";
import {
	itemStackKey,
	levelUpItem,
	MAX_ITEM_LEVEL,
	statsWithItemBonuses,
} from "../../common/items";
import { h } from "./dom";
import type { CurrencyPreview, HudCallbacks } from "./types";
import { bindRequirementPreview, itemDetails } from "./ItemDetails";
import {
	extractionCost,
	extractableSkills,
	purgeYield,
	sellYield,
	upgradeCosts,
} from "../../common/inventory";
import { extractButtonStatus } from "./inventoryAvailability";
import { formatProjectedValue } from "./preview";

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
		action?: "card" | "upgrade",
	) => void,
	onCurrencyPreview?: (preview?: CurrencyPreview) => void,
	onSpellPreview?: (skills?: InventoryTile["item"]["skills"]) => void,
	canSend = false,
	onHoverChange?: (tileId?: string, actionIndex?: number) => void,
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
					<button type="button">Send</button>
					<button type="button">Reroll</button>
					{skills.length ? <button type="button">Extract</button> : null}
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
	const bindBulk = (
		index: number,
		callback: (tileId: string, bulk: boolean) => void,
	): void => {
		const button = buttons[index] as HTMLButtonElement | undefined;
		if (!button) return;
		if (!button.disabled) button.title = "Shift+click to repeat while possible";
		button.onclick = (event) => callback(tile.id, event.shiftKey);
	};
	bindBulk(0, callbacks.onSell);
	bindBulk(1, callbacks.onPurge);
	bindBulk(2, callbacks.onUpgrade);
	bindBulk(3, callbacks.onSend);
	bindBulk(4, callbacks.onReroll);
	bindBulk(5, callbacks.onExtract);
	const extractButton = buttons[5] as HTMLButtonElement | undefined;
	if (extractButton && extractStatus === "needs-gold") {
		extractButton.disabled = true;
		extractButton.title = `Extracting costs ${extractCost} gold`;
	}
	if (extractButton && extractStatus === "unlearned-skill") {
		extractButton.disabled = true;
		extractButton.title = `Learn ${skills.filter((skill) => !progress.learnedSkills.includes(skill)).join(", ")} before extracting`;
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
	bindActionPreview(1, { [item.rarity]: purgeYield(item) });
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
	bindActionPreview(4);
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
