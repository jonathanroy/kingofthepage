import type { Server } from "node:http";
import { decodeClientMessage, encodeServerMessage } from "@kotp/shared/protocol";
import { WebSocketServer } from "ws";
import type { Game } from "../game/game";

/** Max bytes per client message; intents are tiny, so anything bigger is abuse. */
const MAX_MESSAGE_BYTES = 1024;

/**
 * Pings keep idle connections alive through proxies (nginx closes silent upgrades after its
 * read timeout) and let the server drop clients that vanished without closing.
 */
const HEARTBEAT_MS = 30_000;

export function attachWebSocketServer(game: Game, server: Server): WebSocketServer {
	const wss = new WebSocketServer({ server, path: "/ws", maxPayload: MAX_MESSAGE_BYTES });

	const alive = new WeakMap<object, boolean>();
	const heartbeat = setInterval(() => {
		for (const socket of wss.clients) {
			if (alive.get(socket) === false) {
				socket.terminate();
				continue;
			}
			alive.set(socket, false);
			socket.ping();
		}
	}, HEARTBEAT_MS);
	wss.on("close", () => clearInterval(heartbeat));

	wss.on("connection", (socket) => {
		alive.set(socket, true);
		socket.on("pong", () => alive.set(socket, true));
		const sessionId = game.connect(
			(msg) => {
				if (socket.readyState === socket.OPEN) socket.send(encodeServerMessage(msg));
			},
			() => socket.close(4000, "Signed in elsewhere"),
		);

		socket.on("message", (data, isBinary) => {
			if (isBinary) return;
			// Validate at the boundary: nothing unparsed reaches game logic.
			const msg = decodeClientMessage(data.toString());
			if (msg) game.receive(sessionId, msg);
		});
		socket.on("close", () => game.disconnect(sessionId));
		socket.on("error", () => socket.terminate());
	});

	return wss;
}
