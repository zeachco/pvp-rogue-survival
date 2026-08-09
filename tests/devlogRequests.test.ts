import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { activeAccountId, parseDevlogRequestInput } from "../server/createApp";
import {
	nextUtcMonth,
	SqlDevlogRequestStore,
} from "../server/DevlogRequestRepository";

const cleanupDirectories: string[] = [];

afterEach(() => {
	for (const directory of cleanupDirectories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

describe("devlog requests", () => {
	test("assigns requests to the next UTC calendar month", () => {
		expect(nextUtcMonth(new Date("2026-12-31T23:59:59Z"))).toBe("2027-01");
	});

	test("persists public requests and one switchable vote per voter", async () => {
		const directory = temporaryDirectory();
		const url = `sqlite://${join(directory, "requests.sqlite")}`;
		const store = await SqlDevlogRequestStore.open(url);
		const request = await store.create({
			kind: "feature",
			title: "Controller support",
			description: "Allow heroes to be controlled with a gamepad.",
		});
		expect((await store.vote(request.id, "browser-aaaaaaaa", 1))?.score).toBe(
			1,
		);
		const switched = await store.vote(request.id, "browser-aaaaaaaa", -1);
		expect(switched).toMatchObject({ upvotes: 0, downvotes: 1, score: -1 });
		await store.close();

		const restored = await SqlDevlogRequestStore.open(url);
		expect(await restored.list()).toEqual([
			expect.objectContaining({
				id: request.id,
				title: "Controller support",
				downvotes: 1,
				score: -1,
			}),
		]);
		await restored.close();
	});

	test("normalizes valid public submissions and rejects invalid ones", () => {
		expect(
			parseDevlogRequestInput({
				kind: "bug",
				title: "  Stuck movement  ",
				description: "  The hero remains stuck after opening inventory.  ",
				environment: {
					browser: "Firefox",
					version: "141.0",
					os: "Linux x86_64",
					resolution: "3840×2160",
					devicePixelRatio: "2",
				},
			}),
		).toEqual({
			kind: "bug",
			title: "Stuck movement",
			description:
				"The hero remains stuck after opening inventory.\n\nEnvironment\nBrowser: Firefox 141.0\nOS: Linux x86_64\nScreen: 3840×2160 physical pixels (DPR 2)",
		});
		expect(
			parseDevlogRequestInput({
				kind: "idea",
				title: "x",
				description: "too short",
			}),
		).toBeUndefined();
	});

	test("accepts only a currently active account identity", () => {
		const request = { headers: { "x-hero-id": "hero-active" } };
		expect(activeAccountId(request, (id) => id === "hero-active")).toBe(
			"hero-active",
		);
		expect(activeAccountId(request, () => false)).toBeUndefined();
	});
});

function temporaryDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "multi-line-devlog-"));
	cleanupDirectories.push(directory);
	return directory;
}
