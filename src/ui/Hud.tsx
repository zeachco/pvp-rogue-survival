/** @jsx h */
/** @jsxFrag Fragment */
import { STAT_KEYS, cumulativeXpForLevel, xpForNextLevel, type Stats } from "../../common/progression";
import type { PublicPlayer, UnitBuild } from "../../common/protocol";
import type { PlayerState } from "../game/types";
import { Fragment, h } from "./dom";
import { itemCard } from "./InventoryView";
import type { HudCallbacks, SpellSlot } from "./types";
export type { HudCallbacks, SpellSlot } from "./types";

declare global { namespace JSX { interface IntrinsicElements { [elementName: string]: Record<string, unknown> } } }

export class Hud {
  private player?: PlayerState;
  private inspected?: UnitBuild;
  private readonly joinPanel: HTMLElement;
  private readonly gameHud: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly statsPanel: HTMLElement;
  private readonly neighborList: HTMLElement;
  private readonly noticeNode: HTMLElement;
  private readonly inventoryNode: HTMLElement;
  private readonly allocationNode: HTMLElement;
  private readonly characterPanel: HTMLElement;
  private readonly spellBar: HTMLElement;
  private readonly onboarding: HTMLElement;
  private readonly backButton: HTMLButtonElement;
  private readonly waveBanner: HTMLElement;
  private waveTimer?: number;
  private characterSignature = "";
  private openItemMenuId?: string;

  constructor(private readonly root: HTMLDivElement, private readonly callbacks: HudCallbacks) {
    this.nameInput = <input name="name" maxlength="20" placeholder="Player name" autocomplete="off" /> as HTMLInputElement;
    this.joinPanel = <form class="join-panel">{this.nameInput}<button type="submit">Join</button></form> as HTMLElement;
    this.joinPanel.addEventListener("submit", (event) => { event.preventDefault(); const name = this.nameInput.value.trim(); if (name) callbacks.onJoin(name); });
    this.statsPanel = <div class="stats-panel" /> as HTMLElement;
    this.neighborList = <div class="neighbor-list" /> as HTMLElement;
    this.noticeNode = <div class="notice">Enter a name to join.</div> as HTMLElement;
    this.inventoryNode = <div class="inventory-list" /> as HTMLElement;
    this.allocationNode = <form class="allocation-panel" /> as HTMLElement;
    this.backButton = <button class="inspect-back" type="button">Back to hero</button> as HTMLButtonElement;
    this.backButton.addEventListener("click", callbacks.onBack);
    this.characterPanel = <aside class="character-panel">{this.backButton}{this.inventoryNode}{this.allocationNode}</aside> as HTMLElement;
    this.spellBar = <section class="spell-bar" /> as HTMLElement;
    this.onboarding = (
      <section class="onboarding-card">
        <small>FIRST WAVE BRIEFING</small><strong>Survive the perimeter</strong>
        <span><kbd>WASD</kbd> Move and dodge red attack zones</span>
        <span><b>Automatic combat</b> Your equipped weapon attacks the closest enemy</span>
        <span><b>Grow permanently</b> Kills grant XP; all five next-level points are already assigned evenly</span>
        <span><b>Collect gear</b> Walk over glowing drops, then manage the right build panel</span>
        <button type="button">Start moving</button>
      </section>
    ) as HTMLElement;
    (this.onboarding.querySelector("button") as HTMLButtonElement).onclick = () => { this.onboarding.classList.add("is-hidden"); callbacks.onStart(); };
    this.waveBanner = <div class="wave-banner" aria-live="polite"><strong /><span /></div> as HTMLElement;
    this.gameHud = (
      <div class="game-hud">
        <section class="hud-top">{this.statsPanel}<div class="neighbor-panel"><strong>Neighbors</strong>{this.neighborList}</div></section>
        {this.waveBanner}
        {this.onboarding}
        {this.spellBar}
        {this.characterPanel}
        <section class="hud-bottom">{this.noticeNode}</section>
      </div>
    ) as HTMLElement;
    root.append(this.joinPanel, this.gameHud);
    this.updateVisibility();
  }

  setJoinName(name: string): void { this.nameInput.value = name; }
  setNotice(notice: string): void { this.noticeNode.textContent = notice; }
  setPlayer(player: PlayerState): void {
    this.player = player;
    const signature = JSON.stringify(player.progress);
    if (!this.inspected && signature !== this.characterSignature) { this.characterSignature = signature; this.renderCharacter(); }
    this.renderStats(); this.updateVisibility();
  }
  setInspection(build?: UnitBuild): void { this.inspected = build; this.renderCharacter(); }
  setSpells(spells: SpellSlot[]): void {
    this.spellBar.replaceChildren(...(spells.length ? spells.map((spell) => {
      const ratio = spell.cooldownMax > 0 ? Math.min(1, Math.max(0, spell.cooldown / spell.cooldownMax)) : 0;
      return (
        <button class="spell-slot" type="button" title={`${spell.label} Lv${spell.level}`}>
          <span class="spell-cooldown" style={`height:${ratio * 100}%`} />
          <strong>{spell.label.slice(0, 2).toUpperCase()}</strong>
          <small>Lv{spell.level}</small>
        </button>
      );
    }) : [<small>No spells</small>]));
  }
  setNeighbors(neighbors: PublicPlayer[]): void {
    this.neighborList.replaceChildren(...(neighbors.length ? neighbors.map((neighbor) => <span>{neighbor.name} · L{neighbor.level} · {neighbor.score}</span>) : [<span>Solo queue</span>]));
  }

  showWaveBanner(title: string, detail: string): void {
    clearTimeout(this.waveTimer); (this.waveBanner.querySelector("strong") as HTMLElement).textContent = title; (this.waveBanner.querySelector("span") as HTMLElement).textContent = detail;
    this.waveBanner.classList.add("is-visible"); this.waveTimer = window.setTimeout(() => this.waveBanner.classList.remove("is-visible"), 3200);
  }

  private renderStats(): void {
    if (!this.player) return;
    const progress = this.player.progress;
    const intoLevel = progress.xp - cumulativeXpForLevel(progress.level);
    this.statsPanel.replaceChildren(
      <strong>{this.player.name}</strong>, <span>Level {progress.level}</span>, <span>XP {intoLevel}/{xpForNextLevel(progress.level)}</span>,
      <span>HP {format(this.player.health)}/{format(this.player.maxHealth)}</span>, <span>STA {format(this.player.stamina)}/{format(this.player.maxStamina)}</span>, <span>MP {format(this.player.mana)}/{format(this.player.maxMana)}</span>, <span>Gold {progress.gold}</span>,
      <span>Score {this.player.score}</span>, <span>Wave {this.player.waveNumber}</span>
    );
  }

  private renderCharacter(): void {
    if (!this.player) return;
    const build = this.inspected;
    const progress = this.player.progress;
    const equipped = build?.equipped ?? progress.equipped;
    const backpack = build?.backpack ?? progress.backpack;
    const stats = build?.stats ?? progress.stats;
    if (this.openItemMenuId && !backpack.some((item) => item.id === this.openItemMenuId)) this.openItemMenuId = undefined;
    this.backButton.classList.toggle("is-hidden", !build);
    this.inventoryNode.replaceChildren(
      <div class="portrait"><span>{build ? "◆" : "●"}</span><div><strong>{build?.name ?? this.player.name}</strong><small>Level {build?.level ?? progress.level}{build?.isRival ? " · Rival" : ""}</small></div></div>,
      <div class="attribute-grid">{STAT_KEYS.map((key) => <span><small>{capitalize(key)}</small>{format(stats[key])}</span>)}</div>,
      <strong>Equipped</strong>, itemCard(equipped, false, build, this.callbacks, this.openItemMenuId, (itemId) => { this.openItemMenuId = itemId; this.renderCharacter(); }),
      <strong>Backpack {backpack.length}/8</strong>,
      <div class="backpack-scroll">{backpack.length ? backpack.map((item) => itemCard(item, true, build, this.callbacks, this.openItemMenuId, (itemId) => { this.openItemMenuId = itemId; this.renderCharacter(); })) : <small>Empty</small>}</div>,
      <small>{build ? `Statuses and resources are shown in the arena. Skills: ${equipped.skills.join(", ") || "basic attack"}` : `Learned: ${progress.learnedSkills.join(", ")}`}</small>
    );
    this.renderAllocation();
  }

  private renderAllocation(): void {
    this.allocationNode.replaceChildren();
    if (!this.player || this.inspected) { this.allocationNode.classList.add("is-hidden"); return; }
    this.allocationNode.classList.remove("is-hidden");
    const remainingNode = <small class="allocation-remaining" /> as HTMLElement;
    const inputs = new Map<string, HTMLInputElement>();
    this.allocationNode.append(<strong>Next-level allocation</strong>, remainingNode);
    for (const key of STAT_KEYS) {
      const input = <input name={key} type="number" min="0" max="5" step="0.1" value={this.player.progress.allocation[key]} /> as HTMLInputElement;
      inputs.set(key, input);
      this.allocationNode.append(<label>{capitalize(key)}{input}</label>);
    }
    const saveButton = <button type="submit">Save allocation</button> as HTMLButtonElement;
    this.allocationNode.append(saveButton);
    const enforceBudget = (changed?: HTMLInputElement) => {
      if (changed) {
        const spentElsewhere = [...inputs.values()].filter((input) => input !== changed).reduce((sum, input) => sum + numericInput(input), 0);
        changed.value = String(Math.min(Math.max(0, numericInput(changed)), Math.max(0, 5 - spentElsewhere)));
      }
      const spent = [...inputs.values()].reduce((sum, input) => sum + numericInput(input), 0);
      const remaining = Math.max(0, 5 - spent);
      remainingNode.textContent = remaining > 0.001 ? `${remaining.toFixed(1)} of 5 points left to assign` : "All 5 points assigned for your next level";
      saveButton.disabled = Math.abs(remaining) > 0.001;
    };
    for (const input of inputs.values()) input.addEventListener("input", () => enforceBudget(input));
    enforceBudget();
    this.allocationNode.onsubmit = (event) => {
      event.preventDefault(); const data = new FormData(this.allocationNode as HTMLFormElement);
      this.callbacks.onAllocation(Object.fromEntries(STAT_KEYS.map((key) => [key, Number(data.get(key))])) as unknown as Stats);
    };
  }

  private updateVisibility(): void { const joined = Boolean(this.player); this.joinPanel.classList.toggle("is-hidden", joined); this.gameHud.classList.toggle("is-hidden", !joined); }
}

function format(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function numericInput(input: HTMLInputElement): number { const value = Number(input.value); return Number.isFinite(value) ? value : 0; }
function capitalize(value: string): string { return value[0].toUpperCase() + value.slice(1); }
