const SESSION_KEY = "multi-line-tower.session";
export interface SavedSession {
	heroId: string;
	username: string;
}

type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isSavedSession(value: unknown): value is SavedSession {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<SavedSession>;
	return (
		typeof candidate.heroId === "string" &&
		candidate.heroId.length > 0 &&
		typeof candidate.username === "string" &&
		candidate.username.length > 0
	);
}

export class SessionStorage {
	constructor(private readonly storage: SessionStore = localStorage) {}

	load(): SavedSession | undefined {
		try {
			const parsed: unknown = JSON.parse(
				this.storage.getItem(SESSION_KEY) ?? "null",
			);
			return isSavedSession(parsed) ? parsed : undefined;
		} catch {
			return undefined;
		}
	}
	save(session: SavedSession): void {
		try {
			this.storage.setItem(SESSION_KEY, JSON.stringify(session));
		} catch {
			/* restricted */
		}
	}
	clear(): void {
		try {
			this.storage.removeItem(SESSION_KEY);
		} catch {
			/* restricted */
		}
	}
}
