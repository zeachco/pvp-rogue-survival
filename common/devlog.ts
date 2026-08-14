export const DEVLOG_SUMMARY_BUCKETS = [
	"features",
	"bugfixes",
	"performance",
	"balance",
	"ux",
	"graphics",
] as const;

export type CommunityRequestCompletionFilter = "all" | "pending" | "completed";

export function filterCommunityRequestsByCompletion<
	T extends { completed: boolean },
>(requests: readonly T[], filter: CommunityRequestCompletionFilter): T[] {
	if (filter === "pending")
		return requests.filter(({ completed }) => !completed);
	if (filter === "completed")
		return requests.filter(({ completed }) => completed);
	return [...requests];
}

export type DevlogSummaryBucket = (typeof DEVLOG_SUMMARY_BUCKETS)[number];
export type DevlogSummary = Partial<Record<DevlogSummaryBucket, string[]>>;
