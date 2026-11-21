import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { NETWORK } from "@kotp/shared/rules";
import { Game } from "./game/game";
import { World } from "./game/world";
import { attachWebSocketServer } from "./net/wsServer";
import { isEmptyBatch, type WorldStore } from "./persistence/store";

export type RunningServer = {
	readonly http: Server;
	readonly game: Game;
	readonly world: World;
	readonly port: number;
	/** Persists pending changes and stops everything. */
	stop(): Promise<void>;
	/** Writes pending changes now. */
	flush(): Promise<void>;
};

export type StartOptions = {
	readonly seed: string;
	readonly port: number;
	/** Interface to bind; behind nginx this should be 127.0.0.1. */
	readonly host?: string;
	readonly store: WorldStore;
	readonly now?: () => number;
	readonly log?: (msg: string) => void;
};

export async function startServer(options: StartOptions): Promise<RunningServer> {
	const now = options.now ?? Date.now;
	const log = options.log ?? console.log;
	const random = Math.random;

	const world = new World({ seed: options.seed, random, newId: randomUUID });
	world.load(await options.store.load(), now());

	const game = new Game({
		world,
		seed: options.seed,
		now,
		random,
		newId: randomUUID,
		newToken: () => randomBytes(32).toString("base64url"),
		hashToken: (token) => createHash("sha256").update(token).digest("hex"),
	});

	const http = createServer((req, res) => {
		if (req.url === "/healthz") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true, online: game.onlineCount() }));
			return;
		}
		res.writeHead(200, { "content-type": "text/plain" });
		res.end("King of the Page server\n");
	});
	const wss = attachWebSocketServer(game, http);

	await new Promise<void>((resolve) => http.listen(options.port, options.host, resolve));
	const address = http.address();
	const port = typeof address === "object" && address ? address.port : options.port;

	const tickTimer = setInterval(() => game.tick(), 1000 / NETWORK.tickRateHz);

	let flushing: Promise<void> = Promise.resolve();
	const flush = (): Promise<void> => {
		// Chain flushes so batches reach the database in order.
		flushing = flushing.then(async () => {
			const batch = world.takeWriteBatch();
			if (isEmptyBatch(batch)) return;
			try {
				await options.store.write(batch);
			} catch (err) {
				log(`Persist failed, changes since last flush may be lost: ${String(err)}`);
			}
		});
		return flushing;
	};
	const persistTimer = setInterval(() => void flush(), NETWORK.persistIntervalMs);

	const stop = async (): Promise<void> => {
		clearInterval(tickTimer);
		clearInterval(persistTimer);
		for (const client of wss.clients) client.close(1001, "Server shutting down");
		wss.close();
		await new Promise<void>((resolve) => http.close(() => resolve()));
		await flush();
		await options.store.close();
	};

	return { http, game, world, port, stop, flush };
}
