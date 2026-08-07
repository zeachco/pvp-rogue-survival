import { describe, expect, test } from "bun:test";
import { isSemanticCommitMessage } from "../scripts/validateCommitMessage";

describe("semantic commit hook", () => {
	test("accepts supported semantic commit messages", () => {
		expect(isSemanticCommitMessage("feat: add matchmaking")).toBe(true);
		expect(isSemanticCommitMessage("balance(spells): reduce nova damage")).toBe(
			true,
		);
		expect(
			isSemanticCommitMessage("docs(game rules): explain matchmaking"),
		).toBe(true);
		expect(isSemanticCommitMessage("perf(path finding): reduce allocations")).toBe(
			true,
		);
	});

	test("rejects unsupported or incomplete commit messages", () => {
		expect(isSemanticCommitMessage("style: restyle matchmaking")).toBe(false);
		expect(isSemanticCommitMessage("fix(server)!: replace wave protocol")).toBe(
			false,
		);
		expect(isSemanticCommitMessage("feat:")).toBe(false);
		expect(isSemanticCommitMessage("feat(): add matchmaking")).toBe(false);
		expect(isSemanticCommitMessage("Added matchmaking")).toBe(false);
	});
});
