import "./devlog.css";
import {
	type CommunityRequestCompletionFilter,
	COMMUNITY_REQUEST_KIND_LABELS,
	DEVLOG_SUMMARY_BUCKETS,
	DEVLOG_SUMMARY_BUCKET_LABELS,
	filterCommunityRequestsByCompletion,
	type DevlogSummary,
} from "../common/devlog";
import type { WeeklyDevlog } from "../scripts/changelog";
import type { DevlogRequest } from "../server/DevlogRequestRepository";
import { gameApiUrl } from "./navigation";
import { SessionStorage } from "./platform/SessionStorage";

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
const requestSearch = document.querySelector(
	"#request-search",
) as HTMLInputElement;
const futureRequests = document.querySelector(
	"#future-requests",
) as HTMLElement;
const requestFilters = document.querySelector(
	"#request-filters",
) as HTMLElement;
const requestEditModal = document.querySelector(
	"#request-edit-modal",
) as HTMLDialogElement;
const requestEditForm = document.querySelector(
	"#request-edit-form",
) as HTMLFormElement;
const requestEditStatus = document.querySelector(
	"#request-edit-status",
) as HTMLElement;
const sessionStorage = new SessionStorage();
let voteChoices = loadVoteChoices();
let requests: DevlogRequest[] = [];
let isModerator = false;
let completionFilter: CommunityRequestCompletionFilter = "all";
let ownershipFilter: "all" | "mine" | "others" = "all";
let selectedWeekKey = weeks.at(-1)?.key ?? "";
let editedRequest: DevlogRequest | undefined;

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

function renderSummary(summary: DevlogSummary | string): HTMLElement {
	const container = element("div", undefined, "devlog-summary");
	if (typeof summary === "string") {
		const paragraph = element("p", undefined, "legacy-summary");
		for (const part of summary.split(/(\n\n+|\n)/)) {
			if (/^\n\n+$/.test(part)) paragraph.append(element("hr"));
			else if (part === "\n") paragraph.append(element("br"));
			else if (part) paragraph.append(document.createTextNode(part));
		}
		container.append(paragraph);
		return container;
	}
	for (const bucket of DEVLOG_SUMMARY_BUCKETS) {
		const updates = summary[bucket];
		if (!updates?.length) continue;
		const section = element("section", undefined, "summary-section");
		const list = element("ul");
		list.append(...updates.map((update) => element("li", update)));
		section.append(element("h4", DEVLOG_SUMMARY_BUCKET_LABELS[bucket]), list);
		container.append(section);
	}
	return container;
}

function renderWeek(key: string, data: string | WeeklyDevlog): void {
	selectedWeekKey = key;
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
	const query = searchQuery();
	const periods = data.periods
		.map((period) => ({
			...period,
			summary: filterSummary(period.summary, query),
			commits: query
				? period.commits.filter((commit) =>
						matchesText(query, commit.title, commit.description ?? ""),
					)
				: period.commits,
		}))
		.filter(
			(period) =>
				!query ||
				hasSummaryContent(period.summary) ||
				period.commits.length > 0,
		);
	const articles = periods.map((period) => {
		const article = element("article");
		article.append(
			element("small", period.label),
			element("h3", period.summaryTitle),
			renderSummary(period.summary),
		);
		const tags = element("div", undefined, "tags");
		tags.append(
			...period.categories.map((category) => element("span", category)),
		);
		const details = element("details", undefined, "commit-details");
		details.open = Boolean(query);
		const commitCount = `${period.commits.length} source commit${period.commits.length === 1 ? "" : "s"}`;
		const list = element("ul");
		list.append(
			...period.commits.map((commit) => {
				const item = element("li", commit.title);
				if (commit.description)
					item.append(element("small", commit.description));
				return item;
			}),
		);
		details.append(element("summary", commitCount), list);
		article.append(tags);
		if (period.commits.length) article.append(details);
		return article;
	});
	weekNode.replaceChildren(heading, ...articles);
}

function filterSummary(
	summary: DevlogSummary | string,
	query: string,
): DevlogSummary | string {
	if (!query) return summary;
	if (typeof summary === "string")
		return matchesText(query, summary) ? summary : "";
	return {
		features: summary.features?.filter((feature) =>
			matchesText(query, feature),
		),
	};
}

function hasSummaryContent(summary: DevlogSummary | string): boolean {
	return typeof summary === "string"
		? Boolean(summary)
		: DEVLOG_SUMMARY_BUCKETS.some((bucket) => Boolean(summary[bucket]?.length));
}

function searchQuery(): string {
	return requestSearch.value.trim().toLocaleLowerCase();
}

function matchesText(query: string, ...values: string[]): boolean {
	return values.some((value) => value.toLocaleLowerCase().includes(query));
}

function weekMatchesSearch(
	data: string | WeeklyDevlog,
	query: string,
): boolean {
	if (!query || typeof data === "string") return !query;
	return data.periods.some(
		(period) =>
			(typeof period.summary === "string"
				? matchesText(query, period.summary)
				: period.summary.features?.some((feature) =>
						matchesText(query, feature),
					) === true) ||
			period.commits.some((commit) =>
				matchesText(query, commit.title, commit.description ?? ""),
			),
	);
}

function renderChangelogSearch(): void {
	const query = searchQuery();
	const matches = weeks.filter(({ data }) => weekMatchesSearch(data, query));
	for (const button of calendar.querySelectorAll<HTMLButtonElement>("button"))
		button.hidden = !matches.some(({ key }) => key === button.dataset.week);
	if (!matches.length) {
		weekNode.replaceChildren(
			element(
				"p",
				`No changelog entries match “${requestSearch.value.trim()}”.`,
				"muted",
			),
		);
		return;
	}
	const selected =
		matches.find(({ key }) => key === selectedWeekKey) ?? matches.at(-1)!;
	renderWeek(selected.key, selected.data);
}

function renderRequests(): void {
	const query = searchQuery();
	const completionMatches = filterCommunityRequestsByCompletion(
		requests,
		completionFilter,
	);
	const ownershipMatches = completionMatches.filter(
		(request) =>
			ownershipFilter === "all" ||
			(ownershipFilter === "mine") === request.ownedByViewer,
	);
	const visibleRequests = query
		? ownershipMatches.filter((request) =>
				`${request.title} ${request.description}`
					.toLocaleLowerCase()
					.includes(query),
			)
		: ownershipMatches;
	if (!visibleRequests.length) {
		const filtered = completionFilter !== "all" || ownershipFilter !== "all";
		futureRequests.replaceChildren(
			element(
				"p",
				query
					? `No requests match “${requestSearch.value.trim()}”.`
					: filtered
						? "No requests match the selected filter."
						: "No requests yet. Be the first to suggest one.",
				"muted",
			),
		);
		return;
	}
	const groups = new Map<string, DevlogRequest[]>();
	for (const request of visibleRequests)
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

requestSearch.addEventListener("input", () => {
	renderRequests();
	renderChangelogSearch();
});

requestFilters.addEventListener("click", (event) => {
	const button = (event.target as Element).closest<HTMLButtonElement>(
		"button[data-completion-filter], button[data-ownership-filter]",
	);
	if (!button || button.hidden) return;
	if (button.dataset.completionFilter)
		completionFilter = button.dataset
			.completionFilter as CommunityRequestCompletionFilter;
	if (button.dataset.ownershipFilter)
		ownershipFilter = button.dataset.ownershipFilter as typeof ownershipFilter;
	updateRequestFilters();
	renderRequests();
});

function updateRequestFilters(): void {
	for (const button of requestFilters.querySelectorAll<HTMLButtonElement>(
		"button[data-completion-filter]",
	)) {
		const filter = button.dataset
			.completionFilter as CommunityRequestCompletionFilter;
		button.hidden = filter === "completed" && !isModerator;
		button.setAttribute("aria-pressed", String(filter === completionFilter));
	}
	for (const button of requestFilters.querySelectorAll<HTMLButtonElement>(
		"button[data-ownership-filter]",
	)) {
		const filter = button.dataset.ownershipFilter as typeof ownershipFilter;
		button.disabled = !activeSession() && filter !== "all";
		button.setAttribute("aria-pressed", String(filter === ownershipFilter));
	}
}

function renderRequest(request: DevlogRequest): HTMLElement {
	const card = element("article", undefined, "request-card");
	const copy = element("div", undefined, "request-copy");
	const meta = element("div", undefined, "request-meta");
	meta.append(
		element(
			"span",
			COMMUNITY_REQUEST_KIND_LABELS[request.kind] ?? request.kind,
			`request-kind ${request.kind}`,
		),
		element("span", `Proposed by ${request.proposerName}`, "request-proposer"),
		element(
			"time",
			new Date(request.createdAt).toLocaleDateString(),
			"request-date",
		),
	);
	if (request.completed)
		meta.append(element("span", "Done with AI", "request-completed"));
	if (request.completed && (request.ownedByViewer || isModerator)) {
		meta.append(requireMoreWorkButton(request));
		if (isModerator) meta.append(deleteButton(request, true));
	} else if (request.ownedByViewer && !request.completed)
		meta.append(editButton(request), deleteButton(request, false));
	else if (isModerator) meta.append(deleteButton(request, true));
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
	const voterNames = element("small", undefined, "voter-names");
	voterNames.textContent = `Upvoted by ${request.upvoterNames.length ? request.upvoterNames.join(", ") : "no one"} · Downvoted by ${request.downvoterNames.length ? request.downvoterNames.join(", ") : "no one"}`;
	votes.append(voterNames);
	card.append(copy, votes);
	return card;
}

function requireMoreWorkButton(request: DevlogRequest): HTMLButtonElement {
	const button = element("button", "Require more work", "request-edit");
	button.type = "button";
	button.onclick = async () => {
		button.disabled = true;
		try {
			const response = await fetch(
				apiUrl(`/api/devlog/requests/${request.id}`),
				{
					method: "PATCH",
					headers: authenticatedHeaders(),
					body: JSON.stringify({ completed: false }),
				},
			);
			const result = (await response.json()) as {
				request?: DevlogRequest;
				error?: string;
			};
			if (!response.ok || !result.request)
				throw new Error(result.error ?? "Could not require more work.");
			requests = requests.map((entry) =>
				entry.id === result.request?.id ? result.request : entry,
			);
			renderRequests();
			openRequestEditModal(result.request);
		} catch (error) {
			requestStatus.textContent =
				error instanceof Error ? error.message : "Could not require more work.";
			requestStatus.className = "error";
			button.disabled = false;
		}
	};
	return button;
}

function deleteButton(
	request: DevlogRequest,
	moderator: boolean,
): HTMLButtonElement {
	const button = element("button", "Delete", "moderator-delete");
	button.type = "button";
	button.title = moderator
		? "Delete completed or refused request"
		: "Delete your pending request";
	button.onclick = async () => {
		if (!confirm(`Permanently delete “${request.title}”?`)) return;
		button.disabled = true;
		try {
			const response = await fetch(
				apiUrl(`/api/devlog/requests/${request.id}`),
				{ method: "DELETE", headers: authenticatedHeaders() },
			);
			const result = (await response.json()) as {
				deleted?: boolean;
				error?: string;
			};
			if (!response.ok || !result.deleted)
				throw new Error(result.error ?? "Deletion failed.");
			requests = requests.filter((entry) => entry.id !== request.id);
			delete voteChoices[request.id];
			localStorage.setItem(voteStorageKey(), JSON.stringify(voteChoices));
			requestStatus.textContent = "Request deleted.";
			requestStatus.className = "success";
			renderRequests();
		} catch (error) {
			requestStatus.textContent =
				error instanceof Error ? error.message : "Deletion failed.";
			requestStatus.className = "error";
			button.disabled = false;
		}
	};
	return button;
}

function editButton(request: DevlogRequest): HTMLButtonElement {
	const button = element("button", "Edit", "request-edit");
	button.type = "button";
	button.onclick = () => openRequestEditModal(request);
	return button;
}

function openRequestEditModal(request: DevlogRequest): void {
	editedRequest = request;
	(requestEditForm.elements.namedItem("kind") as HTMLSelectElement).value =
		request.kind;
	(requestEditForm.elements.namedItem("title") as HTMLInputElement).value =
		request.title;
	(
		requestEditForm.elements.namedItem("description") as HTMLTextAreaElement
	).value = request.description;
	requestEditStatus.textContent = "";
	requestEditStatus.className = "";
	requestEditModal.showModal();
}

function closeRequestEditModal(): void {
	editedRequest = undefined;
	requestEditModal.close();
}

for (const button of requestEditModal.querySelectorAll<HTMLButtonElement>(
	"[data-edit-cancel]",
))
	button.onclick = closeRequestEditModal;

requestEditModal.addEventListener("click", (event) => {
	if (event.target === requestEditModal) closeRequestEditModal();
});

requestEditForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	if (!editedRequest) return;
	const submit = requestEditForm.querySelector(
		"button[type=submit]",
	) as HTMLButtonElement;
	submit.disabled = true;
	requestEditStatus.textContent = "Saving…";
	requestEditStatus.className = "";
	const values = new FormData(requestEditForm);
	const requestId = editedRequest.id;
	try {
		const response = await fetch(apiUrl(`/api/devlog/requests/${requestId}`), {
			method: "PATCH",
			headers: authenticatedHeaders(),
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
			throw new Error(result.error ?? "Edit failed.");
		requests = requests.map((entry) =>
			entry.id === result.request?.id ? result.request : entry,
		);
		requestStatus.textContent = "Request updated.";
		requestStatus.className = "success";
		closeRequestEditModal();
		renderRequests();
	} catch (error) {
		requestEditStatus.textContent =
			error instanceof Error ? error.message : "Edit failed.";
		requestEditStatus.className = "error";
	} finally {
		submit.disabled = false;
	}
});

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
	button.disabled = !activeSession();
	if (!activeSession()) button.title = "Log in from the game to vote.";
	button.onclick = async () => {
		if (!activeSession()) return;
		const nextValue = voteChoices[request.id] === value ? 0 : value;
		button.disabled = true;
		try {
			const response = await fetch(
				apiUrl(`/api/devlog/requests/${request.id}/vote`),
				{
					method: "POST",
					headers: authenticatedHeaders(),
					body: JSON.stringify({ value: nextValue }),
				},
			);
			const result = (await response.json()) as {
				request?: DevlogRequest;
				error?: string;
			};
			if (!response.ok || !result.request)
				throw new Error(result.error ?? "Vote failed.");
			if (nextValue === 0) delete voteChoices[request.id];
			else voteChoices[request.id] = nextValue;
			localStorage.setItem(voteStorageKey(), JSON.stringify(voteChoices));
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
		if (!activeSession())
			throw new Error("Log in from the game to submit a request.");
		const values = new FormData(requestForm);
		const kind = values.get("kind");
		const response = await fetch(apiUrl("/api/devlog/requests"), {
			method: "POST",
			headers: authenticatedHeaders(),
			body: JSON.stringify({
				kind,
				title: values.get("title"),
				description: values.get("description"),
				environment: kind === "bug" ? bugEnvironment() : undefined,
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

function updateAuthenticationState(): void {
	const disabled = !activeSession();
	for (const field of requestForm.elements) {
		if (
			field instanceof HTMLInputElement ||
			field instanceof HTMLTextAreaElement ||
			field instanceof HTMLSelectElement ||
			field instanceof HTMLButtonElement
		)
			field.disabled = disabled;
	}
	requestStatus.textContent = disabled
		? "Log in from the game to submit requests or vote."
		: "";
	if (disabled) ownershipFilter = "all";
	updateRequestFilters();
}

updateAuthenticationState();
void loadRequests();
window.addEventListener("devlogopen", () => {
	voteChoices = loadVoteChoices();
	updateAuthenticationState();
	void loadRequests();
});

async function loadRequests(): Promise<void> {
	try {
		const response = await fetch(apiUrl("/api/devlog/requests"), {
			headers: authenticatedHeaders(),
		});
		const result = (await response.json()) as {
			requests?: DevlogRequest[];
			isModerator?: boolean;
			error?: string;
		};
		if (!response.ok || !result.requests)
			throw new Error(result.error ?? "Could not load requests.");
		requests = result.requests;
		voteChoices = Object.fromEntries(
			requests
				.filter((request) => request.viewerVote)
				.map((request) => [request.id, request.viewerVote!]),
		);
		localStorage.setItem(voteStorageKey(), JSON.stringify(voteChoices));
		isModerator = result.isModerator === true;
		if (!isModerator && completionFilter === "completed")
			completionFilter = "all";
		updateRequestFilters();
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

function authenticatedHeaders(): Record<string, string> {
	return {
		"content-type": "application/json",
		"x-hero-id": activeSession()?.heroId ?? "",
	};
}

function activeSession() {
	return sessionStorage.load();
}

function apiUrl(path: string): string {
	return gameApiUrl(window.location, path);
}

function bugEnvironment() {
	const userAgent = navigator.userAgent;
	const match = userAgent.match(/(Edg|Firefox|Chrome|Version)\/([\d.]+)/);
	const browser =
		match?.[1] === "Version" ? "Safari" : (match?.[1] ?? "Unknown");
	return {
		browser,
		version: match?.[2] ?? "Unknown",
		os: navigator.platform || "Unknown",
		resolution: `${Math.round(screen.width * devicePixelRatio)}×${Math.round(screen.height * devicePixelRatio)}`,
		devicePixelRatio: String(devicePixelRatio),
	};
}

function loadVoteChoices(): Record<string, -1 | 1> {
	try {
		return JSON.parse(localStorage.getItem(voteStorageKey()) ?? "{}") as Record<
			string,
			-1 | 1
		>;
	} catch {
		return {};
	}
}

function voteStorageKey(): string {
	return `multi-line-hero.devlog-votes.${activeSession()?.heroId ?? "anonymous"}`;
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
