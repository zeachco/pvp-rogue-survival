/** @jsx h */
import {
  equippedPerks,
  itemCooldownReduction,
  itemRequirementMultiplier,
  itemResourceCostReduction,
  itemStackKey,
  RARITIES,
  statsWithItemBonuses,
  type ItemInstance,
  type Rarity,
  type SkillId,
} from "../../common/items";
import { BALANCE } from "../../common/balance";
import {
  STAT_KEYS,
  cumulativeXpForLevel,
  integerAllocation,
  lerpXpDisplay,
  levelForXp,
  xpForNextLevel,
  type Stats,
} from "../../common/progression";
import type {
  HeroSummary,
  PanelTriggers,
  PlayerProgress,
  PublicHeroProfile,
  RealmState,
  UnitBuild,
} from "../../common/protocol";
import type { PlayerState, StatusEffectSnapshot } from "../game/types";
import { h } from "./dom";
import { itemTile, orderInventoryTiles } from "./InventoryView";
import {
  inventoryCapacity,
  occupiedInventorySlots,
  SCRAP_PROMOTION_COST,
} from "../../common/inventory";
import { bindRequirementPreview, itemDetails } from "./ItemDetails";
import type { CurrencyPreview, HudCallbacks, SpellSlot } from "./types";
import {
  attackProfile,
  bucklerBlockChance,
  bucklerBlockCost,
  cappedSkillLevel,
  MAX_SKILL_LEVEL,
  cooldownScale,
  healingCooldown,
  orbitingHammerDuration,
  rapidRegenDuration,
  rapidRegenMultiplier,
  skillCooldown,
  skillDamagePreview,
  skillRange,
  skillStatBonusDescription,
  whirlwindDuration,
  whirlwindMovementSpeed,
  type SkillDamagePreview,
} from "../../common/combat";
import { derivedStats } from "../../common/progression";
import { SKILLS } from "../../common/content";
import { actualSkillLevel } from "../game/systems/HeroCombatSystem";
import {
  applyPreviewClass,
  formatPreviewValue,
  formatProjectedValue,
  previewTone,
  type PreviewValue,
} from "./preview";
import { extractButtonStatus } from "./inventoryAvailability";
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
function formatSpellLevel(activeLevel: number, actualLevel: number): string { return activeLevel < actualLevel ? `${activeLevel}/${actualLevel}` : String(activeLevel); }

export class Hud {
  private player?: PlayerState;
  private inspected?: UnitBuild;
  private inspectedXp?: number;
  private inspectedBestWave?: number;
  private realm?: RealmState;
  private readonly joinPanel: HTMLElement;
  private readonly gameHud: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly leaderboardNode = (
    <div class="leaderboard" />
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
        {currencyCell("Gold", 0, "gold")}
        {currencyCell("Souls", 0, "souls")}
        {currencyCell("Common", 0, "common")}
        {currencyCell("Uncommon", 0, "uncommon")}
        {currencyCell("Rare", 0, "rare")}
        {currencyCell("Epic", 0, "epic")}
      </div>
      {this.loadoutNode}
      {this.inventoryCount}
    </div>
  ) as HTMLElement;
  private readonly backpackScroll = (
    <div class="backpack-scroll" />
  ) as HTMLElement;
  private readonly spellBar = (<section class="spell-bar" />) as HTMLElement;
  private readonly learnedSkillsBar = (<div class="skill-bar learned-skills-bar" aria-label="Learned skills" />) as HTMLElement;
  private readonly gearedSkillsBar = (<div class="skill-bar geared-skills-bar" aria-label="Geared skills" />) as HTMLElement;
  private readonly resourceDock = (
    <section class="resource-dock" />
  ) as HTMLElement;
  private readonly healthBar = resourceBar("Health", "health");
  private readonly statusEffects = (<div class="status-effects" aria-label="Active status effects" />) as HTMLElement;
  private readonly manaBar = resourceBar("Mana", "mana");
  private readonly staminaLine = (
    <div
      class="stamina-line"
      role="progressbar"
      aria-label="Stamina"
      aria-valuemin="0"
    >
      <span />
    </div>
  ) as HTMLElement;
  private readonly xpName = (<small />) as HTMLElement;
  private readonly xpLevel = (<strong />) as HTMLElement;
  private readonly xpBadge = (
    <div
      class="xp-badge"
      role="progressbar"
      aria-label="Experience"
      aria-valuemin="0"
    >
      <div>
        {this.xpName}
        {this.xpLevel}
      </div>
    </div>
  ) as HTMLElement;
  private readonly waveBanner = (
    <div class="wave-banner" aria-live="polite">
      <strong />
      <span />
    </div>
  ) as HTMLElement;
  private readonly centerToast = (
    <div class="center-toast" role="status" aria-live="polite" />
  ) as HTMLElement;
  private readonly multiplayerIntro = (
    <aside
      class="multiplayer-intro is-hidden"
      aria-label="Multiplayer introduction"
    >
      <div>
        <strong>Your bloodline must survive.</strong>
        <p>
          Training Grounds are safe, but death in a Realm ends this hero's
          journey. Their child takes over at level 0, inheriting all equipment
          and half the family's Gold and Souls. In a Realm, use an item's Send
          button to invade another player's realm: your gear arms a named creep
          in one of their future waves.
        </p>
      </div>
    </aside>
  ) as HTMLElement;
  private readonly xpToast = (
    <div class="xp-toast" role="status" aria-live="polite" />
  ) as HTMLElement;
  private waveTimer?: number;
  private centerToastTimer?: number;
  private xpToastTimer?: number;
  private displayedXp?: number;
  private targetXp = 0;
  private dynamicSignature = "";
  private realmSignature = "";
  private spellStructureSignature = "";
  private allocationSignature = "";
  private lastWaveNumber?: number;
  private staticProgress?: PlayerProgress;
  private staticPlayerName = "";
  private staticReceivesDeathEchoes = false;
  private staticBestWave = -1;
  private activeMainHand?: HTMLElement;
  private currentSpells: SpellSlot[] = [];
  private spellPreview?: Map<SkillId, number | null>;
  private inventoryHover?: { tileId: string; actionIndex?: number };
  private activeScrapPromotion?: Exclude<Rarity, "common">;
  private readonly spellNodes = new Map<string, HTMLElement>();
  constructor(
    private readonly root: HTMLDivElement,
    private readonly callbacks: HudCallbacks,
  ) {
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
    this.joinPanel = (
      <section class="join-panel">
        {joinForm}
        {this.joinNoticeNode}
        <h2>Heroes</h2>
        {this.leaderboardNode}
      </section>
    ) as HTMLElement;
    joinForm.onsubmit = (event) => {
      event.preventDefault();
      const name = this.nameInput.value.trim();
      if (name) callbacks.onJoin(name);
    };
    const back = (
      <button class="inspect-back is-hidden" type="button">
        Back to hero
      </button>
    ) as HTMLButtonElement;
    back.onclick = callbacks.onBack;
    this.characterToggle = (
      <button
        class="panel-toggle"
        type="button"
        aria-label="Collapse character sheet"
        aria-expanded="true"
      >
        ‹
      </button>
    ) as HTMLButtonElement;
    this.inventoryToggle = (
      <button
        class="panel-toggle"
        type="button"
        aria-label="Collapse inventory"
        aria-expanded="true"
      >
        ›
      </button>
    ) as HTMLButtonElement;
    this.characterPanel = (
      <aside class="character-panel">
        {this.characterToggle}
        {back}
        {this.sheetNode}
      </aside>
    ) as HTMLElement;
    this.inventoryPanel = (
      <aside class="inventory-column">
        {this.inventoryToggle}
        {this.inventoryNode}
      </aside>
    ) as HTMLElement;
    this.inventoryNode.append(this.inventoryHeader, this.backpackScroll);
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
    this.resourceDock.append(
      (
        <div class="health-cluster">
          {this.statusEffects}
          {this.healthBar.node}
          {this.staminaLine}
        </div>
      ) as HTMLElement,
      (
        <div class="xp-cluster">
          {this.xpToast}
          {this.xpBadge}
        </div>
      ) as HTMLElement,
      (<div class="mana-cluster">{this.manaBar.node}</div>) as HTMLElement,
    );
    const dismissMultiplayer = (
      <button type="button">Got it</button>
    ) as HTMLButtonElement;
    dismissMultiplayer.onclick = () => {
      this.panelTriggers.multiplayer = false;
      this.multiplayerIntro.classList.add("is-hidden");
      this.callbacks.onDismissPanelTrigger("multiplayer");
    };
    this.multiplayerIntro.append(dismissMultiplayer);
    this.gameHud = (
      <div class="game-hud">
        <header class="game-status-bar">
          <section class="hud-top">{this.realmPanel}</section>
        </header>
        {this.multiplayerIntro}
        <div class="canvas-overlay-top">
          {this.waveBanner}
          <section class="notification-area">{this.noticeNode}</section>
        </div>
        {this.centerToast}
        {this.spellBar}
        {this.resourceDock}
        {this.characterPanel}
        {this.inventoryPanel}
      </div>
    ) as HTMLElement;
    root.append(this.joinPanel, this.publicSheet, this.gameHud);
    this.updateVisibility();
  }
  setJoinName(name: string): void {
    this.nameInput.value = name;
  }
  setNotice(notice: string): void {
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
    clearTimeout(this.xpToastTimer);
    this.xpToast.textContent = message;
    this.xpToast.classList.add("is-visible");
    this.xpToastTimer = window.setTimeout(
      () => this.xpToast.classList.remove("is-visible"),
      3200,
    );
  }
  setPlayer(player: PlayerState): void {
    this.player = player;
    this.targetXp = player.progress.xp;
    this.displayedXp =
      this.displayedXp === undefined
        ? this.targetXp
        : lerpXpDisplay(this.displayedXp, this.targetXp);
    this.renderDynamicHud();
    if (
      this.staticProgress !== player.progress ||
      this.staticPlayerName !== player.name ||
      this.staticReceivesDeathEchoes !== player.receivesDeathEchoes ||
      this.staticBestWave !== player.maxWaveReached
    ) {
      this.staticProgress = player.progress;
      this.staticPlayerName = player.name;
      this.staticReceivesDeathEchoes = player.receivesDeathEchoes;
      this.staticBestWave = player.maxWaveReached;
      this.renderStaticHud();
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
    if (triggers.character)
      this.setPanelCollapsed(
        this.characterPanel,
        this.characterToggle,
        "character",
        true,
      );
    if (triggers.inventory)
      this.setPanelCollapsed(
        this.inventoryPanel,
        this.inventoryToggle,
        "inventory",
        true,
      );
    this.multiplayerIntro.classList.toggle("is-hidden", !triggers.multiplayer);
  }
  setLeaderboard(heroes: HeroSummary[]): void {
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
            <span>Level {hero.level}</span>
          </button>
        ) as HTMLButtonElement;
        button.onclick = () => this.callbacks.onInspectHero(hero.id);
        return button;
      }),
    );
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
      effectiveStatSheet(hero.mainHand, hero.offHand, stats),
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
    this.staticProgress = undefined;
    this.dynamicSignature = "";
    this.updateVisibility();
  }
  setInspection(build?: UnitBuild, xpReward?: number, bestWave?: number): void {
    this.inspected = build;
    this.inspectedXp = build ? (xpReward ?? build.xpReward) : undefined;
    this.inspectedBestWave = build ? bestWave : undefined;
    this.renderStaticHud();
  }
  setRealm(realm: RealmState): void {
    const modeChanged = this.realm?.mode !== realm.mode;
    this.realm = realm;
    this.renderRealm();
    if (modeChanged && this.player) this.renderInventory(this.player.progress);
  }
  setSpells(spells: SpellSlot[]): void {
    this.currentSpells = spells;
    this.renderSpellSlots();
  }
  private previewSpellLevels(skills?: SkillId[]): void {
    this.spellPreview =
      skills && this.player
        ? new Map(
            skills.map((id) => [
              id,
              cappedSkillLevel(
                (this.currentSpells.find((spell) => spell.id === id)?.actualLevel ??
                  actualSkillLevel(this.player!.progress, id)) + 1,
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
          resource: SKILLS[id].resource,
          costLabel: SKILLS[id].passive
            ? `0 ${capitalize(SKILLS[id].resource)}`
            : capitalize(SKILLS[id].resource),
          active: false,
          bar: this.player?.progress.learnedSkills.includes(id) ? "learned" as const : "geared" as const,
        },
    );
    const visible = spells.filter((spell) => spell.active);
    const structure = visible
      .map(
        ({ id, label, level, resource, bar }) =>
          `${bar}:${id}:${label}:${level}:${resource}:${preview?.get(id) ?? ""}`,
      )
      .join("|");
    if (structure !== this.spellStructureSignature) {
      this.spellStructureSignature = structure;
      this.spellNodes.clear();
      this.learnedSkillsBar.replaceChildren(
        <small class="skill-bar-label">Learned</small>,
        ...visible.filter((spell) => spell.bar === "learned").map((spell) => this.renderSpellSlot(spell, preview)),
      );
      this.gearedSkillsBar.replaceChildren(
        <small class="skill-bar-label">Geared</small>,
        ...visible.filter((spell) => spell.bar === "geared").map((spell) => this.renderSpellSlot(spell, preview)),
      );
      this.spellBar.replaceChildren(
        ...(visible.length ? [this.learnedSkillsBar, this.gearedSkillsBar] : [<small>No skills</small>]),
      );
    }
    for (const spell of spells) {
      const ratio =
        spell.cooldownMax > 0
          ? Math.max(0, Math.min(1, spell.cooldown / spell.cooldownMax))
          : 0;
      this.spellNodes
        .get(spell.id)
        ?.style.setProperty("--cooldown-progress", String(ratio));
    }
  }
  private renderSpellSlot(spell: SpellSlot, preview?: Map<SkillId, number | null>): HTMLButtonElement {
              const cooldown = (<span class="spell-cooldown" />) as HTMLElement;
              this.spellNodes.set(spell.id, cooldown);
              const projected = preview?.get(spell.id);
              const actualLevel = projected === undefined ? spell.actualLevel : projected ?? 0;
              const shownLevel = Math.min(actualLevel, this.player?.progress.level ?? actualLevel);
              const levelValue: PreviewValue<string> = {
                currentVal: formatSpellLevel(spell.level, spell.actualLevel),
                newVal: formatSpellLevel(shownLevel, actualLevel),
              };
              const changed =
                projected !== undefined && projected !== spell.actualLevel;
              const button = (
                <button
                  class={`spell-slot spell-resource-${spell.resource}${spell.cooldown <= 0 ? " is-ready" : ""}${changed ? (projected === null || projected < spell.actualLevel ? " is-level-cost-preview" : " is-level-preview") : ""}`}
                  type="button"
                  aria-label={`${spell.label}, level ${formatPreviewValue(levelValue)}`}
                >
                  {cooldown}
                  <strong>{spell.label.slice(0, 2).toUpperCase()}</strong>
                  <small>{formatPreviewValue(levelValue)}</small>
                  {this.renderSkillTooltip(spell, shownLevel)}
                </button>
              ) as HTMLButtonElement;
              button.onclick = () => this.moveSpellToListEnd(spell.id);
              return button;
  }
  private moveSpellToListEnd(skill: SkillId): void {
    const order = this.currentSpells.map(({ id }) => id);
    const index = order.indexOf(skill);
    if (index < 0) return;
    order.push(...order.splice(index, 1));
    this.callbacks.onReorderSkills(order);
  }
  private renderSkillTooltip(spell: SpellSlot, level: number): HTMLElement {
    const shownLevel = Math.max(0, Math.min(MAX_SKILL_LEVEL, level));
    const skill = SKILLS[spell.id];
    return (
      <span class="spell-tooltip" role="tooltip">
        <b>{skill.label}</b>
        <span class="spell-tooltip-description">{skill.description}</span>
        {skillStatBonusDescription(spell.id) ? <span class="spell-tooltip-description">{skillStatBonusDescription(spell.id)}</span> : null}
        <span class="spell-tooltip-comparison">
          {this.renderSkillProperties(spell, shownLevel, "Current level")}
          {this.renderSkillProperties(spell, shownLevel + 1, "Next level")}
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
    const progress = this.player?.progress;
    const stats = progress
      ? statsWithItemBonuses(
          progress.stats,
          progress.mainHand,
          progress.offHand,
        )
      : undefined;
    const cooldownSeconds =
      spell.id === "healing"
        ? healingCooldown(shownLevel)
        : progress && stats
          ? skillCooldown(spell.id, progress.mainHand, stats, shownLevel) *
            (spell.id === "flurry" ? 1 : cooldownScale(shownLevel, derivedStats(stats).cooldownReduction))
          : skill.cooldown;
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
        magic: 0,
        spirit: 0,
        intelligence: 0,
      },
    );
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
            <strong>{spell.costLabel}</strong>
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
            <strong>{range ? `${fmt(range)}px` : "Self"}</strong>
          </span>
          {spell.id === "whirlwind" ? <span>
            <small>Duration</small>
            <strong>{fmt(whirlwindDuration(shownLevel))}s</strong>
          </span> : null}
          {spell.id === "whirlwind" ? <span>
            <small>Movement</small>
            <strong>{fmt(whirlwindMovementSpeed(shownLevel))}×</strong>
          </span> : null}
          {spell.id === "orbitingHammers" ? <span>
            <small>Duration</small>
            <strong>{fmt(orbitingHammerDuration(shownLevel))}s</strong>
          </span> : null}
          {spell.id === "rapidRegen" ? <span>
            <small>Duration</small>
            <strong>{fmt(rapidRegenDuration(shownLevel))}s</strong>
          </span> : null}
          {spell.id === "rapidRegen" ? <span>
            <small>Regen</small>
            <strong>{fmt(rapidRegenMultiplier(shownLevel) * 100)}% +0.1/s</strong>
          </span> : null}
        </span>
      </span>
    ) as HTMLElement;
  }
  showWaveBanner(title: string, detail: string): void {
    clearTimeout(this.waveTimer);
    (this.waveBanner.querySelector("strong") as HTMLElement).textContent =
      title;
    (this.waveBanner.querySelector("span") as HTMLElement).textContent = detail;
    this.waveBanner.classList.add("is-visible");
    this.waveTimer = window.setTimeout(
      () => this.waveBanner.classList.remove("is-visible"),
      3200,
    );
  }
  private renderDynamicHud(): void {
    if (!this.player) return;
    const p = this.player.progress;
    const shownXp = this.displayedXp ?? p.xp;
    const shownLevel = levelForXp(shownXp);
    const into = shownXp - cumulativeXpForLevel(shownLevel);
    const needed = xpForNextLevel(shownLevel);
    const xpRatio = needed > 0 ? Math.max(0, Math.min(1, into / needed)) : 0;
    const effectiveStats = statsWithItemBonuses(
      p.stats,
      p.mainHand,
      p.offHand,
      p.amulet,
      p.charm,
    );
    const derived = derivedStats(effectiveStats);
    const equipped = [p.mainHand, p.offHand, p.amulet, p.charm].filter(
      Boolean,
    ) as ItemInstance[];
    const vigorousRegen = equipped.reduce((sum, item) => {
      const effectiveness = itemRequirementMultiplier(item, effectiveStats);
      const multiplier =
        (item.modifiers.strengthRegenMultiplier ?? 0) * effectiveness;
      return (
        sum +
        (multiplier > 0
          ? (0.01 + multiplier * effectiveStats.strength) * effectiveness
          : 0)
      );
    }, 0);
    const healthRegen = this.player.healthRegen || derived.hpRegen + vigorousRegen;
    const mainEffectiveness = itemRequirementMultiplier(
      p.mainHand,
      effectiveStats,
    );
    const manaRegen =
      derived.manaRegen *
      (1 +
        ((p.mainHand?.modifiers.manaRegenMultiplier ?? 1) - 1) *
          mainEffectiveness);
    const signature = [
      this.player.health,
      this.player.maxHealth,
      healthRegen,
      this.player.stamina,
      this.player.maxStamina,
      this.player.mana,
      this.player.maxMana,
      manaRegen,
      shownXp,
      shownLevel,
      this.player.name,
      ...this.player.statuses.flatMap((status) => [
        status.kind,
        Math.ceil(status.remaining * 10) / 10,
        status.damagePerSecond,
      ]),
    ]
      .map(flatValue)
      .join("|");
    if (signature !== this.dynamicSignature) {
      this.dynamicSignature = signature;
      updateResourceBar(
        this.healthBar,
        this.player.health,
        this.player.maxHealth,
        healthRegen,
      );
      this.renderStatusEffects(this.player.statuses);
      updateResourceBar(
        this.manaBar,
        this.player.mana,
        this.player.maxMana,
        manaRegen,
      );
      const stamina = resourceRatio(
        this.player.stamina,
        this.player.maxStamina,
      );
      setText(this.xpName, this.player.name);
      setText(this.xpLevel, String(shownLevel));
      this.staminaLine.setAttribute(
        "aria-valuemax",
        String(this.player.maxStamina),
      );
      this.staminaLine.setAttribute(
        "aria-valuenow",
        String(this.player.stamina),
      );
      (this.staminaLine.firstElementChild as HTMLElement).style.width =
        `${stamina * 100}%`;
      this.xpBadge.style.setProperty("--xp-angle", `${xpRatio * 360}deg`);
      this.xpBadge.setAttribute("aria-valuemax", String(needed));
      this.xpBadge.setAttribute("aria-valuenow", String(into));
    }
    this.activeMainHand?.style.setProperty(
      "--attack-progress",
      `${(this.inspected ? 1 : this.player.attackProgress) * 100}%`,
    );
  }
  private renderStatusEffects(statuses: StatusEffectSnapshot[]): void {
    this.statusEffects.replaceChildren(...statusEffectSummaries(statuses).map((status) => (
      <span class={`status-effect status-effect-${status.kind}`} tabindex="0" aria-label={status.tooltip}>
        <span aria-hidden="true">{status.icon}</span>
        {status.stacks > 1 ? <b>{status.stacks}</b> : null}
        <span class="status-effect-tooltip" role="tooltip">{status.tooltip}</span>
      </span>
    ) as HTMLElement));
  }
  private renderStaticHud(): void {
    if (!this.player) return;
    const p = this.player.progress;
    const build = this.inspected;
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
            ? this.inspectedBestWave === undefined
              ? ` · ${fmt(this.inspectedXp ?? build.xpReward)} XP`
              : ` · Best wave ${this.inspectedBestWave}`
            : ` · Best wave ${this.player.maxWaveReached}`}
        </small>
      </div>,
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
            <b>{fmt(effectiveStats[key])}</b>
          </span>
        ))}
      </div>,
      this.allocationNode,
      <strong>Effective stats</strong>,
      effectiveStatSheet(main, off, effectiveStats),
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
    if (this.activeScrapPromotion) this.previewScrapPromotion(this.activeScrapPromotion);
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
    const ordered = orderInventoryTiles(progress.inventoryTiles, progress);
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
      const signature = `${tile.key}:${tile.quantity}:${Number(equippedKeys.has(tile.key))}:${statsSignature}:${Number(canSend)}:${extractButtonStatus(tile, progress)}`;
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
    action: "card" | "upgrade" = "card",
  ): void {
    if (!this.player || this.inspected) return;
    const p = this.player.progress;
    this.highlightDestinationSlot(item);
    this.highlightDisplacedItems(item, equipped, action);
    if (!item) {
      this.previewBuild(p.mainHand, p.offHand, p.amulet, p.charm, false);
      this.spellPreview = undefined;
      this.renderSpellSlots();
      return;
    }
    let main = p.mainHand;
    let off = p.offHand;
    let amulet = p.amulet;
    let charm = p.charm;
    if (action === "upgrade") {
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
    for (const cell of this.loadoutNode.querySelectorAll<HTMLElement>(
      ".loadout-cell",
    ))
      cell.classList.toggle(
        "is-slot-preview",
        Boolean(item && cell.dataset.equipSlot === equipSlotKey(item)),
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
    action: "card" | "upgrade" = "card",
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
    const cell = this.inventoryHeader.querySelector<HTMLElement>(`.currency-cell[data-currency="${target}"]`);
    if (!cell) return;
    cell.tabIndex = 0;
    cell.setAttribute("role", "button");
    cell.setAttribute("aria-label", `Promote scrap to ${target}`);
    cell.title = `Click: convert ${SCRAP_PROMOTION_COST} lower-tier scrap into 1 ${target} scrap. Shift-click: convert all complete batches.`;
    cell.classList.add("is-scrap-promotion");
    cell.onclick = (event) => this.callbacks.onPromoteScrap(target, event.shiftKey);
    cell.onpointerenter = () => { this.activeScrapPromotion = target; this.previewScrapPromotion(target); };
    cell.onpointerleave = () => { this.activeScrapPromotion = undefined; this.previewCurrencies(); };
    cell.onfocus = () => { this.activeScrapPromotion = target; this.previewScrapPromotion(target); };
    cell.onblur = () => { this.activeScrapPromotion = undefined; this.previewCurrencies(); };
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
    let baseline: Array<[string, string]> | undefined;
    if (highlight) {
      const p = this.player.progress;
      baseline = effectiveStatRows(
        p.mainHand,
        p.offHand,
        statsWithItemBonuses(p.stats, p.mainHand, p.offHand, p.amulet, p.charm),
      );
    }
    current.replaceWith(effectiveStatSheet(main, off, effective, baseline));
  }
  private renderRealm(): void {
    if (!this.realm) return;
    const r = this.realm;
    const signature = [
      r.mode,
      this.player?.waveNumber ?? "",
      Number(r.canLeave),
      r.outgoingQueued,
      r.incomingQueued,
      ...r.guards.map(realmMemberSignature),
      "|",
      ...r.attackers.map(realmMemberSignature),
    ].join(":");
    if (signature === this.realmSignature) return;
    this.realmSignature = signature;
    const action = (
      <button type="button">
        {r.mode === "training" ? "Enter Realm" : "Leave to Lobby"}
      </button>
    ) as HTMLButtonElement;
    action.onclick =
      r.mode === "training"
        ? this.callbacks.onEnterRealm
        : this.callbacks.onLeaveRealm;
    action.disabled = r.mode !== "training" && !r.canLeave;
    const logout = (<button type="button">Logout</button>) as HTMLButtonElement;
    logout.onclick = this.callbacks.onLogout;
    const kill = (
      <button class="kill-player" type="button">
        Kill Player
      </button>
    ) as HTMLButtonElement;
    kill.onclick = this.callbacks.onKillPlayer;
    const title =
      r.mode === "training"
        ? `Wave ${this.player?.waveNumber ?? "—"} · Halls of Realms`
        : r.mode === "waiting"
          ? `Wave ${this.player?.waveNumber ?? "—"} · Waiting for realm`
          : `Wave ${this.player?.waveNumber ?? "—"}`;
    const members = (values: RealmState["guards"]) =>
      values.length
        ? (values
            .flatMap((p, index) => {
              const button = (
                <button class="realm-member" type="button">
                  {rankedName(
                    `${p.name} L${p.level}${p.down ? " ↓" : ""}`,
                    p.receivesDeathEchoes,
                  )}
                </button>
              ) as HTMLButtonElement;
              button.onclick = () => this.callbacks.onInspectHero(p.id);
              return [index ? document.createTextNode(", ") : null, button];
            })
            .filter(Boolean) as Node[])
        : [document.createTextNode("—")];
    const guards = (<span>Guard: </span>) as HTMLElement;
    guards.append(...members(r.guards));
    const attackers = (<span>Attacker: </span>) as HTMLElement;
    attackers.append(...members(r.attackers));
    this.realmPanel.replaceChildren(
      <strong>{title}</strong>,
      guards,
      attackers,
      <span>
        Queues {r.outgoingQueued} out / {r.incomingQueued} in
      </span>,
      action,
      ...(r.mode === "training" ? [logout] : [kill]),
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
    if (!this.player || this.inspected) {
      this.allocationNode.classList.add("is-hidden");
      return;
    }
    this.allocationNode.classList.remove("is-hidden");
    const values = integerAllocation(this.player.progress.allocation);
    const valueNodes = new Map<keyof Stats, HTMLElement>();
    const minusButtons = new Map<keyof Stats, HTMLButtonElement>();
    const plusButtons = new Map<keyof Stats, HTMLButtonElement>();
    let preview = false;
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
      <strong class="allocation-title">Next-level allocation</strong>,
      controls,
    );
    const currentValues = (): Stats => ({ ...values });
    const update = () => {
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
      const projected = Object.fromEntries(
        STAT_KEYS.map((key) => [key, p.stats[key] + values[key]]),
      ) as Stats;
      const currentEffective = statsWithItemBonuses(
        p.stats,
        p.mainHand,
        p.offHand,
        p.amulet,
        p.charm,
      );
      const projectedEffective = statsWithItemBonuses(
        projected,
        p.mainHand,
        p.offHand,
        p.amulet,
        p.charm,
      );
      for (const key of STAT_KEYS) {
        const node = grid?.querySelector<HTMLElement>(`[data-stat="${key}"] b`);
        if (node) {
          const value = {
            currentVal: currentEffective[key],
            newVal: preview ? projectedEffective[key] : currentEffective[key],
          };
          setText(node, formatPreviewValue(value, fmt));
          applyPreviewClass(node, previewTone(value));
        }
      }
      this.previewEffectiveStats(
        preview ? projected : p.stats,
        p.mainHand,
        p.offHand,
        p.amulet,
        p.charm,
        preview,
      );
    };
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
      preview = true;
      update();
    };
    this.allocationNode.onmouseleave = () => {
      if (!this.allocationNode.contains(document.activeElement)) {
        preview = false;
        update();
      }
    };
    const focusNode = this.allocationNode as HTMLElement & {
      onfocusin: (() => void) | null;
      onfocusout: (() => void) | null;
    };
    focusNode.onfocusin = () => {
      preview = true;
      update();
    };
    focusNode.onfocusout = () =>
      window.setTimeout(() => {
        if (!this.allocationNode.contains(document.activeElement)) {
          preview = false;
          update();
        }
      });
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
  private setPanelCollapsed(
    panel: HTMLElement,
    toggle: HTMLButtonElement,
    kind: "character" | "inventory",
    collapsed: boolean,
  ): void {
    panel.classList.toggle("is-collapsed", collapsed);
    toggle.textContent =
      kind === "character" ? (collapsed ? "›" : "‹") : collapsed ? "‹" : "›";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute(
      "aria-label",
      `${collapsed ? "Expand" : "Collapse"} ${kind === "character" ? "character sheet" : "inventory"}`,
    );
    console.log({ collapsed });
    debugger;
    document.documentElement.style.setProperty(
      kind === "character"
        ? "--character-panel-width"
        : "--inventory-panel-width",
      collapsed ? "30px" : kind === "character" ? "320px" : "640px",
    );
  }
  private updateVisibility(): void {
    const joined = Boolean(this.player);
    this.joinPanel.classList.toggle("is-hidden", joined);
    this.gameHud.classList.toggle("is-hidden", !joined);
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
function equipSlotKey(item: ItemInstance): string {
  return item.itemKind === "weapon"
    ? "main-hand"
    : item.itemKind === "amulet"
      ? "amulet"
      : item.itemKind === "charm"
        ? "charm"
        : "offhand";
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
function effectiveStatRows(
  main: ItemInstance | undefined,
  off: ItemInstance | undefined,
  stats: Stats,
): Array<[string, string]> {
  const derived = derivedStats(stats);
  const items = [main, off].filter(Boolean) as ItemInstance[];
  const buckler = off?.itemKind === "buckler" ? off : undefined;
  const profile = attackProfile(main, stats, BALANCE);
  const perks = equippedPerks(stats, main, off);
  const mainEffectiveness = itemRequirementMultiplier(main, stats);
  const bucklerEffectiveness = buckler
    ? itemRequirementMultiplier(buckler, stats)
    : 1;
  const lifeSteal = items.reduce((sum, item) => {
    const effectiveness = itemRequirementMultiplier(item, stats);
    const base = (item.modifiers.lifeStealBase ?? 0) * effectiveness;
    return sum + (base + (base > 0 ? 0.001 * stats.spirit : 0)) * effectiveness;
  }, 0);
  const vigorous = items.reduce((sum, item) => {
    const effectiveness = itemRequirementMultiplier(item, stats);
    const multiplier =
      (item.modifiers.strengthRegenMultiplier ?? 0) * effectiveness;
    return (
      sum +
      (multiplier > 0
        ? (0.01 + multiplier * stats.strength) * effectiveness
        : 0)
    );
  }, 0);
  return [
    ["Damage", fmt(profile.damage)],
    ["Attacks/s", fmt(profile.attacksPerSecond)],
    ["Attack cost", `${fmt(profile.staminaCost)} stamina`],
    ["Attack range", `${profile.range}px`],
    [
      "Crit chance",
      percent(
        Math.min(
          1,
          derived.critChance +
            (main?.modifiers.critChance ?? 0) * mainEffectiveness,
        ),
      ),
    ],
    ["Crit damage", percent(derived.critMultiplier)],
    [
      "Magic amp",
      percent(
        Math.max(
          0,
          derived.magicAmp +
            (main?.modifiers.magicAmp ?? 0) * mainEffectiveness -
            1,
        ),
      ),
    ],
    [
      "Cooldown reduction",
      percent(
        Math.min(
          0.8,
          derived.cooldownReduction +
            itemCooldownReduction(off) *
              (off ? itemRequirementMultiplier(off, stats) : 1),
        ),
      ),
    ],
    ["Spell range/Lv", `+${fmt(0.5 * stats.spirit)}px`],
    ["Spell power/Lv", "+15%"],
    ["Max health", fmt(derived.maxHp)],
    ["Max stamina", fmt(derived.maxStamina)],
    ["Max mana", fmt(derived.maxMana)],
    ["Defense", fmt(perks.defense + (buckler ? stats.strength : 0))],
    [
      "Dodge chance",
      percent(Math.min(0.5, stats.agility * 0.003 + perks.dodgeChance)),
    ],
    ["Physical resist", percent(Math.min(0.5, perks.physicalResist))],
    ["Magic resist", percent(Math.min(0.5, perks.magicResist))],
    ["Fire resist", percent(Math.min(0.5, perks.fireResist))],
    ["Frost resist", percent(Math.min(0.5, perks.frostResist))],
    ["Poison resist", percent(Math.min(0.5, perks.poisonResist))],
    ["Bleed resist", percent(Math.min(0.5, perks.bleedResist))],
    ["Block chance", percent(bucklerBlockChance(buckler, stats))],
    [
      "Block cost",
      buckler ? `${fmt(bucklerBlockCost(buckler, stats))} stamina` : "0",
    ],
    ["Health regen", `${fmt(derived.hpRegen + vigorous)}/s`],
    [
      "Mana regen",
      `${fmt(derived.manaRegen * (1 + ((main?.modifiers.manaRegenMultiplier ?? 1) - 1) * mainEffectiveness))}/s`,
    ],
    ["Stamina regen", `${fmt(derived.staminaRegen)}/s`],
    ["Life steal", percent(lifeSteal)],
    [
      "Mana cost reduction",
      percent(itemResourceCostReduction(off, "mana", stats)),
    ],
    [
      "Life cost reduction",
      percent(itemResourceCostReduction(off, "life", stats)),
    ],
    [
      "Bleed chance",
      percent((main?.modifiers.bleedChance ?? 0) * mainEffectiveness),
    ],
    [
      "Poison chance",
      percent((main?.modifiers.poisonChance ?? 0) * mainEffectiveness),
    ],
    [
      "Stun chance",
      percent((main?.modifiers.stunChance ?? 0) * mainEffectiveness),
    ],
    [
      "Gold gain",
      percent((buckler?.modifiers.goldGain ?? 0) * bucklerEffectiveness),
    ],
    [
      "Rarity boost",
      percent((buckler?.modifiers.rarityBoost ?? 0) * bucklerEffectiveness),
    ],
    [
      "Attraction",
      `${fmt(Math.max((main?.attractionSpeed ?? 0) * mainEffectiveness, (off?.attractionSpeed ?? 0) * (off ? itemRequirementMultiplier(off, stats) : 1)))}px/s`,
    ],
    ["Reflection", buckler?.reflectionComponents.join(" / ") || "None"],
  ];
}
function effectiveStatSheet(
  main: ItemInstance | undefined,
  off: ItemInstance | undefined,
  stats: Stats,
  baseline?: Array<[string, string]>,
): HTMLElement {
  const previous = new Map(baseline);
  const rows = effectiveStatRows(main, off, stats);
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
    "Max stamina",
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
function currencyCell(label: string, value: number, kind: string): HTMLElement {
  return (
    <div class={`currency-cell currency-${kind}`} data-currency={kind}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  ) as HTMLElement;
}
interface ResourceBar {
  node: HTMLElement;
  value: HTMLElement;
  regen: HTMLElement;
  fill: HTMLElement;
  loss: HTMLElement;
  previous?: number;
  lossTimer?: ReturnType<typeof setTimeout>;
}
function resourceBar(label: string, kind: "health" | "mana"): ResourceBar {
  const value = (<span />) as HTMLElement;
  const regen = (<span class="resource-regen" />) as HTMLElement;
  const loss = (<span class="resource-loss" />) as HTMLElement;
  const fill = (<span class="resource-fill" />) as HTMLElement;
  const node = (
    <div
      class={`resource-bar resource-${kind}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin="0"
    >
      <div class="resource-bar-header">
        <strong>{label}</strong>
        <span class="resource-bar-values">
          {value}
          {regen}
        </span>
      </div>
      <div class="resource-bar-track">
        {loss}
        {fill}
      </div>
    </div>
  ) as HTMLElement;
  return { node, value, regen, fill, loss };
}
function updateResourceBar(
  bar: ResourceBar,
  current: number,
  maximum: number,
  regen: number,
): void {
  const safeMaximum = Math.max(0, maximum);
  const safeCurrent = Math.max(0, Math.min(current, safeMaximum));
  const ratio = resourceRatio(safeCurrent, safeMaximum);
  const previous = bar.previous;
  bar.node.setAttribute("aria-valuemax", String(safeMaximum));
  bar.node.setAttribute("aria-valuenow", String(safeCurrent));
  setText(bar.value, `${fmt(safeCurrent)} / ${fmt(safeMaximum)}`);
  setText(bar.regen, `+${fmt(Math.max(0, regen))}/s`);
  bar.fill.style.width = `${ratio * 100}%`;
  if (previous === undefined || safeCurrent >= previous) {
    if (bar.lossTimer) clearTimeout(bar.lossTimer);
    bar.lossTimer = undefined;
    bar.loss.classList.remove("is-catching-up");
    bar.loss.style.width = `${ratio * 100}%`;
  } else {
    bar.loss.classList.remove("is-catching-up");
    if (bar.lossTimer) clearTimeout(bar.lossTimer);
    bar.lossTimer = setTimeout(() => {
      bar.loss.classList.add("is-catching-up");
      bar.loss.style.width = `${ratio * 100}%`;
      bar.lossTimer = undefined;
    }, 420);
  }
  bar.previous = safeCurrent;
}
function resourceRatio(current: number, maximum: number): number {
  return maximum > 0 ? Math.max(0, Math.min(1, current / maximum)) : 0;
}
export interface StatusEffectSummary {
  kind: StatusEffectSnapshot["kind"];
  icon: string;
  stacks: number;
  remaining: number;
  damagePerSecond: number;
  tooltip: string;
}
const STATUS_EFFECT_PRESENTATION: Record<StatusEffectSnapshot["kind"], { name: string; icon: string }> = {
  bleed: { name: "Bleed", icon: "🩸" },
  poison: { name: "Poison", icon: "☠" },
  burn: { name: "Burn", icon: "🔥" },
  stun: { name: "Stun", icon: "✦" },
  freeze: { name: "Freeze", icon: "❄" },
  shock: { name: "Shock", icon: "✦" },
  curse: { name: "Curse", icon: "✧" },
};
export function statusEffectSummaries(statuses: StatusEffectSnapshot[]): StatusEffectSummary[] {
  const summaries = new Map<StatusEffectSnapshot["kind"], Omit<StatusEffectSummary, "tooltip">>();
  for (const status of statuses) {
    const presentation = STATUS_EFFECT_PRESENTATION[status.kind];
    const summary = summaries.get(status.kind);
    if (summary) {
      summary.stacks += 1;
      summary.remaining = Math.max(summary.remaining, status.remaining);
      summary.damagePerSecond += status.damagePerSecond;
    } else summaries.set(status.kind, { kind: status.kind, icon: presentation.icon, stacks: 1, remaining: status.remaining, damagePerSecond: status.damagePerSecond });
  }
  return [...summaries.values()].map((summary) => {
    const name = STATUS_EFFECT_PRESENTATION[summary.kind].name;
    const details = [`${fmt(Math.max(0, summary.remaining))}s remaining`];
    if (summary.stacks > 1) details.push(`${summary.stacks} stacks`);
    if (summary.damagePerSecond > 0) details.push(`${fmt(summary.damagePerSecond)} damage/s`);
    return { ...summary, tooltip: `${name} — ${details.join(" · ")}` };
  });
}
function flatValue(value: string | number): string {
  return typeof value === "number"
    ? String(Math.round(value * 100) / 100)
    : value;
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
function fmt(value: number): string {
  return Number(value.toFixed(3)).toString();
}
function percent(value: number): string {
  return `${fmt(value * 100)}%`;
}
