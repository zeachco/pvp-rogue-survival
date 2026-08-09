export const DEVLOG_SUMMARY_BUCKETS = [
	"features",
	"bugfixes",
	"performance",
	"balance",
	"ux",
	"graphics",
] as const;

export type DevlogSummaryBucket = (typeof DEVLOG_SUMMARY_BUCKETS)[number];
export type DevlogSummary = Partial<Record<DevlogSummaryBucket, string[]>>;
