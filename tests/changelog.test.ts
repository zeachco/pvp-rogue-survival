import { describe, expect, test } from "bun:test";
import {
	buildDocument,
	extractPeriods,
	generatePeriods,
	MODEL_FALLBACKS,
	parseGitLog,
	promptFor,
	projectInitializationCommit,
	selectChangelogCommits,
	semanticCommitType,
	startOfWeek,
	weekKey,
	weekStartsBetween,
} from "../scripts/changelog";

describe("generated devlog history", () => {
	test("requires detailed summaries of every supplied reportable commit", () => {
		const prompt = promptFor([
			{
				key: "2026-W32",
				commits: [
					{
						hash: "newest",
						authoredAt: "2026-08-07T10:00:00Z",
						title: "feat: add realms",
						description: "Adds realm matchmaking.",
					},
					{
						hash: "older",
						authoredAt: "2026-08-06T10:00:00Z",
						title: "fix: preserve drops",
						description: "Keeps drops through reconnects.",
					},
				],
				groupedCategories: [],
				projectInitialized: false,
			},
		]);

		expect(prompt).toContain(
			"Prioritize completeness for features and bugfixes",
		);
		expect(prompt).toContain("regardless of its position in the log");
		expect(prompt).toContain(
			"features for new player-facing functionality, bugfixes for fixed bugs",
		);
		expect(prompt).toContain("performance for what became faster");
		expect(prompt).toContain("balance for tuning");
		expect(prompt).toContain("ux for design or experience changes");
		expect(prompt).toContain(
			"graphics for rendering or visual-presentation work",
		);
		expect(prompt).toContain(
			"Every distinct player-facing feature and every distinct fixed problem must appear",
		);
		expect(prompt).toContain(
			"preserve important standalone systems such as authentication",
		);
		expect(prompt).toContain(
			"For performance, balance, ux, and graphics, provide an abstract higher-level recap",
		);
		expect(prompt).toContain("Use no more than three concise lines per bucket");
		expect(prompt).toContain("only its primary player-facing bucket");
		expect(prompt).toContain("feat: add realms");
		expect(prompt).toContain("fix: preserve drops");
	});

	test("schema-validates structured summary buckets", () => {
		expect(
			extractPeriods(
				'{"periods":[{"key":"2026-W32","title":"Realm work","summary":{"features":["Added realms."],"bugfixes":["Preserved drops."]}}]}',
			),
		).toEqual([
			{
				key: "2026-W32",
				title: "Realm work",
				summary: {
					features: ["Added realms."],
					bugfixes: ["Preserved drops."],
				},
			},
		]);
		expect(() =>
			extractPeriods(
				'{"periods":[{"key":"2026-W32","title":"Realm work","summary":{}}]}',
			),
		).toThrow("Ollama returned invalid changelog JSON");
		expect(() =>
			extractPeriods(
				'{"periods":[{"key":"2026-W32","title":"Realm work","summary":{"other":["Unstructured update."]}}]}',
			),
		).toThrow('Unrecognized key: "other"');
	});

	test("retries an invalid week with progressively larger models", async () => {
		const attempts: string[] = [];
		const errors: string[] = [];
		const originalError = console.error;
		console.error = (message?: unknown) => errors.push(String(message));
		try {
			const result = await generatePeriods(
				[
					{
						key: "2026-W32",
						commits: [projectInitializationCommit("2026-08-07T10:00:00Z")],
						groupedCategories: [],
						projectInitialized: true,
					},
				],
				async (model) => {
					attempts.push(model);
					if (model !== "gemma4:latest") return '{"periods":[{"periods":[]}]}';
					return '{"periods":[{"key":"2026-W32","title":"Started","summary":{"features":["Initialized the project."]}}]}';
				},
			);

			expect(attempts).toEqual(MODEL_FALLBACKS);
			expect(result.models.get("2026-W32")).toBe("gemma4:latest");
			expect(errors[0]).toContain("2026-W32 with gemma4:e2b");
			expect(errors[0]).toContain('Unrecognized key: "periods"');
		} finally {
			console.error = originalError;
		}
	});

	test("fails clearly after every model rejects the week", async () => {
		const originalError = console.error;
		console.error = () => {};
		try {
			await expect(
				generatePeriods(
					[
						{
							key: "2026-W32",
							commits: [projectInitializationCommit("2026-08-07T10:00:00Z")],
							groupedCategories: [],
							projectInitialized: true,
						},
					],
					async () => "not json",
				),
			).rejects.toThrow(
				"Changelog generation failed for 2026-W32 after trying gemma4:e2b, gemma4:e4b, gemma4:latest",
			);
		} finally {
			console.error = originalError;
		}
	});

	test("serializes the summary before its source commits", () => {
		const week = {
			key: "2026-W32",
			commits: [projectInitializationCommit("2026-08-07T10:00:00Z")],
			groupedCategories: [],
			projectInitialized: true,
		};
		const document = buildDocument(
			week,
			new Date(2026, 7, 3),
			new Map([
				[
					week.key,
					{
						key: week.key,
						title: "Started the project",
						summary: {
							features: ["Initialized the complete project foundation."],
							graphics: ["Established the arena presentation."],
						},
					},
				],
			]),
		);
		const periodKeys = Object.keys(document.periods[0]);

		expect(periodKeys.indexOf("summaryTitle")).toBeLessThan(
			periodKeys.indexOf("commits"),
		);
		expect(periodKeys.indexOf("summary")).toBeLessThan(
			periodKeys.indexOf("commits"),
		);
		expect(document.periods[0].categories).toEqual(["Features", "Graphics"]);
	});

	test("parses commit titles and descriptions without diff content", () => {
		expect(
			parseGitLog(
				"\u001eabc\u001f2026-08-06T10:00:00Z\u001fImprove UI\u001fExplains the HUD change.\n",
			),
		).toEqual([
			{
				hash: "abc",
				authoredAt: "2026-08-06T10:00:00Z",
				title: "Improve UI",
				description: "Explains the HUD change.",
			},
		]);
	});

	test("computes ISO calendar week boundaries across years", () => {
		const newYear = startOfWeek(new Date(2026, 0, 1, 12));
		const nextWeek = startOfWeek(new Date(2026, 0, 5, 12));
		expect(newYear).toEqual(new Date(2025, 11, 29));
		expect(weekKey(newYear)).toBe("2026-W01");
		expect(weekKey(nextWeek)).toBe("2026-W02");
	});

	test("lists every ISO calendar week between two dates", () => {
		expect(
			weekStartsBetween(new Date(2025, 11, 28), new Date(2026, 0, 6)).map(
				weekKey,
			),
		).toEqual(["2025-W52", "2026-W01", "2026-W02"]);
	});

	test("represents repository creation as a reportable first-week entry", () => {
		expect(projectInitializationCommit("2026-07-07T18:01:40-04:00")).toEqual({
			hash: "project-initialization",
			authoredAt: "2026-07-07T18:01:40-04:00",
			title: "Initialized project",
			description: "",
		});
	});

	test("keeps player-facing semantic changes and groups maintenance work", () => {
		const entry = (title: string) => ({
			hash: title,
			authoredAt: "2026-08-06T10:00:00Z",
			title,
			description: "details",
		});
		const selected = selectChangelogCommits([
			entry("feat(spells): add nova"),
			entry("fix: stop duplicate drops"),
			entry("docs(readme): explain matchmaking"),
			entry("chore: update tooling"),
			entry("test: cover drops"),
			entry("refactor(server): split wave builder"),
		]);

		expect(selected.commits.map(({ title }) => title)).toEqual([
			"feat(spells): add nova",
			"fix: stop duplicate drops",
		]);
		expect(selected.groupedCategories).toEqual(["General fixes", "Refactor"]);
		expect(semanticCommitType("ux(hud): improve layout")).toBe("ux");
	});
});
