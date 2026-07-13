/** @jsx h */
/** @jsxFrag Fragment */
import { skillLabel } from "../../common/combat";
import { statsWithItemBonuses, type ItemInstance } from "../../common/items";
import { STAT_KEYS, cumulativeXpForLevel, derivedStats, xpForNextLevel, type Stats } from "../../common/progression";
import type { RealmState, UnitBuild } from "../../common/protocol";
import type { PlayerState } from "../game/types";
import { Fragment, h } from "./dom";
import { itemTile, orderInventoryTiles } from "./InventoryView";
import type { HudCallbacks, SpellSlot } from "./types";
export type { HudCallbacks, SpellSlot } from "./types";
declare global { namespace JSX { interface IntrinsicElements { [elementName: string]: Record<string, unknown> } } }

export class Hud {
  private player?: PlayerState; private inspected?: UnitBuild; private realm?: RealmState;
  private readonly joinPanel: HTMLElement; private readonly gameHud: HTMLElement; private readonly nameInput: HTMLInputElement;
  private readonly realmPanel = <div class="realm-panel" /> as HTMLElement;
  private readonly noticeNode = <div class="notice">Enter a name to join.</div> as HTMLElement; private readonly sheetNode = <div class="sheet-content" /> as HTMLElement;
  private readonly inventoryNode = <div class="inventory-content" /> as HTMLElement; private readonly allocationNode = <form class="allocation-panel" /> as HTMLElement;
  private readonly spellBar = <section class="spell-bar" /> as HTMLElement; private readonly resourceDock = <section class="resource-dock" /> as HTMLElement;
  private readonly waveBanner = <div class="wave-banner" aria-live="polite"><strong /><span /></div> as HTMLElement;
  private readonly centerToast = <div class="center-toast" role="status" aria-live="polite" /> as HTMLElement;
  private readonly xpToast = <div class="xp-toast" role="status" aria-live="polite" /> as HTMLElement;
  private waveTimer?: number; private centerToastTimer?: number; private xpToastTimer?: number;
  private staticSignature = "";
  constructor(private readonly root: HTMLDivElement, private readonly callbacks: HudCallbacks) {
    this.nameInput = <input name="name" maxlength="20" placeholder="Player name" autocomplete="off" /> as HTMLInputElement;
    this.joinPanel = <form class="join-panel">{this.nameInput}<button type="submit">Join</button></form> as HTMLElement;
    this.joinPanel.onsubmit = (event) => { event.preventDefault(); const name = this.nameInput.value.trim(); if (name) callbacks.onJoin(name); };
    const back = <button class="inspect-back is-hidden" type="button">Back to hero</button> as HTMLButtonElement; back.onclick = callbacks.onBack;
    const sheetToggle = <button class="panel-toggle" type="button" aria-label="Collapse character sheet" aria-expanded="true">‹</button> as HTMLButtonElement;
    const inventoryToggle = <button class="panel-toggle" type="button" aria-label="Collapse inventory" aria-expanded="true">›</button> as HTMLButtonElement;
    const sheet = <aside class="character-panel">{sheetToggle}{back}{this.sheetNode}{this.allocationNode}</aside> as HTMLElement;
    const inventory = <aside class="inventory-column">{inventoryToggle}{this.inventoryNode}</aside> as HTMLElement;
    sheetToggle.onclick = () => this.togglePanel(sheet, sheetToggle, "character");
    inventoryToggle.onclick = () => this.togglePanel(inventory, inventoryToggle, "inventory");
    this.gameHud = <div class="game-hud"><section class="hud-top">{this.realmPanel}</section><section class="notification-area">{this.noticeNode}</section>{this.waveBanner}{this.centerToast}{this.spellBar}{this.resourceDock}{sheet}{inventory}</div> as HTMLElement;
    root.append(this.joinPanel, this.gameHud); this.updateVisibility();
  }
  setJoinName(name: string): void { this.nameInput.value = name; }
  setNotice(notice: string): void { this.noticeNode.textContent = notice; this.noticeNode.classList.toggle("is-hidden", !notice); }
  showCenterToast(message: string): void { clearTimeout(this.centerToastTimer); this.centerToast.textContent = message; this.centerToast.classList.add("is-visible"); this.centerToastTimer = window.setTimeout(() => this.centerToast.classList.remove("is-visible"), 3200); }
  showXpToast(message: string): void { clearTimeout(this.xpToastTimer); this.xpToast.textContent = message; this.xpToast.classList.add("is-visible"); this.xpToastTimer = window.setTimeout(() => this.xpToast.classList.remove("is-visible"), 3200); }
  setPlayer(player: PlayerState): void { this.player = player; this.renderDynamicHud(); const signature = JSON.stringify({ name: player.name, progress: player.progress }); if (signature !== this.staticSignature) { this.staticSignature = signature; this.renderStaticHud(); } this.updateVisibility(); }
  setInspection(build?: UnitBuild): void { this.inspected = build; this.renderStaticHud(); }
  setRealm(realm: RealmState): void { this.realm = realm; this.renderRealm(); }
  setSpells(spells: SpellSlot[]): void { this.spellBar.replaceChildren(...(spells.length ? spells.map((spell) => { const ratio = spell.cooldownMax > 0 ? Math.max(0, Math.min(1, spell.cooldown / spell.cooldownMax)) : 0; return <button class="spell-slot" type="button" title={`${spell.label} · Level ${spell.level}`}><span class="spell-cooldown" style={`height:${ratio * 100}%`} /><strong>{spell.label.slice(0, 2).toUpperCase()}</strong><small>Lv{spell.level}</small></button>; }) : [<small>No spells</small>])); }
  showWaveBanner(title: string, detail: string): void { clearTimeout(this.waveTimer); (this.waveBanner.querySelector("strong") as HTMLElement).textContent = title; (this.waveBanner.querySelector("span") as HTMLElement).textContent = detail; this.waveBanner.classList.add("is-visible"); this.waveTimer = window.setTimeout(() => this.waveBanner.classList.remove("is-visible"), 3200); }
  private renderDynamicHud(): void { if (!this.player) return; const p = this.player.progress;
    const into = p.xp - cumulativeXpForLevel(p.level); const needed = xpForNextLevel(p.level); const xpRatio = needed > 0 ? Math.max(0, Math.min(1, into / needed)) : 0;
    this.resourceDock.replaceChildren(
      <div class="health-cluster">{resourceBar("Health", this.player.health, this.player.maxHealth, "health")}<div class="stamina-line" role="progressbar" aria-label="Stamina" aria-valuemin="0" aria-valuemax={this.player.maxStamina} aria-valuenow={this.player.stamina}><span style={`width:${resourceRatio(this.player.stamina, this.player.maxStamina) * 100}%`} /></div></div>,
      <div class="xp-cluster">{this.xpToast}<div class="xp-badge" style={`--xp-angle:${xpRatio * 360}deg`} role="progressbar" aria-label="Experience" aria-valuemin="0" aria-valuemax={needed} aria-valuenow={into}><div><small>{this.player.name}</small><strong>{p.level}</strong></div></div></div>,
      <div class="mana-cluster">{resourceBar("Mana", this.player.mana, this.player.maxMana, "mana")}</div>
    );
    const mainHand = this.root.querySelector(".equipped-main-hand") as HTMLElement | null; mainHand?.style.setProperty("--attack-progress", `${(this.inspected ? 1 : this.player.attackProgress) * 100}%`);
    this.renderRealm();
  }
  private renderStaticHud(): void { if (!this.player) return; const p = this.player.progress; const build = this.inspected; const stats = build?.stats ?? p.stats; const main = build?.mainHand ?? p.mainHand; const off = build?.offHand ?? p.offHand; const effectiveStats = statsWithItemBonuses(stats, main, off);
    this.sheetNode.replaceChildren(
      <div class="currency-grid">
        {currencyCell("Gold", p.gold, "gold")}{currencyCell("Souls", p.souls, "souls")}
        {currencyCell("Common", p.scraps.common, "common")}{currencyCell("Uncommon", p.scraps.uncommon, "uncommon")}
        {currencyCell("Rare", p.scraps.rare, "rare")}{currencyCell("Epic", p.scraps.epic, "epic")}
      </div>,
      <div class="portrait"><strong>{build?.name ?? this.player.name}</strong><small>Level {build?.level ?? p.level}</small></div>,
      <div class="attribute-grid">{STAT_KEYS.map((key) => <span><small>{key}</small>{fmt(stats[key])}</span>)}</div>,
      <strong>Main hand</strong>, equipmentSummary(main, effectiveStats, "main"), <strong>Offhand</strong>, off ? equipmentSummary(off, effectiveStats, "off") : <small>Empty</small>
    );
    (this.root.querySelector(".inspect-back") as HTMLElement).classList.toggle("is-hidden", !build); this.renderAllocation();
    this.inventoryNode.replaceChildren(<strong>Equipment {p.inventoryTiles.length}/{4 + Math.ceil(p.level / 10)}</strong>, <div class="backpack-scroll">{orderInventoryTiles(p.inventoryTiles).map((tile) => itemTile(tile, this.callbacks))}</div>); this.renderRealm(); }
  private renderRealm(): void { if (!this.realm) return; const r = this.realm; const action = <button type="button">{r.mode === "training" ? "Enter Realm" : "Leave to Lobby"}</button> as HTMLButtonElement; action.onclick = r.mode === "training" ? this.callbacks.onEnterRealm : this.callbacks.onLeaveRealm;
    const title = r.mode === "training" ? "Halls of Realms" : r.mode === "waiting" ? "Waiting for realm" : `Wave ${this.player?.waveNumber ?? "—"}`;
    this.realmPanel.replaceChildren(<strong>{title}</strong>, <span>Guard: {r.guards.map((p) => `${p.name} L${p.level}${p.down ? " ↓" : ""}`).join(", ") || "—"}</span>, <span>Attacker: {r.attackers.map((p) => `${p.name} L${p.level}${p.down ? " ↓" : ""}`).join(", ") || "—"}</span>, <span>Queues {r.outgoingQueued} out / {r.incomingQueued} in</span>, action); }
  private renderAllocation(): void { this.allocationNode.replaceChildren(); if (!this.player || this.inspected) { this.allocationNode.classList.add("is-hidden"); return; } this.allocationNode.classList.remove("is-hidden"); const inputs = new Map<string, HTMLInputElement>(); this.allocationNode.append(<strong>Next-level allocation</strong>); for (const key of STAT_KEYS) { const input = <input name={key} type="number" min="0" max="5" step="0.1" value={this.player.progress.allocation[key]} /> as HTMLInputElement; inputs.set(key, input); this.allocationNode.append(<label>{key}{input}</label>); } const save = <button type="submit">Save allocation</button> as HTMLButtonElement; this.allocationNode.append(save); this.allocationNode.onsubmit = (event) => { event.preventDefault(); this.callbacks.onAllocation(Object.fromEntries(STAT_KEYS.map((key) => [key, Number(inputs.get(key)?.value ?? 0)])) as Stats); }; }
  private togglePanel(panel: HTMLElement, toggle: HTMLButtonElement, kind: "character" | "inventory"): void {
    const collapsed = panel.classList.toggle("is-collapsed"); toggle.textContent = kind === "character" ? (collapsed ? "›" : "‹") : (collapsed ? "‹" : "›"); toggle.setAttribute("aria-expanded", String(!collapsed)); toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${kind === "character" ? "character sheet" : "inventory"}`);
    document.documentElement.style.setProperty(kind === "character" ? "--character-panel-width" : "--inventory-panel-width", collapsed ? "30px" : kind === "character" ? "220px" : "320px");
  }
  private updateVisibility(): void { const joined = Boolean(this.player); this.joinPanel.classList.toggle("is-hidden", joined); this.gameHud.classList.toggle("is-hidden", !joined); }
}
function equipmentSummary(item: ItemInstance, stats: Stats, slot: "main" | "off"): HTMLElement {
  const derived = derivedStats(stats); const attacks = item.itemKind === "weapon";
  const damage = attacks ? derived.baseDamage * item.modifiers.damageMultiplier * (item.definitionId === "staff" ? derived.magicAmp + item.modifiers.magicAmp : 1) : undefined;
  const attackSpeed = attacks ? derived.attackSpeed * item.modifiers.attackSpeedMultiplier : undefined;
  const requirements = STAT_KEYS.filter((key) => (item.requirements[key] ?? 0) > 0).map((key) => `${capitalize(key)} ${fmt(item.requirements[key] ?? 0)}`).join(", ") || "None";
  return (
    <div class={`item-card equipped-item equipped-${slot}-hand rarity-${item.rarity}`} style={slot === "main" ? "--attack-progress:100%" : undefined}>
      <strong>{item.name}</strong><small>Level {item.level} · {item.itemKind === "weapon" ? `${item.hands}-handed` : "Buckler"} · {item.rarity}</small>
      <div class="equipment-details">
        <span><small>Attack</small><b>{damage === undefined ? "—" : fmt(damage)}</b></span>
        <span><small>Attack speed</small><b>{attackSpeed === undefined ? "—" : `${fmt(attackSpeed)}/s`}</b></span>
        <span class="equipment-detail-wide"><small>Effects</small><b>{itemEffectSummary(item)}</b></span>
        <span class="equipment-detail-wide"><small>Skills</small><b>{item.skills.map(skillLabel).join(", ") || "None"}</b></span>
        <span class="equipment-detail-wide"><small>Requirements</small><b>{requirements}</b></span>
      </div>
    </div>
  ) as HTMLElement;
}
function itemEffectSummary(item: ItemInstance): string {
  const effects = item.affixes.map(capitalize);
  if (item.blockChance > 0) effects.push(`${Math.round(item.blockChance * 100)}% block`);
  if (item.modifiers.critChance > 0) effects.push(`${Math.round(item.modifiers.critChance * 100)}% crit`);
  if (item.modifiers.bleedChance > 0) effects.push(`${Math.round(item.modifiers.bleedChance * 100)}% bleed`);
  if (item.modifiers.poisonChance > 0) effects.push(`${Math.round(item.modifiers.poisonChance * 100)}% poison`);
  if (item.modifiers.stunChance > 0) effects.push(`${Math.round(item.modifiers.stunChance * 100)}% stun`);
  if (item.modifiers.magicAmp > 0) effects.push(`+${Math.round(item.modifiers.magicAmp * 100)}% magic`);
  if (item.reflectionComponents.length) effects.push(`Reflect: ${item.reflectionComponents.map(capitalize).join("/")}`);
  return effects.join(", ") || "None";
}
function currencyCell(label: string, value: number, kind: string): HTMLElement { return <div class={`currency-cell currency-${kind}`}><small>{label}</small><strong>{value}</strong></div> as HTMLElement; }
function resourceBar(label: string, current: number, maximum: number, kind: "health" | "stamina" | "mana"): HTMLElement {
  const safeMaximum = Math.max(0, maximum); const safeCurrent = Math.max(0, Math.min(current, safeMaximum)); const ratio = resourceRatio(safeCurrent, safeMaximum);
  return (
    <div class={`resource-bar resource-${kind}`} role="progressbar" aria-label={label} aria-valuemin="0" aria-valuemax={safeMaximum} aria-valuenow={safeCurrent}>
      <div class="resource-bar-header"><strong>{label}</strong><span>{fmt(safeCurrent)} / {fmt(safeMaximum)}</span></div>
      <div class="resource-bar-track"><span style={`width:${ratio * 100}%`} /></div>
    </div>
  ) as HTMLElement;
}
function resourceRatio(current: number, maximum: number): number { return maximum > 0 ? Math.max(0, Math.min(1, current / maximum)) : 0; }
function fmt(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function capitalize(value: string): string { return `${value.charAt(0).toUpperCase()}${value.slice(1)}`; }
