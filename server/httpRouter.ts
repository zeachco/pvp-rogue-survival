import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import type { PlayerId } from "../common/protocol.ts";
import type {
	DevlogRequestKind,
	DevlogRequestStore,
} from "./DevlogRequestRepository.ts";
import { MAX_DEVLOG_REQUEST_DESCRIPTION_LENGTH } from "./DevlogRequestRepository.ts";

export async function serveRequest(
	request: IncomingMessage,
	response: ServerResponse,
	publicRoot: string,
	devlogRequests: DevlogRequestStore,
	isActiveAccount: (playerId: PlayerId) => boolean | PlayerId,
	isModerator: (playerId: PlayerId) => boolean,
	accountName: (accountId: PlayerId) => string | undefined,
): Promise<void> {
	const url = new URL(
		request.url ?? "/",
		`http://${request.headers.host ?? "localhost"}`,
	);
	if (url.pathname.startsWith("/api/")) {
		const origin = request.headers.origin;
		if (origin && isLocalDevelopmentOrigin(origin)) {
			response.setHeader("access-control-allow-origin", origin);
			response.setHeader("vary", "Origin");
			response.setHeader(
				"access-control-allow-headers",
				"content-type, x-hero-id",
			);
			response.setHeader(
				"access-control-allow-methods",
				"GET, POST, PATCH, DELETE, OPTIONS",
			);
		}
		if (request.method === "OPTIONS") {
			response.writeHead(204);
			response.end();
			return;
		}
	}
	if (url.pathname === "/api/devlog/requests") {
		if (request.method === "GET") {
			const accountId = activeAccountId(request, isActiveAccount);
			json(response, 200, {
				requests: (await devlogRequests.list()).map((entry) =>
					publicRequest(entry, accountId),
				),
				isModerator: Boolean(accountId && isModerator(accountId)),
			});
			return;
		}
		if (request.method === "POST") {
			const accountId = activeAccountId(request, isActiveAccount);
			if (!accountId) {
				json(response, 401, { error: "Log in to submit a request." });
				return;
			}
			const input = await readJson(request);
			const validated = parseDevlogRequestInput(input);
			if (!validated) {
				json(response, 400, {
					error:
						"Choose feature, bug, balance, or graphics, use a 3-100 character title, and a 10-1024 character description.",
				});
				return;
			}
			json(response, 201, {
				request: publicRequest(
					await devlogRequests.create({
						...validated,
						proposerId: accountId,
						proposerName: accountName(accountId) ?? "Unknown player",
					}),
					accountId,
				),
			});
			return;
		}
		methodNotAllowed(response, "GET, POST");
		return;
	}
	const deleteMatch = url.pathname.match(
		/^\/api\/devlog\/requests\/([0-9a-f-]+)$/i,
	);
	if (deleteMatch) {
		if (request.method !== "DELETE" && request.method !== "PATCH") {
			methodNotAllowed(response, "PATCH, DELETE");
			return;
		}
		if (request.method === "PATCH") {
			const input = await readJson(request);
			if (input?.completed === true) {
				const completed = await devlogRequests.complete(deleteMatch[1]);
				if (!completed) {
					json(response, 404, { error: "Community request not found." });
					return;
				}
				json(response, 200, { request: publicRequest(completed) });
				return;
			}
			const accountId = activeAccountId(request, isActiveAccount);
			if (!accountId) {
				json(response, 401, { error: "Log in to edit a request." });
				return;
			}
			if (input?.completed === false) {
				const reopened = await devlogRequests.requireMoreWork(
					deleteMatch[1],
					accountId,
					isModerator(accountId),
				);
				if (!reopened) {
					json(response, 403, {
						error: "Only the proposer or a moderator can require more work.",
					});
					return;
				}
				json(response, 200, { request: publicRequest(reopened, accountId) });
				return;
			}
			const validated = parseDevlogRequestInput(input, false);
			if (!validated) {
				json(response, 400, {
					error: "Use a valid request type, title, and description.",
				});
				return;
			}
			const updated = await devlogRequests.update(
				deleteMatch[1],
				accountId,
				validated,
				isModerator(accountId),
			);
			if (!updated) {
				json(response, 403, {
					error: "Only the proposer can edit a pending request.",
				});
				return;
			}
			json(response, 200, { request: publicRequest(updated, accountId) });
			return;
		}
		const accountId = activeAccountId(request, isActiveAccount);
		if (!accountId) {
			json(response, 401, { error: "Log in to delete a request." });
			return;
		}
		const existing = (await devlogRequests.list()).find(
			(entry) => entry.id === deleteMatch[1],
		);
		const moderator = isModerator(accountId);
		if (
			!existing ||
			(!moderator && (existing.proposerId !== accountId || existing.completed))
		) {
			json(response, existing ? 403 : 404, {
				error: existing
					? "Only the proposer can delete their pending request."
					: "Request not found.",
			});
			return;
		}
		if (!(await devlogRequests.delete(deleteMatch[1]))) {
			json(response, 404, { error: "Request not found." });
			return;
		}
		json(response, 200, { deleted: true });
		return;
	}
	const voteMatch = url.pathname.match(
		/^\/api\/devlog\/requests\/([0-9a-f-]+)\/vote$/i,
	);
	if (voteMatch) {
		if (request.method !== "POST") {
			methodNotAllowed(response, "POST");
			return;
		}
		const accountId = activeAccountId(request, isActiveAccount);
		if (!accountId) {
			json(response, 401, { error: "Log in to vote." });
			return;
		}
		const input = await readJson(request);
		const value = input?.value;
		if (value !== -1 && value !== 0 && value !== 1) {
			json(response, 400, { error: "Invalid vote." });
			return;
		}
		const updated = await devlogRequests.vote(
			voteMatch[1],
			accountId,
			accountName(accountId) ?? "Unknown player",
			value,
		);
		if (!updated) {
			json(response, 404, { error: "Request not found." });
			return;
		}
		json(response, 200, { request: publicRequest(updated, accountId) });
		return;
	}
	if (url.pathname.startsWith("/api/")) {
		json(response, 404, { error: "Not found." });
		return;
	}
	const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
	const filePath = normalize(join(publicRoot, pathname));
	if (!filePath.startsWith(publicRoot)) {
		response.writeHead(403);
		response.end("Forbidden");
		return;
	}
	try {
		const body = await readFile(filePath);
		response.writeHead(200, { "content-type": contentType(filePath) });
		response.end(body);
	} catch {
		const index = await readFile(join(publicRoot, "index.html"));
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(index);
	}
}

function publicRequest(
	request: import("./DevlogRequestRepository.ts").DevlogRequest,
	viewerId?: PlayerId,
) {
	const { proposerId, upvoterIds, downvoterIds, ...visible } = request;
	return {
		...visible,
		ownedByViewer: Boolean(viewerId && proposerId === viewerId),
		viewerVote: viewerId
			? upvoterIds?.includes(viewerId)
				? 1
				: downvoterIds?.includes(viewerId)
					? -1
					: undefined
			: undefined,
	};
}

export function isLocalDevelopmentOrigin(origin: string): boolean {
	try {
		const url = new URL(origin);
		return (
			["http:", "https:"].includes(url.protocol) &&
			["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
		);
	} catch {
		return false;
	}
}

export function activeAccountId(
	request: Pick<IncomingMessage, "headers">,
	isActiveAccount: (playerId: PlayerId) => boolean | PlayerId,
): PlayerId | undefined {
	const value = request.headers["x-hero-id"];
	const playerId = (Array.isArray(value) ? value[0] : value)?.trim();
	if (!playerId) return undefined;
	const active = isActiveAccount(playerId);
	return typeof active === "string" ? active : active ? playerId : undefined;
}

export function activeModeratorAccountId(
	request: Pick<IncomingMessage, "headers">,
	isActiveAccount: (playerId: PlayerId) => boolean | PlayerId,
	isModerator: (playerId: PlayerId) => boolean,
): PlayerId | undefined {
	const accountId = activeAccountId(request, isActiveAccount);
	return accountId && isModerator(accountId) ? accountId : undefined;
}

async function readJson(
	request: IncomingMessage,
): Promise<Record<string, unknown> | undefined> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > 8_192) throw new Error("Request body is too large.");
		chunks.push(buffer);
	}
	try {
		const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		return value && typeof value === "object"
			? (value as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function isRequestKind(value: unknown): value is DevlogRequestKind {
	return (
		value === "feature" ||
		value === "bug" ||
		value === "balance" ||
		value === "graphics"
	);
}

export function parseDevlogRequestInput(
	input: Record<string, unknown> | undefined,
	appendBugEnvironment = true,
): { kind: DevlogRequestKind; title: string; description: string } | undefined {
	const kind = input?.kind;
	const title = typeof input?.title === "string" ? input.title.trim() : "";
	const description =
		typeof input?.description === "string" ? input.description.trim() : "";
	if (
		!isRequestKind(kind) ||
		title.length < 3 ||
		title.length > 100 ||
		description.length < 10 ||
		description.length > MAX_DEVLOG_REQUEST_DESCRIPTION_LENGTH
	)
		return undefined;
	if (kind !== "bug" || !appendBugEnvironment)
		return { kind, title, description };
	const environment = parseBugEnvironment(input?.environment);
	if (!environment) return undefined;
	const storedDescription = `${description}\n\nEnvironment\nBrowser: ${environment.browser} ${environment.version}\nOS: ${environment.os}\nScreen: ${environment.resolution} physical pixels (DPR ${environment.devicePixelRatio})`;
	if (storedDescription.length > MAX_DEVLOG_REQUEST_DESCRIPTION_LENGTH)
		return undefined;
	return {
		kind,
		title,
		description: storedDescription,
	};
}

function parseBugEnvironment(value: unknown) {
	if (!value || typeof value !== "object") return undefined;
	const input = value as Record<string, unknown>;
	const browser = cleanEnvironmentValue(input.browser, 40);
	const version = cleanEnvironmentValue(input.version, 40);
	const os = cleanEnvironmentValue(input.os, 80);
	const resolution = cleanEnvironmentValue(input.resolution, 30);
	const devicePixelRatio = cleanEnvironmentValue(input.devicePixelRatio, 12);
	if (
		!browser ||
		!version ||
		!os ||
		!/^\d+×\d+$/.test(resolution ?? "") ||
		!devicePixelRatio
	)
		return undefined;
	return { browser, version, os, resolution: resolution!, devicePixelRatio };
}

function cleanEnvironmentValue(value: unknown, maximum: number) {
	if (typeof value !== "string") return undefined;
	const cleaned = value.trim().replace(/[\r\n]+/g, " ");
	return cleaned && cleaned.length <= maximum ? cleaned : undefined;
}

export function json(
	response: ServerResponse,
	status: number,
	body: Record<string, unknown>,
): void {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	response.end(JSON.stringify(body));
}

function methodNotAllowed(response: ServerResponse, allow: string): void {
	response.setHeader("allow", allow);
	json(response, 405, { error: "Method not allowed." });
}
function contentType(filePath: string): string {
	const extension = extname(filePath);
	if (extension === ".html") return "text/html; charset=utf-8";
	if (extension === ".js") return "text/javascript; charset=utf-8";
	if (extension === ".css") return "text/css; charset=utf-8";
	if (extension === ".svg") return "image/svg+xml";
	return "application/octet-stream";
}
