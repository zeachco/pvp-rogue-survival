import "./devlog.css";
import type { WeeklyDevlog } from "../scripts/changelog";
import type { DevlogRequest } from "../server/DevlogRequestRepository";

const files = import.meta.glob<string | WeeklyDevlog>("../changelogs/*.json", {
	eager: true,
	import: "default",
});
const weeks = Object.entries(files)
	.map(([path, data]) => ({
		key: path.match(/(\d{4}-W\d{2})\.json$/)?.[1] ?? "",
		data,
	}))
	.filter(({ key }) => key)
	.sort((a, b) => a.key.localeCompare(b.key));

const calendar = document.querySelector("#calendar") as HTMLElement;
const weekNode = document.querySelector("#week") as HTMLElement;
const requestForm = document.querySelector("#request-form") as HTMLFormElement;
const requestStatus = document.querySelector("#request-status") as HTMLElement;
const futureRequests = document.querySelector(
	"#future-requests",
) as HTMLElement;
const voterId = loadVoterId();
const voteChoices = loadVoteChoices();
let requests: DevlogRequest[] = [];

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

function renderWeek(key: string, data: string | WeeklyDevlog): void {
	for (const button of calendar.querySelectorAll("button"))
		button.classList.toggle("is-selected", button.dataset.week === key);
	if (typeof data === "string") {
		const empty = element("article", undefined, "empty-month");
		empty.append(element("small", key), element("h2", "No updates."));
		weekNode.replaceChildren(empty);
		return;
	}
	const heading = element("div", undefined, "month-heading");
	heading.append(
		element("small", "Selected week"),
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
		const details = element("section", undefined, "commit-details");
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
				"strong",
				`${period.commits.length} source commit${period.commits.length === 1 ? "" : "s"}`,
			),
			list,
		);
		article.append(tags, details);
		return article;
	});
	weekNode.replaceChildren(heading, ...articles);
}

function renderRequests(): void {
	if (!requests.length) {
		futureRequests.replaceChildren(
			element("p", "No requests yet. Be the first to suggest one.", "muted"),
		);
		return;
	}
	const groups = new Map<string, DevlogRequest[]>();
	for (const request of requests)
		groups.set(request.scheduledMonth, [
			...(groups.get(request.scheduledMonth) ?? []),
			request,
		]);
	const monthSections = [...groups.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([month, entries]) => {
			entries.sort(
				(a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt),
			);
			const section = element("section", undefined, "future-month");
			const date = new Date(`${month}-01T00:00:00Z`);
			section.append(
				element(
					"h3",
					date.toLocaleDateString(undefined, {
						month: "long",
						year: "numeric",
						timeZone: "UTC",
					}),
				),
			);
			const list = element("div", undefined, "request-list");
			list.append(...entries.map(renderRequest));
			section.append(list);
			return section;
		});
	futureRequests.replaceChildren(...monthSections);
}

function renderRequest(request: DevlogRequest): HTMLElement {
	const card = element("article", undefined, "request-card");
	const copy = element("div", undefined, "request-copy");
	const meta = element("div", undefined, "request-meta");
	meta.append(
		element("span", request.kind, `request-kind ${request.kind}`),
		element(
			"time",
			new Date(request.createdAt).toLocaleDateString(),
			"request-date",
		),
	);
	copy.append(
		meta,
		element("h4", request.title),
		element("p", request.description),
	);
	const votes = element("div", undefined, "vote-controls");
	const up = voteButton(request, 1, `▲ ${request.upvotes}`, "Upvote");
	const score = element("strong", String(request.score), "vote-score");
	score.title = "Net score";
	const down = voteButton(request, -1, `▼ ${request.downvotes}`, "Downvote");
	votes.append(up, score, down);
	card.append(copy, votes);
	return card;
}

function voteButton(
	request: DevlogRequest,
	value: -1 | 1,
	label: string,
	title: string,
): HTMLButtonElement {
	const button = element("button", label);
	button.type = "button";
	button.title = title;
	button.setAttribute("aria-label", `${title} ${request.title}`);
	button.setAttribute(
		"aria-pressed",
		String(voteChoices[request.id] === value),
	);
	button.onclick = async () => {
		const nextValue = voteChoices[request.id] === value ? 0 : value;
		button.disabled = true;
		try {
			const response = await fetch(`/api/devlog/requests/${request.id}/vote`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ voterId, value: nextValue }),
			});
			const result = (await response.json()) as {
				request?: DevlogRequest;
				error?: string;
			};
			if (!response.ok || !result.request)
				throw new Error(result.error ?? "Vote failed.");
			if (nextValue === 0) delete voteChoices[request.id];
			else voteChoices[request.id] = nextValue;
			localStorage.setItem(
				"multi-line-hero.devlog-votes",
				JSON.stringify(voteChoices),
			);
			requests = requests
				.map((entry) =>
					entry.id === result.request?.id ? result.request : entry,
				)
				.sort(
					(a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt),
				);
			renderRequests();
		} catch (error) {
			requestStatus.textContent =
				error instanceof Error ? error.message : "Vote failed.";
			requestStatus.className = "error";
			button.disabled = false;
		}
	};
	return button;
}

requestForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const submit = requestForm.querySelector(
		"button[type=submit]",
	) as HTMLButtonElement;
	submit.disabled = true;
	requestStatus.className = "";
	requestStatus.textContent = "Submitting…";
	try {
		const values = new FormData(requestForm);
		const response = await fetch("/api/devlog/requests", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				kind: values.get("kind"),
				title: values.get("title"),
				description: values.get("description"),
			}),
		});
		const result = (await response.json()) as {
			request?: DevlogRequest;
			error?: string;
		};
		if (!response.ok || !result.request)
			throw new Error(result.error ?? "Submission failed.");
		requests.push(result.request);
		requestForm.reset();
		requestStatus.textContent = "Request submitted.";
		requestStatus.className = "success";
		renderRequests();
	} catch (error) {
		requestStatus.textContent =
			error instanceof Error ? error.message : "Submission failed.";
		requestStatus.className = "error";
	} finally {
		submit.disabled = false;
	}
});

void loadRequests();

async function loadRequests(): Promise<void> {
	try {
		const response = await fetch("/api/devlog/requests");
		const result = (await response.json()) as {
			requests?: DevlogRequest[];
			error?: string;
		};
		if (!response.ok || !result.requests)
			throw new Error(result.error ?? "Could not load requests.");
		requests = result.requests;
		renderRequests();
	} catch (error) {
		futureRequests.replaceChildren(
			element(
				"p",
				error instanceof Error ? error.message : "Could not load requests.",
				"error",
			),
		);
	}
}

function loadVoterId(): string {
	const key = "multi-line-hero.devlog-voter";
	const existing = localStorage.getItem(key);
	if (existing) return existing;
	const created = crypto.randomUUID();
	localStorage.setItem(key, created);
	return created;
}

function loadVoteChoices(): Record<string, -1 | 1> {
	try {
		return JSON.parse(
			localStorage.getItem("multi-line-hero.devlog-votes") ?? "{}",
		) as Record<string, -1 | 1>;
	} catch {
		return {};
	}
}

if (weeks.length === 0) {
	weekNode.append(
		element(
			"p",
			"No generated changelogs found. Run bun run changelog.",
			"error",
		),
	);
} else {
	const maximumCommits = Math.max(
		1,
		...weeks.map(({ data }) =>
			typeof data === "string"
				? 0
				: data.periods.reduce((sum, period) => sum + period.commits.length, 0),
		),
	);
	calendar.append(
		...weeks.map(({ key, data }) => {
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
			button.dataset.week = key;
			button.title = `${key}: ${commits === 0 ? "No updates" : `${commits} commits`}`;
			button.setAttribute("aria-label", button.title);
			button.onclick = () => renderWeek(key, data);
			return button;
		}),
	);
	const latest = weeks.at(-1)!;
	renderWeek(latest.key, latest.data);
}
