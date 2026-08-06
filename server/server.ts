import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./createApp.ts";

const root = normalize(
	join(fileURLToPath(new URL(".", import.meta.url)), ".."),
);
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl && !/^postgres(?:ql)?:\/\//.test(databaseUrl))
	throw new Error(
		"DATABASE_URL must be a PostgreSQL connection string when configured.",
	);
const app = await createApp({ root, databaseUrl });
let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals, restart = false) => {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(
		restart
			? `[MLH][server] ${signal} received; restarting in 30 seconds.`
			: `[MLH][server] ${signal} received; flushing player state.`,
	);
	try {
		if (restart) await app.restart();
		else await app.close();
		process.exit(0);
	} catch (error) {
		console.error(
			"[MLH][server] shutdown failed",
			error instanceof Error ? error.message : error,
		);
		process.exit(1);
	}
};
process.on("SIGINT", () => {
	void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
	void shutdown("SIGTERM", true);
});

app.server.listen(port, host, () =>
	console.log(`Multi-Line Hero server listening on http://${host}:${port}`),
);
