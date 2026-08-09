import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { $ } from "bun";
import { z } from "zod";
import {
	DEVLOG_SUMMARY_BUCKETS,
	type DevlogSummary,
	type DevlogSummaryBucket,
} from "../common/devlog";

export interface CommitEntry {
	hash: string;
	authoredAt: string;
	title: string;
	description: string;
}

export interface DevlogPeriod {
	key: string;
	label: string;
	summaryTitle: string;
	summary: DevlogSummary | string;
	commits: CommitEntry[];
	categories: string[];
}

const SUMMARY_BUCKET_LABELS: Record<DevlogSummaryBucket, string> = {
	features: "Features",
	bugfixes: "Bugfixes",
	performance: "Performance",
	balance: "Balance",
	ux: "UX",
	graphics: "Graphics",
};

export interface WeeklyDevlog {
	week: string;
	label: string;
	generatedAt: string;
	model: string;
	periods: DevlogPeriod[];
}

export interface WeekSource {
	key: string;
	commits: CommitEntry[];
	groupedCategories: string[];
	projectInitialized: boolean;
}

const summaryLineSchema = z.string().trim().min(1);
const generatedSummarySchema = z
	.strictObject({
		features: z.array(summaryLineSchema).optional(),
		bugfixes: z.array(summaryLineSchema).optional(),
		performance: z.array(summaryLineSchema).optional(),
		balance: z.array(summaryLineSchema).optional(),
		ux: z.array(summaryLineSchema).optional(),
		graphics: z.array(summaryLineSchema).optional(),
	})
	.refine(
		(summary) =>
			DEVLOG_SUMMARY_BUCKETS.some((bucket) => summary[bucket]?.length),
		"At least one summary bucket must contain an update.",
	);

const generatedPeriodSchema = z.strictObject({
	key: z.string().regex(/^\d{4}-W\d{2}$/),
	title: z.string().trim().min(1),
	summary: generatedSummarySchema,
});

const generatedResponseSchema = z.strictObject({
	periods: z.array(generatedPeriodSchema),
});

type GeneratedPeriod = z.output<
	typeof generatedResponseSchema
>["periods"][number];

interface ChangelogOptions {
	all: boolean;
}

export const MODEL_FALLBACKS = [
	"gemma4:e2b",
	"gemma4:e4b",
	"gemma4:latest",
] as const;
const GIT_LOG_FORMAT = "%x1e%H%x1f%aI%x1f%s%x1f%b";
const INDIVIDUAL_CHANGE_TYPES = new Set([
	"balance",
	"fix",
	"feat",
	"ux",
	"perf",
]);

export function semanticCommitType(title: string): string | undefined {
	return title.match(/^([a-z]+)(?:\([^()]+\))?:\s+\S/)?.[1];
}

export function selectChangelogCommits(commits: CommitEntry[]): {
	commits: CommitEntry[];
	groupedCategories: string[];
} {
	const types = commits.map((commit) => semanticCommitType(commit.title));
	return {
		commits: commits.filter((_, index) =>
			INDIVIDUAL_CHANGE_TYPES.has(types[index] ?? ""),
		),
		groupedCategories: [
			...(types.some(
				(type) => type === "docs" || type === "chore" || type === "test",
			)
				? ["General fixes"]
				: []),
			...(types.includes("refactor") ? ["Refactor"] : []),
		],
	};
}

export function projectInitializationCommit(authoredAt: string): CommitEntry {
	return {
		hash: "project-initialization",
		authoredAt,
		title: "Initialized project",
		description: "",
	};
}

function hasUpdates(week: WeekSource): boolean {
	return week.commits.length > 0 || week.groupedCategories.length > 0;
}

export function startOfWeek(date: Date): Date {
	const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const daysSinceMonday = (start.getDay() + 6) % 7;
	start.setDate(start.getDate() - daysSinceMonday);
	return start;
}

export function weekKey(date: Date): string {
	const monday = startOfWeek(date);
	const thursday = new Date(monday);
	thursday.setDate(monday.getDate() + 3);
	const weekYear = thursday.getFullYear();
	const firstMonday = startOfWeek(new Date(weekYear, 0, 4));
	const week =
		Math.round((monday.getTime() - firstMonday.getTime()) / 604_800_000) + 1;
	return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

export function parseGitLog(raw: string): CommitEntry[] {
	return raw
		.split("\u001e")
		.map((record) => record.trim())
		.filter(Boolean)
		.map((record) => {
			const [hash = "", authoredAt = "", title = "", ...body] =
				record.split("\u001f");
			return {
				hash,
				authoredAt,
				title: title.trim(),
				description: body.join("\u001f").trim(),
			};
		});
}

function formatGitDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function weekStartsBetween(from: Date, through: Date): Date[] {
	const starts: Date[] = [];
	const cursor = startOfWeek(from);
	const last = startOfWeek(through);
	while (cursor <= last) {
		starts.push(new Date(cursor));
		cursor.setDate(cursor.getDate() + 7);
	}
	return starts;
}

function weekLabel(start: Date): string {
	const date = new Intl.DateTimeFormat("en-CA", {
		day: "numeric",
		month: "long",
		year: "numeric",
	}).format(start);
	return `Week of ${date}`;
}

async function gitLogs(from: Date, before: Date): Promise<CommitEntry[]> {
	const raw =
		await $`git log --since=${formatGitDate(from)} --before=${formatGitDate(before)} --date=iso-strict --format=${GIT_LOG_FORMAT}`.text();
	return parseGitLog(raw);
}

export function promptFor(weeks: WeekSource[]): string {
	const requestedKeys = weeks.filter(hasUpdates).map(({ key }) => key);
	const logs = weeks
		.map(({ key, commits, groupedCategories }) => {
			const entries = commits
				.map(
					(commit) =>
						`[${commit.authoredAt.slice(0, 10)}] ${commit.title}${commit.description ? `\n${commit.description}` : ""}`,
				)
				.join("\n\n");
			const grouped = groupedCategories.length
				? `Grouped weekly categories (do not expand into individual changes): ${groupedCategories.join(", ")}`
				: "";
			return `${key}:\n${[entries, grouped].filter(Boolean).join("\n\n") || "No updates."}`;
		})
		.join("\n\n");

	return `Write detailed, gamer-facing development changelogs from only the supplied semantic Git commit titles and descriptions. Do not invent details or mention commit hashes.
Use features for new player-facing functionality, bugfixes for fixed bugs, performance for what became faster or more efficient, balance for tuning, ux for design or experience changes, and graphics for rendering or visual-presentation work. Ignore grouped General fixes and Refactor entries; they provide context only and must not become summary lines.
Prioritize completeness for features and bugfixes. Before writing, account for every feat and fix commit regardless of its position in the log. Every distinct player-facing feature and every distinct fixed problem must appear in its corresponding bucket; never omit one because another change seems newer, larger, or more relevant.
Regroup related feat and fix commits into concise concepts instead of listing commits individually. Fold follow-up implementation, polish, and repairs into the parent concept when they concern the same feature, but preserve important standalone systems such as authentication, multiplayer, progression, equipment, spells, and major Devlog capabilities as distinct summary lines. Consolidate closely related commits without losing distinct feature additions or distinct bugs fixed.
For performance, balance, ux, and graphics, provide an abstract higher-level recap. Combine related work aggressively and summarize its overall player-facing effect rather than covering every commit separately. Use no more than three concise lines per bucket unless substantially different systems require more.
Place each change in only its primary player-facing bucket. Do not repeat information across buckets and do not copy semantic commit prefixes.
Return only strict JSON shaped as {"periods":[{"key":"YYYY-Www","title":"short headline","summary":{"features":["Feature recap"],"bugfixes":["Bug-fix recap"],"performance":["Performance recap"],"balance":["Balance recap"],"ux":["UX recap"],"graphics":["Graphics recap"]}}]}. Omit empty summary buckets.
Return exactly one period for every requested week, in this order: ${requestedKeys.join(", ")}.

Git logs for the requested weeks:
${logs}`;
}

export function extractPeriods(raw: string): GeneratedPeriod[] {
	const clean = raw
		.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
		.replaceAll("\r", "")
		.trim();
	const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	const candidate =
		fenced ?? clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1);
	let json: unknown;
	try {
		json = JSON.parse(candidate);
	} catch (error) {
		throw new Error(
			`Ollama returned invalid changelog JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const parsed = generatedResponseSchema.safeParse(json);
	if (!parsed.success)
		throw new Error(
			`Ollama returned invalid changelog JSON: ${z.prettifyError(parsed.error)}`,
		);
	return parsed.data.periods;
}

export function buildDocument(
	week: WeekSource,
	start: Date,
	generated: Map<string, GeneratedPeriod>,
	model: string = MODEL_FALLBACKS[0],
): WeeklyDevlog {
	const result = generated.get(week.key);
	if (!result) throw new Error(`Ollama omitted or invalidated ${week.key}.`);
	const categories = DEVLOG_SUMMARY_BUCKETS.filter(
		(bucket) => result.summary[bucket]?.length,
	).map((bucket) => SUMMARY_BUCKET_LABELS[bucket]);
	const periods: DevlogPeriod[] = [
		{
			key: week.key,
			label: weekLabel(start),
			summaryTitle: week.projectInitialized
				? "Initialized project"
				: result.title,
			summary: result.summary,
			commits: week.commits,
			categories,
		},
	];
	return {
		week: week.key,
		label: weekLabel(start),
		generatedAt: new Date().toISOString(),
		model,
		periods,
	};
}

async function firstCommitDate(): Promise<Date> {
	const authoredAt = (await $`git log --reverse --format=%aI`.text())
		.split("\n", 1)[0]
		?.trim();
	if (!authoredAt) throw new Error("The repository has no commits.");
	return new Date(authoredAt);
}

async function sourceWeeks(
	options: ChangelogOptions,
): Promise<Array<WeekSource & { start: Date }>> {
	const firstDate = await firstCommitDate();
	const firstWeekKey = weekKey(firstDate);
	const currentStart = startOfWeek(new Date());
	const previousStart = new Date(currentStart);
	previousStart.setDate(previousStart.getDate() - 7);
	const starts = options.all
		? weekStartsBetween(firstDate, currentStart)
		: [previousStart, currentStart];
	return Promise.all(
		starts.map(async (start) => {
			const end = new Date(start);
			end.setDate(end.getDate() + 7);
			const key = weekKey(start);
			const selected = selectChangelogCommits(await gitLogs(start, end));
			const projectInitialized = key === firstWeekKey;
			return {
				key,
				start,
				...selected,
				projectInitialized,
				commits: projectInitialized
					? [
							projectInitializationCommit(firstDate.toISOString()),
							...selected.commits,
						]
					: selected.commits,
			};
		}),
	);
}

type RunModel = (model: string, prompt: string) => Promise<string>;

async function runOllama(model: string, prompt: string): Promise<string> {
	return await $`printf %s ${prompt} | ollama run ${model} --format json --hidethinking --nowordwrap`.text();
}

export async function generatePeriods(
	weeks: WeekSource[],
	runModel: RunModel = runOllama,
): Promise<{
	periods: Map<string, GeneratedPeriod>;
	models: Map<string, string>;
}> {
	const generated = new Map<string, GeneratedPeriod>();
	const models = new Map<string, string>();
	for (const week of weeks) {
		if (!hasUpdates(week)) continue;
		const prompt = promptFor([week]);
		let lastReason = "unknown error";
		for (const model of MODEL_FALLBACKS) {
			try {
				const periods = extractPeriods(await runModel(model, prompt));
				const period = periods.find(({ key }) => key === week.key);
				if (!period)
					throw new Error(`Ollama omitted expected period ${week.key}.`);
				generated.set(week.key, period);
				models.set(week.key, model);
				break;
			} catch (error) {
				lastReason = error instanceof Error ? error.message : String(error);
				console.error(
					`Changelog generation failed for ${week.key} with ${model}: ${lastReason}`,
				);
			}
		}
		if (!generated.has(week.key))
			throw new Error(
				`Changelog generation failed for ${week.key} after trying ${MODEL_FALLBACKS.join(", ")}. Final reason: ${lastReason}`,
			);
	}
	return { periods: generated, models };
}

async function main(): Promise<void> {
	const unknownArguments = Bun.argv
		.slice(2)
		.filter((argument) => argument !== "--all");
	if (unknownArguments.length > 0)
		throw new Error(`Unknown argument: ${unknownArguments.join(", ")}`);
	const all = Bun.argv.includes("--all");
	const weeks = await sourceWeeks({ all });
	const generated = await generatePeriods(weeks);

	const outputDirectory = resolve(process.cwd(), "changelogs");
	await mkdir(outputDirectory, { recursive: true });
	for (const week of weeks) {
		const path = join(outputDirectory, `${week.key}.json`);
		const contents = !hasUpdates(week)
			? '"No updates."\n'
			: `${JSON.stringify(
					buildDocument(
						week,
						week.start,
						generated.periods,
						generated.models.get(week.key),
					),
					null,
					2,
				)}\n`;
		await Bun.write(path, contents);
		console.log(`Wrote ${path}`);

		if (path.endsWith(".json")) {
			await $`bunx biome format --write ${path}`;
			console.log(`Formatted ${path}`);
		}
	}
}

if (import.meta.main) await main();
