import { describe, expect, it } from "vitest";
import { canEnterTile } from "./access";
import type { Enclosure } from "./enclosure";

const enc = (id: string, ownerId: string): Enclosure => ({
	id,
	ownerId,
	createdAt: 0,
	tiles: new Set(),
});

describe("canEnterTile (§5 Access)", () => {
	it("allows unclaimed land", () => {
		expect(canEnterTile("p", [], [])).toBe(true);
	});

	it("allows your own land", () => {
		expect(canEnterTile("p", [], [enc("1", "p")])).toBe(true);
	});

	it("blocks entering someone else's land", () => {
		expect(canEnterTile("p", [], [enc("1", "q")])).toBe(false);
	});

	it("lets allies into the land (they come in through gates, §4)", () => {
		expect(canEnterTile("friend", [], [enc("1", "q")], (id) => id === "q")).toBe(true);
		expect(canEnterTile("stranger", [], [enc("1", "q")], () => false)).toBe(false);
	});

	it("lets a trapped player move within the land they are inside", () => {
		const land = enc("1", "q");
		expect(canEnterTile("p", [land], [land])).toBe(true);
	});

	it("lets an enclosing owner enter a nested inner area (§5 Nesting)", () => {
		const outer = enc("1", "outer");
		const inner = enc("2", "inner");
		expect(canEnterTile("outer", [outer], [outer, inner])).toBe(true);
		expect(canEnterTile("stranger", [outer], [outer, inner])).toBe(false);
	});
});
