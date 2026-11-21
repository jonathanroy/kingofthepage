import { PROTOCOL_VERSION } from "@kotp/shared/protocol";
import { WebSocketServer } from "ws";

const port = Number(process.env.PORT ?? 8080);
const wss = new WebSocketServer({ port });

wss.on("connection", (socket) => {
	socket.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION }));
});

console.log(`KOTP server listening on ws://localhost:${port}`);
