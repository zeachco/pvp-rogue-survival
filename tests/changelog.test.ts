import { describe, expect, test } from "bun:test";
import {
	groupMonth,
	monthRange,
	parseGitLog,
	previousMonth,
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

	test("groups refreshed months by day and older backfills as one month", () => {
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
		expect(groupMonth("2026-08", commits, true).map(({ key }) => key)).toEqual([
			"2026-08-05",
		]);
		expect(groupMonth("2026-06", commits, false)[0]?.commits).toHaveLength(2);
	});

	test("plans every calendar month and handles year boundaries", () => {
		expect(
			monthRange(
				new Date("2025-11-20T00:00:00Z"),
				new Date("2026-02-01T00:00:00Z"),
			),
		).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
		expect(previousMonth("2026-01")).toBe("2025-12");
	});
});
