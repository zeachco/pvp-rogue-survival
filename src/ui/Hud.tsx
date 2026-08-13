/** @jsx h */

import {
	auraRadius,
	auraSlowMultiplier,
	sunburnFraction,
	sunburnInterval,
	thunderDamage,
	thunderInterval,
} from "../../common/auras";
import { BALANCE } from "../../common/balance";
import {
	attackProfile,
	attractionFindBonus,
	attractionSpeedMultiplier,
	blizzardDuration,
	blizzardProjectilesPerSecond,
	blizzardRadius,
	bucklerBlockCost,
	cappedSkillLevel,
	effectiveSkillCooldown,
	healingFraction,
	MAX_SKILL_LEVEL,
	manaConversionFraction,
	orbitingHammerDuration,
	RENDING_THROW_BLEED_DURATION,
	rapidRegenDuration,
	rapidRegenMultiplier,
	reflectiveSurgeBlockChanceBonus,
	reflectiveSurgeDuration,
	rendingThrowPierce,
	rendingThrowTargetLimit,
	type SkillDamagePreview,
	skillCastTime,
	skillDamagePreview,
	skillRange,
	skillStatBonusDescription,
	skillUpkeepPerSecond,
	spiritWoundsConversionFraction,
	timeHarvestCooldownReduction,
	voodooPoisonMultiplier,
	weaponSkillTriggerChance,
	whirlwindDuration,
	whirlwindMovementSpeed,
} from "../../common/combat";
import { SKILLS } from "../../common/content";
import {
	inventoryCapacity,
	occupiedInventorySlots,
	REROLL_SOUL_COST,
	SCRAP_PROMOTION_COST,
	upgradeCosts,
} from "../../common/inventory";
import {
	type ItemInstance,
	itemCooldownReduction,
	itemStackKey,
	RARITIES,
	type Rarity,
	type SkillId,
	statsWithItemBonuses,
} from "../../common/items";
import {
	derivedStats,
	integerAllocation,
	STAT_KEYS,
	type Stats,
	scaledStats,
} from "../../common/progression";
import type {
	GroundDrop,
	HeroSummary,
	PanelTriggers,
	PlayerProgress,
	PublicHeroProfile,
	RarityAction,
	RealmState,
	UnitBuild,
} from "../../common/protocol";
import { SPELL_SOURCES } from "../../common/spellSources";
import { pixelsToMeters } from "../../common/units";
import {
	actualSkillLevel,
	effectiveSkillLevel,
	resourceReduction,
} from "../game/systems/HeroCombatSystem";
import type { CreepTimedStates, PlayerState } from "../game/types";
import { h } from "./dom";
import { GameSettings } from "./GameSettings";
import {
	effectTimeLabel,
	HeroResourceDock,
	statusEffectSummaries,
} from "./HeroResourceDock";
import {
	type InventorySlotFilter,
	itemTile,
	orderInventoryTiles,
} from "./InventoryView";
import { bindRequirementPreview, itemDetails } from "./ItemDetails";
import { extractButtonStatus } from "./inventoryAvailability";
import {
	applyPreviewClass,
	formatPreviewValue,
	formatProjectedValue,
	type PreviewValue,
	previewTone,
} from "./preview";
import { viewportTooltipPosition } from "./tooltipPosition";
import type { CurrencyPreview, HudCallbacks, SpellSlot } from "./types";

export {
	effectTimeLabel,
	statusEffectSummaries,
	xpSendBuffSummary,
} from "./HeroResourceDock";

import {
	projectUnitState,
	RapidRegenerationEffect,
	ReflectiveSurgeEffect,
	ThornsEffect,
	type UnitEffect,
} from "../../common/unitState";

export type { HudCallbacks, SpellSlot } from "./types";

declare global {
	namespace JSX {
		interface IntrinsicElements {
			[elementName: string]: Record<string, unknown>;
		}
	}
}

function formatSkillDamage(damage: SkillDamagePreview): string {
	if (damage.kind === "multiplier") return `${fmt(damage.value)}×`;
	if (damage.kind === "flat") return `${fmt(damage.value)} ${damage.detail}`;
	return `${fmt(damage.value * 100)}% ${damage.detail}`;
}
function formatSpellLevel(activeLevel: number): string {
	return String(activeLevel);
}

export function panelShortcut(
	key: string,
	modifierPressed = false,
): "character" | "inventory" | undefined {
	if (modifierPressed) return undefined;
	if (key.toLowerCase() === "c") return "character";
	if (["i", "v"].includes(key.toLowerCase())) return "inventory";
	return undefined;
}

export function panelToggleTooltip(
	kind: "character" | "inventory",
	collapsed: boolean,
): string {
	const action = collapsed ? "Expand" : "Collapse";
	return `${action} ${kind === "character" ? "character sheet (C)" : "inventory (V)"}`;
}

export class Hud {
	private spellTooltipOverlay?: HTMLElement;
	private player?: PlayerState;
	private inspected?: UnitBuild;
	private inspectedBestWave?: number;
	private inspectedMaxHp?: number;
	private inspectedHealth?: number;
	private committedInspection?: {
		build?: UnitBuild;
		xpReward?: number;
		bestWave?: number;
		maxHp?: number;
		health?: number;
	};
	private characterCollapsedBeforeInspection?: boolean;
	private realm?: RealmState;
	private readonly joinPanel: HTMLElement;
	private readonly gameHud: HTMLElement;
	private readonly nameInput: HTMLInputElement;
	private onlinePlayerCount = 0;
	private accountCharacters: HeroSummary[] = [];
	private selectedAccountCharacterId?: string;
	private readonly onlineCount = (<div class="online-count" />) as HTMLElement;
	private readonly loginHeaderActions = (
		<nav class="header-login-actions" aria-label="Login links">
			<button class="header-control" type="button">
				Devlog
			</button>
			<button class="header-control" type="button">
				Options
			</button>
		</nav>
	) as HTMLElement;
	private authenticationMode: "create" | "login" = "login";
	private readonly authenticationTitle = (<h2 />) as HTMLElement;
	private readonly authenticationNotice = (
		<div
			class="authentication-notice is-hidden"
			role="alert"
			aria-live="assertive"
		/>
	) as HTMLElement;
	private readonly passwordInput = (
		<input
			type="password"
			minlength="8"
			maxlength="128"
			autocomplete="current-password"
			required
		/>
	) as HTMLInputElement;
	private readonly passwordConfirmationInput = (
		<input
			type="password"
			minlength="8"
			maxlength="128"
			autocomplete="new-password"
			required
		/>
	) as HTMLInputElement;
	private readonly authenticationModal = (
		<form
			class="authentication-modal is-hidden"
			role="dialog"
			aria-modal="true"
		>
			{this.authenticationTitle}
			<label>
				Password
				{this.passwordInput}
			</label>
			<label class="password-confirmation">
				Confirm password
				{this.passwordConfirmationInput}
			</label>
			{this.authenticationNotice}
			<div class="authentication-actions">
				<button type="button">Cancel</button>
				<button type="submit">Continue</button>
			</div>
		</form>
	) as HTMLFormElement;
	private readonly authenticationMask = (
		<div class="authentication-mask is-hidden" aria-hidden="true" />
	) as HTMLElement;
	private readonly characterSelectorList = (
		<div class="character-selector-list" />
	) as HTMLElement;
	private readonly newCharacterInput = (
		<input
			type="text"
			minlength="1"
			maxlength="20"
			pattern="[A-Za-z0-9_-]+"
			placeholder="New character name"
			aria-label="New character name"
		/>
	) as HTMLInputElement;
	private readonly switchCharacterButton = (
		<button class="character-switch-action" type="button" />
	) as HTMLButtonElement;
	private readonly characterSelector = (
		<section
			class="character-selector is-hidden"
			role="dialog"
			aria-modal="true"
			aria-labelledby="character-selector-title"
		>
			<header>
				<div>
					<small>Account roster</small>
					<h2 id="character-selector-title">Characters</h2>
				</div>
				<button
					class="character-selector-close"
					type="button"
					aria-label="Close"
				>
					×
				</button>
			</header>
			{this.characterSelectorList}
			<footer>
				{this.switchCharacterButton}
				<div class="character-create-action">
					{this.newCharacterInput}
					<button type="button">Create new</button>
				</div>
			</footer>
		</section>
	) as HTMLElement;
	private readonly leaderboardNode = (
		<div class="leaderboard" />
	) as HTMLElement;
	private readonly leaderboardPanel = (
		<section class="leaderboard-panel">
			<h2>Heroes</h2>
			{this.leaderboardNode}
		</section>
	) as HTMLElement;
	private readonly publicSheet = (
		<aside class="character-panel public-character-panel is-hidden" />
	) as HTMLElement;
	private readonly characterPanel: HTMLElement;
	private readonly inventoryPanel: HTMLElement;
	private readonly characterToggle: HTMLButtonElement;
	private readonly inventoryToggle: HTMLButtonElement;
	private panelTriggers: PanelTriggers = {
		character: false,
		inventory: false,
		multiplayer: false,
	};
	private readonly realmPanel = (<div class="realm-panel" />) as HTMLElement;
	private readonly gameSettings: GameSettings;
	private readonly aimReticle = (
		<div class="aim-reticle is-hidden" aria-hidden="true">
			<span />
		</div>
	) as HTMLElement;
	private readonly noticeNode = (
		<div class="notice" role="status" aria-live="polite">
			Enter a name to join.
		</div>
	) as HTMLElement;
	private readonly joinNoticeNode = (
		<div class="notice" role="status" aria-live="polite">
			Enter a name to join.
		</div>
	) as HTMLElement;
	private readonly sheetNode = (<div class="sheet-content" />) as HTMLElement;
	private readonly inventoryNode = (
		<div class="inventory-content" />
	) as HTMLElement;
	private readonly itemHoverCard = (
		<aside class="item-hover-card is-hidden" aria-hidden="true" inert="" />
	) as HTMLElement;
	private readonly allocationNode = (
		<form class="allocation-panel" />
	) as HTMLElement;
	private readonly inventoryCount = (<strong />) as HTMLElement;
	private readonly loadoutNode = (
		<div class="inventory-loadout" aria-label="Equipped loadout" />
	) as HTMLElement;
	private readonly inventoryHeader = (
		<div class="inventory-header">
			<div class="currency-grid">
				{currencyCell("Gold", 0, "gold", GOLD_TOOLTIP)}
				{currencyCell("Souls", 0, "souls", SOULS_TOOLTIP)}
				{currencyCell("Common", 0, "common", scrapTooltip("Common"))}
				{currencyCell("Uncommon", 0, "uncommon", scrapTooltip("Uncommon"))}
				{currencyCell("Rare", 0, "rare", scrapTooltip("Rare"))}
				{currencyCell("Epic", 0, "epic", scrapTooltip("Epic"))}
			</div>
			{this.loadoutNode}
			{this.inventoryCount}
		</div>
	) as HTMLElement;
	private readonly backpackScroll = (
		<div class="backpack-scroll" />
	) as HTMLElement;
	private readonly rarityFilterNode = (
		<div class="rarity-filter" />
	) as HTMLElement;
	private inventorySlotFilter: InventorySlotFilter = "all";
	private readonly spellBar = (<section class="spell-bar" />) as HTMLElement;
	private readonly creepPreview = (
		<aside class="creep-preview-tooltip is-hidden" aria-live="polite" />
	) as HTMLElement;
	private readonly learnedSkillsBar = (
		<div class="skill-bar learned-skills-bar" aria-label="Equipped spells" />
	) as HTMLElement;
	private readonly learnedSkillsList = (
		<div class="skill-list" />
	) as HTMLElement;
	private readonly spellCatalog = (
		<section
			class="spell-catalog is-hidden"
			role="dialog"
			aria-modal="true"
			aria-label="Available spells"
		/>
	) as HTMLElement;
	private selectedCatalogSpell?: SkillId;
	private spellCatalogSignature = "";
	private spellCatalogFilters = new Set<SpellCatalogFilter>([
		"learned",
		"equipped",
		"actives",
	]);
	private spellCatalogSearch = "";
	private spellPreviewKind?: "extract" | "equipment";
	private readonly heroResourceDock = new HeroResourceDock();
	private readonly chatLog = (<div class="chat-log" />) as HTMLElement;
	private readonly chatInput = (
		<input
			class="chat-input"
			type="text"
			maxlength={200}
			placeholder="Chat..."
		/>
	) as HTMLInputElement;
	private readonly deathModal = (
		<div
			class="death-modal is-hidden"
			role="dialog"
			aria-modal="true"
			aria-labelledby="death-modal-title"
			aria-describedby="death-modal-detail"
		>
			<strong id="death-modal-title">YOU DIED</strong>
			<span id="death-modal-detail">
				Your legacy inherited your remaining resources and spellbooks and will
				try to avenge you…
			</span>
		</div>
	) as HTMLElement;
	private readonly centerToast = (
		<div class="center-toast" role="status" aria-live="polite" />
	) as HTMLElement;
	private readonly multiplayerIntro = (
		<aside
			class="multiplayer-intro is-hidden"
			role="dialog"
			aria-modal="true"
			aria-label="Multiplayer introduction"
		>
			<div>
				<strong>Your bloodline must survive.</strong>
				<p>
					Training Grounds are safe, but provide no rewards. Enter Realm is the
					real test: it provides rewards, and you can be matched against other
					players who are online. Death in a Realm ends this hero's journey.
					Their child takes over at level 1, inheriting all equipment and half
					the family's Gold and Souls. In a Realm, use an item's Bonk foe button
					to invade another player's realm: your gear arms a named creep in one
					of their future waves.
				</p>
			</div>
		</aside>
	) as HTMLElement;
	private readonly multiplayerIntroMask = (
		<div class="multiplayer-intro-mask is-hidden" aria-hidden="true" />
	) as HTMLElement;
	private centerToastTimer?: number;
	private realmSignature = "";
	private forceNextWaveReadyAt = 0;
	private forceNextWaveButton?: HTMLButtonElement;
	private forceNextWaveLabel?: HTMLElement;
	private swarmMode = false;
	private forceNextWavePending = false;
	private spellStructureSignature = "";
	private allocationSignature = "";
	private allocationPreview?: "next" | "respec";
	private allocationUpdate?: () => void;
	private lastWaveNumber?: number;
	private staticProgress?: PlayerProgress;
	private staticPlayerName = "";
	private staticReceivesDeathEchoes = false;
	private staticBestWave = -1;
	private staticSurgeActive = false;
	private staticRapidRegenActive = false;
	private activeMainHand?: HTMLElement;
	private currentSpells: SpellSlot[] = [];
	private spellPreview?: Map<SkillId, number | null>;
	private spellPreviewProgress?: PlayerProgress;
	private inventoryHover?: { tileId: string; actionIndex?: number };
	private activeScrapPromotion?: Exclude<Rarity, "common">;
	private readonly spellNodes = new Map<string, HTMLElement>();
	constructor(
		private readonly root: HTMLDivElement,
		private readonly callbacks: HudCallbacks,
	) {
		this.gameSettings = new GameSettings(callbacks);
		this.nameInput = (
			<input
				name="name"
				maxlength="20"
				placeholder="Player name"
				autocomplete="off"
			/>
		) as HTMLInputElement;
		const joinForm = (
			<form>
				{this.nameInput}
				<button type="submit">Join</button>
			</form>
		) as HTMLElement;
		(
			this.loginHeaderActions.querySelector(
				"button:last-child",
			) as HTMLButtonElement
		).onclick = () => this.gameSettings.open();
		(
			this.loginHeaderActions.querySelector(
				"button:first-child",
			) as HTMLButtonElement
		).onclick = callbacks.onOpenDevlog;
		this.joinPanel = (
			<section class="join-panel">
				<p class="project-intro">
					Built by autonomous coding agents. The community votes on what they
					build next.
				</p>
				{joinForm}
				{this.joinNoticeNode}
			</section>
		) as HTMLElement;
		joinForm.onsubmit = (event) => {
			event.preventDefault();
			const name = this.nameInput.value.trim();
			if (name) callbacks.onJoin(name);
		};
		const closeAuthentication = () => {
			this.authenticationMask.classList.add("is-hidden");
			this.authenticationModal.classList.add("is-hidden");
			this.passwordInput.value = "";
			this.passwordConfirmationInput.value = "";
			this.authenticationNotice.textContent = "";
			this.authenticationNotice.classList.add("is-hidden");
		};
		(
			this.authenticationModal.querySelector(
				'button[type="button"]',
			) as HTMLButtonElement
		).onclick = closeAuthentication;
		this.authenticationMask.onclick = closeAuthentication;
		this.authenticationModal.onsubmit = (event) => {
			event.preventDefault();
			if (
				this.authenticationMode === "create" &&
				this.passwordInput.value !== this.passwordConfirmationInput.value
			) {
				this.setNotice("Passwords do not match.", "error");
				return;
			}
			this.callbacks.onJoin(
				this.nameInput.value.trim(),
				this.passwordInput.value,
				this.authenticationMode === "create"
					? this.passwordConfirmationInput.value
					: undefined,
			);
		};
		(
			this.characterSelector.querySelector(
				".character-selector-close",
			) as HTMLButtonElement
		).onclick = () => this.closeCharacterSelector();
		this.switchCharacterButton.onclick = () => {
			const selected = this.accountCharacters.find(
				({ id }) => id === this.selectedAccountCharacterId,
			);
			if (!selected || selected.id === this.player?.id) return;
			this.closeCharacterSelector();
			this.callbacks.onSwitchCharacter(selected.id);
		};
		(
			this.characterSelector.querySelector(
				".character-create-action button",
			) as HTMLButtonElement
		).onclick = () => this.createCharacter();
		this.newCharacterInput.onkeydown = (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				this.createCharacter();
			}
		};
		const back = (
			<button
				class="inspect-back is-hidden"
				type="button"
				aria-label="Close enemy preview"
			>
				<span class="inspect-back-icon" aria-hidden="true">
					×
				</span>
				<span class="inspect-back-label">Back to hero</span>
			</button>
		) as HTMLButtonElement;
		back.onclick = callbacks.onBack;
		this.characterToggle = (
			<button
				class="header-panel-toggle character-panel-toggle"
				type="button"
				aria-label="Collapse character sheet"
				title={panelToggleTooltip("character", false)}
				aria-expanded="true"
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<circle cx="12" cy="8" r="3.5" />
					<path d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6" />
				</svg>
			</button>
		) as HTMLButtonElement;
		this.inventoryToggle = (
			<button
				class="header-panel-toggle inventory-panel-toggle"
				type="button"
				aria-label="Collapse inventory"
				title={panelToggleTooltip("inventory", false)}
				aria-expanded="true"
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M5 8h14l-1 12H6L5 8Z" />
					<path d="M9 8V6a3 3 0 0 1 6 0v2" />
				</svg>
			</button>
		) as HTMLButtonElement;
		this.characterPanel = (
			<aside class="character-panel">
				{back}
				{this.sheetNode}
			</aside>
		) as HTMLElement;
		this.inventoryPanel = (
			<aside class="inventory-column">{this.inventoryNode}</aside>
		) as HTMLElement;
		this.inventoryNode.append(
			this.inventoryHeader,
			this.backpackScroll,
			this.rarityFilterNode,
		);
		const rarityActions: RarityAction[] = [
			"keep",
			"auto-sell",
			"auto-purge",
			"auto-send",
		];
		const actionLabels: Record<RarityAction, string> = {
			keep: "Keep",
			"auto-sell": "Auto-sell",
			"auto-purge": "Auto-purge",
			"auto-send": "Auto-send",
		};
		for (const rarity of RARITIES) {
			const select = (
				<select class={`rarity-filter-select rarity-${rarity}`}>
					{rarityActions.map((a) => (
						<option value={a}>{actionLabels[a]}</option>
					))}
				</select>
			) as HTMLSelectElement;
			select.onchange = () =>
				callbacks.onSetRarityAction(rarity, select.value as RarityAction);
			const field = (
				<label class="inventory-filter-field">
					<small class="rarity-filter-label">{rarity}</small>
					{select}
				</label>
			) as HTMLLabelElement;
			this.rarityFilterNode.append(field);
		}
		const slotFilter = (
			<label class="inventory-filter-field inventory-slot-filter">
				<small>Slots</small>
				<select>
					<option value="all">All</option>
					<option value="mainhand">Main hand</option>
					<option value="charms">Charms</option>
					<option value="offhands">Offhands</option>
				</select>
			</label>
		) as HTMLLabelElement;
		const slotSelect = slotFilter.querySelector("select") as HTMLSelectElement;
		slotSelect.onchange = () => {
			this.inventorySlotFilter = slotSelect.value as InventorySlotFilter;
			if (this.player) this.renderInventory(this.player.progress);
		};
		this.rarityFilterNode.prepend(slotFilter);
		for (const target of ["uncommon", "rare", "epic"] as const) {
			this.bindScrapPromotion(target);
		}
		this.characterToggle.onclick = () =>
			this.togglePanel(
				this.characterPanel,
				this.characterToggle,
				"character",
				true,
			);
		this.inventoryToggle.onclick = () =>
			this.togglePanel(
				this.inventoryPanel,
				this.inventoryToggle,
				"inventory",
				true,
			);
		this.chatInput.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && this.chatInput.value.trim()) {
				this.callbacks.onChat(this.chatInput.value.trim());
				this.chatInput.value = "";
				this.chatInput.blur();
			} else if (event.key === "Escape") {
				this.chatInput.blur();
			}
		});
		this.chatInput.addEventListener("focus", () =>
			this.callbacks.onChattingChange(true),
		);
		this.chatInput.addEventListener("blur", () => {
			this.callbacks.onChattingChange(false);
			this.chatInput.value = "";
		});
		const dismissMultiplayer = (
			<button type="button">Got it</button>
		) as HTMLButtonElement;
		const closeMultiplayerIntro = () => {
			this.panelTriggers.multiplayer = false;
			this.multiplayerIntroMask.classList.add("is-hidden");
			this.multiplayerIntro.classList.add("is-hidden");
			this.callbacks.onDismissPanelTrigger("multiplayer");
		};
		dismissMultiplayer.onclick = closeMultiplayerIntro;
		this.multiplayerIntroMask.onclick = closeMultiplayerIntro;
		this.multiplayerIntro.append(dismissMultiplayer);
		const statusBar = (
			<header class="game-status-bar">
				{this.characterToggle}
				<section class="hud-top">{this.realmPanel}</section>
				{this.loginHeaderActions}
				{this.onlineCount}
				<section class="notification-area">{this.noticeNode}</section>
				{this.inventoryToggle}
			</header>
		) as HTMLElement;
		this.gameHud = (
			<div class="game-hud character-panel-open inventory-panel-open">
				{this.multiplayerIntroMask}
				{this.multiplayerIntro}
				{this.deathModal}
				{this.centerToast}
				{this.creepPreview}
				{this.aimReticle}
				{this.spellBar}
				{this.spellCatalog}
				<section class="chat-area">
					{this.chatLog}
					{this.chatInput}
				</section>
				{this.heroResourceDock.node}
				{this.characterSelector}
				{this.characterPanel}
				{this.inventoryPanel}
				{this.itemHoverCard}
			</div>
		) as HTMLElement;
		root.append(
			statusBar,
			this.leaderboardPanel,
			this.joinPanel,
			this.publicSheet,
			this.gameHud,
			this.authenticationMask,
			this.authenticationModal,
		);
		this.gameSettings.appendTo(root);
		this.updateVisibility();
	}
	setJoinName(name: string): void {
		this.nameInput.value = name;
	}
	setLightingMode(mode: "off" | "hero" | "all"): void {
		this.gameSettings.setLightingMode(mode);
	}

	setKeepAwakeMode(mode: "on" | "off"): void {
		this.gameSettings.setKeepAwakeMode(mode);
	}
	setShadowMode(mode: "off" | "dynamic"): void {
		this.gameSettings.setShadowMode(mode);
	}
	setFullscreenMode(mode: "on" | "off"): void {
		this.gameSettings.setFullscreenMode(mode);
	}
	setResolutionScale(scale: number): void {
		this.gameSettings.setResolutionScale(scale);
	}
	setAutoEquipOptions(items: boolean, spells: boolean): void {
		this.gameSettings.setAutoEquipOptions(items, spells);
	}
	setNotice(notice: string, tone: "success" | "error" = "success"): void {
		if (!this.authenticationModal.classList.contains("is-hidden")) {
			this.authenticationNotice.textContent = notice;
			this.authenticationNotice.classList.toggle("is-hidden", !notice);
			this.authenticationNotice.classList.toggle(
				"is-success",
				Boolean(notice) && tone === "success",
			);
			this.authenticationNotice.classList.toggle(
				"is-error",
				Boolean(notice) && tone === "error",
			);
			return;
		}
		for (const node of [this.noticeNode, this.joinNoticeNode]) {
			node.textContent = notice;
			node.classList.toggle("is-hidden", !notice);
		}
	}
	showCenterToast(message: string): void {
		clearTimeout(this.centerToastTimer);
		this.centerToast.textContent = message;
		this.centerToast.classList.add("is-visible");
		this.centerToastTimer = window.setTimeout(
			() => this.centerToast.classList.remove("is-visible"),
			3200,
		);
	}
	showXpToast(message: string): void {
		this.heroResourceDock.showXpToast(message);
	}
	setPlayer(player: PlayerState): void {
		this.player = player;
		this.setAutoEquipOptions(
			player.progress.autoEquipItems ?? false,
			player.progress.autoEquipSpells ?? false,
		);
		this.updateForceNextWaveButton();
		this.renderDynamicHud();
		if (
			this.staticProgress !== player.progress ||
			this.staticPlayerName !== player.name ||
			this.staticReceivesDeathEchoes !== player.receivesDeathEchoes ||
			this.staticBestWave !== player.maxWaveReached ||
			this.staticSurgeActive !== player.reflectiveSurgeRemaining > 0 ||
			this.staticRapidRegenActive !== player.rapidRegenRemaining > 0
		) {
			this.staticProgress = player.progress;
			this.staticPlayerName = player.name;
			this.staticReceivesDeathEchoes = player.receivesDeathEchoes;
			this.staticBestWave = player.maxWaveReached;
			this.staticSurgeActive = player.reflectiveSurgeRemaining > 0;
			this.staticRapidRegenActive = player.rapidRegenRemaining > 0;
			this.renderStaticHud();
		}
		const actions = player.progress.rarityActions;
		for (const rarity of RARITIES) {
			const select = this.rarityFilterNode.querySelector<HTMLSelectElement>(
				`.rarity-filter-select.rarity-${rarity}`,
			);
			if (select && actions) select.value = actions[rarity] ?? "keep";
		}
		if (this.lastWaveNumber !== player.waveNumber) {
			this.lastWaveNumber = player.waveNumber;
			this.renderRealm();
		}
		this.applyPanelTriggers(player.progress);
		this.updateVisibility();
	}
	configurePanelTriggers(triggers: PanelTriggers): void {
		this.panelTriggers = { ...triggers };
		const newlyCreated =
			triggers.character && triggers.inventory && triggers.multiplayer;
		if (newlyCreated) {
			this.setPanelCollapsed(
				this.characterPanel,
				this.characterToggle,
				"character",
				false,
			);
			this.setPanelCollapsed(
				this.inventoryPanel,
				this.inventoryToggle,
				"inventory",
				false,
			);
			this.spellCatalog.classList.remove("is-hidden");
		} else if (triggers.character)
			this.setPanelCollapsed(
				this.characterPanel,
				this.characterToggle,
				"character",
				true,
			);
		if (!newlyCreated && triggers.inventory)
			this.setPanelCollapsed(
				this.inventoryPanel,
				this.inventoryToggle,
				"inventory",
				true,
			);
		this.multiplayerIntroMask.classList.toggle(
			"is-hidden",
			!triggers.multiplayer,
		);
		this.multiplayerIntro.classList.toggle("is-hidden", !triggers.multiplayer);
	}
	setLeaderboard(heroes: HeroSummary[], onlineCount: number): void {
		this.onlinePlayerCount = onlineCount;
		this.renderPresenceSummary();
		this.leaderboardNode.replaceChildren(
			...heroes.map((hero) => {
				const button = (
					<button
						class={hero.connected ? "is-online" : "is-offline"}
						type="button"
					>
						<strong>
							{rankedName(hero.username, hero.receivesDeathEchoes)}
						</strong>
						<span>
							{hero.souls} {hero.souls === 1 ? "Soul" : "Souls"} · Level{" "}
							{hero.level}
						</span>
					</button>
				) as HTMLButtonElement;
				button.onclick = () => this.callbacks.onInspectHero(hero.id);
				return button;
			}),
		);
	}
	setAccountCharacters(characters: HeroSummary[]): void {
		this.accountCharacters = characters;
		if (!characters.some(({ id }) => id === this.selectedAccountCharacterId))
			this.selectedAccountCharacterId = this.player?.id ?? characters[0]?.id;
		this.renderCharacterSelector();
		this.renderRealm();
	}
	openCharacterSelector(): void {
		if (!this.player || this.realm?.mode !== "training") return;
		this.selectedAccountCharacterId = this.player.id;
		this.renderCharacterSelector();
		this.characterSelector.classList.remove("is-hidden");
	}
	showAuthentication(username: string, mode: "create" | "login"): void {
		this.authenticationMode = mode;
		this.nameInput.value = username;
		this.authenticationTitle.textContent =
			mode === "create"
				? `Create password for ${username}`
				: `Log in as ${username}`;
		const confirmation = this.authenticationModal.querySelector(
			".password-confirmation",
		) as HTMLElement;
		confirmation.hidden = mode === "login";
		this.passwordConfirmationInput.required = mode === "create";
		this.passwordInput.autocomplete =
			mode === "create" ? "new-password" : "current-password";
		this.authenticationNotice.textContent = "";
		this.authenticationNotice.classList.add("is-hidden");
		this.authenticationMask.classList.remove("is-hidden");
		this.authenticationModal.classList.remove("is-hidden");
		this.passwordInput.focus();
	}
	setPublicHero(hero?: PublicHeroProfile): void {
		if (!hero) {
			this.publicSheet.classList.add("is-hidden");
			return;
		}
		if (this.player) {
			this.publicSheet.classList.add("is-hidden");
			this.setInspection(
				{
					id: hero.id,
					name: hero.username,
					kind: "rival",
					level: hero.level,
					stats: hero.stats,
					mainHand: hero.mainHand,
					offHand: hero.offHand,
					amulet: hero.amulet,
					charm: hero.charm,
					carried: [],
					isRival: true,
					xpReward: 0,
					goldReward: 0,
					seed: 0,
					bonusSkills: hero.learnedSkills,
				},
				undefined,
				hero.maxWaveReached,
			);
			return;
		}
		const stats = statsWithItemBonuses(
			hero.stats,
			hero.mainHand,
			hero.offHand,
			hero.amulet,
			hero.charm,
		);
		this.publicSheet.replaceChildren(
			<div class="portrait">
				<strong>{hero.username}</strong>
				<small>
					Level {hero.level} · Best wave {hero.maxWaveReached}
				</small>
			</div>,
			<div class="attribute-grid">
				{STAT_KEYS.map((key) => (
					<span>
						<small>{key}</small>
						<b>{fmt(stats[key])}</b>
					</span>
				))}
			</div>,
			<strong>Effective stats</strong>,
			effectiveStatSheet(
				hero.mainHand,
				hero.offHand,
				hero.amulet,
				hero.charm,
				stats,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				hasThornsSkill(hero.learnedSkills, [
					hero.mainHand,
					hero.offHand,
					hero.amulet,
					hero.charm,
				]),
			),
			<strong>Main hand</strong>,
			equipmentSummary(hero.mainHand, stats, "main"),
			<strong>Offhand</strong>,
			hero.offHand ? (
				equipmentSummary(hero.offHand, stats, "off")
			) : (
				<small>Empty</small>
			),
			<strong>Amulet</strong>,
			hero.amulet ? (
				equipmentSummary(hero.amulet, stats, "off")
			) : (
				<small>Empty</small>
			),
			<strong>Charm</strong>,
			hero.charm ? (
				equipmentSummary(hero.charm, stats, "off")
			) : (
				<small>Empty</small>
			),
			<strong>Skills</strong>,
			<small>
				{[
					...new Set([
						...hero.learnedSkills,
						...(hero.mainHand?.skills ?? []),
						...(hero.offHand?.skills ?? []),
						...(hero.amulet?.skills ?? []),
						...(hero.charm?.skills ?? []),
					]),
				]
					.map((id) => SKILLS[id].label)
					.join(", ") || "None"}
			</small>,
		);
		this.publicSheet.classList.remove("is-hidden");
	}
	clearPlayer(): void {
		this.player = undefined;
		this.realm = undefined;
		this.inspected = undefined;
		this.committedInspection = undefined;
		this.characterCollapsedBeforeInspection = undefined;
		this.setGroundDropPreview();
		this.staticProgress = undefined;
		this.heroResourceDock.clear();
		this.updateVisibility();
	}
	setInspection(
		build?: UnitBuild,
		xpReward?: number,
		bestWave?: number,
		maxHp?: number,
		health?: number,
	): void {
		const hadInspection = Boolean(this.committedInspection?.build);
		if (build && !hadInspection) {
			this.characterCollapsedBeforeInspection =
				this.characterPanel.classList.contains("is-collapsed");
			this.setPanelCollapsed(
				this.characterPanel,
				this.characterToggle,
				"character",
				false,
			);
		} else if (!build && hadInspection) {
			this.setPanelCollapsed(
				this.characterPanel,
				this.characterToggle,
				"character",
				this.characterCollapsedBeforeInspection ?? false,
			);
			this.characterCollapsedBeforeInspection = undefined;
		}
		this.committedInspection = { build, xpReward, bestWave, maxHp, health };
		this.showInspection(build, xpReward, bestWave, maxHp, health);
	}
	setInspectionPreview(
		build?: UnitBuild,
		xpReward?: number,
		bestWave?: number,
		maxHp?: number,
		health?: number,
		states?: CreepTimedStates,
	): void {
		void xpReward;
		void bestWave;
		this.renderCreepPreview(build, maxHp, health, states);
	}
	clearInspectionPreview(): void {
		this.renderCreepPreview();
	}
	private renderCreepPreview(
		build?: UnitBuild,
		maxHp?: number,
		health?: number,
		states?: CreepTimedStates,
	): void {
		this.creepPreview.classList.toggle("is-hidden", !build);
		if (!build) {
			this.creepPreview.replaceChildren();
			return;
		}
		this.creepPreview.replaceChildren(
			<div class="creep-preview-heading">
				<strong>{build.name}</strong>
				<small>Level {build.level}</small>
			</div>,
			<div class="inspection-health">
				<small>HP</small>
				<strong>
					{fmt(health ?? maxHp ?? 0)} / {fmt(maxHp ?? 0)}
				</strong>
			</div>,
			creepStateBadges(states),
			<div class="equipped-icons" aria-label="Equipped items">
				{equipmentIcon(build.mainHand, "Main hand")}
				{equipmentIcon(build.offHand, "Offhand")}
				{equipmentIcon(build.amulet, "Amulet")}
				{equipmentIcon(build.charm, "Charm")}
			</div>,
			<div class="attribute-grid">
				{STAT_KEYS.map((key) => (
					<span data-stat={key}>
						<small>{key}</small>
						<b>{fmt(build.stats[key])}</b>
					</span>
				))}
			</div>,
		);
	}
	private showInspection(
		build?: UnitBuild,
		xpReward?: number,
		bestWave?: number,
		maxHp?: number,
		health?: number,
	): void {
		void xpReward;
		this.inspected = build;
		this.inspectedBestWave = build ? bestWave : undefined;
		this.inspectedMaxHp = build ? maxHp : undefined;
		this.inspectedHealth = build ? health : undefined;
		this.renderStaticHud();
	}
	setRealm(realm: RealmState): void {
		const startedNewRealm =
			this.realm?.mode === "training" && realm.mode !== "training";
		const returnedToLobby =
			this.realm !== undefined &&
			this.realm.mode !== "training" &&
			realm.mode === "training";
		const modeChanged = this.realm?.mode !== realm.mode;
		this.realm = realm;
		if (realm.challenge === "agreed" || realm.challenge === "active")
			this.swarmMode = false;
		if (realm.mode !== "training") this.closeCharacterSelector();
		if (startedNewRealm) {
			this.swarmMode = false;
			this.forceNextWavePending = false;
		}
		this.renderRealm();
		if (returnedToLobby) this.openLobbyPanels();
		if (modeChanged && this.player) this.renderInventory(this.player.progress);
	}
	setForceNextWaveReadyAt(readyAt: number): void {
		this.forceNextWaveReadyAt = readyAt;
		this.forceNextWavePending = false;
		this.updateForceNextWaveButton();
	}
	trySwarmMode(): void {
		if (
			this.realm?.mode === "training" ||
			!this.swarmMode ||
			this.forceNextWavePending ||
			Date.now() < this.forceNextWaveReadyAt
		)
			return;
		this.requestForceNextWave();
	}
	focusChat(): void {
		this.chatInput.focus();
	}
	setGroundDropPreview(drop?: GroundDrop): void {
		this.itemHoverCard.replaceChildren();
		this.itemHoverCard.classList.toggle("is-hidden", !drop || !this.player);
		if (!drop || !this.player) return;
		if (drop.kind !== "item") {
			const label =
				drop.kind === "gold"
					? "Gold"
					: `${drop.rarity[0].toUpperCase()}${drop.rarity.slice(1)} Scrap`;
			const card = (
				<div
					class={`ground-resource-card ${drop.kind === "gold" ? "is-gold" : `rarity-${drop.rarity}`}`}
				>
					<strong>{label}</strong>
					<span>
						<small>Quantity</small>
						<b>{drop.amount}</b>
					</span>
				</div>
			) as HTMLElement;
			this.itemHoverCard.append(card);
			return;
		}
		const item = drop.item;
		const card = itemTile(
			{
				id: `ground-${item.seed}`,
				key: itemStackKey(item),
				item,
				quantity: 1,
			},
			this.callbacks,
			this.player.progress,
		);
		card.classList.add("item-hover-card-copy");
		card.removeAttribute("data-tile-id");
		card.removeAttribute("data-stack-key");
		card.querySelector(".item-card-controls")?.remove();
		this.itemHoverCard.append(card);
	}
	togglePanelShortcut(kind: "character" | "inventory"): void {
		if (!this.player) return;
		if (kind === "character" && this.committedInspection?.build) return;
		if (kind === "character")
			this.togglePanel(
				this.characterPanel,
				this.characterToggle,
				"character",
				true,
			);
		else
			this.togglePanel(
				this.inventoryPanel,
				this.inventoryToggle,
				"inventory",
				true,
			);
	}
	pushChatMessage(
		senderId: string,
		senderName: string,
		text: string,
		kind: "chat" | "system" = "chat",
	): void {
		if (kind === "system") {
			const entry = (
				<div class="chat-entry chat-system">{text}</div>
			) as HTMLElement;
			this.chatLog.append(entry);
			if (this.chatLog.children.length > 50)
				this.chatLog.firstElementChild?.remove();
			this.chatLog.scrollTop = this.chatLog.scrollHeight;
			return;
		}
		const isTeammate =
			this.player && this.realm
				? this.realm.guards.some((m) => m.id === senderId) ===
					this.realm.guards.some((m) => m.id === this.player!.id)
				: false;
		const entry = (
			<div class="chat-entry">
				<span
					class={isTeammate ? "chat-name chat-team" : "chat-name chat-opponent"}
				>
					{senderName}
				</span>
				: {text}
			</div>
		) as HTMLElement;
		this.chatLog.append(entry);
		if (this.chatLog.children.length > 50)
			this.chatLog.firstElementChild?.remove();
		this.chatLog.scrollTop = this.chatLog.scrollHeight;
	}
	setSpells(spells: SpellSlot[]): void {
		this.currentSpells = spells;
		this.renderSpellSlots();
		this.renderSpellCatalog();
	}
	setAiming(aiming: boolean): void {
		this.aimReticle.classList.toggle("is-hidden", !aiming);
	}
	toggleSpellCatalog(): void {
		this.spellCatalog.classList.toggle("is-hidden");
		if (!this.spellCatalog.classList.contains("is-hidden")) {
			this.spellCatalogFilters = new Set(["learned", "equipped", "actives"]);
			this.spellCatalogSignature = "";
			this.renderSpellCatalog("");
			this.spellCatalog
				.querySelector<HTMLElement>(".spell-catalog-scroll")
				?.focus();
		}
	}
	assignHoveredSpell(slot: number): boolean {
		void slot;
		return !this.spellCatalog.classList.contains("is-hidden");
	}
	private renderSpellCatalog(searchText?: string): void {
		const available = new Map(
			this.currentSpells.map((spell) => [spell.id, spell]),
		);
		const signature = (Object.keys(SKILLS) as SkillId[])
			.map((id) => {
				const spell = available.get(id);
				return `${id}:${spell?.actualLevel ?? ""}:${Number(Boolean(spell?.passive))}:${Number(Boolean(spell?.active))}:${spell?.shortcut ?? ""}:${this.player?.progress.learnedSkillLevels[id] ?? 0}`;
			})
			.join("|");
		if (signature === this.spellCatalogSignature) return;
		this.spellCatalogSignature = signature;
		const previousScrollTop =
			this.spellCatalog.querySelector<HTMLElement>(".spell-catalog-scroll")
				?.scrollTop ?? 0;
		const close = (
			<button class="spell-catalog-close" type="button">
				×
			</button>
		) as HTMLButtonElement;
		close.onclick = () => this.spellCatalog.classList.add("is-hidden");
		const filterButtons = (
			<div class="spell-catalog-filter-buttons" aria-label="Spell filters" />
		) as HTMLElement;
		for (const group of SPELL_CATALOG_FILTER_GROUPS) {
			const filterGroup = (
				<div class="spell-catalog-filter-group" />
			) as HTMLElement;
			for (const [filter, label] of group) {
				const control = (
					<label class="spell-catalog-filter-button">
						<input type="checkbox" value={filter} />
						<span>{label}</span>
					</label>
				) as HTMLLabelElement;
				const input = control.querySelector("input") as HTMLInputElement;
				input.checked = this.spellCatalogFilters.has(filter);
				input.onchange = () => {
					if (input.checked) this.spellCatalogFilters.add(filter);
					else this.spellCatalogFilters.delete(filter);
					this.updateCatalogFilters();
				};
				filterGroup.append(control);
			}
			filterButtons.append(filterGroup);
		}
		const search = (
			<label class="spell-catalog-filter spell-catalog-search">
				<span>Search</span>
				<input
					autofocus="on"
					type="search"
					placeholder="Name, effect, resource…"
				/>
			</label>
		) as HTMLLabelElement;
		const searchInput = search.querySelector("input") as HTMLInputElement;
		searchInput.value = this.spellCatalogSearch;
		searchInput.oninput = () => {
			this.spellCatalogSearch = searchInput.value;
			this.updateCatalogFilters();
		};
		const filters = (
			<div class="spell-catalog-filters">
				{search}
				{filterButtons}
			</div>
		) as HTMLElement;
		const slots = (
			<div class="spell-catalog-slots" aria-label="Equipped spell slots" />
		) as HTMLElement;
		const equipped = this.currentSpells
			.filter((spell) => spell.active && !spell.passive && spell.shortcut)
			.sort((a, b) => (a.shortcut ?? 0) - (b.shortcut ?? 0));
		for (let slot = 1; slot <= 6; slot += 1) {
			const occupant = equipped.find((spell) => spell.shortcut === slot);
			const destination = (
				<button class="spell-catalog-slot" type="button">
					<small>{slot}</small>
					<strong>{occupant?.label ?? "Empty"}</strong>
				</button>
			) as HTMLButtonElement;
			destination.onclick = () => {
				if (!this.selectedCatalogSpell) return;
				this.callbacks.onSetSkillEquipped(
					this.selectedCatalogSpell,
					true,
					slot,
				);
				this.selectedCatalogSpell = undefined;
				this.updateCatalogSelection();
			};
			slots.append(destination);
		}
		const scroll = (
			<div
				class="spell-catalog-scroll"
				tabindex="0"
				aria-label="Spell catalog entries"
			/>
		) as HTMLElement;
		scroll.addEventListener(
			"wheel",
			(event) => {
				scroll.scrollTop += event.deltaY;
				event.preventDefault();
			},
			{ passive: false },
		);
		const sortedIds = (Object.keys(SKILLS) as SkillId[]).sort(
			(a, b) =>
				spellCatalogResourceOrder(SKILLS[a].resource) -
					spellCatalogResourceOrder(SKILLS[b].resource) ||
				SKILLS[a].label.localeCompare(SKILLS[b].label),
		);
		let currentResource: SpellSlot["resource"] | undefined;
		let grid: HTMLElement | undefined;
		for (const id of sortedIds) {
			const spell = available.get(id);
			const acquired = Boolean(spell);
			const definition = SKILLS[id];
			if (definition.resource !== currentResource) {
				currentResource = definition.resource;
				grid = (<div class="spell-catalog-grid" />) as HTMLElement;
				scroll.append(
					<h3
						class={`spell-catalog-resource spell-resource-${currentResource}`}
					>
						{spellResourceLabel(currentResource)}
					</h3>,
					grid,
				);
			}
			const learnedLevel = Math.max(
				0,
				this.player?.progress.learnedSkillLevels[id] ?? 0,
			);
			const card = (
				<button
					class={`spell-catalog-card spell-resource-${definition.resource}${acquired ? "" : " is-locked"}${learnedLevel > 0 ? "" : " is-not-learned"}`}
					type="button"
					aria-disabled={String(!acquired)}
					tabindex={acquired ? "0" : "-1"}
					data-spell-id={id}
					data-learned={String(learnedLevel > 0)}
					data-equipped={String(spell?.bar === "geared")}
					data-active={String(!definition.passive)}
					data-passive={String(Boolean(definition.passive))}
					data-unavailable={String(!acquired)}
					data-search={`${id} ${definition.label} ${definition.description} ${spellResourceLabel(definition.resource)}`}
				>
					<span class="spell-catalog-card-heading">
						<strong>{definition.label}</strong>
						<small>
							{spell?.passive || definition.passive
								? "Passive · Always active"
								: "Active"}
						</small>
					</span>
					<span class="spell-catalog-description">
						{definition.description}
					</span>
					<span class="spell-catalog-levels">
						<span>
							Available level <b>{spell?.actualLevel ?? "—"}</b>
						</span>
						<span>
							Max learned <b>{learnedLevel}</b>
						</span>
					</span>
					<small class="spell-catalog-resource-label">
						Resource: {spellResourceLabel(definition.resource)}
					</small>
					{learnedLevel === 0 ? (
						<small class="spell-catalog-source">
							Source: {SPELL_SOURCES[id]}
						</small>
					) : null}
				</button>
			) as HTMLButtonElement;
			if (acquired && !spell?.passive) {
				card.onclick = () => {
					this.selectedCatalogSpell = id;
					this.updateCatalogSelection();
				};
			}
			grid?.append(card);
		}
		this.spellCatalog.replaceChildren(
			<h2>Available Spells</h2>,
			<p>Tap a spell, then tap one of the six destination slots.</p>,
			close,
			filters,
			slots,
			scroll,
		);
		scroll.scrollTop = previousScrollTop;
		this.updateCatalogFilters();
		this.updateCatalogSelection();
		if (typeof searchText === "string") {
			searchInput.value = searchText;
			searchInput.select();
		}
	}
	private updateCatalogFilters(): void {
		for (const card of this.spellCatalog.querySelectorAll<HTMLElement>(
			".spell-catalog-card[data-spell-id]",
		)) {
			card.hidden = !spellCatalogFilterMatches(
				{
					learned: card.dataset.learned === "true",
					equipped: card.dataset.equipped === "true",
					actives: card.dataset.active === "true",
					passives: card.dataset.passive === "true",
					unavailable: card.dataset.unavailable === "true",
				},
				this.spellCatalogFilters,
				this.spellCatalogSearch,
				card.dataset.search,
			);
		}
		for (const grid of this.spellCatalog.querySelectorAll<HTMLElement>(
			".spell-catalog-grid",
		)) {
			const empty = !grid.querySelector(".spell-catalog-card:not([hidden])");
			grid.hidden = empty;
			if (grid.previousElementSibling instanceof HTMLElement)
				grid.previousElementSibling.hidden = empty;
		}
	}
	private updateCatalogSelection(): void {
		for (const card of this.spellCatalog.querySelectorAll<HTMLElement>(
			".spell-catalog-card[data-spell-id]",
		))
			card.classList.toggle(
				"is-selected",
				card.dataset.spellId === this.selectedCatalogSpell,
			);
		this.spellCatalog.classList.toggle(
			"has-selected-spell",
			Boolean(this.selectedCatalogSpell),
		);
	}
	private previewSpellLevels(skills?: SkillId[]): void {
		this.spellPreviewProgress = undefined;
		this.spellPreviewKind = skills ? "extract" : undefined;
		this.spellPreview =
			skills && this.player
				? new Map(
						skills.map((id) => [
							id,
							extractedLearnedLevel(
								this.player!.progress.learnedSkillLevels[id] ?? 0,
							),
						]),
					)
				: undefined;
		this.renderSpellSlots();
	}
	private renderSpellSlots(): void {
		const preview = this.spellPreview;
		const ids = new Set<SkillId>([
			...this.currentSpells.map((spell) => spell.id),
			...(preview?.keys() ?? []),
		]);
		const spells = [...ids].map(
			(id) =>
				this.currentSpells.find((spell) => spell.id === id) ?? {
					id,
					label: SKILLS[id].label,
					level: 0,
					actualLevel: 0,
					cooldown: 0,
					cooldownMax: 0,
					affordable: true,
					resource: SKILLS[id].resource,
					costLabel: SKILLS[id].upkeep
						? `${SKILLS[id].upkeep!.resource}/s`
						: capitalize(SKILLS[id].resource),
					active: false,
					passive: Boolean(SKILLS[id].passive),
					autoFire: false,
					bar: this.player?.progress.learnedSkills.includes(id)
						? ("learned" as const)
						: ("geared" as const),
				},
		);
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
		const visible = [...passiveSpells, ...activeSpells];
		const hasHiddenExtractPreview =
			this.spellPreviewKind === "extract" &&
			Boolean(
				preview &&
					[...preview.keys()].some(
						(id) => !visible.some((spell) => spell.id === id),
					),
			);
		const structure = [
			this.spellPreviewKind ?? "none",
			String(hasHiddenExtractPreview),
			...visible.map(
				({
					id,
					label,
					level,
					resource,
					bar,
					active,
					passive,
					autoFire,
					shortcut,
					procChancesOnAttacks,
					providedByItemName,
				}) =>
					`${bar}:${id}:${label}:${level}:${resource}:${active}:${passive}:${autoFire}:${shortcut ?? ""}:${procChancesOnAttacks ?? ""}:${providedByItemName ?? ""}:${preview?.get(id) ?? ""}`,
			),
		].join("|");
		if (structure !== this.spellStructureSignature) {
			this.spellStructureSignature = structure;
			this.spellNodes.clear();
			this.learnedSkillsList.replaceChildren(
				...visible.map((spell) => this.renderSpellSlot(spell, preview)),
			);
			this.learnedSkillsBar.replaceChildren(
				this.learnedSkillsList,
				<small class="skill-bar-label">Spells</small>,
				<button
					class={`spell-catalog-trigger${hasHiddenExtractPreview ? " is-extract-preview" : ""}`}
					type="button"
					aria-label="Open available spells"
				>
					...
				</button>,
			);
			const trigger = this.learnedSkillsBar.querySelector<HTMLButtonElement>(
				".spell-catalog-trigger",
			);
			if (trigger) trigger.onclick = () => this.toggleSpellCatalog();
			this.spellBar.replaceChildren(
				...(visible.length ? [this.learnedSkillsBar] : [this.learnedSkillsBar]),
			);
		}
		for (const spell of spells) {
			const ratio =
				spell.cooldownMax > 0
					? Math.max(0, Math.min(1, spell.cooldown / spell.cooldownMax))
					: 0;
			const cooldownNode = this.spellNodes.get(spell.id);
			cooldownNode?.style.setProperty("--cooldown-progress", String(ratio));
			const button = cooldownNode?.parentElement;
			button?.classList.toggle("is-casting", spell.castProgress !== undefined);
			button?.classList.toggle(
				"is-unaffordable",
				spell.active && !spell.affordable,
			);
			button?.style.setProperty(
				"--cast-progress",
				String(spell.castProgress ?? 0),
			);
		}
	}
	private renderSpellSlot(
		spell: SpellSlot,
		preview?: Map<SkillId, number | null>,
	): HTMLButtonElement {
		const cooldown = (<span class="spell-cooldown" />) as HTMLElement;
		this.spellNodes.set(spell.id, cooldown);
		const projected = preview?.get(spell.id);
		const actualLevel =
			projected === undefined ? spell.actualLevel : (projected ?? 0);
		const shownLevel =
			projected !== undefined && this.spellPreviewKind === "extract"
				? actualLevel
				: Math.min(actualLevel, this.player?.progress.level ?? actualLevel);
		const levelValue: PreviewValue<string> = {
			currentVal: formatSpellLevel(spell.level),
			newVal: formatSpellLevel(shownLevel),
		};
		const changed =
			projected !== undefined &&
			(this.spellPreviewKind === "extract" || projected !== spell.actualLevel);
		const button = (
			<button
				class={`spell-slot spell-resource-${spell.resource}${spell.passive ? " is-passive" : ""}${spell.active && spell.cooldown <= 0 ? " is-ready" : ""}${spell.active ? "" : " is-disabled"}${spell.active && !spell.affordable ? " is-unaffordable" : ""}${changed ? (this.spellPreviewKind !== "extract" && (projected === null || projected < spell.actualLevel) ? " is-level-cost-preview" : " is-level-preview") : ""}`}
				type="button"
				aria-label={`${spell.label}, level ${formatPreviewValue(levelValue)}, ${spell.passive ? "passive, always active" : spell.active ? `equipped in slot ${spell.shortcut}${spell.autoFire ? ", auto-fire enabled" : ""}` : "unequipped"}`}
				aria-pressed={String(spell.active)}
			>
				{cooldown}
				{spell.shortcut ? (
					<span class="spell-shortcut" aria-hidden="true">
						{spell.autoFire ? (
							<span class="spell-shortcut-dot" />
						) : (
							spell.shortcut
						)}
					</span>
				) : null}
				{spell.autoFire ? (
					<span class="spell-auto-fire" aria-label="Auto-fire enabled" />
				) : null}
				<strong>
					{spellInitials(spell.label)}
					<small class="spell-level">lv{formatPreviewValue(levelValue)}</small>
				</strong>
				{this.renderSkillTooltip(spell, shownLevel)}
			</button>
		) as HTMLButtonElement;
		const tooltip = button.querySelector<HTMLElement>(".spell-tooltip");
		if (tooltip) {
			button.addEventListener("mouseenter", () =>
				this.showSpellTooltip(button, tooltip),
			);
			button.addEventListener("mouseleave", () => this.hideSpellTooltip());
			button.addEventListener("focus", () =>
				this.showSpellTooltip(button, tooltip),
			);
			button.addEventListener("blur", () => this.hideSpellTooltip());
		}
		button.onclick = () => {
			if (!spell.passive)
				this.callbacks.onSetSkillEquipped(spell.id, !spell.active);
		};
		button.oncontextmenu = (event) => {
			event.preventDefault();
			if (spell.active && !spell.passive)
				this.callbacks.onToggleSkillAutoFire(spell.id);
		};
		return button;
	}
	private showSpellTooltip(
		button: HTMLButtonElement,
		template: HTMLElement,
	): void {
		this.hideSpellTooltip();
		const tooltip = template.cloneNode(true) as HTMLElement;
		tooltip.classList.add("is-overlay", "is-visible");
		document.body.append(tooltip);
		const tooltipRect = tooltip.getBoundingClientRect();
		const position = viewportTooltipPosition(
			button.getBoundingClientRect(),
			tooltipRect.width,
			tooltipRect.height,
			window.innerWidth,
			window.innerHeight,
		);
		tooltip.style.left = `${position.left}px`;
		tooltip.style.top = `${position.top}px`;
		this.spellTooltipOverlay = tooltip;
	}
	private hideSpellTooltip(): void {
		this.spellTooltipOverlay?.remove();
		this.spellTooltipOverlay = undefined;
	}
	private renderSkillTooltip(spell: SpellSlot, level: number): HTMLElement {
		const shownLevel = Math.max(0, Math.min(MAX_SKILL_LEVEL, level));
		const skill = SKILLS[spell.id];
		const progress = this.spellPreviewProgress ?? this.player?.progress;
		const maxLearnedLevel = progress?.learnedSkillLevels[spell.id] ?? 0;
		return (
			<span class="spell-tooltip" role="tooltip">
				<b>{skill.label}</b>
				<span class="spell-tooltip-description">{skill.description}</span>
				<span class="spell-tooltip-description">
					{spell.procChancesOnAttacks !== undefined
						? "Passive weapon proc — may trigger from each basic attack."
						: spell.passive
							? "Passive — always active while available."
							: spell.active
								? `Equipped as ${spell.shortcut}. Press ${spell.shortcut} to cast; right-click toggles auto-fire.`
								: "Click to equip this spell (maximum 6)."}
				</span>
				{spell.providedByItemName ? (
					<span class="spell-tooltip-description">
						Source: {spell.providedByItemName}
					</span>
				) : null}
				{skillStatBonusDescription(spell.id) ? (
					<span class="spell-tooltip-description">
						{skillStatBonusDescription(spell.id)}
					</span>
				) : null}
				<span class="spell-tooltip-comparison">
					{spellTooltipLevels(shownLevel, maxLearnedLevel).map(
						({ level, heading }) =>
							this.renderSkillProperties(spell, level, heading),
					)}
				</span>
			</span>
		) as HTMLElement;
	}
	private renderSkillProperties(
		spell: SpellSlot,
		level: number,
		heading: string,
	): HTMLElement {
		const shownLevel = Math.max(0, Math.min(MAX_SKILL_LEVEL, level));
		const skill = SKILLS[spell.id];
		const progress = this.spellPreviewProgress ?? this.player?.progress;
		const stats = progress
			? statsWithItemBonuses(
					progress.stats,
					progress.mainHand,
					progress.offHand,
					progress.amulet,
					progress.charm,
				)
			: undefined;
		const cooldownSeconds =
			progress && stats
				? effectiveSkillCooldown(
						spell.id,
						progress.mainHand,
						stats,
						shownLevel,
						Math.min(
							0.6,
							derivedStats(stats).cooldownReduction +
								itemCooldownReduction(
									progress.offHand,
									progress.amulet,
									progress.charm,
								),
						),
					)
				: Math.max(3, skill.cooldown);
		const range =
			progress && stats
				? skillRange(spell.id, progress.mainHand, shownLevel, stats.spirit)
				: skill.range;
		const damage = skillDamagePreview(
			spell.id,
			shownLevel,
			stats ?? {
				strength: 0,
				agility: 0,
				spirit: 0,
				intelligence: 0,
			},
		);
		const castTime = skillCastTime(
			spell.id,
			shownLevel,
			stats?.agility ?? 0,
			attackProfile(
				progress?.mainHand,
				stats ?? {
					strength: 0,
					agility: 0,
					spirit: 0,
					intelligence: 0,
				},
				BALANCE,
			).attacksPerSecond,
		);
		const costLabel =
			spell.id === "blocking" && progress && stats
				? progress.offHand?.itemKind === "buckler" &&
					progress.offHand.rarity === "unique"
					? "1% max Mana / block; no cooldown; +1 Rage"
					: `${fmt(progress.offHand ? bucklerBlockCost(progress.offHand, stats) : 0)} Rage / block`
				: spell.costLabel;
		if (spell.procChancesOnAttacks !== undefined) {
			const procChance = weaponSkillTriggerChance(cooldownSeconds);
			return (
				<span class="spell-tooltip-property-column">
					<b>{heading}</b>
					<span class="spell-tooltip-stats">
						<span>
							<small>Level</small>
							<strong>{shownLevel}</strong>
						</span>
						<span>
							<small>Activation</small>
							<strong>Attack proc</strong>
						</span>
						<span>
							<small>Proc chance on attacks</small>
							<strong>{fmt(procChance * 100)}%</strong>
						</span>
						{damage ? (
							<span>
								<small>Damage</small>
								<strong>{formatSkillDamage(damage)}</strong>
							</span>
						) : null}
						<span>
							<small>Cooldown</small>
							<strong>{fmt(cooldownSeconds)}s</strong>
						</span>
						<span>
							<small>Range</small>
							<strong>
								{range ? `${fmt(pixelsToMeters(range))} m` : "Self"}
							</strong>
						</span>
					</span>
				</span>
			) as HTMLElement;
		}
		if (skill.passive) {
			const upkeep =
				skill.upkeep && progress && stats
					? skillUpkeepPerSecond(
							spell.id,
							shownLevel,
							resourceReduction(progress, "mana", stats),
						)
					: 0;
			return (
				<span class="spell-tooltip-property-column">
					<b>{heading}</b>
					<span class="spell-tooltip-stats">
						<span>
							<small>Level</small>
							<strong>{shownLevel}</strong>
						</span>
						<span>
							<small>Activation</small>
							<strong>
								{spell.id === "manaDrain" ? "Critical aura" : "Continuous"}
							</strong>
						</span>
						{skill.upkeep ? (
							<span>
								<small>Upkeep</small>
								<strong>
									{fmt(upkeep)} {capitalize(skill.upkeep.resource)}/s
								</strong>
							</span>
						) : null}
						{passiveSkillMetrics(spell.id, shownLevel, stats).map((metric) => (
							<span>
								<small>{metric.label}</small>
								<strong>{metric.value}</strong>
							</span>
						))}
					</span>
				</span>
			) as HTMLElement;
		}
		return (
			<span class="spell-tooltip-property-column">
				<b>{heading}</b>
				<span class="spell-tooltip-stats">
					<span>
						<small>Level</small>
						<strong>{shownLevel}</strong>
					</span>
					<span>
						<small>Cost</small>
						<strong>{costLabel}</strong>
					</span>
					{skill.upkeep && progress && stats ? (
						<span>
							<small>Upkeep</small>
							<strong>
								{fmt(
									skillUpkeepPerSecond(
										spell.id,
										shownLevel,
										resourceReduction(progress, "mana", stats),
									),
								)}{" "}
								{capitalize(skill.upkeep.resource)}/s
							</strong>
						</span>
					) : null}
					{damage ? (
						<span>
							<small>Damage</small>
							<strong>{formatSkillDamage(damage)}</strong>
						</span>
					) : null}
					<span>
						<small>Cooldown</small>
						<strong>{fmt(cooldownSeconds)}s</strong>
					</span>
					{castTime > 0 ? (
						<span>
							<small>Cast time</small>
							<strong>{fmt(castTime)}s</strong>
						</span>
					) : null}
					<span>
						<small>Range</small>
						<strong>
							{range ? `${fmt(pixelsToMeters(range))} m` : "Self"}
						</strong>
					</span>
					{spell.id === "whirlwind" ? (
						<span>
							<small>Duration</small>
							<strong>{fmt(whirlwindDuration(shownLevel))}s</strong>
						</span>
					) : null}
					{spell.id === "blizzard" ? (
						<span>
							<small>Duration</small>
							<strong>{fmt(blizzardDuration(shownLevel))}s</strong>
						</span>
					) : null}
					{spell.id === "blizzard" ? (
						<span>
							<small>Rainfall</small>
							<strong>{fmt(blizzardProjectilesPerSecond(shownLevel))}/s</strong>
						</span>
					) : null}
					{spell.id === "blizzard" ? (
						<span>
							<small>Impact area</small>
							<strong>
								{fmt(pixelsToMeters(blizzardRadius(shownLevel)))} m
							</strong>
						</span>
					) : null}
					{spell.id === "whirlwind" ? (
						<span>
							<small>Movement</small>
							<strong>{fmt(whirlwindMovementSpeed(shownLevel))}×</strong>
						</span>
					) : null}
					{spell.id === "orbitingHammers" ? (
						<span>
							<small>Duration</small>
							<strong>{fmt(orbitingHammerDuration(shownLevel))}s</strong>
						</span>
					) : null}
					{spell.id === "rapidRegen" ? (
						<span>
							<small>Duration</small>
							<strong>{fmt(rapidRegenDuration(shownLevel))}s</strong>
						</span>
					) : null}
					{spell.id === "reflectiveSurge" ? (
						<span>
							<small>Duration</small>
							<strong>{fmt(reflectiveSurgeDuration(shownLevel))}s</strong>
						</span>
					) : null}
					{spell.id === "reflectiveSurge" ? (
						<span>
							<small>Block chance</small>
							<strong>
								+{fmt(reflectiveSurgeBlockChanceBonus(shownLevel) * 100)}%
							</strong>
						</span>
					) : null}
					{spell.id === "reflectiveSurge" ? (
						<span>
							<small>Block cap</small>
							<strong>95%</strong>
						</span>
					) : null}
					{spell.id === "rendingThrow" ? (
						<span>
							<small>Targets</small>
							<strong>{rendingThrowTargetLimit(shownLevel)}</strong>
						</span>
					) : null}
					{spell.id === "rendingThrow" ? (
						<span>
							<small>Pierce</small>
							<strong>{rendingThrowPierce(shownLevel)}</strong>
						</span>
					) : null}
					{spell.id === "rendingThrow" ? (
						<span>
							<small>Bleed</small>
							<strong>{RENDING_THROW_BLEED_DURATION}s at 0.25/s</strong>
						</span>
					) : null}
					{spell.id === "healing" ? (
						<span>
							<small>Current HP heal</small>
							<strong>{fmt(healingFraction(shownLevel) * 100)}%</strong>
						</span>
					) : null}
					{spell.id === "healing" ? (
						<span>
							<small>Auto-cast</small>
							<strong>≤50% HP</strong>
						</span>
					) : null}
					{spell.id === "rapidRegen" ? (
						<span>
							<small>Regen</small>
							<strong>
								{fmt(rapidRegenMultiplier(shownLevel) * 100)}% +0.1/s
							</strong>
						</span>
					) : null}
				</span>
			</span>
		) as HTMLElement;
	}
	showDeathModal(detail?: string): void {
		const message = this.deathModal.querySelector("#death-modal-detail");
		if (message)
			message.textContent =
				detail ??
				"Your legacy inherited your remaining resources and spellbooks and will try to avenge you…";
		this.deathModal.classList.remove("is-hidden");
	}
	closeDeathModal(): void {
		this.deathModal.classList.add("is-hidden");
	}
	private renderDynamicHud(): void {
		if (!this.player) return;
		const p = this.player.progress;
		const compiled = projectUnitState({
			baseStats: p.stats,
			mainHand: p.mainHand,
			offHand: p.offHand,
			amulet: p.amulet,
			charm: p.charm,
			effects: statEffects(
				activeStatBuffs(this.player, p),
				hasThornsSkill(p.learnedSkills, [
					p.mainHand,
					p.offHand,
					p.amulet,
					p.charm,
				]),
			),
		});
		const healthRegen = this.player.healthRegen || compiled.healthRegen;
		this.heroResourceDock.update(this.player, healthRegen, compiled.manaRegen);
		this.activeMainHand?.style.setProperty(
			"--attack-progress",
			`${(this.inspected ? 1 : this.player.attackProgress) * 100}%`,
		);
	}
	private renderStaticHud(): void {
		if (!this.player) return;
		const p = this.player.progress;
		const build = this.inspected;
		const creepInspection = Boolean(
			build && this.inspectedBestWave === undefined,
		);
		const stats = build?.stats ?? p.stats;
		const main = build?.mainHand ?? p.mainHand;
		const off = build?.offHand ?? p.offHand;
		const amulet = build?.amulet ?? p.amulet;
		const charm = build?.charm ?? p.charm;
		const effectiveStats = statsWithItemBonuses(
			stats,
			main,
			off,
			amulet,
			charm,
		);
		const blockingLevel = build
			? (build.skillLevels?.blocking ??
				([main, off, amulet, charm].some((item) =>
					item?.skills.includes("blocking"),
				)
					? 1
					: 0))
			: effectiveSkillLevel(p, "blocking");
		const attractionLevel = build
			? (build.skillLevels?.attraction ??
				([main, off, amulet, charm].some((item) =>
					item?.skills.includes("attraction"),
				)
					? 1
					: 0))
			: effectiveSkillLevel(p, "attraction");
		const buffs = build ? undefined : activeStatBuffs(this.player, p);
		const thornsActive = build
			? Boolean(
					build.skillLevels?.thorns ||
						[main, off, amulet, charm].some((item) =>
							item?.skills.includes("thorns"),
						),
				)
			: hasThornsSkill(p.learnedSkills, [main, off, amulet, charm]);
		const mainSummary = equipmentSummary(main, effectiveStats, "main");
		this.activeMainHand = build ? mainSummary : undefined;
		this.sheetNode.replaceChildren(
			<div class="portrait">
				<strong>
					{build
						? build.name
						: rankedName(this.player.name, this.player.receivesDeathEchoes)}
				</strong>
				<small>
					Level {build?.level ?? p.level}
					{build
						? creepInspection
							? ""
							: ` · Best wave ${this.inspectedBestWave}`
						: ` · Best wave ${this.player.maxWaveReached}`}
				</small>
			</div>,
			...(creepInspection
				? [
						<div class="inspection-health">
							<small>HP</small>
							<strong>
								{fmt(this.inspectedHealth ?? this.inspectedMaxHp ?? 0)} /{" "}
								{fmt(this.inspectedMaxHp ?? 0)}
							</strong>
						</div>,
					]
				: []),
			<div class="equipped-icons" aria-label="Equipped items">
				{equipmentIcon(main, "Main hand")}
				{equipmentIcon(off, "Offhand")}
				{equipmentIcon(amulet, "Amulet")}
				{equipmentIcon(charm, "Charm")}
			</div>,
			<div class="attribute-grid">
				{STAT_KEYS.map((key) => (
					<span data-stat={key}>
						<small>{key}</small>
						<b>{fmt(creepInspection ? stats[key] : effectiveStats[key])}</b>
					</span>
				))}
			</div>,
			this.allocationNode,
			...(creepInspection
				? []
				: [
						<strong>Effective stats</strong>,
						effectiveStatSheet(
							main,
							off,
							amulet,
							charm,
							effectiveStats,
							undefined,
							this.inspectedMaxHp,
							blockingLevel,
							attractionLevel,
							buffs,
							thornsActive,
						),
					]),
			...(build
				? [
						<strong>Main hand</strong>,
						mainSummary,
						<strong>Offhand</strong>,
						off ? (
							equipmentSummary(off, effectiveStats, "off")
						) : (
							<small>Empty</small>
						),
						<strong>Amulet</strong>,
						amulet ? (
							equipmentSummary(amulet, effectiveStats, "off")
						) : (
							<small>Empty</small>
						),
						<strong>Charm</strong>,
						charm ? (
							equipmentSummary(charm, effectiveStats, "off")
						) : (
							<small>Empty</small>
						),
					]
				: []),
		);
		(this.root.querySelector(".inspect-back") as HTMLElement).classList.toggle(
			"is-hidden",
			!build,
		);
		this.renderAllocation();
		this.allocationUpdate?.();
		this.renderInventory(p);
	}
	private renderInventory(progress: PlayerProgress): void {
		const balances = {
			gold: progress.gold,
			souls: progress.souls,
			...progress.scraps,
		};
		for (const [key, value] of Object.entries(balances)) {
			const cell = this.inventoryHeader.querySelector<HTMLElement>(
				`.currency-cell[data-currency="${key}"] strong`,
			);
			if (cell) setText(cell, String(value));
		}
		if (this.activeScrapPromotion)
			this.previewScrapPromotion(this.activeScrapPromotion);
		this.loadoutNode.replaceChildren(
			loadoutCell("Main hand", progress.mainHand),
			loadoutCell("Offhand", progress.offHand),
			loadoutCell("Amulet", progress.amulet),
			loadoutCell("Charm", progress.charm),
		);
		setText(
			this.inventoryCount,
			`Equipment ${occupiedInventorySlots(progress)}/${inventoryCapacity(progress.level)}`,
		);
		const ordered = orderInventoryTiles(
			progress.inventoryTiles,
			progress,
			this.inventorySlotFilter,
		);
		const existing = new Map(
			[...this.backpackScroll.children].map((node) => [
				(node as HTMLElement).dataset.tileId,
				node as HTMLElement,
			]),
		);
		const equippedKeys = new Set([
			itemStackKey(progress.mainHand),
			progress.offHand ? itemStackKey(progress.offHand) : "",
			progress.amulet ? itemStackKey(progress.amulet) : "",
			progress.charm ? itemStackKey(progress.charm) : "",
		]);
		const statsSignature = STAT_KEYS.map((key) => progress.stats[key]).join(
			":",
		);
		this.previewCurrencies();
		const canSend = Boolean(this.realm);
		ordered.forEach((tile, index) => {
			const costs = upgradeCosts(tile.item);
			const upgradeAvailability = `${Number(progress.gold >= costs.gold)}:${Number(progress.scraps[tile.item.rarity] >= costs.scraps)}:${Number(progress.souls >= costs.souls)}`;
			const signature = `${tile.key}:${tile.quantity}:${Number(equippedKeys.has(tile.key))}:${statsSignature}:${Number(canSend)}:${extractButtonStatus(tile, progress)}:${upgradeAvailability}:${Number(progress.souls >= REROLL_SOUL_COST)}`;
			let node = existing.get(tile.id);
			if (!node || node.dataset.renderSignature !== signature) {
				const replacement = itemTile(
					tile,
					this.callbacks,
					progress,
					(item, equipped, action) => this.previewItem(item, equipped, action),
					(preview) => this.previewCurrencies(preview),
					(skills) => this.previewSpellLevels(skills),
					canSend,
					(tileId, actionIndex) => {
						this.inventoryHover = tileId ? { tileId, actionIndex } : undefined;
					},
				);
				replacement.dataset.renderSignature = signature;
				if (node) node.replaceWith(replacement);
				node = replacement;
			}
			existing.delete(tile.id);
			const position = this.backpackScroll.children[index];
			if (position !== node)
				this.backpackScroll.insertBefore(node, position ?? null);
		});
		for (const node of existing.values()) node.remove();
		this.bindLoadoutHighlights();
		this.restoreInventoryHover();
	}
	private restoreInventoryHover(): void {
		const active = this.inventoryHover;
		if (!active) return;
		const card = [
			...this.backpackScroll.querySelectorAll<HTMLElement>(".item-card"),
		].find((node) => node.dataset.tileId === active.tileId);
		if (!card) {
			this.inventoryHover = undefined;
			return;
		}
		card.onmouseenter?.(new MouseEvent("mouseenter"));
		if (active.actionIndex !== undefined)
			card
				.querySelectorAll<HTMLButtonElement>("button")
				[active.actionIndex]?.dispatchEvent(new MouseEvent("mouseenter"));
	}
	private previewItem(
		item?: ItemInstance,
		equipped = false,
		action: "card" | "upgrade" | "reroll" = "card",
	): void {
		if (!this.player || this.inspected) return;
		const p = this.player.progress;
		this.highlightDestinationSlot(item);
		this.highlightDisplacedItems(item, equipped, action);
		if (!item) {
			this.previewBuild(p.mainHand, p.offHand, p.amulet, p.charm, false);
			this.spellPreview = undefined;
			this.spellPreviewProgress = undefined;
			this.spellPreviewKind = undefined;
			this.renderSpellSlots();
			return;
		}
		let main = p.mainHand;
		let off = p.offHand;
		let amulet = p.amulet;
		let charm = p.charm;
		if (action === "upgrade" || action === "reroll") {
			if (item.itemKind === "weapon") main = item;
			else if (item.itemKind === "amulet") amulet = item;
			else if (item.itemKind === "charm") charm = item;
			else off = item;
		} else if (equipped) {
			if (itemStackKey(main) === itemStackKey(item)) main = undefined;
			else if (off && itemStackKey(off) === itemStackKey(item)) off = undefined;
			else if (amulet && itemStackKey(amulet) === itemStackKey(item))
				amulet = undefined;
			else if (charm && itemStackKey(charm) === itemStackKey(item))
				charm = undefined;
		} else if (item.itemKind === "weapon") {
			main = item;
			if (item.hands === 2) off = undefined;
		} else if (item.itemKind === "amulet") amulet = item;
		else if (item.itemKind === "charm") charm = item;
		else if (!main || main.hands === 1) off = item;
		this.previewBuild(main, off, amulet, charm, true);
		const projected = { ...p, mainHand: main, offHand: off, amulet, charm };
		this.spellPreviewProgress = projected;
		this.spellPreviewKind = "equipment";
		const ids = new Set<SkillId>([
			...this.currentSpells.map((spell) => spell.id),
			...p.learnedSkills,
			...(main?.skills ?? []),
			...(off?.skills ?? []),
			...(amulet?.skills ?? []),
			...(charm?.skills ?? []),
		]);
		this.spellPreview = new Map(
			[...ids].map((id) => [id, actualSkillLevel(projected, id) || null]),
		);
		this.renderSpellSlots();
	}
	private highlightDestinationSlot(item?: ItemInstance): void {
		const destinationSlots = new Set(item ? equipSlotKeys(item) : []);
		for (const cell of this.loadoutNode.querySelectorAll<HTMLElement>(
			".loadout-cell",
		))
			cell.classList.toggle(
				"is-slot-preview",
				destinationSlots.has(cell.dataset.equipSlot ?? ""),
			);
	}
	private bindLoadoutHighlights(): void {
		for (const cell of this.loadoutNode.querySelectorAll<HTMLElement>(
			".loadout-cell",
		)) {
			const toggle = (active: boolean): void => {
				const key = cell.dataset.stackKey;
				for (const card of this.backpackScroll.querySelectorAll<HTMLElement>(
					".item-card",
				))
					card.classList.toggle(
						"is-loadout-source",
						Boolean(active && key && card.dataset.stackKey === key),
					);
			};
			cell.onmouseenter = () => toggle(true);
			cell.onmouseleave = () => toggle(false);
			cell.onfocus = () => toggle(true);
			cell.onblur = () => toggle(false);
		}
	}
	private highlightDisplacedItems(
		item?: ItemInstance,
		equipped = false,
		action: "card" | "upgrade" | "reroll" = "card",
	): void {
		for (const card of this.backpackScroll.querySelectorAll<HTMLElement>(
			".item-card",
		))
			card.classList.remove("is-replacement-preview");
		if (!this.player || !item || action !== "card") return;
		const p = this.player.progress;
		const displaced = new Set<string>();
		if (equipped) displaced.add(itemStackKey(item));
		else if (item.itemKind === "weapon") {
			displaced.add(itemStackKey(p.mainHand));
			if (item.hands === 2 && p.offHand) displaced.add(itemStackKey(p.offHand));
		} else if (item.itemKind === "amulet") {
			if (p.amulet) displaced.add(itemStackKey(p.amulet));
		} else if (item.itemKind === "charm") {
			if (p.charm) displaced.add(itemStackKey(p.charm));
		} else if ((!p.mainHand || p.mainHand.hands === 1) && p.offHand)
			displaced.add(itemStackKey(p.offHand));
		for (const card of this.backpackScroll.querySelectorAll<HTMLElement>(
			".item-card",
		)) {
			const tile = p.inventoryTiles.find(
				(entry) => entry.id === card.dataset.tileId,
			);
			card.classList.toggle(
				"is-replacement-preview",
				Boolean(tile && displaced.has(tile.key)),
			);
		}
	}
	private previewBuild(
		main: ItemInstance | undefined,
		off: ItemInstance | undefined,
		amulet: ItemInstance | undefined,
		charm: ItemInstance | undefined,
		highlight: boolean,
	): void {
		if (!this.player) return;
		const p = this.player.progress;
		const currentStats = statsWithItemBonuses(
			p.stats,
			p.mainHand,
			p.offHand,
			p.amulet,
			p.charm,
		);
		const nextStats = statsWithItemBonuses(p.stats, main, off, amulet, charm);
		const grid = this.sheetNode.querySelector<HTMLElement>(".attribute-grid");
		for (const key of STAT_KEYS) {
			const node = grid?.querySelector<HTMLElement>(`[data-stat="${key}"] b`);
			if (!node) continue;
			const value = {
				currentVal: currentStats[key],
				newVal: highlight ? nextStats[key] : currentStats[key],
			};
			setText(node, formatPreviewValue(value, fmt));
			applyPreviewClass(node, previewTone(value));
		}
		const currentMain = this.sheetNode.querySelector<HTMLElement>(
			".equipped-main-hand",
		);
		if (currentMain) {
			const replacement = equipmentSummary(
				highlight ? main : p.mainHand,
				highlight ? nextStats : currentStats,
				"main",
				highlight ? p.mainHand : undefined,
				highlight ? currentStats : undefined,
			);
			currentMain.replaceWith(replacement);
			this.activeMainHand = replacement;
		}
		this.previewEffectiveStats(p.stats, main, off, amulet, charm, highlight);
	}
	private previewCurrencies(preview?: CurrencyPreview): void {
		if (!this.player) return;
		const p = this.player.progress;
		const balances = { gold: p.gold, souls: p.souls, ...p.scraps };
		for (const [key, current] of Object.entries(balances)) {
			const cell = this.inventoryNode.querySelector<HTMLElement>(
				`.currency-cell[data-currency="${key}"]`,
			);
			const valueNode = cell?.querySelector<HTMLElement>("strong");
			if (!cell || !valueNode) continue;
			const delta = preview?.[key as keyof CurrencyPreview];
			const value = {
				currentVal: current,
				newVal: delta === undefined ? current : current + delta,
			};
			setText(
				valueNode,
				delta === undefined
					? formatPreviewValue(value)
					: formatProjectedValue(value),
			);
			applyPreviewClass(cell, previewTone(value));
		}
	}
	private bindScrapPromotion(target: Exclude<Rarity, "common">): void {
		const cell = this.inventoryHeader.querySelector<HTMLElement>(
			`.currency-cell[data-currency="${target}"]`,
		);
		if (!cell) return;
		cell.tabIndex = 0;
		cell.setAttribute("role", "button");
		cell.setAttribute(
			"aria-label",
			`Promote scrap to ${target}. ${scrapTooltip(capitalize(target))}`,
		);
		cell.title = `Click: convert ${SCRAP_PROMOTION_COST} lower-tier scrap into 1 ${target} scrap. Shift-click: convert all complete batches.`;
		cell.classList.add("is-scrap-promotion");
		cell.onclick = (event) =>
			this.callbacks.onPromoteScrap(target, event.shiftKey);
		cell.onpointerenter = () => {
			this.activeScrapPromotion = target;
			this.previewScrapPromotion(target);
		};
		cell.onpointerleave = () => {
			this.activeScrapPromotion = undefined;
			this.previewCurrencies();
		};
		cell.onfocus = () => {
			this.activeScrapPromotion = target;
			this.previewScrapPromotion(target);
		};
		cell.onblur = () => {
			this.activeScrapPromotion = undefined;
			this.previewCurrencies();
		};
		cell.onkeydown = (event) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			this.callbacks.onPromoteScrap(target, event.shiftKey);
		};
	}
	private previewScrapPromotion(target: Exclude<Rarity, "common">): void {
		if (!this.player) return;
		const source = RARITIES[RARITIES.indexOf(target) - 1]!;
		this.previewCurrencies({ [source]: -SCRAP_PROMOTION_COST, [target]: 1 });
	}
	private previewEffectiveStats(
		baseStats: Stats,
		main: ItemInstance | undefined,
		off: ItemInstance | undefined,
		amulet: ItemInstance | undefined,
		charm: ItemInstance | undefined,
		highlight: boolean,
	): void {
		if (!this.player) return;
		const current =
			this.sheetNode.querySelector<HTMLElement>(".combat-stat-grid");
		if (!current) return;
		const effective = statsWithItemBonuses(baseStats, main, off, amulet, charm);
		const blockingLevel = effectiveSkillLevel(this.player.progress, "blocking");
		const attractionLevel = effectiveSkillLevel(
			this.player.progress,
			"attraction",
		);
		const buffs = activeStatBuffs(this.player, this.player.progress);
		let baseline: Array<[string, string]> | undefined;
		if (highlight) {
			const p = this.player.progress;
			baseline = effectiveStatRows(
				p.mainHand,
				p.offHand,
				p.amulet,
				p.charm,
				statsWithItemBonuses(p.stats, p.mainHand, p.offHand, p.amulet, p.charm),
				undefined,
				blockingLevel,
				attractionLevel,
				buffs,
				hasThornsSkill(p.learnedSkills, [
					p.mainHand,
					p.offHand,
					p.amulet,
					p.charm,
				]),
			);
		}
		current.replaceWith(
			effectiveStatSheet(
				main,
				off,
				amulet,
				charm,
				effective,
				baseline,
				undefined,
				blockingLevel,
				attractionLevel,
				buffs,
				hasThornsSkill(this.player.progress.learnedSkills, [
					main,
					off,
					amulet,
					charm,
				]),
			),
		);
	}
	private renderRealm(): void {
		if (!this.realm) return;
		const r = this.realm;
		this.renderPresenceSummary();
		const signature = [
			r.mode,
			this.player?.waveNumber ?? "",
			this.player?.maxWaveReached ?? "",
			Number(r.canLeave),
			r.challenge,
			r.outgoingQueued,
			r.incomingQueued,
			...r.guards.map(realmMemberSignature),
			"|",
			...r.attackers.map(realmMemberSignature),
		].join(":");
		if (signature === this.realmSignature) return;
		this.realmSignature = signature;
		const action = (
			<button
				class={
					r.mode === "training"
						? "header-control enter-realm"
						: "header-control"
				}
				type="button"
			>
				{r.mode === "training"
					? `Enter wave ${Math.max(1, this.player?.maxWaveReached ?? 1)}`
					: "Leave to Lobby"}
			</button>
		) as HTMLButtonElement;
		const forceNextWave = (
			<button
				class="header-control swarm-mode-control"
				type="button"
				aria-pressed="false"
			>
				<span class="swarm-mode-label">Release the warm!</span>
				<span role="tooltip">
					Swarm mode automatically releases every pending enemy and starts the
					next wave when fewer than 100 enemies are active and the wave cooldown
					is ready.
				</span>
			</button>
		) as HTMLButtonElement;
		forceNextWave.onclick = () => {
			this.swarmMode = !this.swarmMode;
			this.updateForceNextWaveButton();
		};
		this.forceNextWaveButton = forceNextWave;
		this.forceNextWaveLabel = forceNextWave.querySelector(".swarm-mode-label")!;
		this.updateForceNextWaveButton();
		const enterWaveOne = (
			<button class="header-control enter-realm" type="button">
				Enter wave 1
			</button>
		) as HTMLButtonElement;
		const challenge = (
			<button class="header-control" type="button">
				{r.challenge === "incoming"
					? "Accept challenge"
					: r.challenge === "outgoing"
						? "Cancel challenge"
						: r.challenge === "agreed"
							? "Challenge accepted"
							: r.challenge === "active"
								? "Deathmatch"
								: "Challenge realm"}
			</button>
		) as HTMLButtonElement;
		challenge.disabled = r.challenge === "agreed" || r.challenge === "active";
		challenge.onclick = this.callbacks.onChallengeRealm;
		enterWaveOne.onclick = () => {
			this.closeGameplayPanels();
			this.callbacks.onEnterRealm(1);
		};
		action.onclick =
			r.mode === "training"
				? () => {
						this.closeGameplayPanels();
						this.callbacks.onEnterRealm(
							Math.max(1, this.player?.maxWaveReached ?? 1),
						);
					}
				: this.callbacks.onLeaveRealm;
		action.disabled = r.mode !== "training" && !r.canLeave;
		const logout = (
			<button class="header-control" type="button">
				Logout
			</button>
		) as HTMLButtonElement;
		logout.onclick = this.callbacks.onLogout;
		const characters = (
			<button class="header-control" type="button">
				Characters
			</button>
		) as HTMLButtonElement;
		characters.onclick = () => this.openCharacterSelector();
		const options = (
			<button class="header-control" type="button">
				Options
			</button>
		) as HTMLButtonElement;
		options.onclick = () => this.gameSettings.open();
		const devlog = (
			<button class="header-control" type="button">
				Devlog
			</button>
		) as HTMLButtonElement;
		devlog.onclick = this.callbacks.onOpenDevlog;
		const title =
			r.mode === "waiting"
				? `Wave ${this.player?.waveNumber ?? "—"} · Waiting for realm`
				: `Wave ${this.player?.waveNumber ?? "—"}`;
		this.realmPanel.classList.remove("is-hidden");
		this.heroResourceDock.setTrainingMode(r.mode === "training");
		if (r.mode === "training") {
			this.realmPanel.replaceChildren(
				action,
				enterWaveOne,
				devlog,
				options,
				characters,
				logout,
			);
			return;
		}
		this.realmPanel.replaceChildren(
			options,
			devlog,
			forceNextWave,
			...(r.challenge !== "unavailable" ? [challenge] : []),
			action,
			<strong>{title}</strong>,
		);
	}
	private requestForceNextWave(): void {
		if (this.forceNextWavePending) return;
		this.forceNextWavePending = true;
		this.updateForceNextWaveButton();
		this.callbacks.onForceNextWave();
	}
	private updateForceNextWaveButton(): void {
		if (!this.forceNextWaveButton || !this.forceNextWaveLabel) return;
		const remaining = Math.max(
			0,
			Math.ceil((this.forceNextWaveReadyAt - Date.now()) / 1000),
		);
		this.forceNextWaveButton.setAttribute(
			"aria-pressed",
			String(this.swarmMode),
		);
		this.forceNextWaveLabel.textContent = this.swarmMode
			? `Next wave in ${remaining}s`
			: "Release the warm!";
	}
	private renderPresenceSummary(): void {
		const countLabel = `${this.onlinePlayerCount} ${this.onlinePlayerCount === 1 ? "player" : "players"} online`;
		this.onlineCount.replaceChildren(countLabel);
		if (!this.player || !this.realm || this.realm.mode === "training") return;
		const others = new Map(
			[...this.realm.guards, ...this.realm.attackers]
				.filter((member) => member.id !== this.player?.id)
				.map((member) => [member.id, member]),
		);
		this.onlineCount.append(document.createTextNode(" - "));
		if (!others.size) {
			this.onlineCount.append("playing alone for now");
			return;
		}
		const members = [...others.values()];
		for (const [index, member] of members.entries()) {
			if (index > 0) this.onlineCount.append(document.createTextNode(", "));
			const button = (
				<button class="realm-presence-member" type="button">
					{member.name}
				</button>
			) as HTMLButtonElement;
			button.onclick = () => this.callbacks.onInspectHero(member.id);
			this.onlineCount.append(button);
		}
		this.onlineCount.append(
			document.createTextNode(" and "),
			(<em>you</em>) as HTMLElement,
			document.createTextNode(" in this Realm"),
		);
	}
	private renderAllocation(): void {
		const signature = this.inspected
			? "inspection"
			: this.player
				? STAT_KEYS.map((key) => this.player!.progress.allocation[key]).join(
						":",
					)
				: "none";
		if (signature === this.allocationSignature) return;
		this.allocationSignature = signature;
		this.allocationNode.replaceChildren();
		this.allocationUpdate = undefined;
		if (!this.player || this.inspected) {
			this.allocationPreview = undefined;
			this.allocationNode.classList.remove("is-previewing");
			this.allocationNode.classList.add("is-hidden");
			return;
		}
		this.allocationNode.classList.remove("is-hidden");
		const values = integerAllocation(this.player.progress.allocation);
		const valueNodes = new Map<keyof Stats, HTMLElement>();
		const minusButtons = new Map<keyof Stats, HTMLButtonElement>();
		const plusButtons = new Map<keyof Stats, HTMLButtonElement>();
		const rows = STAT_KEYS.map((key) => {
			const value = (<b>{values[key]}</b>) as HTMLElement;
			const minus = (
				<button type="button" aria-label={`Decrease ${key}`}>
					−
				</button>
			) as HTMLButtonElement;
			const plus = (
				<button type="button" aria-label={`Increase ${key}`}>
					+
				</button>
			) as HTMLButtonElement;
			valueNodes.set(key, value);
			minusButtons.set(key, minus);
			plusButtons.set(key, plus);
			return (
				<div class="allocation-row">
					<span>{key}</span>
					{minus}
					{value}
					{plus}
				</div>
			);
		});
		const budget = (<small class="allocation-remaining" />) as HTMLElement;
		const reset = (
			<button type="button">Reset allocation</button>
		) as HTMLButtonElement;
		const save = (
			<button type="submit">Save for future levels</button>
		) as HTMLButtonElement;
		const respec = (
			<button type="button" class="allocation-respec" />
		) as HTMLButtonElement;
		const controls = (
			<div class="allocation-controls">
				{rows}
				{budget}
				<div class="allocation-actions">
					{reset}
					{save}
					{respec}
				</div>
			</div>
		) as HTMLElement;
		this.allocationNode.append(
			<strong class="allocation-title">Level-up allocation</strong>,
			controls,
		);
		const currentValues = (): Stats => ({ ...values });
		const update = () => {
			this.allocationNode.classList.toggle(
				"is-previewing",
				Boolean(this.allocationPreview),
			);
			const total = STAT_KEYS.reduce((sum, key) => sum + values[key], 0);
			budget.textContent = `Budget ${total}/5 · ${5 - total} remaining`;
			save.disabled = total !== 5;
			respec.disabled = total !== 5;
			respec.textContent = `Reapply ratio to all levels · ${this.player!.progress.level * 100}g`;
			for (const key of STAT_KEYS) {
				setText(valueNodes.get(key)!, String(values[key]));
				minusButtons.get(key)!.disabled = values[key] === 0;
				plusButtons.get(key)!.disabled = total >= 5;
			}
			const grid = this.sheetNode.querySelector<HTMLElement>(".attribute-grid");
			const p = this.player!.progress;
			const projected =
				this.allocationPreview === "respec"
					? scaledStats(values, p.level)
					: (Object.fromEntries(
							STAT_KEYS.map((key) => [key, p.stats[key] + values[key]]),
						) as Stats);
			const effects = statEffects(
				activeStatBuffs(this.player!, p),
				hasThornsSkill(p.learnedSkills, [
					p.mainHand,
					p.offHand,
					p.amulet,
					p.charm,
				]),
			);
			const projectAttributes = (baseStats: Stats): Stats =>
				projectUnitState({
					baseStats,
					mainHand: p.mainHand,
					offHand: p.offHand,
					amulet: p.amulet,
					charm: p.charm,
					blockingLevel: effectiveSkillLevel(p, "blocking"),
					attractionLevel: effectiveSkillLevel(p, "attraction"),
					effects,
				}).attributes;
			const currentEffective = projectAttributes(p.stats);
			const projectedEffective = projectAttributes(projected);
			for (const key of STAT_KEYS) {
				const node = grid?.querySelector<HTMLElement>(`[data-stat="${key}"] b`);
				if (node) {
					const value = {
						currentVal: currentEffective[key],
						newVal: this.allocationPreview
							? projectedEffective[key]
							: currentEffective[key],
					};
					setText(node, formatPreviewValue(value, fmt));
					applyPreviewClass(node, previewTone(value));
				}
			}
			this.previewEffectiveStats(
				this.allocationPreview ? projected : p.stats,
				p.mainHand,
				p.offHand,
				p.amulet,
				p.charm,
				Boolean(this.allocationPreview),
			);
		};
		this.allocationUpdate = update;
		for (const key of STAT_KEYS) {
			minusButtons.get(key)!.onclick = () => {
				values[key] = Math.max(0, values[key] - 1);
				update();
			};
			plusButtons.get(key)!.onclick = () => {
				if (STAT_KEYS.reduce((sum, stat) => sum + values[stat], 0) < 5)
					values[key] += 1;
				update();
			};
		}
		reset.onclick = () => {
			for (const key of STAT_KEYS) values[key] = 0;
			update();
		};
		respec.onclick = () => {
			if (!respec.disabled) this.callbacks.onRespec(currentValues());
		};
		this.allocationNode.onmouseenter = () => {
			this.allocationPreview ??= "next";
			update();
		};
		this.allocationNode.onmouseleave = () => {
			window.setTimeout(() => {
				if (
					!this.allocationNode.matches(":hover") &&
					!this.allocationNode.contains(document.activeElement)
				) {
					this.allocationPreview = undefined;
					update();
				}
			});
		};
		const focusNode = this.allocationNode as HTMLElement & {
			onfocusin: (() => void) | null;
			onfocusout: (() => void) | null;
		};
		focusNode.onfocusin = () => {
			this.allocationPreview ??= "next";
			update();
		};
		focusNode.onfocusout = () =>
			window.setTimeout(() => {
				if (!this.allocationNode.contains(document.activeElement)) {
					this.allocationPreview = undefined;
					update();
				}
			});
		const previewRespec = () => {
			this.allocationPreview = "respec";
			update();
		};
		const restoreNextPreview = () => {
			if (
				this.allocationNode.matches(":hover") ||
				this.allocationNode.contains(document.activeElement)
			) {
				this.allocationPreview = "next";
				update();
			}
		};
		respec.onmouseenter = previewRespec;
		respec.onfocus = previewRespec;
		respec.onmouseleave = restoreNextPreview;
		respec.onblur = restoreNextPreview;
		this.allocationNode.onsubmit = (event) => {
			event.preventDefault();
			if (!save.disabled) this.callbacks.onAllocation(currentValues());
		};
		update();
	}
	private applyPanelTriggers(progress: PlayerProgress): void {
		if (this.panelTriggers.character && progress.level >= 1) {
			this.panelTriggers.character = false;
			this.setPanelCollapsed(
				this.characterPanel,
				this.characterToggle,
				"character",
				false,
			);
			this.callbacks.onDismissPanelTrigger("character");
		}
		const itemCount = progress.inventoryTiles.reduce(
			(sum, tile) => sum + tile.quantity,
			0,
		);
		if (this.panelTriggers.inventory && itemCount > 3) {
			this.panelTriggers.inventory = false;
			this.setPanelCollapsed(
				this.inventoryPanel,
				this.inventoryToggle,
				"inventory",
				false,
			);
			this.callbacks.onDismissPanelTrigger("inventory");
		}
	}
	private togglePanel(
		panel: HTMLElement,
		toggle: HTMLButtonElement,
		kind: "character" | "inventory",
		manual = false,
	): void {
		if (kind === "character" && this.committedInspection?.build) return;
		if (manual && this.panelTriggers[kind]) {
			this.panelTriggers[kind] = false;
			this.callbacks.onDismissPanelTrigger(kind);
		}
		this.setPanelCollapsed(
			panel,
			toggle,
			kind,
			!panel.classList.contains("is-collapsed"),
		);
	}
	private closeGameplayPanels(): void {
		this.setPanelCollapsed(
			this.characterPanel,
			this.characterToggle,
			"character",
			true,
		);
		this.setPanelCollapsed(
			this.inventoryPanel,
			this.inventoryToggle,
			"inventory",
			true,
		);
		this.spellCatalog.classList.add("is-hidden");
	}
	private openLobbyPanels(): void {
		this.setPanelCollapsed(
			this.characterPanel,
			this.characterToggle,
			"character",
			false,
		);
		this.setPanelCollapsed(
			this.inventoryPanel,
			this.inventoryToggle,
			"inventory",
			false,
		);
	}
	private closeCharacterSelector(): void {
		if (this.characterSelector.classList.contains("is-hidden")) return;
		this.characterSelector.classList.add("is-hidden");
		this.callbacks.onBack();
	}
	private createCharacter(): void {
		const name = this.newCharacterInput.value.trim();
		if (!name || !this.newCharacterInput.checkValidity()) {
			this.newCharacterInput.reportValidity();
			return;
		}
		this.closeCharacterSelector();
		this.newCharacterInput.value = "";
		this.callbacks.onCreateCharacter(name);
	}
	private renderCharacterSelector(): void {
		this.characterSelectorList.replaceChildren(
			...this.accountCharacters.map((hero) => {
				const active = hero.id === this.player?.id;
				const selected = hero.id === this.selectedAccountCharacterId;
				const card = (
					<button
						class={`character-selector-card${selected ? " is-selected" : ""}`}
						type="button"
						aria-pressed={String(selected)}
					>
						<strong>{hero.username}</strong>
						<span>Level {hero.level}</span>
						<span>
							{hero.souls} {hero.souls === 1 ? "Soul" : "Souls"}
						</span>
						{active ? <small>Current character</small> : null}
					</button>
				) as HTMLButtonElement;
				card.onclick = () => {
					this.selectedAccountCharacterId = hero.id;
					this.renderCharacterSelector();
				};
				card.onmouseenter = () => {
					if (active) this.callbacks.onBack();
					else this.callbacks.onInspectHero(hero.id);
				};
				card.onmouseleave = this.callbacks.onBack;
				return card;
			}),
		);
		const selected = this.accountCharacters.find(
			({ id }) => id === this.selectedAccountCharacterId,
		);
		this.switchCharacterButton.textContent = selected
			? `Switch to ${selected.username}`
			: "Select a character";
		this.switchCharacterButton.disabled =
			!selected || selected.id === this.player?.id;
	}
	private setPanelCollapsed(
		panel: HTMLElement,
		toggle: HTMLButtonElement,
		kind: "character" | "inventory",
		collapsed: boolean,
	): void {
		panel.classList.toggle("is-collapsed", collapsed);
		this.gameHud.classList.toggle(`${kind}-panel-open`, !collapsed);
		toggle.setAttribute("aria-expanded", String(!collapsed));
		toggle.setAttribute(
			"aria-label",
			`${collapsed ? "Expand" : "Collapse"} ${kind === "character" ? "character sheet" : "inventory"}`,
		);
		toggle.title = panelToggleTooltip(kind, collapsed);
		if (kind === "inventory")
			document.documentElement.style.setProperty(
				"--inventory-panel-preview-width",
				collapsed ? "0px" : "640px",
			);
	}
	private updateVisibility(): void {
		const joined = Boolean(this.player);
		this.joinPanel.classList.toggle("is-hidden", joined);
		this.leaderboardPanel.classList.toggle("is-hidden", joined);
		this.gameHud.classList.toggle("is-hidden", !joined);
		this.realmPanel.classList.toggle("is-hidden", !joined);
		this.loginHeaderActions.classList.toggle("is-hidden", joined);
		this.characterToggle.classList.toggle("is-hidden", !joined);
		this.inventoryToggle.classList.toggle("is-hidden", !joined);
		if (joined) {
			this.authenticationMask.classList.add("is-hidden");
			this.authenticationModal.classList.add("is-hidden");
		}
	}
}
function equipmentIcon(
	item: ItemInstance | undefined,
	slot: string,
): HTMLElement {
	const glyph = !item
		? "—"
		: item.itemKind === "weapon"
			? "⚔"
			: item.itemKind === "buckler"
				? "◆"
				: item.itemKind === "relic"
					? "✦"
					: item.itemKind === "amulet"
						? "◉"
						: "◇";
	const label = `${slot}: ${item?.name ?? "Empty"}`;
	return (
		<span
			class={`equipped-icon${item ? ` rarity-${item.rarity}` : " is-empty"}`}
			tabindex="0"
			aria-label={label}
		>
			{glyph}
			<span role="tooltip">{label}</span>
		</span>
	) as HTMLElement;
}
function loadoutCell(slot: string, item?: ItemInstance): HTMLElement {
	const label = `${slot}: ${item?.name ?? "Empty"}`;
	return (
		<span
			class={`loadout-cell${item ? ` rarity-${item.rarity}` : " is-empty"}`}
			data-equip-slot={slot.toLowerCase().replace(" ", "-")}
			data-stack-key={item ? itemStackKey(item) : ""}
			tabindex="0"
			aria-label={label}
		>
			<small>{slot}</small>
			<strong>{item?.name ?? "Empty"}</strong>
			<span role="tooltip">{label}</span>
		</span>
	) as HTMLElement;
}
export function equipSlotKeys(item: ItemInstance): string[] {
	return item.itemKind === "weapon"
		? item.hands === 2
			? ["main-hand", "offhand"]
			: ["main-hand"]
		: item.itemKind === "amulet"
			? ["amulet"]
			: item.itemKind === "charm"
				? ["charm"]
				: ["offhand"];
}
function equipmentSummary(
	item: ItemInstance | undefined,
	stats: Stats,
	slot: "main" | "off",
	baselineItem?: ItemInstance,
	baselineStats?: Stats,
): HTMLElement {
	if (!item)
		return (
			<div class={`item-card equipped-item equipped-${slot}-hand is-empty`}>
				<strong>Unarmed</strong>
				<small>1H · no weapon</small>
			</div>
		) as HTMLElement;
	const node = (
		<div
			class={`item-card equipped-item equipped-${slot}-hand rarity-${item.rarity}`}
			style={slot === "main" ? "--attack-progress:100%" : undefined}
		>
			<span class="tile-text-anchor item-name-anchor" tabindex="0">
				<strong>{item.name}</strong>
				<span class="tile-text-tooltip" role="tooltip">
					{item.name}
				</span>
			</span>
			<small
				class={
					baselineItem && baselineItem.level !== item.level
						? "is-gain-preview"
						: ""
				}
			>
				Level{" "}
				{formatProjectedValue({
					currentVal: baselineItem?.level ?? item.level,
					newVal: item.level,
				})}{" "}
				·{" "}
				{item.itemKind === "weapon"
					? `${item.hands}-handed`
					: capitalize(item.itemKind)}{" "}
				· {item.rarity}
			</small>
			{itemDetails(item, stats, baselineItem, baselineStats)}
		</div>
	) as HTMLElement;
	bindRequirementPreview(
		node.querySelector<HTMLElement>(".equipment-details")!,
		item,
		stats,
	);
	return node;
}
export interface ActiveStatBuffs {
	reflectiveSurge?: { level: number };
	rapidRegen?: { multiplier: number; flat: number };
}

function hasThornsSkill(
	learnedSkills: SkillId[],
	items: Array<ItemInstance | undefined>,
): boolean {
	return (
		learnedSkills.includes("thorns") ||
		items.some((item) => item?.skills.includes("thorns"))
	);
}

export function activeStatBuffs(
	player: PlayerState | undefined,
	progress: PlayerProgress,
): ActiveStatBuffs | undefined {
	const buffs: ActiveStatBuffs = {};
	if ((player?.reflectiveSurgeRemaining ?? 0) > 0) {
		const level = effectiveSkillLevel(progress, "reflectiveSurge");
		if (level > 0) buffs.reflectiveSurge = { level };
	}
	if ((player?.rapidRegenRemaining ?? 0) > 0) {
		const level = effectiveSkillLevel(progress, "rapidRegen");
		if (level > 0)
			buffs.rapidRegen = {
				multiplier: rapidRegenMultiplier(level),
				flat: 0.1,
			};
	}
	return buffs.reflectiveSurge || buffs.rapidRegen ? buffs : undefined;
}

function statEffects(
	buffs: ActiveStatBuffs | undefined,
	thornsActive: boolean,
): UnitEffect[] {
	const effects: UnitEffect[] = [];
	if (thornsActive) effects.push(new ThornsEffect());
	if (buffs?.reflectiveSurge)
		effects.push(
			new ReflectiveSurgeEffect(
				buffs.reflectiveSurge.level,
				Number.POSITIVE_INFINITY,
			),
		);
	if (buffs?.rapidRegen)
		effects.push(
			new RapidRegenerationEffect(
				buffs.rapidRegen.multiplier,
				buffs.rapidRegen.flat,
				Number.POSITIVE_INFINITY,
			),
		);
	return effects;
}

export function effectiveStatRows(
	main: ItemInstance | undefined,
	off: ItemInstance | undefined,
	amulet: ItemInstance | undefined,
	charm: ItemInstance | undefined,
	stats: Stats,
	maxHp?: number,
	blockingLevel = 0,
	attractionLevel = 0,
	buffs?: ActiveStatBuffs,
	thornsActive = false,
): Array<[string, string]> {
	const buckler = off?.itemKind === "buckler" ? off : undefined;
	const effects = statEffects(buffs, thornsActive);
	const state = projectUnitState({
		baseStats: stats,
		attributesAreEffective: true,
		mainHand: main,
		offHand: off,
		amulet,
		charm,
		blockingLevel,
		attractionLevel,
		effects,
	});
	const reflection = state.reflection;
	const surge = buffs?.reflectiveSurge;
	return [
		["Damage", fmt(state.attack.damage)],
		["Attacks/s", fmt(state.attack.attacksPerSecond)],
		["Attack cost", `${fmt(state.attack.rageCost)} rage`],
		["Attack range", `${fmt(pixelsToMeters(state.attack.range))} m`],
		["Crit chance", percent(state.critChance)],
		["Crit damage", percent(state.critMultiplier)],
		["Magic amp", percent(Math.max(0, state.magicAmp - 1))],
		["Cooldown reduction", percent(state.cooldownReduction)],
		["Turn speed", `${fmt(state.turnSpeedDegrees)}°/s`],
		[
			"Spell range/Lv",
			`+${fmt(pixelsToMeters(0.5 * state.attributes.spirit))} m`,
		],
		["Spell power/Lv", "+15%"],
		["Max health", fmt(maxHp ?? state.maxHp)],
		["Max rage", fmt(state.maxRage)],
		["Max mana", fmt(state.maxMana)],
		["Defense", fmt(state.defense)],
		["Dodge chance", percent(state.dodgeChance)],
		[
			"Physical resist",
			state.immunities.has("physical")
				? "Immune"
				: percent(state.resistances.physical),
		],
		[
			"Magic resist",
			state.immunities.has("magic")
				? "Immune"
				: percent(state.resistances.magic),
		],
		[
			"Fire resist",
			state.immunities.has("fire") ? "Immune" : percent(state.resistances.fire),
		],
		[
			"Frost resist",
			state.immunities.has("frost")
				? "Immune"
				: percent(state.resistances.frost),
		],
		[
			"Poison resist",
			state.immunities.has("poison")
				? "Immune"
				: percent(state.resistances.poison),
		],
		[
			"Bleed resist",
			state.immunities.has("bleed")
				? "Immune"
				: percent(state.resistances.bleed),
		],
		["Block chance", percent(state.blockChance)],
		[
			"Block cost",
			buckler?.rarity === "unique"
				? "1% max mana; no cooldown; +1 rage"
				: buckler
					? `${fmt(state.blockCost)} rage`
					: "0",
		],
		["Health regen", `${fmt(state.healthRegen)}/s`],
		["Mana regen", `${fmt(state.manaRegen)}/s`],
		["Rage decay", `−${fmt(state.rageDecay)}/s`],
		["Bonus XP", percent(state.bonusXp)],
		["HP on kill", fmt(state.healthOnKill)],
		["Mana on kill", fmt(state.manaOnKill)],
		["Life steal", percent(state.lifeSteal)],
		["Mana cost reduction", percent(state.manaCostReduction)],
		["Life cost reduction", percent(state.lifeCostReduction)],
		["Bleed chance", percent(state.bleedChance)],
		["Poison chance", percent(state.poisonChance)],
		["Stun chance", percent(state.stunChance)],
		["Gold gain", percent(state.goldGain)],
		["Magic find", percent(state.magicFind)],
		["Attraction Gold find", percent(state.attractionGoldFind)],
		["Attraction", `${fmt(pixelsToMeters(state.attractionSpeed))} m/s`],
		[
			"Reflection",
			buckler?.reflectionComponents.length || thornsActive
				? (() => {
						const parts: string[] = [];
						if (buckler?.reflectionComponents.includes("flat"))
							parts.push(fmt(reflection.flat));
						if (buckler?.reflectionComponents.includes("strength"))
							parts.push(`${fmt(reflection.strength)} (20%×STR)`);
						if (buckler?.reflectionComponents.includes("return"))
							parts.push(
								`${fmt(reflection.incomingFraction * 100)}% inc. (15%+0.4%×AGI)`,
							);
						if (thornsActive)
							parts.push(
								`${fmt(reflection.thornsFraction * 100)}% inc. (Thorns)`,
							);
						if (surge) parts.push("1% inc. (Surge)");
						return `Reflect: ${parts.join(" + ")}${surge ? " · 2× Surge" : ""}`;
					})()
				: "None",
		],
	];
}
function effectiveStatSheet(
	main: ItemInstance | undefined,
	off: ItemInstance | undefined,
	amulet: ItemInstance | undefined,
	charm: ItemInstance | undefined,
	stats: Stats,
	baseline?: Array<[string, string]>,
	maxHp?: number,
	blockingLevel = 0,
	attractionLevel = 0,
	buffs?: ActiveStatBuffs,
	thornsActive = false,
): HTMLElement {
	const previous = new Map(baseline);
	const rows = effectiveStatRows(
		main,
		off,
		amulet,
		charm,
		stats,
		maxHp,
		blockingLevel,
		attractionLevel,
		buffs,
		thornsActive,
	);
	const offensive = new Set([
		"Damage",
		"Attacks/s",
		"Attack cost",
		"Attack range",
		"Crit chance",
		"Crit damage",
		"Magic amp",
		"Bleed chance",
		"Poison chance",
		"Stun chance",
	]);
	const defensive = new Set([
		"Max health",
		"Max rage",
		"Defense",
		"Dodge chance",
		"Physical resist",
		"Magic resist",
		"Fire resist",
		"Frost resist",
		"Poison resist",
		"Bleed resist",
		"Block chance",
		"Block cost",
		"Reflection",
	]);
	const groups: Array<[string, (label: string) => boolean]> = [
		["Offensive", (label) => offensive.has(label)],
		["Defensive", (label) => defensive.has(label)],
		["Utility", (label) => !offensive.has(label) && !defensive.has(label)],
	];
	const renderRow = ([label, newValue]: [string, string]) => {
		const currentVal = previous.get(label) ?? newValue;
		const changed = Boolean(baseline && currentVal !== newValue);
		const lowerIsBetter = label === "Attack cost" || label === "Block cost";
		const currentNumber = Number.parseFloat(currentVal);
		const newNumber = Number.parseFloat(newValue);
		const tone = !changed
			? "same"
			: Number.isFinite(currentNumber) && Number.isFinite(newNumber)
				? previewTone(
						{ currentVal: currentNumber, newVal: newNumber },
						!lowerIsBetter,
					)
				: "gain";
		return (
			<span>
				<small>{label}</small>
				<b
					class={
						tone === "gain"
							? "is-gain-preview"
							: tone === "cost"
								? "is-cost-preview"
								: ""
					}
				>
					{formatPreviewValue({
						currentVal,
						newVal: baseline ? newValue : currentVal,
					})}
				</b>
			</span>
		);
	};
	return (
		<div class={`combat-stat-grid${baseline ? " is-previewing" : ""}`}>
			{groups.map(([title, includes]) => (
				<section class="combat-stat-group">
					<strong>{title}</strong>
					<div class="combat-stat-section">
						{rows.filter(([label]) => includes(label)).map(renderRow)}
					</div>
				</section>
			))}
		</div>
	) as HTMLElement;
}
export const SOULS_TOOLTIP =
	"Purge Unique items to earn Souls. Every real death removes up to 1 Soul; a player killer always gains 1 Soul, even when the defeated player has none. Spend Souls to upgrade Unique items or reroll item properties.";
export const GOLD_TOOLTIP =
	"Used with matching Scrap to upgrade non-Unique items.";
export const scrapTooltip = (rarity: string): string =>
	`${rarity} Scrap is used with Gold to upgrade ${rarity} items.`;

function currencyCell(
	label: string,
	value: number,
	kind: string,
	tooltip?: string,
): HTMLElement {
	return (
		<div
			class={`currency-cell currency-${kind}${tooltip ? " has-tooltip" : ""}`}
			data-currency={kind}
			tabindex={tooltip ? "0" : undefined}
			aria-label={tooltip ? `${label}. ${tooltip}` : undefined}
		>
			<small>{label}</small>
			<strong>{value}</strong>
			{tooltip ? <span role="tooltip">{tooltip}</span> : null}
		</div>
	) as HTMLElement;
}
export function passiveSkillMetrics(
	skill: SkillId,
	level: number,
	stats?: Stats,
): Array<{ label: string; value: string }> {
	const effectiveStats = stats ?? {
		strength: 0,
		agility: 0,
		magic: 0,
		spirit: 0,
		intelligence: 0,
	};
	const radius = (): { label: string; value: string } => ({
		label: "Radius",
		value: `${fmt(pixelsToMeters(auraRadius(level, effectiveStats.spirit)))} m`,
	});
	switch (skill) {
		case "attraction":
			return [
				{
					label: "Pull speed",
					value: `${fmt(
						pixelsToMeters(35 * attractionSpeedMultiplier(level)),
					)} m/s`,
				},
				{
					label: "Magic find",
					value: `+${fmt(attractionFindBonus(level) * 100)}%`,
				},
				{
					label: "Gold find",
					value: `+${fmt(attractionFindBonus(level) * 100)}%`,
				},
			];
		case "manaDrain":
			return [
				{
					label: "Mana + Cold",
					value: `${fmt(spiritWoundsConversionFraction(level) * 100)}% crit damage`,
				},
			];
		case "penance":
			return [
				{
					label: "Conversion",
					value: `${fmt(manaConversionFraction(level) * 100)}%`,
				},
				{ label: "Minimum return", value: "1% max Mana" },
			];
		case "blocking":
			return [{ label: "Base block chance", value: `+${fmt(level * 0.5)}%` }];
		case "thorns":
			return [{ label: "Damage returned", value: "5%" }];
		case "voodoo":
			return [
				{
					label: "Poison damage",
					value: `+${fmt((voodooPoisonMultiplier(level, effectiveStats.spirit) - 1) * 100)}%`,
				},
			];
		case "slowAura":
			return [
				{
					label: "Enemy movement",
					value: `${fmt(auraSlowMultiplier(level) * 100)}%`,
				},
				radius(),
			];
		case "hinderingAura":
			return [
				{
					label: "Enemy attack speed",
					value: `${fmt(auraSlowMultiplier(level) * 100)}%`,
				},
				radius(),
			];
		case "deathBurst":
			return [
				{ label: "Burst damage", value: "20% enemy HP" },
				{
					label: "Blast radius",
					value: `${fmt(
						pixelsToMeters(auraRadius(level, effectiveStats.spirit) * 0.45),
					)} m`,
				},
				radius(),
			];
		case "sunburnAura":
			return [
				{
					label: "Damage / pulse",
					value: `${fmt(sunburnFraction(effectiveStats.intelligence) * 100)}% enemy HP`,
				},
				{
					label: "Pulse interval",
					value: `${fmt(sunburnInterval(effectiveStats.spirit))}s`,
				},
				radius(),
			];
		case "thunderAura":
			return [
				{
					label: "Lightning damage",
					value: fmt(thunderDamage(effectiveStats.intelligence)),
				},
				{ label: "Pulse interval", value: `${fmt(thunderInterval(level))}s` },
				radius(),
			];
		case "timeHarvest":
			return [
				{
					label: "Cooldown removal",
					value: `${fmt(timeHarvestCooldownReduction(level))}s / kill`,
				},
			];
		default:
			return [];
	}
}

function creepStateBadges(states?: CreepTimedStates): HTMLElement {
	const statuses = statusEffectSummaries(states?.statuses ?? []);
	const entries: Array<{
		className: string;
		icon: string;
		tooltip: string;
		remaining?: number;
	}> = statuses.map((status) => ({
		className: `status-effect-${status.kind}`,
		icon: `${status.icon}${status.stacks > 1 ? ` ${status.stacks}` : ""}`,
		tooltip: status.tooltip,
		remaining: status.remaining,
	}));
	if (states?.regenerating)
		entries.push({
			className: "beneficial-effect-rapid-regen",
			icon: "✚",
			tooltip: "Regeneration increased",
		});
	if ((states?.reflectiveSurgeRemaining ?? 0) > 0)
		entries.push({
			className: "beneficial-effect-reflective-surge",
			icon: "◆",
			tooltip: "Reflective Surge",
			remaining: states!.reflectiveSurgeRemaining,
		});
	return (
		<div class="creep-state-badges" aria-label="Active states">
			{entries.map((entry) => (
				<span
					class={`creep-state-badge ${entry.className}`}
					title={entry.tooltip}
				>
					{entry.icon}
					{entry.remaining === undefined ? null : (
						<small class="effect-time" aria-hidden="true">
							{effectTimeLabel(entry.remaining)}
						</small>
					)}
				</span>
			))}
		</div>
	) as HTMLElement;
}
function setText(node: HTMLElement, value: string): void {
	if (node.textContent !== value) node.textContent = value;
}
function realmMemberSignature(member: RealmState["guards"][number]): string {
	return `${member.id},${member.name},${member.level},${Number(member.down)},${Number(member.receivesDeathEchoes)}`;
}
function rankedName(name: string, receivesDeathEchoes: boolean): Node {
	if (!receivesDeathEchoes) return document.createTextNode(name);
	const warning = (
		<span
			class="death-echo-warning"
			tabindex="0"
			aria-label="Highest-ranked hero: receives all other players' death echoes in this realm to fight against"
		>
			⚠
			<span role="tooltip">
				Highest-ranked hero: receives all other players' death echoes in this
				realm to fight against.
			</span>
		</span>
	) as HTMLElement;
	const wrapper = (
		<span class="ranked-name">
			{warning}
			{name}
		</span>
	) as HTMLElement;
	return wrapper;
}
function capitalize(value: string): string {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

export function spellInitials(label: string): string {
	const words = label.trim().split(/\s+/).filter(Boolean);
	return (
		words.length > 1 ? words.map((word) => word[0]).join("") : label.slice(0, 2)
	)
		.slice(0, 2)
		.toUpperCase();
}
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
export type SpellCatalogFilter =
	| "learned"
	| "equipped"
	| "actives"
	| "passives"
	| "unavailable";
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
function spellResourceLabel(resource: SpellSlot["resource"]): string {
	return resource === "life" ? "HP" : resource === "rage" ? "Rage" : "Mana";
}
function fmt(value: number): string {
	return Number(value.toFixed(2)).toString();
}
function percent(value: number): string {
	return `${fmt(value * 100)}%`;
}
