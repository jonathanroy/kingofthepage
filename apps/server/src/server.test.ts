import {
	decodeServerMessage,
	encodeClientMessage,
	type ServerMessage,
} from "@kotp/shared/protocol";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { MemoryStore } from "./persistence/memoryStore";
import { type RunningServer, startServer } from "./server";

type Conn = {
	ws: WebSocket;
	next<T extends ServerMessage["type"]>(type: T): Promise<Extract<ServerMessage, { type: T }>>;
};

function connect(port: number): Promise<Conn> {
	const ws = new WebSocket(`ws://localhost:${port}/ws`);
	const received: ServerMessage[] = [];
	const waiters: (() => void)[] = [];
	ws.on("message", (data) => {
		received.push(decodeServerMessage(data.toString()));
		for (const w of waiters.splice(0)) w();
	});
	const next = <T extends ServerMessage["type"]>(type: T) =>
		new Promise<Extract<ServerMessage, { type: T }>>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 2000);
			const check = () => {
				const i = received.findIndex((m) => m.type === type);
				if (i >= 0) {
					clearTimeout(timeout);
					resolve(received.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>);
				} else waiters.push(check);
			};
			check();
		});
	return new Promise((resolve, reject) => {
		ws.on("open", () => resolve({ ws, next }));
		ws.on("error", reject);
	});
}

describe("server over WebSocket", () => {
	let server: RunningServer | undefined;
	afterEach(async () => {
		await server?.stop();
		server = undefined;
	});

	it("joins, moves, survives garbage input, and persists on shutdown", async () => {
		const store = new MemoryStore();
		server = await startServer({ seed: "itest", port: 0, store, log: () => {} });
		const c = await connect(server.port);

		const hello = await c.next("hello");
		expect(hello.worldSeed).toBe("itest");

		c.ws.send("{not json");
		c.ws.send(JSON.stringify({ type: "teleport", x: 0, y: 0 }));
		c.ws.send(encodeClientMessage({ type: "join", handle: "Tester" }));
		const joined = await c.next("joined");
		expect(joined.you.handle).toBe("Tester");

		c.ws.send(encodeClientMessage({ type: "move", dir: "up", seq: 1 }));
		const moved = await c.next("moved");
		expect(moved.seq).toBe(1);
		expect(moved.facing).toBe("up");

		c.ws.close();
		await server.stop();
		server = undefined;
		expect([...store.players.values()].map((p) => p.handle)).toEqual(["Tester"]);
	});

	it("resumes with the token after reconnecting", async () => {
		server = await startServer({ seed: "itest", port: 0, store: new MemoryStore(), log: () => {} });
		const first = await connect(server.port);
		first.ws.send(encodeClientMessage({ type: "join", handle: "Tester" }));
		const joined = await first.next("joined");
		first.ws.close();

		const second = await connect(server.port);
		second.ws.send(encodeClientMessage({ type: "resume", token: joined.token }));
		const resumed = await second.next("joined");
		expect(resumed.you.id).toBe(joined.you.id);
		second.ws.close();
	});
});
