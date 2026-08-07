import { describe, expect, test } from "bun:test";
import {
	monthKey,
	monthStartsBetween,
	parseGitLog,
	selectChangelogCommits,
	semanticCommitType,
	startOfMonth,
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

	test("computes local calendar month boundaries across years", () => {
		const january = startOfMonth(new Date(2026, 0, 20, 12));
		const previous = new Date(january.getFullYear(), january.getMonth() - 1, 1);
		expect(monthKey(january)).toBe("2026-01");
		expect(monthKey(previous)).toBe("2025-12");
	});

	test("lists every calendar month between two dates", () => {
		expect(
			monthStartsBetween(new Date(2025, 10, 18), new Date(2026, 1, 2)).map(
				monthKey,
			),
		).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
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
			entry("refactor(server)!: split wave builder"),
		]);

		expect(selected.commits.map(({ title }) => title)).toEqual([
			"feat(spells): add nova",
			"fix: stop duplicate drops",
		]);
		expect(selected.groupedCategories).toEqual(["General fixes", "Refactor"]);
		expect(semanticCommitType("ux(hud): improve layout")).toBe("ux");
	});
});
