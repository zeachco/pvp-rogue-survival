/** @jsx h */
/** @jsxFrag Fragment */
import { CREEP_DEFINITIONS, type CreepKind, type PublicPlayer } from "../../common/protocol";
import type { PlayerState } from "../game/types";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elementName: string]: Record<string, unknown>;
    }
  }
}

interface HudCallbacks {
  onJoin(name: string): void;
  onBuyCreep(kind: CreepKind): void;
}

type Child = Node | string | number | boolean | null | undefined;

export class Hud {
  private player?: PlayerState;
  private neighbors: PublicPlayer[] = [];
  private notice = "Enter a name to join matchmaking.";
  private readonly joinPanel: HTMLElement;
  private readonly statsPanel: HTMLElement;
  private readonly hudBottom: HTMLElement;
  private readonly neighborList: HTMLElement;
  private readonly noticeNode: HTMLElement;
  private readonly waveBanner: HTMLElement;
  private readonly waveBannerTitle: HTMLElement;
  private readonly waveBannerDetail: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly playerNameNode: HTMLElement;
  private readonly scoreNode: HTMLElement;
  private readonly waveNode: HTMLElement;
  private readonly goldNode: HTMLElement;
  private readonly incomeNode: HTMLElement;
  private readonly livesNode: HTMLElement;
  private lastPlayerText = "";
  private lastNeighborText = "";
  private waveBannerTimer?: number;

  constructor(
    private readonly root: HTMLDivElement,
    private readonly callbacks: HudCallbacks
  ) {
    const view = this.createView();
    this.joinPanel = view.joinPanel;
    this.statsPanel = view.statsPanel;
    this.hudBottom = view.hudBottom;
    this.neighborList = view.neighborList;
    this.noticeNode = view.noticeNode;
    this.waveBanner = view.waveBanner;
    this.waveBannerTitle = view.waveBannerTitle;
    this.waveBannerDetail = view.waveBannerDetail;
    this.nameInput = view.nameInput;
    this.playerNameNode = view.playerNameNode;
    this.scoreNode = view.scoreNode;
    this.waveNode = view.waveNode;
    this.goldNode = view.goldNode;
    this.incomeNode = view.incomeNode;
    this.livesNode = view.livesNode;
    this.root.append(view.node);
    this.updateVisibility();
    this.setNotice(this.notice);
    this.setNeighbors(this.neighbors);
  }

  setPlayer(player: PlayerState): void {
    this.player = player;
    const nextText = [
      player.name,
      player.score,
      player.waveNumber,
      Math.floor(player.gold),
      player.income,
      player.lives
    ].join("|");

    if (nextText !== this.lastPlayerText) {
      this.playerNameNode.textContent = player.name;
      this.scoreNode.textContent = `Score ${player.score}`;
      this.waveNode.textContent = `Wave ${player.waveNumber}`;
      this.goldNode.textContent = `Gold ${Math.floor(player.gold)}`;
      this.incomeNode.textContent = `Income ${player.income}`;
      this.livesNode.textContent = `Lives ${player.lives}`;
      this.lastPlayerText = nextText;
    }

    this.updateVisibility();
  }

  setNeighbors(neighbors: PublicPlayer[]): void {
    this.neighbors = neighbors;
    const nextText = neighbors.map((neighbor) => `${neighbor.id}:${neighbor.name}:${neighbor.score}:${neighbor.waveNumber}`).join("|");
    if (nextText === this.lastNeighborText) return;

    this.neighborList.replaceChildren();
    if (neighbors.length === 0) {
      this.neighborList.append(<span>Solo queue</span>);
    } else {
      for (const neighbor of neighbors) {
        this.neighborList.append(<span>{neighbor.name}: {neighbor.score} / Wave {neighbor.waveNumber}</span>);
      }
    }
    this.lastNeighborText = nextText;
  }

  setNotice(notice: string): void {
    if (notice === this.notice && this.noticeNode.textContent === notice) return;
    this.notice = notice;
    this.noticeNode.textContent = notice;
  }

  setJoinName(name: string): void {
    this.nameInput.value = name;
  }

  showWaveBanner(title: string, detail: string): void {
    window.clearTimeout(this.waveBannerTimer);
    this.waveBannerTitle.textContent = title;
    this.waveBannerDetail.textContent = detail;
    this.waveBanner.classList.remove("is-visible");
    window.requestAnimationFrame(() => {
      this.waveBanner.classList.add("is-visible");
    });
    this.waveBannerTimer = window.setTimeout(() => {
      this.waveBanner.classList.remove("is-visible");
    }, 3200);
  }

  private createView(): {
    node: DocumentFragment;
    joinPanel: HTMLElement;
    statsPanel: HTMLElement;
    hudBottom: HTMLElement;
    neighborList: HTMLElement;
    noticeNode: HTMLElement;
    waveBanner: HTMLElement;
    waveBannerTitle: HTMLElement;
    waveBannerDetail: HTMLElement;
    nameInput: HTMLInputElement;
    playerNameNode: HTMLElement;
    scoreNode: HTMLElement;
    waveNode: HTMLElement;
    goldNode: HTMLElement;
    incomeNode: HTMLElement;
    livesNode: HTMLElement;
  } {
    const nameInput = <input name="name" maxlength="20" placeholder="Player name" autocomplete="off" /> as HTMLInputElement;
    const joinPanel = (
      <form class="join-panel">
        {nameInput}
        <button type="submit">Join</button>
      </form>
    ) as HTMLFormElement;

    joinPanel.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(joinPanel);
      const name = String(form.get("name") ?? "").trim();
      if (name) this.callbacks.onJoin(name);
    });

    const playerNameNode = <strong /> as HTMLElement;
    const scoreNode = <span>Score 0</span> as HTMLElement;
    const waveNode = <span>Wave 0</span> as HTMLElement;
    const goldNode = <span>Gold 0</span> as HTMLElement;
    const incomeNode = <span>Income 0</span> as HTMLElement;
    const livesNode = <span>Lives 0</span> as HTMLElement;
    const statsPanel = (
      <div class="stats-panel">
        {playerNameNode}
        {scoreNode}
        {waveNode}
        {goldNode}
        {incomeNode}
        {livesNode}
      </div>
    ) as HTMLElement;

    const neighborList = <div class="neighbor-list" /> as HTMLElement;
    const noticeNode = <div class="notice" /> as HTMLElement;
    const waveBannerTitle = <strong /> as HTMLElement;
    const waveBannerDetail = <span /> as HTMLElement;
    const waveBanner = (
      <div class="wave-banner" aria-live="polite">
        {waveBannerTitle}
        {waveBannerDetail}
      </div>
    ) as HTMLElement;
    const hudBottom = (
      <section class="hud-bottom">
        {noticeNode}
        <div class="buy-panel">
          {Object.values(CREEP_DEFINITIONS).map((creep) => {
            const tooltip = `${creep.label} creep: costs ${creep.cost} gold, adds ${creep.incomeGain} income, queues creeps for each neighbor's next wave.`;
            const button = (
              <button data-creep={creep.kind} data-tooltip={tooltip} title={tooltip} type="button">
                <strong>Send {creep.label}</strong>
                <span>{creep.cost}g / +{creep.incomeGain} income</span>
              </button>
            ) as HTMLButtonElement;
            button.addEventListener("click", () => this.callbacks.onBuyCreep(creep.kind));
            return button;
          })}
        </div>
      </section>
    ) as HTMLElement;

    const node = (
      <>
        <section class="hud-top">
          {joinPanel}
          {statsPanel}
          <div class="neighbor-panel">
            <strong>Neighbors</strong>
            {neighborList}
          </div>
        </section>
        {waveBanner}
        {hudBottom}
      </>
    ) as DocumentFragment;

    return {
      node,
      joinPanel,
      statsPanel,
      hudBottom,
      neighborList,
      noticeNode,
      waveBanner,
      waveBannerTitle,
      waveBannerDetail,
      nameInput,
      playerNameNode,
      scoreNode,
      waveNode,
      goldNode,
      incomeNode,
      livesNode
    };
  }

  private updateVisibility(): void {
    const joined = Boolean(this.player);
    this.joinPanel.classList.toggle("is-hidden", joined);
    this.statsPanel.classList.toggle("is-hidden", !joined);
    this.hudBottom.classList.toggle("is-hidden", !joined);
  }
}

export function h(tag: string | ((props: Record<string, unknown>, ...children: Child[]) => Node), props: Record<string, unknown> | null, ...children: Child[]): Node {
  if (typeof tag === "function") {
    return tag(props ?? {}, ...children);
  }

  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === "class") {
      element.className = String(value);
    } else if (key.startsWith("data-")) {
      element.setAttribute(key, String(value));
    } else if (key in element) {
      Reflect.set(element, key, value === true ? "" : value);
    } else {
      element.setAttribute(key, String(value));
    }
  }
  appendChildren(element, children);
  return element;
}

export function Fragment(_props: unknown, ...children: Child[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  appendChildren(fragment, children);
  return fragment;
}

function appendChildren(parent: Node, children: Child[]): void {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}
