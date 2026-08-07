import { describe, expect, test } from "bun:test";
import { monthKey, parseGitLog, startOfMonth } from "../scripts/changelog";

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
});
