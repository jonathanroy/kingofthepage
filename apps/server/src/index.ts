import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readEnv } from "./env";
import { MemoryStore } from "./persistence/memoryStore";
import { PgStore } from "./persistence/pgStore";
import type { WorldStore } from "./persistence/store";
import { startServer } from "./server";

const env = readEnv();

let store: WorldStore;
if (env.databaseUrl) {
	const pg = new PgStore(env.databaseUrl);
	// Before migrating: a newer schema must not appear under a server still running old code.
	await pg.acquireWorldLock(() =>
		console.log("Another game server holds this world; waiting for it to save and stop..."),
	);
	await pg.migrate(fileURLToPath(new URL("../drizzle", import.meta.url)));
	store = pg;
} else {
	console.warn("DATABASE_URL not set: world state is kept in memory and lost on restart.");
	store = new MemoryStore();
}

// In production the server also serves the built client, for hosts without nginx (Railway).
const clientDir = env.clientDir ?? fileURLToPath(new URL("../../client/dist", import.meta.url));
const serveClient = env.production && existsSync(clientDir);

const server = await startServer({
	seed: env.worldSeed,
	port: env.port,
	host: env.host,
	store,
	...(serveClient ? { clientDir } : {}),
});
if (serveClient) console.log(`Serving the client from ${clientDir}`);
console.log(`KOTP server on http://${env.host}:${server.port} (WebSocket at /ws)`);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		if (stopping) return;
		stopping = true;
		console.log(`${signal} received, saving world...`);
		server
			.stop()
			.then(() => process.exit(0))
			.catch((err) => {
				console.error(err);
				process.exit(1);
			});
	});
}
