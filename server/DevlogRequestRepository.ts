import { SQL } from "bun";

export type DevlogRequestKind = "feature" | "bug" | "balance";
export const MAX_DEVLOG_REQUEST_DESCRIPTION_LENGTH = 1_024;

export interface DevlogRequest {
	id: string;
	kind: DevlogRequestKind;
	title: string;
	description: string;
	scheduledMonth: string;
	createdAt: string;
	upvotes: number;
	downvotes: number;
	score: number;
	completed: boolean;
}

export interface DevlogRequestStore {
	list(): Promise<DevlogRequest[]>;
	create(input: {
		kind: DevlogRequestKind;
		title: string;
		description: string;
	}): Promise<DevlogRequest>;
	vote(
		id: string,
		voterId: string,
		value: -1 | 0 | 1,
	): Promise<DevlogRequest | undefined>;
	complete(id: string): Promise<DevlogRequest | undefined>;
	delete(id: string): Promise<boolean>;
	close?(): Promise<void>;
}

interface RequestRow {
	id: string;
	kind: DevlogRequestKind;
	title: string;
	description: string;
	scheduled_month: string;
	created_at: string;
	upvotes: number;
	downvotes: number;
	completed: boolean | number;
}

export class SqlDevlogRequestStore implements DevlogRequestStore {
	private constructor(private readonly sql: SQL) {}

	static async open(databaseUrl: string): Promise<SqlDevlogRequestStore> {
		const store = new SqlDevlogRequestStore(new SQL(databaseUrl));
		await store.initialize();
		return store;
	}

	async list(): Promise<DevlogRequest[]> {
		const rows = await this.rows();
		return rows.map(fromRow);
	}

	async create(input: {
		kind: DevlogRequestKind;
		title: string;
		description: string;
	}): Promise<DevlogRequest> {
		const id = crypto.randomUUID();
		const createdAt = new Date().toISOString();
		const scheduledMonth = nextUtcMonth(new Date(createdAt));
		await this.sql`
			INSERT INTO devlog_requests (id, kind, title, description, scheduled_month, created_at)
			VALUES (${id}, ${input.kind}, ${input.title}, ${input.description}, ${scheduledMonth}, ${createdAt})
		`;
		return {
			id,
			...input,
			scheduledMonth,
			createdAt,
			upvotes: 0,
			downvotes: 0,
			score: 0,
			completed: false,
		};
	}

	async vote(
		id: string,
		voterId: string,
		value: -1 | 0 | 1,
	): Promise<DevlogRequest | undefined> {
		const existing = await this.sql<Array<{ id: string }>>`
			SELECT id FROM devlog_requests WHERE id = ${id}
		`;
		if (!existing.length) return undefined;
		if (value === 0)
			await this.sql`
				DELETE FROM devlog_request_votes WHERE request_id = ${id} AND voter_id = ${voterId}
			`;
		else
			await this.sql`
				INSERT INTO devlog_request_votes (request_id, voter_id, value)
				VALUES (${id}, ${voterId}, ${value})
				ON CONFLICT (request_id, voter_id) DO UPDATE SET value = excluded.value
			`;
		const rows = await this.rows(id);
		return rows[0] ? fromRow(rows[0]) : undefined;
	}

	async complete(id: string): Promise<DevlogRequest | undefined> {
		await this.sql`
			UPDATE devlog_requests SET completed = TRUE
			WHERE id = ${id} AND kind = 'feature'
		`;
		const rows = await this.rows(id);
		return rows[0]?.kind === "feature" ? fromRow(rows[0]) : undefined;
	}

	async delete(id: string): Promise<boolean> {
		const existing = await this.sql<Array<{ id: string }>>`
			SELECT id FROM devlog_requests WHERE id = ${id}
		`;
		if (!existing.length) return false;
		await this.sql`DELETE FROM devlog_request_votes WHERE request_id = ${id}`;
		await this.sql`DELETE FROM devlog_requests WHERE id = ${id}`;
		return true;
	}

	async close(): Promise<void> {
		await this.sql.close();
	}

	private async initialize(): Promise<void> {
		await this.sql`
			CREATE TABLE IF NOT EXISTS devlog_requests (
				id TEXT PRIMARY KEY,
				kind TEXT NOT NULL,
				title TEXT NOT NULL,
				description TEXT NOT NULL,
				scheduled_month TEXT NOT NULL,
				created_at TEXT NOT NULL,
				completed BOOLEAN NOT NULL DEFAULT FALSE
			)
		`;
		await this.sql`
			CREATE TABLE IF NOT EXISTS devlog_request_votes (
				request_id TEXT NOT NULL REFERENCES devlog_requests(id) ON DELETE CASCADE,
				voter_id TEXT NOT NULL,
				value INTEGER NOT NULL,
				PRIMARY KEY (request_id, voter_id)
			)
		`;
		try {
			await this
				.sql`ALTER TABLE devlog_requests ADD COLUMN completed BOOLEAN NOT NULL DEFAULT FALSE`;
		} catch (error) {
			const message = String(error).toLowerCase();
			if (
				!message.includes("duplicate column") &&
				!message.includes("already exists")
			)
				throw error;
		}
		await this
			.sql`CREATE INDEX IF NOT EXISTS devlog_requests_month ON devlog_requests (scheduled_month)`;
	}

	private rows(id?: string): Promise<RequestRow[]> {
		const select = id
			? this.sql<RequestRow[]>`
				SELECT r.id, r.kind, r.title, r.description, r.scheduled_month, r.created_at, r.completed,
					COALESCE(SUM(CASE WHEN v.value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
					COALESCE(SUM(CASE WHEN v.value = -1 THEN 1 ELSE 0 END), 0) AS downvotes
				FROM devlog_requests r LEFT JOIN devlog_request_votes v ON v.request_id = r.id
				WHERE r.id = ${id}
				GROUP BY r.id, r.kind, r.title, r.description, r.scheduled_month, r.created_at, r.completed
			`
			: this.sql<RequestRow[]>`
				SELECT r.id, r.kind, r.title, r.description, r.scheduled_month, r.created_at, r.completed,
					COALESCE(SUM(CASE WHEN v.value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
					COALESCE(SUM(CASE WHEN v.value = -1 THEN 1 ELSE 0 END), 0) AS downvotes
				FROM devlog_requests r LEFT JOIN devlog_request_votes v ON v.request_id = r.id
				GROUP BY r.id, r.kind, r.title, r.description, r.scheduled_month, r.created_at, r.completed
				ORDER BY (COALESCE(SUM(CASE WHEN v.value = 1 THEN 1 ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN v.value = -1 THEN 1 ELSE 0 END), 0)) DESC, r.created_at ASC
			`;
		return select;
	}
}

export class InMemoryDevlogRequestStore implements DevlogRequestStore {
	private readonly requests = new Map<string, DevlogRequest>();
	private readonly votes = new Map<string, Map<string, -1 | 1>>();

	async list(): Promise<DevlogRequest[]> {
		return [...this.requests.values()].sort(
			(a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt),
		);
	}

	async create(input: {
		kind: DevlogRequestKind;
		title: string;
		description: string;
	}): Promise<DevlogRequest> {
		const createdAt = new Date().toISOString();
		const request: DevlogRequest = {
			id: crypto.randomUUID(),
			...input,
			scheduledMonth: nextUtcMonth(new Date(createdAt)),
			createdAt,
			upvotes: 0,
			downvotes: 0,
			score: 0,
			completed: false,
		};
		this.requests.set(request.id, request);
		return request;
	}

	async complete(id: string): Promise<DevlogRequest | undefined> {
		const request = this.requests.get(id);
		if (!request || request.kind !== "feature") return undefined;
		request.completed = true;
		return request;
	}

	async vote(
		id: string,
		voterId: string,
		value: -1 | 0 | 1,
	): Promise<DevlogRequest | undefined> {
		const request = this.requests.get(id);
		if (!request) return undefined;
		const votes = this.votes.get(id) ?? new Map<string, -1 | 1>();
		if (value === 0) votes.delete(voterId);
		else votes.set(voterId, value);
		this.votes.set(id, votes);
		request.upvotes = [...votes.values()].filter((vote) => vote === 1).length;
		request.downvotes = [...votes.values()].filter(
			(vote) => vote === -1,
		).length;
		request.score = request.upvotes - request.downvotes;
		return request;
	}

	async delete(id: string): Promise<boolean> {
		this.votes.delete(id);
		return this.requests.delete(id);
	}
}

function fromRow(row: RequestRow): DevlogRequest {
	const upvotes = Number(row.upvotes);
	const downvotes = Number(row.downvotes);
	return {
		id: row.id,
		kind: row.kind,
		title: row.title,
		description: row.description,
		scheduledMonth: row.scheduled_month,
		createdAt: row.created_at,
		upvotes,
		downvotes,
		score: upvotes - downvotes,
		completed: row.completed === true || Number(row.completed) === 1,
	};
}

export function nextUtcMonth(now: Date): string {
	const date = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
	);
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
