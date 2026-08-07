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
}

interface GeneratedPeriod {
	key?: unknown;
	title?: unknown;
	summary?: unknown;
	categories?: unknown;
}

const MODEL = "gemma4:e2b";
const GIT_LOG_FORMAT = "%x1e%H%x1f%aI%x1f%s%x1f%b";

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

export function groupByDay(commits: CommitEntry[]): Map<string, CommitEntry[]> {
	const groups = new Map<string, CommitEntry[]>();
	for (const commit of commits) {
		const key = commit.authoredAt.slice(0, 10);
		groups.set(key, [...(groups.get(key) ?? []), commit]);
	}
	return new Map([...groups].sort(([a], [b]) => b.localeCompare(a)));
}

function formatGitDate(date: Date): string {
	return `${monthKey(date)}-01`;
}

function monthLabel(key: string): string {
	return new Intl.DateTimeFormat("en-CA", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(`${key}-01T00:00:00Z`));
}

function dayLabel(key: string): string {
	return new Intl.DateTimeFormat("en-CA", {
		dateStyle: "long",
		timeZone: "UTC",
	}).format(new Date(`${key}T00:00:00Z`));
}

async function gitLogs(from: Date, until: Date): Promise<CommitEntry[]> {
	const raw =
		await $`git log --since=${formatGitDate(from)} --until=${formatGitDate(until)} --date=iso-strict --format=${GIT_LOG_FORMAT}`.text();
	return parseGitLog(raw);
}

function promptFor(months: MonthSource[]): string {
	const requestedKeys = months.flatMap(({ commits }) => [
		...groupByDay(commits).keys(),
	]);
	const logs = months
		.map(({ key, commits }) => {
			const entries = commits
				.map(
					(commit) =>
						`[${commit.authoredAt.slice(0, 10)}] ${commit.title}${commit.description ? `\n${commit.description}` : ""}`,
				)
				.join("\n\n");
			return `${key}:\n${entries || "No commits."}`;
		})
		.join("\n\n");

	return `Write concise, gamer-facing development changelogs from only the supplied Git commit titles and descriptions. Do not invent details or mention commit hashes.
Return only strict JSON shaped as {"periods":[{"key":"YYYY-MM-DD","title":"short headline","summary":"one paragraph","categories":["concise category"]}]}.
Return exactly one period for every requested day, in this order: ${requestedKeys.join(", ")}.

Git logs for the previous and current months:
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
	const periods = [...groupByDay(month.commits)].map(([key, commits]) => {
		const result = generated.get(key);
		if (typeof result?.title !== "string" || typeof result.summary !== "string")
			throw new Error(`Ollama omitted or invalidated ${key}.`);
		const categories = Array.isArray(result.categories)
			? result.categories.filter(
					(category): category is string => typeof category === "string",
				)
			: [];
		return {
			key,
			label: dayLabel(key),
			commits,
			summaryTitle: result.title,
			summary: result.summary,
			categories,
		};
	});
	return {
		month: month.key,
		label: monthLabel(month.key),
		generatedAt: new Date().toISOString(),
		model: MODEL,
		periods,
	};
}

async function main(): Promise<void> {
	const currentStart = startOfMonth(new Date());
	const previousStart = new Date(
		currentStart.getFullYear(),
		currentStart.getMonth() - 1,
		1,
	);
	const nextStart = new Date(
		currentStart.getFullYear(),
		currentStart.getMonth() + 1,
		1,
	);
	const months: MonthSource[] = [
		{
			key: monthKey(previousStart),
			commits: await gitLogs(previousStart, currentStart),
		},
		{
			key: monthKey(currentStart),
			commits: await gitLogs(currentStart, nextStart),
		},
	];
	const monthsWithCommits = months.filter(({ commits }) => commits.length > 0);
	const generated = new Map<string, GeneratedPeriod>();
	if (monthsWithCommits.length > 0) {
		const prompt = promptFor(months);
		const response = await $`printf %s ${prompt} | ollama run ${MODEL}`.text();
		for (const period of extractPeriods(response)) {
			if (typeof period.key === "string") generated.set(period.key, period);
		}
	}

	const outputDirectory = resolve(process.cwd(), "changelogs");
	await mkdir(outputDirectory, { recursive: true });
	for (const month of months) {
		const path = join(outputDirectory, `${month.key}.json`);
		const contents =
			month.commits.length === 0
				? '"No updates."\n'
				: `${JSON.stringify(buildDocument(month, generated), null, 2)}\n`;
		await Bun.write(path, contents);
		console.log(`Wrote ${path}`);
	}
}

if (import.meta.main) await main();
