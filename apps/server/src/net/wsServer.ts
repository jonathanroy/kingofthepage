import type { Server } from "node:http";
import { decodeClientMessage, encodeServerMessage } from "@kotp/shared/protocol";
import { WebSocketServer } from "ws";
import type { Game } from "../game/game";

/** Max bytes per client message; intents are tiny, so anything bigger is abuse. */
const MAX_MESSAGE_BYTES = 1024;

export function attachWebSocketServer(game: Game, server: Server): WebSocketServer {
	const wss = new WebSocketServer({ server, path: "/ws", maxPayload: MAX_MESSAGE_BYTES });

	wss.on("connection", (socket) => {
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
