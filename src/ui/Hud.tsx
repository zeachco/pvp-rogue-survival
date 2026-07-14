/** @jsx h */
/** @jsxFrag Fragment */
import { itemStackKey, statsWithItemBonuses, type ItemInstance } from "../../common/items";
import { STAT_KEYS, cumulativeXpForLevel, lerpXpDisplay, levelForXp, xpForNextLevel, type Stats } from "../../common/progression";
import type { PlayerProgress, RealmState, UnitBuild } from "../../common/protocol";
import type { PlayerState } from "../game/types";
import { Fragment, h } from "./dom";
import { itemTile, orderInventoryTiles } from "./InventoryView";
import { occupiedInventorySlots } from "../../common/inventory";
import { itemDetails } from "./ItemDetails";
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
  private readonly healthBar = resourceBar("Health", "health"); private readonly manaBar = resourceBar("Mana", "mana");
  private readonly staminaLine = <div class="stamina-line" role="progressbar" aria-label="Stamina" aria-valuemin="0"><span /></div> as HTMLElement;
  private readonly xpName = <small /> as HTMLElement; private readonly xpLevel = <strong /> as HTMLElement;
  private readonly xpBadge = <div class="xp-badge" role="progressbar" aria-label="Experience" aria-valuemin="0"><div>{this.xpName}{this.xpLevel}</div></div> as HTMLElement;
  private readonly waveBanner = <div class="wave-banner" aria-live="polite"><strong /><span /></div> as HTMLElement;
  private readonly centerToast = <div class="center-toast" role="status" aria-live="polite" /> as HTMLElement;
  private readonly xpToast = <div class="xp-toast" role="status" aria-live="polite" /> as HTMLElement;
  private waveTimer?: number; private centerToastTimer?: number; private xpToastTimer?: number;
  private displayedXp?: number; private targetXp = 0;
  private staticSignature = ""; private dynamicSignature = ""; private realmSignature = ""; private spellStructureSignature = ""; private allocationSignature = ""; private lastWaveNumber?: number;
  private staticProgress?: PlayerProgress; private staticPlayerName = ""; private activeMainHand?: HTMLElement;
  private readonly spellNodes = new Map<string, HTMLElement>();
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
    this.resourceDock.append(<div class="health-cluster">{this.healthBar.node}{this.staminaLine}</div> as HTMLElement, <div class="xp-cluster">{this.xpToast}{this.xpBadge}</div> as HTMLElement, <div class="mana-cluster">{this.manaBar.node}</div> as HTMLElement);
    this.gameHud = <div class="game-hud"><section class="hud-top">{this.realmPanel}</section><section class="notification-area">{this.noticeNode}</section>{this.waveBanner}{this.centerToast}{this.spellBar}{this.resourceDock}{sheet}{inventory}</div> as HTMLElement;
    root.append(this.joinPanel, this.gameHud); this.updateVisibility();
  }
  setJoinName(name: string): void { this.nameInput.value = name; }
  setNotice(notice: string): void { this.noticeNode.textContent = notice; this.noticeNode.classList.toggle("is-hidden", !notice); }
  showCenterToast(message: string): void { clearTimeout(this.centerToastTimer); this.centerToast.textContent = message; this.centerToast.classList.add("is-visible"); this.centerToastTimer = window.setTimeout(() => this.centerToast.classList.remove("is-visible"), 3200); }
  showXpToast(message: string): void { clearTimeout(this.xpToastTimer); this.xpToast.textContent = message; this.xpToast.classList.add("is-visible"); this.xpToastTimer = window.setTimeout(() => this.xpToast.classList.remove("is-visible"), 3200); }
  setPlayer(player: PlayerState): void { this.player = player; this.targetXp = player.progress.xp; this.displayedXp = this.displayedXp === undefined ? this.targetXp : lerpXpDisplay(this.displayedXp, this.targetXp); this.renderDynamicHud(); if (this.staticProgress !== player.progress || this.staticPlayerName !== player.name) { this.staticProgress = player.progress; this.staticPlayerName = player.name; const signature = staticStateSignature(player, this.inspected); if (signature !== this.staticSignature) { this.staticSignature = signature; this.renderStaticHud(); } } if (this.lastWaveNumber !== player.waveNumber) { this.lastWaveNumber = player.waveNumber; this.renderRealm(); } this.updateVisibility(); }
  setInspection(build?: UnitBuild): void { this.inspected = build; this.staticSignature = staticStateSignature(this.player, build); this.renderStaticHud(); }
  setRealm(realm: RealmState): void { this.realm = realm; this.renderRealm(); }
  setSpells(spells: SpellSlot[]): void { const structure = spells.map(({ id, label, level }) => `${id}:${label}:${level}`).join("|"); if (structure !== this.spellStructureSignature) { this.spellStructureSignature = structure; this.spellNodes.clear(); this.spellBar.replaceChildren(...(spells.length ? spells.map((spell) => { const cooldown = <span class="spell-cooldown" /> as HTMLElement; this.spellNodes.set(spell.id, cooldown); return <button class="spell-slot" type="button" title={`${spell.label} · Level ${spell.level}`}>{cooldown}<strong>{spell.label.slice(0, 2).toUpperCase()}</strong><small>Lv{spell.level}</small></button>; }) : [<small>No spells</small>])); } for (const spell of spells) { const ratio = spell.cooldownMax > 0 ? Math.max(0, Math.min(1, spell.cooldown / spell.cooldownMax)) : 0; this.spellNodes.get(spell.id)?.style.setProperty("height", `${ratio * 100}%`); } }
  showWaveBanner(title: string, detail: string): void { clearTimeout(this.waveTimer); (this.waveBanner.querySelector("strong") as HTMLElement).textContent = title; (this.waveBanner.querySelector("span") as HTMLElement).textContent = detail; this.waveBanner.classList.add("is-visible"); this.waveTimer = window.setTimeout(() => this.waveBanner.classList.remove("is-visible"), 3200); }
  private renderDynamicHud(): void { if (!this.player) return; const p = this.player.progress; const shownXp = this.displayedXp ?? p.xp; const shownLevel = levelForXp(shownXp);
    const into = shownXp - cumulativeXpForLevel(shownLevel); const needed = xpForNextLevel(shownLevel); const xpRatio = needed > 0 ? Math.max(0, Math.min(1, into / needed)) : 0;
    const signature = [this.player.health, this.player.maxHealth, this.player.stamina, this.player.maxStamina, this.player.mana, this.player.maxMana, shownXp, shownLevel, this.player.name].map(flatValue).join("|");
    if (signature !== this.dynamicSignature) { this.dynamicSignature = signature; updateResourceBar(this.healthBar, this.player.health, this.player.maxHealth); updateResourceBar(this.manaBar, this.player.mana, this.player.maxMana); const stamina = resourceRatio(this.player.stamina, this.player.maxStamina); setText(this.xpName, this.player.name); setText(this.xpLevel, String(shownLevel)); this.staminaLine.setAttribute("aria-valuemax", String(this.player.maxStamina)); this.staminaLine.setAttribute("aria-valuenow", String(this.player.stamina)); (this.staminaLine.firstElementChild as HTMLElement).style.width = `${stamina * 100}%`; this.xpBadge.style.setProperty("--xp-angle", `${xpRatio * 360}deg`); this.xpBadge.setAttribute("aria-valuemax", String(needed)); this.xpBadge.setAttribute("aria-valuenow", String(into)); }
    this.activeMainHand?.style.setProperty("--attack-progress", `${(this.inspected ? 1 : this.player.attackProgress) * 100}%`);
  }
  private renderStaticHud(): void { if (!this.player) return; const p = this.player.progress; const build = this.inspected; const stats = build?.stats ?? p.stats; const main = build?.mainHand ?? p.mainHand; const off = build?.offHand ?? p.offHand; const effectiveStats = statsWithItemBonuses(stats, main, off);
    const mainSummary = equipmentSummary(main, effectiveStats, "main"); this.activeMainHand = mainSummary;
    this.sheetNode.replaceChildren(
      <div class="currency-grid">
        {currencyCell("Gold", p.gold, "gold")}{currencyCell("Souls", p.souls, "souls")}
        {currencyCell("Common", p.scraps.common, "common")}{currencyCell("Uncommon", p.scraps.uncommon, "uncommon")}
        {currencyCell("Rare", p.scraps.rare, "rare")}{currencyCell("Epic", p.scraps.epic, "epic")}
      </div>,
      <div class="portrait"><strong>{build?.name ?? this.player.name}</strong><small>Level {build?.level ?? p.level}</small></div>,
      <div class="attribute-grid">{STAT_KEYS.map((key) => <span><small>{key}</small>{fmt(stats[key])}</span>)}</div>,
      <strong>Main hand</strong>, mainSummary, <strong>Offhand</strong>, off ? equipmentSummary(off, effectiveStats, "off") : <small>Empty</small>
    );
    (this.root.querySelector(".inspect-back") as HTMLElement).classList.toggle("is-hidden", !build); this.renderAllocation();
    this.inventoryNode.replaceChildren(<strong>Equipment {occupiedInventorySlots(p)}/{4 + Math.ceil(p.level / 10)}</strong>, <div class="backpack-scroll">{orderInventoryTiles(p.inventoryTiles, p).map((tile) => itemTile(tile, this.callbacks, p))}</div>); }
  private renderRealm(): void { if (!this.realm) return; const r = this.realm; const signature = [r.mode, this.player?.waveNumber ?? "", r.outgoingQueued, r.incomingQueued, ...r.guards.map(realmMemberSignature), "|", ...r.attackers.map(realmMemberSignature)].join(":"); if (signature === this.realmSignature) return; this.realmSignature = signature; const action = <button type="button">{r.mode === "training" ? "Enter Realm" : "Leave to Lobby"}</button> as HTMLButtonElement; action.onclick = r.mode === "training" ? this.callbacks.onEnterRealm : this.callbacks.onLeaveRealm;
    const title = r.mode === "training" ? "Halls of Realms" : r.mode === "waiting" ? "Waiting for realm" : `Wave ${this.player?.waveNumber ?? "—"}`;
    this.realmPanel.replaceChildren(<strong>{title}</strong>, <span>Guard: {r.guards.map((p) => `${p.name} L${p.level}${p.down ? " ↓" : ""}`).join(", ") || "—"}</span>, <span>Attacker: {r.attackers.map((p) => `${p.name} L${p.level}${p.down ? " ↓" : ""}`).join(", ") || "—"}</span>, <span>Queues {r.outgoingQueued} out / {r.incomingQueued} in</span>, action); }
  private renderAllocation(): void { const signature = this.inspected ? "inspection" : this.player ? STAT_KEYS.map((key) => this.player!.progress.allocation[key]).join(":") : "none"; if (signature === this.allocationSignature) return; this.allocationSignature = signature; this.allocationNode.replaceChildren(); if (!this.player || this.inspected) { this.allocationNode.classList.add("is-hidden"); return; } this.allocationNode.classList.remove("is-hidden"); const inputs = new Map<string, HTMLInputElement>(); this.allocationNode.append(<strong>Next-level allocation</strong>); for (const key of STAT_KEYS) { const input = <input name={key} type="number" min="0" max="5" step="0.1" value={this.player.progress.allocation[key]} /> as HTMLInputElement; inputs.set(key, input); this.allocationNode.append(<label>{key}{input}</label>); } const save = <button type="submit">Save allocation</button> as HTMLButtonElement; this.allocationNode.append(save); this.allocationNode.onsubmit = (event) => { event.preventDefault(); this.callbacks.onAllocation(Object.fromEntries(STAT_KEYS.map((key) => [key, Number(inputs.get(key)?.value ?? 0)])) as Stats); }; }
  private togglePanel(panel: HTMLElement, toggle: HTMLButtonElement, kind: "character" | "inventory"): void {
    const collapsed = panel.classList.toggle("is-collapsed"); toggle.textContent = kind === "character" ? (collapsed ? "›" : "‹") : (collapsed ? "‹" : "›"); toggle.setAttribute("aria-expanded", String(!collapsed)); toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${kind === "character" ? "character sheet" : "inventory"}`);
    document.documentElement.style.setProperty(kind === "character" ? "--character-panel-width" : "--inventory-panel-width", collapsed ? "30px" : kind === "character" ? "220px" : "640px");
  }
  private updateVisibility(): void { const joined = Boolean(this.player); this.joinPanel.classList.toggle("is-hidden", joined); this.gameHud.classList.toggle("is-hidden", !joined); }
}
function equipmentSummary(item: ItemInstance, stats: Stats, slot: "main" | "off"): HTMLElement {
  return (
    <div class={`item-card equipped-item equipped-${slot}-hand rarity-${item.rarity}`} style={slot === "main" ? "--attack-progress:100%" : undefined}>
      <strong>{item.name}</strong><small>Level {item.level} · {item.itemKind === "weapon" ? `${item.hands}-handed` : item.itemKind === "buckler" ? "Buckler" : "Relic"} · {item.rarity}</small>
      {itemDetails(item, stats)}
    </div>
  ) as HTMLElement;
}
function currencyCell(label: string, value: number, kind: string): HTMLElement { return <div class={`currency-cell currency-${kind}`}><small>{label}</small><strong>{value}</strong></div> as HTMLElement; }
interface ResourceBar { node: HTMLElement; value: HTMLElement; fill: HTMLElement }
function resourceBar(label: string, kind: "health" | "mana"): ResourceBar { const value = <span /> as HTMLElement; const fill = <span /> as HTMLElement; const node = <div class={`resource-bar resource-${kind}`} role="progressbar" aria-label={label} aria-valuemin="0"><div class="resource-bar-header"><strong>{label}</strong>{value}</div><div class="resource-bar-track">{fill}</div></div> as HTMLElement; return { node, value, fill }; }
function updateResourceBar(bar: ResourceBar, current: number, maximum: number): void { const safeMaximum = Math.max(0, maximum); const safeCurrent = Math.max(0, Math.min(current, safeMaximum)); bar.node.setAttribute("aria-valuemax", String(safeMaximum)); bar.node.setAttribute("aria-valuenow", String(safeCurrent)); setText(bar.value, `${fmt(safeCurrent)} / ${fmt(safeMaximum)}`); bar.fill.style.width = `${resourceRatio(safeCurrent, safeMaximum) * 100}%`; }
function resourceRatio(current: number, maximum: number): number { return maximum > 0 ? Math.max(0, Math.min(1, current / maximum)) : 0; }
function flatValue(value: string | number): string { return typeof value === "number" ? String(Math.round(value * 100) / 100) : value; }
function setText(node: HTMLElement, value: string): void { if (node.textContent !== value) node.textContent = value; }
function staticStateSignature(player: PlayerState | undefined, inspected: UnitBuild | undefined): string { if (!player) return "none"; const p = player.progress; return [player.name, p.level, inspected?.id ?? "hero", inspected?.level ?? "", p.gold, p.souls, ...Object.values(p.scraps), ...STAT_KEYS.map((key) => (inspected?.stats ?? p.stats)[key]), itemStackKey(inspected?.mainHand ?? p.mainHand), inspected?.offHand ? itemStackKey(inspected.offHand) : p.offHand ? itemStackKey(p.offHand) : "", ...p.inventoryTiles.map((tile) => `${tile.id}:${tile.key}:${tile.quantity}:${tile.automation}:${tile.disposalRarity}`)].join("|"); }
function realmMemberSignature(member: RealmState["guards"][number]): string { return `${member.id},${member.name},${member.level},${Number(member.down)}`; }
function fmt(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function capitalize(value: string): string { return `${value.charAt(0).toUpperCase()}${value.slice(1)}`; }
