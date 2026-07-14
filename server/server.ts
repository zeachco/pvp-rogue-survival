import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { BalanceProfileId } from "../common/balance.ts";
import { createApp } from "./createApp.ts";

const root = normalize(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const defaultProfile: BalanceProfileId = process.env.NODE_ENV === "production" ? "normal" : "dev";
const profile: BalanceProfileId = process.env.BALANCE_PROFILE === "normal" || process.env.BALANCE_PROFILE === "dev" ? process.env.BALANCE_PROFILE : defaultProfile;
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl && !/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw new Error("DATABASE_URL must be a PostgreSQL connection string when configured.");
const app = await createApp({ root, balanceProfile: profile, databaseUrl });

app.server.listen(port, host, () => console.log(`Multi-Line Hero server listening on http://${host}:${port} (${profile} balance)`));
