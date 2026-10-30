import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { BALANCE } from "../common/balance.ts";
import {
	type PlayerId,
	parseClientMessage,
	type ServerMessage,
} from "../common/protocol.ts";
import { systemRandom } from "../common/random.ts";
import {
	type DevlogRequestStore,
	InMemoryDevlogRequestStore,
	SqlDevlogRequestStore,
} from "./DevlogRequestRepository.ts";
import type { PlayerRepository } from "./domain.ts";
import { InMemoryPlayerRepository } from "./domain.ts";
import { GameService } from "./GameService.ts";
import { json, serveRequest } from "./httpRouter.ts";
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
