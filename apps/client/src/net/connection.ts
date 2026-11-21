import {
	type ClientMessage,
	decodeServerMessage,
	encodeClientMessage,
	type ServerMessage,
} from "@kotp/shared/protocol";

const TOKEN_KEY = "kotp.token";

/** Storage can be unavailable (private mode, blocked site data); the game still works without it. */
export const tokenStorage = {
	get(): string | null {
		try {
			return localStorage.getItem(TOKEN_KEY);
		} catch {
			return null;
		}
	},
	set(token: string): void {
		try {
			localStorage.setItem(TOKEN_KEY, token);
		} catch {
			// Without storage the player simply can't resume after a reload.
		}
	},
	clear(): void {
		try {
			localStorage.removeItem(TOKEN_KEY);
		} catch {
			// Nothing to clear.
		}
	},
};

export type ConnectionEvents = {
	onMessage(msg: ServerMessage): void;
	onClose(reason: string): void;
};

export class Connection {
	private socket: WebSocket | null = null;
	private seq = 0;

	constructor(private readonly events: ConnectionEvents) {}

	open(): void {
		const protocol = location.protocol === "https:" ? "wss:" : "ws:";
		const socket = new WebSocket(`${protocol}//${location.host}/ws`);
		socket.addEventListener("message", (e) => {
			if (typeof e.data === "string") this.events.onMessage(decodeServerMessage(e.data));
		});
		socket.addEventListener("close", (e) => this.events.onClose(e.reason || "Connection lost"));
		this.socket = socket;
	}

	send(msg: ClientMessage): void {
		if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(encodeClientMessage(msg));
	}

	nextSeq(): number {
		this.seq += 1;
		return this.seq;
	}
}
