import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { SQL } from "bun";

const databasePath = join(process.cwd(), "server-data", "players.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });
const database = new SQL(`sqlite://${databasePath}`);

try {
	await database`PRAGMA busy_timeout = 10000`;
	const tables = await database<Array<{ name: string }>>`
		SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'heroes'
	`;
	if (tables.length === 0) {
		console.log("Local hero database is already empty.");
	} else {
		const rows = await database<Array<{ count: number }>>`
			SELECT COUNT(*) AS count FROM heroes
		`;
		await database`BEGIN IMMEDIATE`;
		try {
			await database`DELETE FROM heroes`;
			await database`COMMIT`;
		} catch (error) {
			await database`ROLLBACK`;
			throw error;
		}
		await database`PRAGMA wal_checkpoint(TRUNCATE)`;
		const remaining = await database<Array<{ count: number }>>`
			SELECT COUNT(*) AS count FROM heroes
		`;
		if (Number(remaining[0]?.count ?? -1) !== 0)
			throw new Error("Local hero database reset verification failed.");
		console.log(
			`Reset local hero database: deleted ${Number(rows[0]?.count ?? 0)} hero(s).`,
		);
	}
} finally {
	await database.close();
}
