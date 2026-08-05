import "./styles.css";
import { Game } from "./game/Game";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
const hudRoot = document.querySelector<HTMLDivElement>("#hud");

if (!canvas || !hudRoot) {
	throw new Error("Missing game canvas or HUD root");
}

const game = new Game(canvas, hudRoot);
void game.start().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	hudRoot.textContent = `Unable to start the game: ${message}`;
	console.error(error);
});
