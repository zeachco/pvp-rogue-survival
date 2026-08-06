import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface CommitEntry {
	hash: string;
	authoredAt: string;
	title: string;
	description: string;
}

export interface SummaryPeriod {
	key: string;
	label: string;
	commits: CommitEntry[];
}

export interface DevlogSummary extends SummaryPeriod {
	summaryTitle: string;
	summary: string;
	categories: string[];
}

export interface MonthlyDevlog {
	month: string;
	label: string;
	generatedAt: string;
	model: string;
	periods: DevlogSummary[];
}

const GENERIC_CATEGORIES = [
	"General bug fixes",
	"Quality of life",
	"UI",
	"UX",
	"Features",
];

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

export function monthKey(date: Date): string {
	return date.toISOString().slice(0, 7);
}

export function monthRange(first: Date, last: Date): string[] {
	const cursor = new Date(
		Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1),
	);
	const end = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1));
	const months: string[] = [];
	while (cursor <= end) {
		months.push(monthKey(cursor));
		cursor.setUTCMonth(cursor.getUTCMonth() + 1);
	}
	return months;
}

export function previousMonth(key: string): string {
	const [year, month] = key.split("-").map(Number);
	return monthKey(new Date(Date.UTC(year!, month! - 2, 1)));
}

export function groupMonth(
	month: string,
	commits: CommitEntry[],
	byDay: boolean,
): SummaryPeriod[] {
	const matching = commits.filter(
		(commit) => commit.authoredAt.slice(0, 7) === month,
	);
	if (matching.length === 0) return [];
	if (!byDay)
		return [{ key: month, label: monthLabel(month), commits: matching }];
	const groups = new Map<string, SummaryPeriod>();
	for (const commit of matching) {
		const key = commit.authoredAt.slice(0, 10);
		const group = groups.get(key) ?? {
			key,
			label: dayLabel(key),
			commits: [],
		};
		group.commits.push(commit);
		groups.set(key, group);
	}
	return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));
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

function extractJson(raw: string): {
	periods?: unknown;
} {
	const clean = raw
		.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
		.replaceAll("\r", "")
		.trim();
	const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	const candidate =
		fenced ?? clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1);
	return JSON.parse(candidate);
}

function promptFor(
	month: string,
	periods: SummaryPeriod[],
	byDay: boolean,
): string {
	const commits = periods
		.flatMap((period) =>
			period.commits.map(
				(commit) =>
					`[${commit.authoredAt.slice(0, 10)}] ${commit.title}${commit.description ? `\n  ${commit.description.replaceAll("\n", "\n  ")}` : ""}`,
			),
		)
		.join("\n");
	const expectedKeys = periods.map((period) => period.key).join(", ");
	return `You write concise game development logs for technically savvy gamers.
Summarize only what the supplied Git commit titles and descriptions explicitly support.
Give enough concrete technical and gameplay detail to understand what changed directly.
If a commit is vague, do not infer specifics. Represent it only with a broad category such as General bug fixes, Quality of life, UI, UX, or Features.
Do not mention commit hashes. Return only strict JSON with this shape:
{"periods":[{"key":"requested key","title":"short period headline","summary":"one detailed paragraph","categories":["one or more concise categories"]}]}
Return exactly one entry for each requested key, in the requested order. Use at most five categories per entry. Do not use Markdown.

Month: ${month}
Grouping: ${byDay ? "one summary per commit day" : "one summary for the complete month"}
Requested keys: ${expectedKeys}
Commits:
${commits}`;
}

async function summarizeMonth(
	month: string,
	periods: SummaryPeriod[],
	byDay: boolean,
	model: string,
): Promise<DevlogSummary[]> {
	const child = Bun.spawn(
		[
			"ollama",
			"run",
			model,
			"--format",
			"json",
			"--hidethinking",
			"--nowordwrap",
		],
		{
			stdin: new Blob([promptFor(month, periods, byDay)]),
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0)
		throw new Error(`Ollama failed for ${month}: ${stderr.trim()}`);
	const parsed = extractJson(stdout);
	if (!Array.isArray(parsed.periods))
		throw new Error(`Ollama returned invalid JSON for ${month}.`);
	const generated = new Map(
		parsed.periods
			.filter(
				(value): value is Record<string, unknown> =>
					typeof value === "object" && value !== null,
			)
			.map((value) => [value.key, value]),
	);
	return periods.map((period) => {
		const value = generated.get(period.key);
		if (typeof value?.title !== "string" || typeof value.summary !== "string")
			throw new Error(`Ollama omitted or invalidated ${period.key}.`);
		const categories = Array.isArray(value.categories)
			? value.categories.filter(
					(category): category is string => typeof category === "string",
				)
			: [];
		return {
			...period,
			summaryTitle: value.title,
			summary: value.summary,
			categories:
				categories.length > 0 ? categories.slice(0, 5) : GENERIC_CATEGORIES,
		};
	});
}

async function gitHistory(): Promise<CommitEntry[]> {
	const child = Bun.spawn(
		["git", "log", "--format=%x1e%H%x1f%aI%x1f%s%x1f%b", "--date=iso-strict"],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) throw new Error(`git log failed: ${stderr.trim()}`);
	return parseGitLog(stdout);
}

async function fileExists(path: string): Promise<boolean> {
	return Bun.file(path).exists();
}

async function main(): Promise<void> {
	const model = process.env.CHANGELOG_MODEL ?? "gemma4-tools:64k";
	const outputDirectory = resolve(process.cwd(), "changelogs");
	const commits = await gitHistory();
	if (commits.length === 0) throw new Error("No Git commits found.");
	const currentMonth = monthKey(new Date());
	const refreshedMonths = new Set([currentMonth, previousMonth(currentMonth)]);
	const earliest = new Date(
		Math.min(...commits.map((commit) => new Date(commit.authoredAt).getTime())),
	);
	const months = monthRange(earliest, new Date());
	await mkdir(outputDirectory, { recursive: true });
	for (const month of months) {
		const outputPath = join(outputDirectory, `${month}.json`);
		const missing = !(await fileExists(outputPath));
		if (!missing && !refreshedMonths.has(month)) continue;
		const byDay = refreshedMonths.has(month);
		const periods = groupMonth(month, commits, byDay);
		if (periods.length === 0) {
			await Bun.write(outputPath, '"No updates."\n');
			console.log(`Wrote ${month}: No updates.`);
			continue;
		}
		console.log(`Summarizing ${month} in one Ollama call...`);
		const summaries = await summarizeMonth(month, periods, byDay, model);
		const document: MonthlyDevlog = {
			month,
			label: monthLabel(month),
			generatedAt: new Date().toISOString(),
			model,
			periods: summaries,
		};
		await Bun.write(outputPath, `${JSON.stringify(document, null, 2)}\n`);
		console.log(`Wrote ${outputPath}`);
	}
}

if (import.meta.main) await main();
