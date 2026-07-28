import "./styles.css";
import { Game } from "./game/Game";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
const hudRoot = document.querySelector<HTMLDivElement>("#hud");

if (!canvas || !hudRoot) {
	throw new Error("Missing game canvas or HUD root");
}

const game = new Game(canvas, hudRoot);
game.start();
