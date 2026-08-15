import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { extname, join, normalize } from "node:path";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { BALANCE } from "../common/balance.ts";
import {
	type PlayerId,
	parseClientMessage,
	type ServerMessage,
} from "../common/protocol.ts";
import { systemRandom } from "../common/random.ts";
import {
	type DevlogRequestKind,
	type DevlogRequestStore,
	InMemoryDevlogRequestStore,
	MAX_DEVLOG_REQUEST_DESCRIPTION_LENGTH,
	SqlDevlogRequestStore,
} from "./DevlogRequestRepository.ts";
import type { PlayerRepository } from "./domain.ts";
import { InMemoryPlayerRepository } from "./domain.ts";
import { GameService } from "./GameService.ts";
import { SqlPlayerRepository } from "./SqlPlayerRepository.ts";

export { MAX_DEVLOG_REQUEST_DESCRIPTION_LENGTH } from "./DevlogRequestRepository.ts";

interface PlayerSocket extends WebSocket {
	playerId?: PlayerId;
	lastSeen: number;
	commandChain: Promise<void>;
}
export interface AppOptions {
	root: string;
	databaseUrl?: string | false;
	devlogRequestStore?: DevlogRequestStore;
}
const PERSIST_INTERVAL_MS = 60_000;
export const RESTART_COUNTDOWN_MS = 30_000;
export const RESTART_NOTICE =
	"Server restart in 30 seconds. You will be disconnected when the restart begins.";

export async function createApp(options: AppOptions) {
	const publicRoot = existsSync(join(options.root, "dist"))
		? join(options.root, "dist")
		: options.root;
	const sockets = new Map<string, PlayerSocket>();
	let closing = false;
	let closePromise: Promise<void> | undefined;
	let restartPromise: Promise<void> | undefined;
	let repository: PlayerRepository;
	let devlogRequests: DevlogRequestStore;
	if (options.databaseUrl === false)
		repository = new InMemoryPlayerRepository();
	else {
		const databaseUrl =
			options.databaseUrl ??
			`sqlite://${join(options.root, "server-data", "players.sqlite")}`;
		if (databaseUrl.startsWith("sqlite:") || databaseUrl.startsWith("file:"))
			mkdirSync(join(options.root, "server-data"), { recursive: true });
		repository = await SqlPlayerRepository.open(databaseUrl);
	}
	if (options.devlogRequestStore) devlogRequests = options.devlogRequestStore;
	else if (options.databaseUrl === false)
		devlogRequests = new InMemoryDevlogRequestStore();
	else {
		const databaseUrl =
			options.databaseUrl ??
			`sqlite://${join(options.root, "server-data", "players.sqlite")}`;
		devlogRequests = await SqlDevlogRequestStore.open(databaseUrl);
	}
	const sendToPlayer = (playerId: PlayerId, message: ServerMessage) => {
		for (const socket of sockets.values())
			if (socket.playerId === playerId && socket.readyState === WebSocket.OPEN)
				socket.send(JSON.stringify(message));
	};
	const game = new GameService({
		repository,
		balance: BALANCE,
		random: systemRandom,
		send: sendToPlayer,
		logPlayerLifecycle: (event, player) =>
			console.log(
				`[MLH][player] ${event} id=${player.id} name=${JSON.stringify(player.name)}`,
			),
		logRealmLifecycle: (event, playerId, realmId, opponentIds) =>
			console.log(
				`[MLH][realm] ${event} id=${playerId} realm=${realmId} opponents=${opponentIds.join(",")}`,
			),
	});
	const broadcastLeaderboard = () => {
		const message = JSON.stringify({
			type: "leaderboard",
			heroes: game.leaderboard(),
			onlineCount: game.onlinePlayerCount(),
		} satisfies ServerMessage);
		for (const socket of sockets.values())
			if (socket.readyState === WebSocket.OPEN) socket.send(message);
	};
	const server = createServer((request, response) => {
		void serveRequest(
			request,
			response,
			publicRoot,
			devlogRequests,
			(playerId) =>
				hasSocket(sockets, playerId)
					? (repository.get(playerId)?.accountId ?? false)
					: false,
			(playerId) => repository.get(playerId)?.isModerator === true,
			(accountId) => repository.getAccountPlayers(accountId)[0]?.accountName,
		).catch((error) => {
			console.error(
				"[MLH][devlog] request failed",
				error instanceof Error ? error.message : error,
			);
			if (!response.headersSent)
				json(response, 500, { error: "The request could not be completed." });
			else response.end();
		});
	});
	const wss = new WebSocketServer({ server, path: "/ws" });
	wss.on("connection", (socket: PlayerSocket) => {
		if (closing) {
			socket.close(1012, "Server shutting down");
			return;
		}
		const connectionId = crypto.randomUUID();
		socket.lastSeen = Date.now();
		socket.commandChain = Promise.resolve();
		sockets.set(connectionId, socket);
		socket.on("pong", () => {
			socket.lastSeen = Date.now();
		});
		socket.on("message", (raw: RawData) => {
			if (closing) return;
			socket.lastSeen = Date.now();
			socket.commandChain = socket.commandChain
				.then(async () => {
					const message = decode(raw);
					if (!message)
						return sendSocket(socket, {
							type: "serverNotice",
							message: "Ignored invalid message.",
							tone: "error",
						});
					if (message.type === "listHeroes")
						return sendLeaderboard(socket, game);
					if (message.type === "inspectHero") {
						const hero = game.publicHeroProfile(message.heroId);
						return hero
							? sendSocket(socket, { type: "heroProfile", hero })
							: sendSocket(socket, {
									type: "serverNotice",
									message: "That hero is unavailable.",
									tone: "error",
								});
					}
					if (message.type === "join") {
						const existing = game.findPlayer(message.heroId, message.name);
						if (
							existing &&
							repository
								.getAccountPlayers(existing.accountId)
								.some((hero) => hero.connected)
						)
							return sendSocket(socket, {
								type: "serverNotice",
								message: "That username is already logged in.",
								tone: "error",
							});
						if (message.name && !message.password)
							return sendSocket(socket, {
								type: "authenticationRequired",
								username: existing?.name ?? message.name.trim(),
								mode: existing?.passwordHash ? "login" : "create",
							});
						if (
							message.name &&
							existing?.passwordHash &&
							!(await Bun.password.verify(
								message.password!,
								existing.passwordHash,
							))
						)
							return sendSocket(socket, {
								type: "serverNotice",
								message: "Incorrect password.",
								tone: "error",
							});
						const needsPassword = message.name && !existing?.passwordHash;
						if (
							needsPassword &&
							message.password !== message.passwordConfirmation
						)
							return sendSocket(socket, {
								type: "serverNotice",
								message: "Passwords do not match.",
								tone: "error",
							});
						const newPasswordHash = needsPassword
							? await Bun.password.hash(message.password!)
							: undefined;
						try {
							const player = game.join(
								message.name ?? "",
								message.heroId,
								(playerId, identified) => {
									socket.playerId = playerId;
									if (newPasswordHash)
										identified.passwordHash = newPasswordHash;
								},
							);
							if (newPasswordHash) {
								repository.markDirty(player.id);
								await repository.persist();
							}
							broadcastLeaderboard();
						} catch {
							sendSocket(socket, {
								type: "serverNotice",
								message: message.heroId
									? "That hero is unavailable."
									: "Username must use 1-20 letters, digits, underscores, or hyphens.",
								tone: "error",
							});
						}
						return;
					}
					if (
						message.type === "createCharacter" ||
						message.type === "switchCharacter"
					) {
						const current = socket.playerId
							? repository.get(socket.playerId)
							: undefined;
						if (!current)
							return sendSocket(socket, {
								type: "serverNotice",
								message: "Join before choosing a character.",
								tone: "error",
							});
						try {
							const target =
								message.type === "createCharacter"
									? game.createCharacter(current, message.name)
									: repository.get(message.heroId);
							if (!target || target.accountId !== current.accountId)
								throw new Error("That character is unavailable.");
							if (target.id === current.id) return;
							game.logout(current.id);
							socket.playerId = undefined;
							game.join("", target.id, (playerId) => {
								socket.playerId = playerId;
							});
							broadcastLeaderboard();
						} catch (error) {
							sendSocket(socket, {
								type: "serverNotice",
								message:
									error instanceof Error
										? error.message
										: "Unable to select that character.",
								tone: "error",
							});
						}
						return;
					}
					if (message.type === "logout") {
						if (socket.playerId) {
							game.logout(socket.playerId);
							socket.playerId = undefined;
						}
						sendSocket(socket, { type: "loggedOut" });
						return broadcastLeaderboard();
					}
					if (message.type === "changePassword") {
						const current = socket.playerId
							? repository.get(socket.playerId)
							: undefined;
						if (!current)
							return sendSocket(socket, {
								type: "serverNotice",
								message: "Join before changing your password.",
								tone: "error",
							});
						if (message.password !== message.passwordConfirmation)
							return sendSocket(socket, {
								type: "serverNotice",
								message: "Passwords do not match.",
								tone: "error",
							});
						await changeAccountPassword(repository, current, message.password);
						return sendSocket(socket, {
							type: "serverNotice",
							message: "Password changed.",
							tone: "success",
						});
					}
					if (!socket.playerId)
						return sendSocket(socket, {
							type: "serverNotice",
							message: "Join before playing.",
							tone: "error",
						});
					game.handle(socket.playerId, message);
				})
				.catch((error) => {
					console.error(
						"[MLH][database] command failed",
						error instanceof Error ? error.message : error,
					);
					sendSocket(socket, {
						type: "serverNotice",
						message: "The server could not save that change.",
						tone: "error",
					});
				});
		});
		socket.on("close", () => {
			sockets.delete(connectionId);
			if (socket.playerId && !hasSocket(sockets, socket.playerId)) {
				game.disconnect(socket.playerId);
				broadcastLeaderboard();
			}
		});
	});
	const waveTimer = setInterval(
		() => game.dispatchWaves(),
		BALANCE.wave.intervalMs,
	);
	waveTimer.unref();
	const persistTimer = setInterval(() => {
		void Promise.resolve(repository.persist()).catch((error) =>
			console.error(
				"[MLH][database] periodic persist failed",
				error instanceof Error ? error.message : error,
			),
		);
	}, PERSIST_INTERVAL_MS);
	persistTimer.unref();
	const heartbeat = setInterval(() => {
		const now = Date.now();
		for (const socket of sockets.values()) {
			if (now - socket.lastSeen >= 300_000) socket.terminate();
			else if (socket.readyState === WebSocket.OPEN) socket.ping();
		}
	}, 30_000);
	heartbeat.unref();
	const realmStateTimer = setInterval(() => game.refreshRealmStates(), 1_000);
	realmStateTimer.unref();
	const close = (): Promise<void> =>
		(closePromise ??= (async () => {
			closing = true;
			clearInterval(waveTimer);
			clearInterval(persistTimer);
			clearInterval(heartbeat);
			clearInterval(realmStateTimer);
			wss.close();
			for (const socket of sockets.values())
				if (
					socket.readyState === WebSocket.OPEN ||
					socket.readyState === WebSocket.CONNECTING
				)
					socket.close(1012, "Server shutting down");
			await Promise.all(
				[...sockets.values()].map((socket) => socket.commandChain),
			);
			await repository.persist();
			await repository.close?.();
			await devlogRequests.close?.();
			for (const socket of sockets.values()) socket.terminate();
			await closeServer(server);
		})());
	const restart = (countdownMs = RESTART_COUNTDOWN_MS): Promise<void> =>
		(restartPromise ??= (async () => {
			broadcastRestartNotice(sockets.values());
			await new Promise<void>((resolve) => setTimeout(resolve, countdownMs));
			await close();
		})());
	return { server, game, repository, devlogRequests, close, restart };
}

export async function changeAccountPassword(
	repository: PlayerRepository,
	current: NonNullable<ReturnType<PlayerRepository["get"]>>,
	password: string,
): Promise<void> {
	const passwordHash = await Bun.password.hash(password);
	for (const player of repository.getAccountPlayers(current.accountId)) {
		player.passwordHash = passwordHash;
		repository.markDirty(player.id);
	}
	await repository.persist();
}

export function broadcastRestartNotice(
	sockets: Iterable<Pick<PlayerSocket, "playerId" | "readyState" | "send">>,
): void {
	for (const socket of sockets)
		if (socket.playerId && socket.readyState === WebSocket.OPEN)
			socket.send(
				JSON.stringify({
					type: "chatMessage",
					senderId: "",
					senderName: "",
					text: RESTART_NOTICE,
					kind: "system",
				} satisfies ServerMessage),
			);
}

function sendSocket(socket: PlayerSocket, message: ServerMessage): void {
	if (socket.readyState === WebSocket.OPEN)
		socket.send(JSON.stringify(message));
}
function sendLeaderboard(socket: PlayerSocket, game: GameService): void {
	sendSocket(socket, {
		type: "leaderboard",
		heroes: game.leaderboard(),
		onlineCount: game.onlinePlayerCount(),
	});
}
export function broadcastAnonymousLeaderboard(
	sockets: Iterable<Pick<PlayerSocket, "playerId" | "readyState" | "send">>,
	game: GameService,
): void {
	for (const socket of sockets)
		if (!socket.playerId && socket.readyState === WebSocket.OPEN)
			socket.send(
				JSON.stringify({
					type: "leaderboard",
					heroes: game.leaderboard(),
					onlineCount: game.onlinePlayerCount(),
				} satisfies ServerMessage),
			);
}

function decode(raw: RawData) {
	try {
		return parseClientMessage(JSON.parse(String(raw)));
	} catch {
		return undefined;
	}
}
function hasSocket(
	sockets: Map<string, PlayerSocket>,
	playerId: PlayerId,
): boolean {
	return [...sockets.values()].some(
		(socket) =>
			socket.playerId === playerId && socket.readyState === WebSocket.OPEN,
	);
}
function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
	return new Promise((resolve, reject) => {
		if (!server.listening) {
			resolve();
			return;
		}
		server.close((error) => (error ? reject(error) : resolve()));
	});
}
async function serveRequest(
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
						"Choose feature, bug, or balance, use a 3-100 character title, and a 10-1024 character description.",
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
	return value === "feature" || value === "bug" || value === "balance";
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

function json(
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
