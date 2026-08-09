import "./styles.css";
import { Game } from "./game/Game";
import { AppRouter } from "./navigation";
import "./devlog";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
const hudRoot = document.querySelector<HTMLDivElement>("#hud");
const devlogPanel = document.querySelector<HTMLElement>("#devlog-panel");
const devlogClose = document.querySelector<HTMLButtonElement>("#devlog-close");

if (!canvas || !hudRoot || !devlogPanel || !devlogClose) {
	throw new Error("Missing game canvas or HUD root");
}

const router = new AppRouter(devlogPanel, devlogClose);
router.start();
const game = new Game(canvas, hudRoot, () => router.openDevlog());
void game.start().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	hudRoot.textContent = `Unable to start the game: ${message}`;
	console.error(error);
});
