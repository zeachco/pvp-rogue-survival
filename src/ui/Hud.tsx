/** @jsx h */
/** @jsxFrag Fragment */
import { STAT_KEYS, cumulativeXpForLevel, xpForNextLevel, type Stats } from "../../common/progression";
import type { RealmState, UnitBuild } from "../../common/protocol";
import type { PlayerState } from "../game/types";
import { Fragment, h } from "./dom";
import { itemTile } from "./InventoryView";
import type { HudCallbacks, SpellSlot } from "./types";
export type { HudCallbacks, SpellSlot } from "./types";
declare global { namespace JSX { interface IntrinsicElements { [elementName: string]: Record<string, unknown> } } }

export class Hud {
  private player?: PlayerState; private inspected?: UnitBuild; private realm?: RealmState;
  private readonly joinPanel: HTMLElement; private readonly gameHud: HTMLElement; private readonly nameInput: HTMLInputElement;
  private readonly statsPanel = <div class="stats-panel" /> as HTMLElement; private readonly realmPanel = <div class="realm-panel" /> as HTMLElement;
  private readonly noticeNode = <div class="notice">Enter a name to join.</div> as HTMLElement; private readonly sheetNode = <div class="sheet-content" /> as HTMLElement;
  private readonly inventoryNode = <div class="inventory-content" /> as HTMLElement; private readonly allocationNode = <form class="allocation-panel" /> as HTMLElement;
  private readonly spellBar = <section class="spell-bar" /> as HTMLElement; private readonly waveBanner = <div class="wave-banner" aria-live="polite"><strong /><span /></div> as HTMLElement;
  private waveTimer?: number;
  constructor(private readonly root: HTMLDivElement, private readonly callbacks: HudCallbacks) {
    this.nameInput = <input name="name" maxlength="20" placeholder="Player name" autocomplete="off" /> as HTMLInputElement;
    this.joinPanel = <form class="join-panel">{this.nameInput}<button type="submit">Join</button></form> as HTMLElement;
    this.joinPanel.onsubmit = (event) => { event.preventDefault(); const name = this.nameInput.value.trim(); if (name) callbacks.onJoin(name); };
    const back = <button class="inspect-back is-hidden" type="button">Back to hero</button> as HTMLButtonElement; back.onclick = callbacks.onBack;
    const sheet = <aside class="character-panel">{back}{this.sheetNode}{this.allocationNode}</aside> as HTMLElement;
    const inventory = <aside class="inventory-column">{this.inventoryNode}</aside> as HTMLElement;
    const onboarding = <section class="onboarding-card"><small>FIRST WAVE BRIEFING</small><strong>Survive the perimeter</strong><span><kbd>WASD</kbd> Move and dodge attacks</span><span><b>Automatic combat</b> attacks the closest enemy</span><span><b>Manage gear</b> in permanent stack tiles</span><button type="button">Start moving</button></section> as HTMLElement;
    (onboarding.querySelector("button") as HTMLButtonElement).onclick = () => { onboarding.classList.add("is-hidden"); callbacks.onStart(); };
    this.gameHud = <div class="game-hud"><section class="hud-top">{this.statsPanel}{this.realmPanel}</section>{this.waveBanner}{onboarding}{this.spellBar}{sheet}{inventory}<section class="hud-bottom">{this.noticeNode}</section></div> as HTMLElement;
    root.append(this.joinPanel, this.gameHud); this.updateVisibility();
  }
  setJoinName(name: string): void { this.nameInput.value = name; }
  setNotice(notice: string): void { this.noticeNode.textContent = notice; }
  setPlayer(player: PlayerState): void { this.player = player; this.renderAll(); this.updateVisibility(); }
  setInspection(build?: UnitBuild): void { this.inspected = build; this.renderAll(); }
  setRealm(realm: RealmState): void { this.realm = realm; this.renderRealm(); }
  setSpells(spells: SpellSlot[]): void { this.spellBar.replaceChildren(...(spells.length ? spells.map((spell) => <button class="spell-slot" type="button"><strong>{spell.label.slice(0, 2).toUpperCase()}</strong><small>Lv{spell.level}</small></button>) : [<small>No spells</small>])); }
  showWaveBanner(title: string, detail: string): void { clearTimeout(this.waveTimer); (this.waveBanner.querySelector("strong") as HTMLElement).textContent = title; (this.waveBanner.querySelector("span") as HTMLElement).textContent = detail; this.waveBanner.classList.add("is-visible"); this.waveTimer = window.setTimeout(() => this.waveBanner.classList.remove("is-visible"), 3200); }
  private renderAll(): void { if (!this.player) return; const p = this.player.progress; const build = this.inspected; const stats = build?.stats ?? p.stats; const main = build?.mainHand ?? p.mainHand; const off = build?.offHand ?? p.offHand;
    const into = p.xp - cumulativeXpForLevel(p.level); this.statsPanel.replaceChildren(<strong>{this.player.name}</strong>, <span>Level {p.level}</span>, <span>XP {into}/{xpForNextLevel(p.level)}</span>, <span>HP {fmt(this.player.health)}/{fmt(this.player.maxHealth)}</span>, <span>Gold {p.gold}</span>, <span>Wave {this.player.waveNumber}</span>);
    this.sheetNode.replaceChildren(<div class="portrait"><strong>{build?.name ?? this.player.name}</strong><small>Level {build?.level ?? p.level}</small></div>, <div class="attribute-grid">{STAT_KEYS.map((key) => <span><small>{key}</small>{fmt(stats[key])}</span>)}</div>, <strong>Main hand</strong>, equipmentSummary(main), <strong>Offhand</strong>, off ? equipmentSummary(off) : <small>Empty</small>);
    (this.root.querySelector(".inspect-back") as HTMLElement).classList.toggle("is-hidden", !build); this.renderAllocation();
    this.inventoryNode.replaceChildren(<strong>Equipment {p.inventoryTiles.length}/{4 + Math.ceil(p.level / 10)}</strong>, <small>Scraps C{p.scraps.common} U{p.scraps.uncommon} R{p.scraps.rare} E{p.scraps.epic}</small>, <div class="backpack-scroll">{p.inventoryTiles.map((tile) => itemTile(tile, this.callbacks))}</div>); this.renderRealm(); }
  private renderRealm(): void { if (!this.realm) return; const r = this.realm; const action = <button type="button">{r.mode === "training" ? "Enter Realm" : "Leave to Lobby"}</button> as HTMLButtonElement; action.onclick = r.mode === "training" ? this.callbacks.onEnterRealm : this.callbacks.onLeaveRealm;
    this.realmPanel.replaceChildren(<strong>{r.mode === "training" ? "Training Grounds" : r.mode === "waiting" ? "Waiting for realm" : "Realm"}</strong>, <span>Guard: {r.guards.map((p) => `${p.name} L${p.level}${p.down ? " ↓" : ""}`).join(", ") || "—"}</span>, <span>Attacker: {r.attackers.map((p) => `${p.name} L${p.level}${p.down ? " ↓" : ""}`).join(", ") || "—"}</span>, <span>Queues {r.outgoingQueued} out / {r.incomingQueued} in</span>, action); }
  private renderAllocation(): void { this.allocationNode.replaceChildren(); if (!this.player || this.inspected) { this.allocationNode.classList.add("is-hidden"); return; } this.allocationNode.classList.remove("is-hidden"); const inputs = new Map<string, HTMLInputElement>(); this.allocationNode.append(<strong>Next-level allocation</strong>); for (const key of STAT_KEYS) { const input = <input name={key} type="number" min="0" max="5" step="0.1" value={this.player.progress.allocation[key]} /> as HTMLInputElement; inputs.set(key, input); this.allocationNode.append(<label>{key}{input}</label>); } const save = <button type="submit">Save allocation</button> as HTMLButtonElement; this.allocationNode.append(save); this.allocationNode.onsubmit = (event) => { event.preventDefault(); this.callbacks.onAllocation(Object.fromEntries(STAT_KEYS.map((key) => [key, Number(inputs.get(key)?.value ?? 0)])) as Stats); }; }
  private updateVisibility(): void { const joined = Boolean(this.player); this.joinPanel.classList.toggle("is-hidden", joined); this.gameHud.classList.toggle("is-hidden", !joined); }
}
function equipmentSummary(item: UnitBuild["mainHand"]): HTMLElement { return <div class={`item-card rarity-${item.rarity}`}><strong>{item.name}</strong><small>L{item.level} · {item.itemKind === "weapon" ? `${item.hands}H` : "Buckler"}</small></div> as HTMLElement; }
function fmt(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
