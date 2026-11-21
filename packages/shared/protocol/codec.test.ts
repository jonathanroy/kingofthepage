import { describe, expect, it } from "vitest";
import { decodeClientMessage, encodeClientMessage } from "./codec";

describe("decodeClientMessage", () => {
	it("round-trips valid intents", () => {
		const msg = { type: "move", dir: "left", seq: 3 } as const;
		expect(decodeClientMessage(encodeClientMessage(msg))).toEqual(msg);
	});

	it.each([
		"not json",
		"{}",
		'{"type":"move","dir":"diagonal","seq":1}',
		'{"type":"move","dir":"up","seq":-1}',
		'{"type":"move","dir":"up","seq":1.5}',
		'{"type":"teleport","x":0,"y":0}',
		`{"type":"join","handle":${JSON.stringify("x".repeat(100))}}`,
	])("rejects %s", (raw) => {
		expect(decodeClientMessage(raw)).toBeNull();
	});

	it("strips fields the client isn't allowed to send", () => {
		const decoded = decodeClientMessage('{"type":"chop","seq":1,"wood":999}');
		expect(decoded).toEqual({ type: "chop", seq: 1 });
	});
});
