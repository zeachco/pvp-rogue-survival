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

export interface MonthlyDevlog {
	month: string;
	label: string;
	generatedAt: string;
	model: string;
	periods: DevlogPeriod[];
}

interface MonthSource {
	key: string;
	commits: CommitEntry[];
	groupedCategories: string[];
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

function hasUpdates(month: MonthSource): boolean {
	return month.commits.length > 0 || month.groupedCategories.length > 0;
}

export function startOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function monthKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	return `${year}-${month}`;
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
	return `${monthKey(date)}-01`;
}

export function monthStartsBetween(from: Date, through: Date): Date[] {
	const starts: Date[] = [];
	const cursor = startOfMonth(from);
	const last = startOfMonth(through);
	while (cursor <= last) {
		starts.push(new Date(cursor));
		cursor.setMonth(cursor.getMonth() + 1);
	}
	return starts;
}

function monthLabel(key: string): string {
	return new Intl.DateTimeFormat("en-CA", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(`${key}-01T00:00:00Z`));
}

async function gitLogs(from: Date, until: Date): Promise<CommitEntry[]> {
	const raw =
		await $`git log --since=${formatGitDate(from)} --until=${formatGitDate(until)} --date=iso-strict --format=${GIT_LOG_FORMAT}`.text();
	return parseGitLog(raw);
}

function promptFor(months: MonthSource[]): string {
	const requestedKeys = months.filter(hasUpdates).map(({ key }) => key);
	const logs = months
		.map(({ key, commits, groupedCategories }) => {
			const entries = commits
				.map(
					(commit) =>
						`[${commit.authoredAt.slice(0, 10)}] ${commit.title}${commit.description ? `\n${commit.description}` : ""}`,
				)
				.join("\n\n");
			const grouped = groupedCategories.length
				? `Grouped monthly categories (do not expand into individual changes): ${groupedCategories.join(", ")}`
				: "";
			return `${key}:\n${[entries, grouped].filter(Boolean).join("\n\n") || "No updates."}`;
		})
		.join("\n\n");

	return `Write concise, gamer-facing development changelogs from only the supplied semantic Git commit titles and descriptions. Do not invent details or mention commit hashes.
Use balance for balance-change descriptions, fix for bugs fixed, feat for features added, ux for design or experience changes, and perf for what became faster. General fixes and Refactor are presence-only monthly categories: mention each at most once and never infer or enumerate its underlying work.
Return only strict JSON shaped as {"periods":[{"key":"YYYY-MM","title":"short headline","summary":"one detailed paragraph","categories":["concise category"]}]}.
Return exactly one period for every requested month, in this order: ${requestedKeys.join(", ")}.

Git logs for the requested months:
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
	month: MonthSource,
	generated: Map<string, GeneratedPeriod>,
): MonthlyDevlog {
	const result = generated.get(month.key);
	if (typeof result?.title !== "string" || typeof result.summary !== "string")
		throw new Error(`Ollama omitted or invalidated ${month.key}.`);
	const categories = Array.isArray(result.categories)
		? result.categories.filter(
				(category): category is string => typeof category === "string",
			)
		: [];
	for (const category of month.groupedCategories)
		if (!categories.includes(category)) categories.push(category);
	const periods: DevlogPeriod[] = [
		{
			key: month.key,
			label: monthLabel(month.key),
			commits: month.commits,
			summaryTitle: result.title,
			summary: result.summary,
			categories,
		},
	];
	return {
		month: month.key,
		label: monthLabel(month.key),
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

async function sourceMonths(options: ChangelogOptions): Promise<MonthSource[]> {
	const currentStart = startOfMonth(new Date());
	const previousStart = new Date(
		currentStart.getFullYear(),
		currentStart.getMonth() - 1,
		1,
	);
	const starts = options.all
		? monthStartsBetween(await firstCommitDate(), currentStart)
		: [previousStart, currentStart];
	return Promise.all(
		starts.map(async (start) => {
			const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
			return {
				key: monthKey(start),
				...selectChangelogCommits(await gitLogs(start, end)),
			};
		}),
	);
}

async function generatePeriods(
	months: MonthSource[],
	separateRequests: boolean,
): Promise<Map<string, GeneratedPeriod>> {
	const generated = new Map<string, GeneratedPeriod>();
	const requests = separateRequests ? months.map((month) => [month]) : [months];
	for (const request of requests) {
		if (!request.some(hasUpdates)) continue;
		const prompt = promptFor(request);
		const response =
			await $`printf %s ${prompt} | ollama run ${MODEL} --format json --hidethinking --nowordwrap`.text();
		for (const period of extractPeriods(response)) {
			if (typeof period.key === "string") generated.set(period.key, period);
		}
		for (const month of request) {
			if (hasUpdates(month) && !generated.has(month.key))
				throw new Error(`Ollama omitted or invalidated ${month.key}.`);
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
	const months = await sourceMonths({ all });
	const generated = await generatePeriods(months, all);

	const outputDirectory = resolve(process.cwd(), "changelogs");
	await mkdir(outputDirectory, { recursive: true });
	for (const month of months) {
		const path = join(outputDirectory, `${month.key}.json`);
		const contents = !hasUpdates(month)
			? '"No updates."\n'
			: `${JSON.stringify(buildDocument(month, generated), null, 2)}\n`;
		await Bun.write(path, contents);
		console.log(`Wrote ${path}`);
	}
}

if (import.meta.main) await main();
