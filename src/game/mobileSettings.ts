export type KeepAwakeMode = "on" | "off";

const KEEP_AWAKE_STORAGE_KEY = "multi-line-tower-keep-awake";

interface SettingsStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

interface WakeLockSentinelLike {
	release(): Promise<void>;
	addEventListener(
		type: "release",
		listener: () => void,
		options?: { once: boolean },
	): void;
}

interface WakeLockLike {
	request(type: "screen"): Promise<WakeLockSentinelLike>;
}

export function loadKeepAwakeMode(storage: SettingsStorage): KeepAwakeMode {
	return storage.getItem(KEEP_AWAKE_STORAGE_KEY) === "on" ? "on" : "off";
}

export function saveKeepAwakeMode(
	storage: SettingsStorage,
	mode: KeepAwakeMode,
): void {
	storage.setItem(KEEP_AWAKE_STORAGE_KEY, mode);
}

export class ScreenWakeLockController {
	private sentinel?: WakeLockSentinelLike;
	private enabled = false;

	constructor(
		private readonly wakeLock: WakeLockLike | undefined,
		private readonly page: Pick<Document, "hidden" | "addEventListener">,
	) {
		page.addEventListener("visibilitychange", () => {
			if (this.enabled && !page.hidden) void this.acquire();
		});
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		if (enabled) void this.acquire();
		else void this.release();
	}

	private async acquire(): Promise<void> {
		if (!this.enabled || this.page.hidden || this.sentinel || !this.wakeLock)
			return;
		try {
			const sentinel = await this.wakeLock.request("screen");
			if (!this.enabled) {
				await sentinel.release();
				return;
			}
			this.sentinel = sentinel;
			sentinel.addEventListener(
				"release",
				() => {
					if (this.sentinel === sentinel) this.sentinel = undefined;
				},
				{ once: true },
			);
		} catch {
			// Wake Lock is optional and may be denied by browser or power policy.
		}
	}

	private async release(): Promise<void> {
		const sentinel = this.sentinel;
		this.sentinel = undefined;
		if (sentinel)
			try {
				await sentinel.release();
			} catch {
				// It may already have been released by the browser.
			}
	}
}
