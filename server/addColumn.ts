import type { SQL } from "bun";

export async function addColumnIfMissing(
	sql: SQL,
	table: string,
	definition: string,
): Promise<void> {
	try {
		await sql.unsafe(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
	} catch (error) {
		const message = String(error).toLowerCase();
		if (
			!message.includes("duplicate column") &&
			!message.includes("already exists")
		)
			throw error;
	}
}
