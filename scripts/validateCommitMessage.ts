const SEMANTIC_COMMIT_PATTERN =
	/^(balance|fix|feat|ux|perf|docs|chore|test|refactor)(\([^()\r\n]+\))?: .+$/;

export function isSemanticCommitMessage(message: string): boolean {
	return SEMANTIC_COMMIT_PATTERN.test(message.trim().split("\n", 1)[0] ?? "");
}

if (import.meta.main) {
	const path = Bun.argv[2];
	if (!path)
		throw new Error("Usage: validateCommitMessage.ts <commit-message-file>");
	const message = await Bun.file(path).text();
	if (!isSemanticCommitMessage(message)) {
		console.error(
			"Commit message must be: <verb>(optional-subject): <description>",
		);
		console.error(
			"Allowed verbs: balance, fix, feat, ux, perf, docs, chore, test, refactor",
		);
		process.exit(1);
	}
}
