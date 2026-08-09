import { gameSocketUrl } from "./net/SocketClient";

export const DEVLOG_PATH = "/devlog";

export function gameApiUrl(
	location: Pick<Location, "host" | "protocol" | "search">,
	path: string,
): string {
	const socket = new URL(gameSocketUrl(location));
	socket.protocol = socket.protocol === "wss:" ? "https:" : "http:";
	socket.pathname = path;
	socket.search = "";
	socket.hash = "";
	return socket.toString();
}

export function routeUrl(pathname: string, search: string): string {
	return `${pathname}${search}`;
}

export class AppRouter {
	constructor(
		private readonly panel: HTMLElement,
		private readonly closeButton: HTMLButtonElement,
	) {}

	start(): void {
		this.closeButton.onclick = () => this.closeDevlog();
		window.addEventListener("popstate", () => this.render());
		this.render();
	}

	openDevlog(): void {
		if (window.location.pathname !== DEVLOG_PATH)
			history.pushState(
				{ devlog: true },
				"",
				routeUrl(DEVLOG_PATH, window.location.search),
			);
		this.render();
	}

	closeDevlog(): void {
		if (window.location.pathname !== DEVLOG_PATH) return;
		if (history.state?.devlog) {
			history.back();
			return;
		}
		history.replaceState({}, "", routeUrl("/", window.location.search));
		this.render();
	}

	private render(): void {
		this.panel.hidden = window.location.pathname !== DEVLOG_PATH;
		if (!this.panel.hidden) window.dispatchEvent(new Event("devlogopen"));
		document.title = this.panel.hidden
			? "Multi-Line Hero"
			: "Multi-Line Hero Devlog";
	}
}
