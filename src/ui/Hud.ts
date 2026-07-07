import { CREEP_DEFINITIONS, type CreepKind, type PublicPlayer } from "../../common/protocol";
import type { PlayerState } from "../game/types";

interface HudCallbacks {
  onJoin(name: string): void;
  onBuyCreep(kind: CreepKind): void;
}

export class Hud {
  private player?: PlayerState;
  private neighbors: PublicPlayer[] = [];
  private notice = "Enter a name to join matchmaking.";

  constructor(
    private readonly root: HTMLDivElement,
    private readonly callbacks: HudCallbacks
  ) {
    this.render();
  }

  setPlayer(player: PlayerState): void {
    this.player = player;
    this.render();
  }

  setNeighbors(neighbors: PublicPlayer[]): void {
    this.neighbors = neighbors;
    this.render();
  }

  setNotice(notice: string): void {
    this.notice = notice;
    this.render();
  }

  render(): void {
    const joined = Boolean(this.player);
    this.root.innerHTML = `
      <section class="hud-top">
        <form class="join-panel ${joined ? "is-hidden" : ""}">
          <input name="name" maxlength="20" placeholder="Player name" autocomplete="off" />
          <button type="submit">Join</button>
        </form>
        <div class="stats-panel ${joined ? "" : "is-hidden"}">
          <strong>${this.player?.name ?? ""}</strong>
          <span>Score ${this.player?.score ?? 0}</span>
          <span>Gold ${Math.floor(this.player?.gold ?? 0)}</span>
          <span>Income ${this.player?.income ?? 0}</span>
          <span>Lives ${this.player?.lives ?? 0}</span>
        </div>
        <div class="neighbor-panel">
          <strong>Neighbors</strong>
          ${this.neighbors.length === 0 ? "<span>Solo queue</span>" : this.neighbors.map((neighbor) => `<span>${neighbor.name}: ${neighbor.score}</span>`).join("")}
        </div>
      </section>
      <section class="hud-bottom ${joined ? "" : "is-hidden"}">
        <div class="notice">${this.notice}</div>
        <div class="buy-panel">
          ${Object.values(CREEP_DEFINITIONS)
            .map(
              (creep) => `
                <button data-creep="${creep.kind}" type="button">
                  <strong>${creep.label}</strong>
                  <span>${creep.cost}g / +${creep.incomeGain}</span>
                </button>
              `
            )
            .join("")}
        </div>
      </section>
    `;

    this.root.querySelector<HTMLFormElement>(".join-panel")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const formElement = event.currentTarget as HTMLFormElement;
      const form = new FormData(formElement);
      const name = String(form.get("name") ?? "").trim();
      if (name) this.callbacks.onJoin(name);
    });

    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-creep]")) {
      button.addEventListener("click", () => {
        this.callbacks.onBuyCreep(button.dataset.creep as CreepKind);
      });
    }
  }
}
