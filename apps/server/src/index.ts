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
	await pg.migrate(fileURLToPath(new URL("../drizzle", import.meta.url)));
	store = pg;
} else {
	console.warn("DATABASE_URL not set: world state is kept in memory and lost on restart.");
	store = new MemoryStore();
}

const server = await startServer({ seed: env.worldSeed, port: env.port, host: env.host, store });
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
