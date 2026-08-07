import { describe, expect, test } from "bun:test";
import {
	buildDocument,
	extractPeriods,
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

		expect(prompt).toContain("synthesize every supplied reportable commit");
		expect(prompt).toContain("regardless of its position in the log");
		expect(prompt).toContain("feat: add realms");
		expect(prompt).toContain("fix: preserve drops");
	});

	test("schema-validates generated periods", () => {
		expect(
			extractPeriods(
				'{"periods":[{"key":"2026-W32","title":"Realm work","summary":"Added realms and preserved drops.","categories":["Features"]}]}',
			),
		).toHaveLength(1);
		expect(
			extractPeriods(
				'{"periods":[{"key":"2026-W32","title":"Realm work","summary":"Added realms and preserved drops."}],"categories":["Features"]}',
			),
		).toEqual([
			{
				key: "2026-W32",
				title: "Realm work",
				summary: "Added realms and preserved drops.",
				categories: ["Features"],
			},
		]);
		expect(() =>
			extractPeriods(
				'{"periods":[{"key":"2026-W32","title":"Realm work","summary":"","categories":"Features"}]}',
			),
		).toThrow("Ollama returned invalid changelog JSON");
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
						summary: "Initialized the complete project foundation.",
						categories: [],
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
