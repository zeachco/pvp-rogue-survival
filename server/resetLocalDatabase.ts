import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { SQL } from "bun";

const databasePath = join(process.cwd(), "server-data", "players.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });
const database = new SQL(`sqlite://${databasePath}`);

try {
	const tables = await database<Array<{ name: string }>>`
		SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'heroes'
	`;
	if (tables.length === 0) {
		console.log("Local hero database is already empty.");
	} else {
		const rows = await database<Array<{ count: number }>>`
			SELECT COUNT(*) AS count FROM heroes
		`;
		await database`DELETE FROM heroes`;
		console.log(
			`Reset local hero database: deleted ${Number(rows[0]?.count ?? 0)} hero(s).`,
		);
	}
} finally {
	await database.close();
}
