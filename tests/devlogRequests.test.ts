import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	activeAccountId,
	activeModeratorAccountId,
	isLocalDevelopmentOrigin,
	MAX_DEVLOG_REQUEST_DESCRIPTION_LENGTH,
	parseDevlogRequestInput,
} from "../server/createApp";
import {
	nextUtcMonth,
	SqlDevlogRequestStore,
} from "../server/DevlogRequestRepository";
import {
	DEFAULT_API_BASE_URL,
	fetchFeatureRequests,
	submittedFeatures,
} from "../scripts/listFeatureRequests";

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
		expect(await restored.delete(request.id)).toBeTrue();
		expect(await restored.delete(request.id)).toBeFalse();
		expect(await restored.list()).toEqual([]);
		await restored.close();
	});

	test("lists only player-submitted features in queue order", () => {
		const feature = {
			id: "feature-request",
			kind: "feature" as const,
			title: "Controller support",
			description: "Allow heroes to be controlled with a gamepad.",
			scheduledMonth: "2026-09",
			createdAt: "2026-08-09T00:00:00.000Z",
			upvotes: 2,
			downvotes: 0,
			score: 2,
		};
		const bug = { ...feature, id: "bug-report", kind: "bug" as const };
		const balance = {
			...feature,
			id: "balance-report",
			kind: "balance" as const,
		};
		expect(submittedFeatures([feature, bug, balance])).toEqual([feature]);
	});

	test("fetches feature submissions through the public request API", async () => {
		const requestedUrls: string[] = [];
		const requests = await fetchFeatureRequests(
			DEFAULT_API_BASE_URL,
			async (input) => {
				requestedUrls.push(String(input));
				return Response.json({
					requests: [
						{ kind: "feature", title: "Controller support" },
						{ kind: "bug", title: "Stuck movement" },
						{ kind: "balance", title: "Overpowered katars" },
					],
				});
			},
		);
		expect(requestedUrls).toEqual([
			"https://pvp.up.railway.app/api/devlog/requests",
		]);
		expect(requests).toEqual([
			expect.objectContaining({
				kind: "feature",
				title: "Controller support",
			}),
		]);
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
				kind: "balance",
				title: "  Overpowered katars  ",
				description: "  Katars block too many incoming attacks.  ",
			}),
		).toEqual({
			kind: "balance",
			title: "Overpowered katars",
			description: "Katars block too many incoming attacks.",
		});
		expect(
			parseDevlogRequestInput({
				kind: "idea",
				title: "x",
				description: "too short",
			}),
		).toBeUndefined();
		expect(
			parseDevlogRequestInput({
				kind: "feature",
				title: "Oversized request",
				description: "x".repeat(MAX_DEVLOG_REQUEST_DESCRIPTION_LENGTH + 1),
			}),
		).toBeUndefined();
		expect(
			parseDevlogRequestInput({
				kind: "feature",
				title: "Maximum request",
				description: "x".repeat(MAX_DEVLOG_REQUEST_DESCRIPTION_LENGTH),
			})?.description,
		).toHaveLength(MAX_DEVLOG_REQUEST_DESCRIPTION_LENGTH);
		const boundedBug = parseDevlogRequestInput({
			kind: "bug",
			title: "Bounded bug report",
			description: "x".repeat(850),
			environment: {
				browser: "Firefox",
				version: "141.0",
				os: "Linux x86_64",
				resolution: "3840×2160",
				devicePixelRatio: "2",
			},
		});
		expect(boundedBug?.description.length).toBeLessThanOrEqual(
			MAX_DEVLOG_REQUEST_DESCRIPTION_LENGTH,
		);
		expect(
			parseDevlogRequestInput({
				kind: "bug",
				title: "Oversized stored bug report",
				description: "x".repeat(MAX_DEVLOG_REQUEST_DESCRIPTION_LENGTH),
				environment: {
					browser: "Firefox",
					version: "141.0",
					os: "Linux x86_64",
					resolution: "3840×2160",
					devicePixelRatio: "2",
				},
			}),
		).toBeUndefined();
	});

	test("accepts only a currently active account identity", () => {
		const request = { headers: { "x-hero-id": "hero-active" } };
		expect(activeAccountId(request, (id) => id === "hero-active")).toBe(
			"hero-active",
		);
		expect(activeAccountId(request, () => false)).toBeUndefined();
		expect(activeAccountId(request, () => "shared-account")).toBe(
			"shared-account",
		);
	});

	test("accepts request deletion only from an active moderator", () => {
		const request = { headers: { "x-hero-id": "hero-moderator" } };
		expect(
			activeModeratorAccountId(
				request,
				() => true,
				() => true,
			),
		).toBe("hero-moderator");
		expect(
			activeModeratorAccountId(
				request,
				() => true,
				() => false,
			),
		).toBeUndefined();
		expect(
			activeModeratorAccountId(
				request,
				() => false,
				() => true,
			),
		).toBeUndefined();
	});

	test("allows production request APIs from local development origins only", () => {
		expect(isLocalDevelopmentOrigin("http://localhost:5173")).toBeTrue();
		expect(isLocalDevelopmentOrigin("https://127.0.0.1:4173")).toBeTrue();
		expect(isLocalDevelopmentOrigin("https://example.com")).toBeFalse();
	});
});

function temporaryDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "multi-line-devlog-"));
	cleanupDirectories.push(directory);
	return directory;
}
