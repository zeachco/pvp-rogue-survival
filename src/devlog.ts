import "./devlog.css";
import type { MonthlyDevlog } from "../scripts/changelog";

const files = import.meta.glob<string | MonthlyDevlog>("../changelogs/*.json", {
	eager: true,
	import: "default",
});
const months = Object.entries(files)
	.map(([path, data]) => ({
		key: path.match(/(\d{4}-\d{2})\.json$/)?.[1] ?? "",
		data,
	}))
	.filter(({ key }) => key)
	.sort((a, b) => a.key.localeCompare(b.key));

const calendar = document.querySelector("#calendar") as HTMLElement;
const monthNode = document.querySelector("#month") as HTMLElement;

function element<K extends keyof HTMLElementTagNameMap>(
	name: K,
	text?: string,
	className?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(name);
	if (text !== undefined) node.textContent = text;
	if (className) node.className = className;
	return node;
}

function renderMonth(key: string, data: string | MonthlyDevlog): void {
	for (const button of calendar.querySelectorAll("button"))
		button.classList.toggle("is-selected", button.dataset.month === key);
	if (typeof data === "string") {
		const empty = element("article", undefined, "empty-month");
		empty.append(element("small", key), element("h2", "No updates."));
		monthNode.replaceChildren(empty);
		return;
	}
	const heading = element("div", undefined, "month-heading");
	heading.append(
		element("small", "Selected month"),
		element("h2", data.label),
		element("span", `Generated ${new Date(data.generatedAt).toLocaleString()}`),
	);
	const articles = data.periods.map((period) => {
		const article = element("article");
		article.append(
			element("small", period.label),
			element("h3", period.summaryTitle),
			element("p", period.summary),
		);
		const tags = element("div", undefined, "tags");
		tags.append(
			...period.categories.map((category) => element("span", category)),
		);
		const details = element("details");
		const list = element("ul");
		list.append(
			...period.commits.map((commit) => {
				const item = element("li", commit.title);
				if (commit.description)
					item.append(element("small", commit.description));
				return item;
			}),
		);
		details.append(
			element(
				"summary",
				`${period.commits.length} source commit${period.commits.length === 1 ? "" : "s"}`,
			),
			list,
		);
		article.append(tags, details);
		return article;
	});
	monthNode.replaceChildren(heading, ...articles);
}

if (months.length === 0) {
	monthNode.append(
		element(
			"p",
			"No generated changelogs found. Run bun run changelog.",
			"error",
		),
	);
} else {
	const maximumCommits = Math.max(
		1,
		...months.map(({ data }) =>
			typeof data === "string"
				? 0
				: data.periods.reduce((sum, period) => sum + period.commits.length, 0),
		),
	);
	calendar.append(
		...months.map(({ key, data }) => {
			const commits =
				typeof data === "string"
					? 0
					: data.periods.reduce(
							(sum, period) => sum + period.commits.length,
							0,
						);
			const intensity =
				commits === 0 ? 0 : Math.ceil((commits / maximumCommits) * 4);
			const button = element("button", key, `intensity-${intensity}`);
			button.type = "button";
			button.dataset.month = key;
			button.title = `${key}: ${commits === 0 ? "No updates" : `${commits} commits`}`;
			button.setAttribute("aria-label", button.title);
			button.onclick = () => renderMonth(key, data);
			return button;
		}),
	);
	const latest = months.at(-1)!;
	renderMonth(latest.key, latest.data);
}
