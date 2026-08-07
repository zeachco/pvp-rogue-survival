import { describe, expect, test } from "bun:test";
import {
	groupByDay,
	monthKey,
	parseGitLog,
	startOfMonth,
	type CommitEntry,
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

	test("groups commits into newest-first website periods", () => {
		const commits: CommitEntry[] = [
			{
				hash: "new-a",
				authoredAt: "2026-08-05T12:00:00Z",
				title: "New A",
				description: "",
			},
			{
				hash: "new-b",
				authoredAt: "2026-08-05T08:00:00Z",
				title: "New B",
				description: "",
			},
			{
				hash: "old-a",
				authoredAt: "2026-06-20T12:00:00Z",
				title: "Old A",
				description: "",
			},
			{
				hash: "old-b",
				authoredAt: "2026-06-01T12:00:00Z",
				title: "Old B",
				description: "",
			},
		];
		expect([...groupByDay(commits).keys()]).toEqual([
			"2026-08-05",
			"2026-06-20",
			"2026-06-01",
		]);
		expect(groupByDay(commits).get("2026-08-05")).toHaveLength(2);
	});

	test("computes local calendar month boundaries across years", () => {
		const january = startOfMonth(new Date(2026, 0, 20, 12));
		const previous = new Date(january.getFullYear(), january.getMonth() - 1, 1);
		expect(monthKey(january)).toBe("2026-01");
		expect(monthKey(previous)).toBe("2025-12");
	});
});
