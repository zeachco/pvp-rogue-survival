/** @jsx h */
/** @jsxFrag Fragment */
import { STAT_KEYS, cumulativeXpForLevel, xpForNextLevel, type Stats } from "../../common/progression";
import type { ItemInstance } from "../../common/items";
import type { PublicPlayer, UnitBuild } from "../../common/protocol";
import type { PlayerState } from "../game/types";

declare global { namespace JSX { interface IntrinsicElements { [elementName: string]: Record<string, unknown> } } }
interface HudCallbacks { onJoin(name: string): void; onAllocation(stats: Stats): void; onEquip(itemId: string): void; onSell(itemId: string): void; onBack(): void }
type Child = Node | string | number | boolean | null | undefined;

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
  private readonly backButton: HTMLButtonElement;
  private readonly waveBanner: HTMLElement;
  private waveTimer?: number;

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
    this.waveBanner = <div class="wave-banner" aria-live="polite"><strong /><span /></div> as HTMLElement;
    this.gameHud = (
      <div class="game-hud">
        <section class="hud-top">{this.statsPanel}<div class="neighbor-panel"><strong>Neighbors</strong>{this.neighborList}</div></section>
        {this.waveBanner}
        <section class="hud-bottom">{this.noticeNode}<aside class="character-panel">{this.backButton}{this.inventoryNode}{this.allocationNode}</aside></section>
      </div>
    ) as HTMLElement;
    root.append(this.joinPanel, this.gameHud);
    this.updateVisibility();
  }

  setJoinName(name: string): void { this.nameInput.value = name; }
  setNotice(notice: string): void { this.noticeNode.textContent = notice; }
  setPlayer(player: PlayerState): void { this.player = player; if (!this.inspected) this.renderCharacter(); this.renderStats(); this.updateVisibility(); }
  setInspection(build?: UnitBuild): void { this.inspected = build; this.renderCharacter(); }
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
      <span>HP {format(this.player.health)}/{format(this.player.maxHealth)}</span>, <span>Gold {progress.gold}</span>,
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
    this.backButton.classList.toggle("is-hidden", !build);
    this.inventoryNode.replaceChildren(
      <div class="portrait"><span>{build ? "◆" : "●"}</span><div><strong>{build?.name ?? this.player.name}</strong><small>Level {build?.level ?? progress.level}{build?.isRival ? " · Rival" : ""}</small></div></div>,
      <div class="attribute-grid">{STAT_KEYS.map((key) => <span><small>{capitalize(key)}</small>{format(stats[key])}</span>)}</div>,
      <strong>Equipped</strong>, itemCard(equipped, false, build, this.callbacks),
      <strong>Backpack {backpack.length}/8</strong>,
      <div class="backpack-scroll">{backpack.length ? backpack.map((item) => itemCard(item, true, build, this.callbacks)) : <small>Empty</small>}</div>,
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
      remainingNode.textContent = `${remaining.toFixed(1)} points remaining`;
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

function itemCard(item: ItemInstance, actions: boolean, inspected: UnitBuild | undefined, callbacks: HudCallbacks): HTMLElement {
  const node = <div class={`item-card rarity-${item.rarity}`} title="Click for actions; right-click to equip"><strong>{item.name}</strong><small>L{item.level} {item.rarity} · {format(item.modifiers.damageMultiplier * 100)}% damage · {format(item.modifiers.attackSpeedMultiplier * 100)}% speed</small></div> as HTMLElement;
  if (actions && !inspected) {
    const menu = <div class="item-menu is-hidden"><button type="button">Equip</button><button type="button">Sell {item.sellValue}g</button></div> as HTMLElement;
    (menu.children[0] as HTMLButtonElement).onclick = () => callbacks.onEquip(item.id);
    (menu.children[1] as HTMLButtonElement).onclick = () => callbacks.onSell(item.id);
    node.append(menu); node.onclick = () => menu.classList.toggle("is-hidden");
    node.oncontextmenu = (event) => { event.preventDefault(); callbacks.onEquip(item.id); };
  }
  return node;
}
function format(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function numericInput(input: HTMLInputElement): number { const value = Number(input.value); return Number.isFinite(value) ? value : 0; }
function capitalize(value: string): string { return value[0].toUpperCase() + value.slice(1); }

export function h(tag: string | ((props: Record<string, unknown>, ...children: Child[]) => Node), props: Record<string, unknown> | null, ...children: Child[]): Node {
  if (typeof tag === "function") return tag(props ?? {}, ...children);
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === "class") element.className = String(value); else if (key.startsWith("data-")) element.setAttribute(key, String(value)); else if (key in element) Reflect.set(element, key, value === true ? "" : value); else element.setAttribute(key, String(value));
  }
  appendChildren(element, children); return element;
}
export function Fragment(_props: unknown, ...children: Child[]): DocumentFragment { const fragment = document.createDocumentFragment(); appendChildren(fragment, children); return fragment; }
function appendChildren(parent: Node, children: Child[]): void { for (const child of children.flat(Infinity) as Child[]) if (child !== null && child !== undefined && child !== false && child !== true) parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child))); }
