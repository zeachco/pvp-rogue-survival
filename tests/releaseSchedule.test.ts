import { describe, expect, test } from "bun:test";

const workflowPath = new URL(
	"../.github/workflows/weekly-release.yml",
	import.meta.url,
);
const releaseScriptPath = new URL(
	"../scripts/release-production.sh",
	import.meta.url,
);

describe("weekly production releases", () => {
	test("promotes main every Friday and supports urgent manual releases", async () => {
		const workflow = await Bun.file(workflowPath).text();

		expect(workflow).toContain('cron: "0 17 * * 5"');
		expect(workflow).toContain("workflow_dispatch:");
		expect(workflow).toContain("bun test");
		expect(workflow).toContain("bun run build");
		expect(workflow).toContain("git restore --worktree dist");
		expect(workflow).toContain("bun run release-production");
	});

	test("promotes only a clean origin/main commit to production", async () => {
		const script = await Bun.file(releaseScriptPath).text();

		expect(script).toContain("git status --porcelain");
		expect(script).toContain('!= "main"');
		expect(script).toContain("git fetch origin");
		expect(script).toContain(
			"Local HEAD must match origin/main before release.",
		);
		expect(script).toContain("git push origin HEAD:production");
	});
});
