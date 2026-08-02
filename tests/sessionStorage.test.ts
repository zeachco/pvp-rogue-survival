import { describe, expect, test } from "bun:test";
import { SessionStorage } from "../src/platform/SessionStorage";

function store(initial: string | null = null) {
	let value = initial;
	return {
		getItem: () => value,
		setItem: (_key: string, next: string) => {
			value = next;
		},
		removeItem: () => {
			value = null;
		},
	};
}

describe("browser session storage", () => {
	test("round-trips the reconnect identity", () => {
		const storage = store();
		const sessions = new SessionStorage(storage);
		sessions.save({ heroId: "hero-1", username: "Hero" });
		expect(sessions.load()).toEqual({ heroId: "hero-1", username: "Hero" });
		sessions.clear();
		expect(sessions.load()).toBeUndefined();
	});

	test("rejects malformed or incorrectly typed persisted values", () => {
		for (const value of [
			"not-json",
			"null",
			JSON.stringify({ heroId: 42, username: "Hero" }),
			JSON.stringify({ heroId: "hero-1", username: "" }),
		])
			expect(new SessionStorage(store(value)).load()).toBeUndefined();
	});

	test("tolerates restricted storage for every operation", () => {
		const restricted = {
			getItem: () => {
				throw new Error("restricted");
			},
			setItem: () => {
				throw new Error("restricted");
			},
			removeItem: () => {
				throw new Error("restricted");
			},
		};
		const sessions = new SessionStorage(restricted);
		expect(sessions.load()).toBeUndefined();
		expect(() =>
			sessions.save({ heroId: "hero-1", username: "Hero" }),
		).not.toThrow();
		expect(() => sessions.clear()).not.toThrow();
	});
});
