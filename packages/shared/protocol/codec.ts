import { type ClientMessage, ClientMessageSchema, type ServerMessage } from "./messages";

// The only place that knows the wire format, so JSON can later become binary.

export function encodeServerMessage(msg: ServerMessage): string {
	return JSON.stringify(msg);
}

export function decodeServerMessage(raw: string): ServerMessage {
	// The client trusts the server's shape; validation happens at the server boundary.
	return JSON.parse(raw) as ServerMessage;
}

export function encodeClientMessage(msg: ClientMessage): string {
	return JSON.stringify(msg);
}

/** Validates untrusted input. Returns null for anything malformed. */
export function decodeClientMessage(raw: string): ClientMessage | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	const result = ClientMessageSchema.safeParse(parsed);
	return result.success ? result.data : null;
}
