import { describe, expect, test } from "bun:test";
import {
	parseGitLog,
	projectInitializationCommit,
	selectChangelogCommits,
	semanticCommitType,
	startOfWeek,
	weekKey,
	weekStartsBetween,
} from "../scripts/changelog";

describe("generated devlog history", () => {
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
