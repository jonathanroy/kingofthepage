import { describe, expect, it } from "vitest";
import { ENCLOSURE } from "./config";
import { fillRegion, ownFenceBorderShare } from "./enclosure";
import { AsciiWorld, map } from "./testing/asciiWorld";

function world(m: string, ownerOrder: string[] = []): AsciiWorld {
	const w = new AsciiWorld(m);
	w.buildAllFences(ownerOrder);
	return w;
}

function rows(...r: string[]): string {
	return r.join("\n");
}

describe("basic enclosure (§5 Enclosure)", () => {
	it("claims the inside of a closed ring of own fences", () => {
		const w = world(map`
			aaaaa
			a...a
			a...a
			aaaaa
		`);
		expect(w.controllerMap(5, 4)).toBe(rows(".....", ".aaa.", ".aaa.", "....."));
	});

	it("claims nothing while the ring has a gap, and everything once it closes", () => {
		const w = world(map`
			aa.aa
			a...a
			aaaaa
		`);
		expect(w.land.enclosuresOf("a")).toHaveLength(0);
		const changes = w.placeFence(2, 0, "a");
		expect(changes).toHaveLength(3);
		expect(w.controllerMap(5, 3)).toBe(rows(".....", ".aaa.", "....."));
	});

	it("closes with fences touching only at corners", () => {
		const w = world(map`
			..a..
			.a.a.
			a...a
			.a.a.
			..a..
		`);
		expect(w.controllerMap(5, 5)).toBe(rows(".....", "..a..", ".aaa.", "..a..", "....."));
	});

	it("ignores corner fences: removing one doesn't breach", () => {
		const w = world(map`
			aaaa
			a..a
			aaaa
		`);
		w.breakFence(0, 0);
		expect(w.controllerAt(1, 1)).toBe("a");
	});

	it("works across chunk borders and negative coordinates", () => {
		const w = new AsciiWorld(
			map`
				aaaa
				a..a
				a..a
				aaaa
			`,
			-33,
			-2,
		);
		w.buildAllFences();
		expect(w.controllerAt(1, 1)).toBe("a"); // (-32, -1)
		expect(w.controllerAt(2, 2)).toBe("a"); // (-31, 0)
	});
});

describe("own walls only", () => {
	it("doesn't let two players' fences close an area together", () => {
		const w = world(map`
			aaabb
			a...b
			aaabb
		`);
		expect(w.controllerMap(5, 3)).toBe(rows(".....", ".....", "....."));
	});

	it("doesn't let a single borrowed fence complete a ring", () => {
		const w = world(
			map`
				aaaaa
				a...b
				aaaaa
			`,
			["b", "a"],
		);
		expect(w.land.enclosuresOf("a")).toHaveLength(0);
	});

	it("blocks splitting: a line between someone else's walls claims nothing", () => {
		const w = world(map`
			aaaaaaa
			a.....a
			a.....a
			aaaaaaa
		`);
		w.placeFence(3, 1, "b");
		w.placeFence(3, 2, "b");
		expect(w.land.enclosuresOf("b")).toHaveLength(0);
		expect(w.controllerMap(7, 4)).toBe(rows(".......", ".aaaaa.", ".aaaaa.", "......."));
	});
});

describe("terrain walls (§5: at least half the border must be own fences)", () => {
	it("claims an area fenced against a lake shore", () => {
		const w = world(map`
			~~~~~~~
			~.....~
			a.....a
			a.....a
			aaaaaaa
		`);
		expect(w.controllerAt(3, 1)).toBe("a");
		expect(w.controllerAt(3, 3)).toBe("a");
	});

	it("doesn't claim a lake-locked pocket from fences at two corners", () => {
		const w = world(map`
			~~~~~~~~~~
			~a.......~
			~........~
			~........~
			~.......a~
			~~~~~~~~~~
		`);
		expect(w.land.enclosuresOf("a")).toHaveLength(0);
	});

	it("doesn't claim a valley with a short fence across its mouth", () => {
		const w = world(map`
			^^^^^^^^^
			^.......^
			^.......^
			^.......^
			^^^aaa^^^
		`);
		expect(w.land.enclosuresOf("a")).toHaveLength(0);
	});

	it("claims a terrain-locked pocket once it is fenced all around", () => {
		const w = world(map`
			~~~~~~~
			~aaaaa~
			~a...a~
			~aaaaa~
			~~~~~~~
		`);
		expect(w.controllerMap(7, 5)).toBe(rows(".......", ".......", "..aaa..", ".......", "......."));
	});

	it("doesn't count a pond inside the land as border", () => {
		const w = world(map`
			aaaaaaa
			a.....a
			a.~~~.a
			a.~~~.a
			a.....a
			aaaaaaa
		`);
		const fill = fillRegion("a", { x: 1, y: 1 }, w, ENCLOSURE.maxArea);
		if (!fill.closed) throw new Error("expected a closed region");
		expect(ownFenceBorderShare("a", fill.region, w)).toBe(1);
		expect(w.controllerAt(1, 1)).toBe("a");
	});

	it("does count a lake reaching in from outside", () => {
		const w = world(map`
			aaaa~
			a...~
			aaaa~
		`);
		const fill = fillRegion("a", { x: 1, y: 1 }, w, ENCLOSURE.maxArea);
		if (!fill.closed) throw new Error("expected a closed region");
		expect(ownFenceBorderShare("a", fill.region, w)).toBeCloseTo(7 / 8);
	});
});

describe("maximum area", () => {
	it("claims nothing when the ring is larger than the maximum", () => {
		const limits = { ...ENCLOSURE, maxArea: 8 };
		const small = new AsciiWorld("aaaa\na..a\na..a\naaaa", 0, 0, limits);
		small.buildAllFences();
		expect(small.land.enclosuresOf("a")).toHaveLength(1);

		const big = new AsciiWorld("aaaaa\na...a\na...a\na...a\naaaaa", 0, 0, limits);
		big.buildAllFences();
		expect(big.land.enclosuresOf("a")).toHaveLength(0);
	});
});

const NESTED = map`
	aaaaaaaaa
	a.......a
	a.bbbbb.a
	a.b...b.a
	a.b...b.a
	a.bbbbb.a
	a.......a
	aaaaaaaaa
`;
const NESTED_CONTROL = rows(
	".........",
	".aaaaaaa.",
	".aaaaaaa.",
	".aabbbaa.",
	".aabbbaa.",
	".aaaaaaa.",
	".aaaaaaa.",
	".........",
);

describe("nesting (§5 Nesting)", () => {
	it("gives the inner ring to its builder (mine theft)", () => {
		const w = world(NESTED, ["a", "b"]);
		expect(w.controllerMap(9, 8)).toBe(NESTED_CONTROL);
		expect(w.ownersAt(4, 3)).toEqual(["a", "b"]);
	});

	it("wrapping from outside gives the same result", () => {
		const w = world(NESTED, ["b", "a"]);
		expect(w.controllerMap(9, 8)).toBe(NESTED_CONTROL);
		expect(w.ownersAt(4, 3)).toEqual(["a", "b"]);
		expect(w.ownersAt(1, 1)).toEqual(["a"]);
	});

	it("keeps an owner's own nested rings as separate areas", () => {
		const w = world(NESTED.replaceAll("b", "a"));
		expect(w.land.enclosuresOf("a")).toHaveLength(2);
		expect(w.controllerAt(4, 3)).toBe("a");
		expect(w.controllerAt(2, 2)).toBeNull(); // the inner ring's fence tile
	});
});

describe("breach (§5 Breach)", () => {
	it("loses the whole area when one boundary fence is removed", () => {
		const w = world(map`
			aaaaa
			a...a
			aaaaa
		`);
		const changes = w.breakFence(2, 0);
		expect(w.land.enclosuresOf("a")).toHaveLength(0);
		expect(changes.map((c) => c.to)).toEqual([null, null, null]);
	});

	it("returns an inner area to the outer owner when the inner ring is breached", () => {
		const w = world(NESTED, ["a", "b"]);
		const changes = w.breakFence(4, 2);
		expect(w.controllerAt(4, 3)).toBe("a");
		expect(changes).toContainEqual({ tile: "4,3", from: "b", to: "a" });
	});

	it("keeps the inner area when only the outer ring is breached", () => {
		const w = world(NESTED, ["a", "b"]);
		w.breakFence(4, 0);
		expect(w.land.enclosuresOf("a")).toHaveLength(0);
		expect(w.controllerAt(4, 3)).toBe("b");
		expect(w.controllerAt(1, 1)).toBeNull();
	});

	it("merges two of an owner's areas when the divider is removed", () => {
		const w = world(map`
			aaaaaaa
			a..a..a
			a..a..a
			aaaaaaa
		`);
		const [left, right] = w.land.enclosuresOf("a");
		w.breakFence(3, 1);
		const merged = w.land.enclosuresOf("a");
		expect(merged).toHaveLength(1);
		expect(merged[0]?.tiles.size).toBe(9);
		expect(merged[0]?.createdAt).toBe(Math.min(left?.createdAt ?? 0, right?.createdAt ?? 0));
	});

	it("splits an owner's area with their own divider, keeping its age", () => {
		const w = world(map`
			aaaaaaa
			a.....a
			aaaaaaa
		`);
		const [original] = w.land.enclosuresOf("a");
		w.placeFence(3, 1, "a");
		const halves = w.land.enclosuresOf("a");
		expect(halves).toHaveLength(2);
		for (const h of halves) expect(h.createdAt).toBe(original?.createdAt);
	});

	it("leaves other players' areas alone when a fence inside them changes", () => {
		const w = world(map`
			aaaaa
			a...a
			aaaaa
		`);
		const [before] = w.land.enclosuresOf("a");
		w.placeFence(2, 1, "b");
		w.breakFence(2, 1);
		expect(w.land.enclosuresOf("a")).toEqual([before]);
	});
});
