import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { $ } from "bun";

export interface CommitEntry {
	hash: string;
	authoredAt: string;
	title: string;
	description: string;
}

export interface DevlogPeriod {
	key: string;
	label: string;
	commits: CommitEntry[];
	summaryTitle: string;
	summary: string;
	categories: string[];
}

export interface WeeklyDevlog {
	week: string;
	label: string;
	generatedAt: string;
	model: string;
	periods: DevlogPeriod[];
}

interface WeekSource {
	key: string;
	commits: CommitEntry[];
	groupedCategories: string[];
	projectInitialized: boolean;
}

interface GeneratedPeriod {
	key?: unknown;
	title?: unknown;
	summary?: unknown;
	categories?: unknown;
}

interface ChangelogOptions {
	all: boolean;
}

const MODEL = "gemma4:e2b";
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

function promptFor(weeks: WeekSource[]): string {
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

	return `Write concise, gamer-facing development changelogs from only the supplied semantic Git commit titles and descriptions. Do not invent details or mention commit hashes.
Use balance for balance-change descriptions, fix for bugs fixed, feat for features added, ux for design or experience changes, and perf for what became faster. General fixes and Refactor are presence-only weekly categories: mention each at most once and never infer or enumerate its underlying work.
Return only strict JSON shaped as {"periods":[{"key":"YYYY-Www","title":"short headline","summary":"one detailed paragraph","categories":["concise category"]}]}.
Return exactly one period for every requested week, in this order: ${requestedKeys.join(", ")}.

Git logs for the requested weeks:
${logs}`;
}

function extractPeriods(raw: string): GeneratedPeriod[] {
	const clean = raw
		.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
		.replaceAll("\r", "")
		.trim();
	const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	const candidate =
		fenced ?? clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1);
	const parsed = JSON.parse(candidate) as { periods?: unknown };
	if (!Array.isArray(parsed.periods))
		throw new Error("Ollama returned invalid changelog JSON.");
	return parsed.periods as GeneratedPeriod[];
}

function buildDocument(
	week: WeekSource,
	start: Date,
	generated: Map<string, GeneratedPeriod>,
): WeeklyDevlog {
	const result = generated.get(week.key);
	if (typeof result?.title !== "string" || typeof result.summary !== "string")
		throw new Error(`Ollama omitted or invalidated ${week.key}.`);
	const categories = Array.isArray(result.categories)
		? result.categories.filter(
				(category): category is string => typeof category === "string",
			)
		: [];
	for (const category of week.groupedCategories)
		if (!categories.includes(category)) categories.push(category);
	if (week.projectInitialized && !categories.includes("Project initialization"))
		categories.push("Project initialization");
	const periods: DevlogPeriod[] = [
		{
			key: week.key,
			label: weekLabel(start),
			commits: week.commits,
			summaryTitle: week.projectInitialized
				? "Initialized project"
				: result.title,
			summary: result.summary,
			categories,
		},
	];
	return {
		week: week.key,
		label: weekLabel(start),
		generatedAt: new Date().toISOString(),
		model: MODEL,
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

async function generatePeriods(
	weeks: WeekSource[],
	separateRequests: boolean,
): Promise<Map<string, GeneratedPeriod>> {
	const generated = new Map<string, GeneratedPeriod>();
	const requests = separateRequests ? weeks.map((week) => [week]) : [weeks];
	for (const request of requests) {
		if (!request.some(hasUpdates)) continue;
		const prompt = promptFor(request);
		const response =
			await $`printf %s ${prompt} | ollama run ${MODEL} --format json --hidethinking --nowordwrap`.text();
		for (const period of extractPeriods(response)) {
			if (typeof period.key === "string") generated.set(period.key, period);
		}
		for (const week of request) {
			if (hasUpdates(week) && !generated.has(week.key))
				throw new Error(`Ollama omitted or invalidated ${week.key}.`);
		}
	}
	return generated;
}

async function main(): Promise<void> {
	const unknownArguments = Bun.argv
		.slice(2)
		.filter((argument) => argument !== "--all");
	if (unknownArguments.length > 0)
		throw new Error(`Unknown argument: ${unknownArguments.join(", ")}`);
	const all = Bun.argv.includes("--all");
	const weeks = await sourceWeeks({ all });
	const generated = await generatePeriods(weeks, all);

	const outputDirectory = resolve(process.cwd(), "changelogs");
	await mkdir(outputDirectory, { recursive: true });
	for (const week of weeks) {
		const path = join(outputDirectory, `${week.key}.json`);
		const contents = !hasUpdates(week)
			? '"No updates."\n'
			: `${JSON.stringify(buildDocument(week, week.start, generated), null, 2)}\n`;
		await Bun.write(path, contents);
		console.log(`Wrote ${path}`);
	}
}

if (import.meta.main) await main();
