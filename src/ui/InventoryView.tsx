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
} from "../../common/items";
import type { InventoryTile, PlayerProgress } from "../../common/protocol";
import { h } from "./dom";
import {
	extractButtonStatus,
	extractionLearnsNewSkill,
} from "./inventoryAvailability";
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
		action?: "inspect" | "equip" | "upgrade" | "reroll",
		baselineItem?: InventoryTile["item"],
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
			<div
				class="item-card-content"
				tabindex="0"
				aria-label={`${item.name}, level ${item.level}, ${item.rarity}, quantity ${tile.quantity}`}
			>
				{itemIcon(item)}
				<b class="item-quantity">{tile.quantity}</b>
				<span class="item-tile-name">{item.name}</span>
			</div>
			<div class="item-card-controls">
				<div
					class="item-menu inventory-item-context-menu"
					role="menu"
					aria-label={`${item.name} actions`}
				>
					{actionButton(
						equipped ? "unequip" : "equip",
						equipped ? "Unequip" : "Equip",
					)}
					{actionButton("sell", `Sell for ${sellYield(item)} gold`)}
					{actionButton("purge", "Purge")}
					{actionButton("upgrade", "Upgrade")}
					{actionButton("send", "Bonk foe")}
					{actionButton("reroll", "Reroll")}
					{skills.length ? (
						<button
							type="button"
							aria-label="Extract"
							title="Extract"
							data-action="extract"
							class={
								extractionLearnsNewSkill(tile, progress) ? "has-new-spell" : ""
							}
						>
							{actionIcon("extract")}
							<span class="item-action-label">Extract</span>
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
	const buttons = [...node.querySelectorAll("button")];
	buttons.forEach((button) => {
		(button as HTMLButtonElement).disabled = tile.quantity === 0;
	});
	const menu = node.querySelector<HTMLElement>(".item-menu");
	const closeMenu = bindItemContextMenu(node, menu);
	if (tile.quantity > 0 && onPreview) {
		node.addEventListener("pointerdown", (event) => {
			if (
				event.pointerType !== "touch" ||
				(event.target instanceof Element && event.target.closest("button"))
			)
				return;
			node.querySelector<HTMLElement>(".item-card-content")?.focus();
		});
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
			if (event.target.closest(".item-card-content")) {
				onHoverChange?.(tile.id);
				onPreview(item, equipped);
				return;
			}
			if (!event.target.closest(".item-skill-list [data-skill-id]")) return;
			onHoverChange?.(tile.id);
			onPreview(item, equipped);
		});
		node.addEventListener("focusout", (event) => {
			if (!(event.target instanceof Element)) return;
			if (event.target.closest(".item-card-content")) {
				if (
					event.relatedTarget instanceof Node &&
					node.contains(event.relatedTarget)
				)
					return;
				onHoverChange?.();
				onPreview();
				return;
			}
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
		for (const index of [1, 2, 4, 6])
			if (buttons[index]) (buttons[index] as HTMLButtonElement).disabled = true;
	const equipButton = buttons[0] as HTMLButtonElement | undefined;
	if (equipButton)
		equipButton.onclick = () => {
			closeMenu();
			callbacks.onEquip(tile.id);
		};
	const sendButton = buttons[4] as HTMLButtonElement | undefined;
	if (sendButton && !canSend) {
		sendButton.disabled = true;
		sendButton.title = "Waiting for realm state";
	}
	const costs = upgradeCosts(item);
	const upgradeButton = buttons[3] as HTMLButtonElement | undefined;
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
	const rerollButton = buttons[5] as HTMLButtonElement | undefined;
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
		if (!button.disabled && index !== 6)
			button.title = "Shift+click to repeat while possible";
		button.onclick = (event) => {
			closeMenu();
			callback(tile.id, event.shiftKey);
		};
	};
	bindBulk(1, callbacks.onSell);
	bindBulk(2, callbacks.onPurge);
	bindBulk(3, callbacks.onUpgrade);
	bindBulk(4, callbacks.onSend);
	bindBulk(5, callbacks.onReroll);
	bindBulk(6, callbacks.onExtract);
	const extractButton = buttons[6] as HTMLButtonElement | undefined;
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
	const bindActionPreview = (
		index: number,
		currency?: CurrencyPreview,
		enter?: () => void,
		action: "inspect" | "equip" | "upgrade" | "reroll" = "inspect",
		shownItem = item,
		baselineItem?: InventoryTile["item"],
	): void => {
		const button = buttons[index] as HTMLButtonElement | undefined;
		if (!button) return;
		const show = () => {
			onHoverChange?.(tile.id, index);
			onPreview?.(
				shownItem,
				action === "equip" ? equipped : equipped && spare <= 0,
				action,
				baselineItem,
			);
			onCurrencyPreview?.(currency);
			onSpellPreview?.();
			enter?.();
		};
		const hide = () => {
			onHoverChange?.(tile.id);
			onCurrencyPreview?.();
			onSpellPreview?.();
			onPreview?.(item, equipped);
		};
		button.addEventListener("mouseenter", show);
		button.addEventListener("mouseleave", hide);
		button.addEventListener("focus", show);
		button.addEventListener("blur", hide);
	};
	bindActionPreview(0, undefined, undefined, "equip");
	bindActionPreview(1, { gold: sellYield(item) });
	bindActionPreview(
		2,
		item.rarity === "unique"
			? { souls: purgeYield(item) }
			: { [item.rarity]: purgeYield(item) },
	);
	const upgradeCurrency: CurrencyPreview =
		costs.souls > 0
			? { souls: -costs.souls }
			: { gold: -costs.gold, [item.rarity]: -costs.scraps };
	bindActionPreview(3, upgradeCurrency, undefined, "upgrade", upgraded, item);
	bindActionPreview(4);
	const rerolled = rerollItem(item, itemPendingRerollSeed(item));
	bindActionPreview(
		5,
		{ souls: -REROLL_SOUL_COST },
		undefined,
		"reroll",
		rerolled,
		item,
	);
	bindActionPreview(6, { gold: -extractCost }, () => {
		onSpellPreview?.(skills);
	});
	return node;
}

export type InventoryActionIcon =
	| "equip"
	| "unequip"
	| "sell"
	| "purge"
	| "upgrade"
	| "send"
	| "reroll"
	| "extract";

export function inventoryItemIconId(item: InventoryTile["item"]): string {
	return item.itemKind === "weapon" ? item.definitionId : item.itemKind;
}

function itemIcon(item: InventoryTile["item"]): HTMLElement {
	const id = inventoryItemIconId(item);
	const shapes: Record<string, HTMLElement> = {
		buckler: (
			<g>
				<circle cx="12" cy="12" r="8" />
				<path d="M12 4v16M4 12h16" />
			</g>
		) as HTMLElement,
		relic: (
			<g>
				<path d="M12 3 18 8v8l-6 5-6-5V8Z" />
				<circle cx="12" cy="12" r="3" />
			</g>
		) as HTMLElement,
		amulet: (
			<g>
				<path d="M6 3c0 6 2 8 6 8s6-2 6-8" />
				<circle cx="12" cy="16" r="4" />
			</g>
		) as HTMLElement,
		charm: (
			<g>
				<path d="M12 3v5m-5-2 3 4m7-4-3 4" />
				<path d="M8 11h8l2 8H6Z" />
			</g>
		) as HTMLElement,
		staff: (
			<g>
				<path d="m7 21 8-16" />
				<circle cx="16" cy="5" r="3" />
			</g>
		) as HTMLElement,
		dagger: (
			<g>
				<path d="m6 19 11-11 2-4-4 2L4 17Z" />
				<path d="m4 14 6 6" />
			</g>
		) as HTMLElement,
		hammer: (
			<g>
				<path d="m9 9 4 4-8 8" />
				<path d="m8 4 4-2 6 6-4 4Z" />
			</g>
		) as HTMLElement,
		mace: (
			<g>
				<path d="m6 20 9-11" />
				<path d="m14 3 6 5-5 4-5-5Z" />
			</g>
		) as HTMLElement,
		axe: (
			<g>
				<path d="m6 21 8-14" />
				<path d="M13 4c4-1 7 1 7 1l-5 7-5-4Z" />
			</g>
		) as HTMLElement,
		throwingAxe: (
			<g>
				<path d="M5 7c5-4 10-3 14 1l-5 4-3-3-3 3Z" />
				<path d="m14 12 5 7" />
			</g>
		) as HTMLElement,
	};
	return (
		<svg class="inventory-item-icon" viewBox="0 0 24 24" aria-hidden="true">
			{shapes[id] ?? (
				<g>
					<path d="m5 19 14-14" />
					<path d="m13 5 6 6M4 16l4 4" />
				</g>
			)}
		</svg>
	) as HTMLElement;
}

function actionButton(action: InventoryActionIcon, label: string): HTMLElement {
	return (
		<button type="button" aria-label={label} title={label} data-action={action}>
			{actionIcon(action)}
			<span class="item-action-label">{label}</span>
		</button>
	) as HTMLElement;
}

function actionIcon(action: InventoryActionIcon): HTMLElement {
	const paths: Record<InventoryActionIcon, HTMLElement> = {
		equip: (
			<g>
				<path d="M4 12.5 9 17l11-11" />
				<path d="M4 4h7M4 20h16" />
			</g>
		) as HTMLElement,
		unequip: (
			<g>
				<path d="m6 6 12 12M18 6 6 18" />
				<path d="M4 3h16v18H4Z" />
			</g>
		) as HTMLElement,
		sell: (
			<g>
				<circle cx="12" cy="12" r="8" />
				<path d="M9 10c0-2 6-2 6 0s-6 2-6 4 6 2 6 0M12 7v10" />
			</g>
		) as HTMLElement,
		purge: (
			<path d="m12 2 2.2 6.1L20 5l-3.1 5.8L23 13l-6.1 2.2L20 21l-5.8-3.1L12 24l-2.2-6.1L4 21l3.1-5.8L1 13l6.1-2.2L4 5l5.8 3.1Z" />
		) as HTMLElement,
		upgrade: (
			<g>
				<path d="m5 11 7-7 7 7" />
				<path d="M12 4v16M6 20h12" />
			</g>
		) as HTMLElement,
		send: (
			<g>
				<path d="M4 18c3-7 7-9 14-9" />
				<path d="m14 5 5 4-5 4" />
			</g>
		) as HTMLElement,
		reroll: (
			<g>
				<path d="M5 9a8 8 0 0 1 13-3l2 2" />
				<path d="M20 3v5h-5M19 15a8 8 0 0 1-13 3l-2-2" />
				<path d="M4 21v-5h5" />
			</g>
		) as HTMLElement,
		extract: (
			<g>
				<path d="M19 12a7 7 0 1 1-7-7c4 0 6 3 5 6-1 4-7 4-7 0 0-2 3-3 4-1" />
				<path d="m12 2 2 3-2 3" />
			</g>
		) as HTMLElement,
	};
	return (
		<svg class="item-action-icon" viewBox="0 0 24 24" aria-hidden="true">
			{paths[action]}
		</svg>
	) as HTMLElement;
}

export function extractLevelTooltipText(
	spellLabel: string,
	currentLearnedLevel: number,
): string {
	const current = Math.max(0, Math.min(MAX_SKILL_LEVEL, currentLearnedLevel));
	return `${spellLabel}: max level ${current} → ${Math.min(MAX_SKILL_LEVEL, current + 1)}`;
}

export const TOUCH_ACTION_HOLD_MS = 600;

export function bindItemContextMenu(
	card: HTMLElement,
	menu?: HTMLElement | null,
): () => void {
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	let openedByTouch = false;
	let cleanupOutside: (() => void) | undefined;
	const portal = card.closest<HTMLElement>(".game-hud") ?? document.body;
	const cancelHold = () => {
		if (holdTimer !== undefined) clearTimeout(holdTimer);
		holdTimer = undefined;
	};
	const close = () => {
		cancelHold();
		card.classList.remove("is-menu-open");
		menu?.classList.remove("is-open");
		const controls = card.querySelector<HTMLElement>(".item-card-controls");
		if (menu?.parentElement === portal) {
			if (controls && card.isConnected) controls.append(menu);
			else menu.remove();
		}
		cleanupOutside?.();
		cleanupOutside = undefined;
	};
	const open = (clientX: number, clientY: number) => {
		if (!menu) return;
		document.dispatchEvent(new CustomEvent("inventory-context-close"));
		cleanupOutside?.();
		card.classList.add("is-menu-open");
		menu.classList.add("is-open");
		menu.style.setProperty(
			"--rarity-rgb",
			getComputedStyle(card).getPropertyValue("--rarity-rgb"),
		);
		portal.append(menu);
		menu.style.left = `${clientX}px`;
		menu.style.top = `${clientY}px`;
		const rect = menu.getBoundingClientRect();
		const inset = 8;
		menu.style.left = `${Math.max(inset, Math.min(clientX, window.innerWidth - rect.width - inset))}px`;
		menu.style.top = `${Math.max(inset, Math.min(clientY, window.innerHeight - rect.height - inset))}px`;
		const onPointerDown = (event: PointerEvent) => {
			if (!(event.target instanceof Node) || !menu.contains(event.target))
				close();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		const onContextClose = () => close();
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("inventory-context-close", onContextClose);
		cleanupOutside = () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("inventory-context-close", onContextClose);
		};
		menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
	};
	card.addEventListener("contextmenu", (event) => {
		event.preventDefault();
		open(event.clientX, event.clientY);
	});
	card.addEventListener("keydown", (event) => {
		if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
			return;
		event.preventDefault();
		const rect = card.getBoundingClientRect();
		open(rect.right, rect.top);
	});
	card.addEventListener("pointerdown", (event) => {
		if (
			event.pointerType !== "touch" ||
			(event.target instanceof Element && event.target.closest("button"))
		)
			return;
		cancelHold();
		holdTimer = setTimeout(() => {
			holdTimer = undefined;
			openedByTouch = true;
			open(event.clientX, event.clientY);
		}, TOUCH_ACTION_HOLD_MS);
	});
	for (const type of ["pointerup", "pointercancel", "pointerleave"] as const)
		card.addEventListener(type, cancelHold);
	card.addEventListener("click", (event) => {
		if (!openedByTouch) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		openedByTouch = false;
	});
	return close;
}

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
