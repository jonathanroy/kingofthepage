import { describe, expect, it } from "vitest";
import { TREE } from "./config";
import { buildFence, makeGate } from "./fences";
import { isWalkable, isWalkableFor, isWallFor, resolveTile } from "./tiles";

const T0 = 1_000_000;

describe("resolveTile", () => {
	it("shows a stump until the regrow delay has passed, then a tree", () => {
		const diff = { choppedAt: T0 };
		expect(resolveTile("tree", diff, T0).kind).toBe("stump");
		expect(resolveTile("tree", diff, T0 + TREE.regrowDelayMs - 1).kind).toBe("stump");
		expect(resolveTile("tree", diff, T0 + TREE.regrowDelayMs).kind).toBe("tree");
	});

	it("waits for the stump to be empty before regrowing (§2)", () => {
		const diff = { choppedAt: T0 };
		const later = T0 + TREE.regrowDelayMs * 2;
		expect(resolveTile("tree", diff, later, true).kind).toBe("stump");
		expect(resolveTile("tree", diff, later, false).kind).toBe("tree");
	});

	it("keeps a fence on a stump even after the regrow delay", () => {
		const diff = { choppedAt: T0, fence: buildFence("p1") };
		expect(resolveTile("tree", diff, T0 + TREE.regrowDelayMs * 10).kind).toBe("fence");
	});

	it("returns the base terrain when there is no diff", () => {
		expect(resolveTile("water", undefined, T0)).toEqual({ kind: "water" });
	});
});

describe("walls and walkability", () => {
	it("treats own fences, water and hills as walls, but not others' fences or trees", () => {
		const fence = { kind: "fence", fence: buildFence("p1") } as const;
		expect(isWallFor(fence, "p1")).toBe(true);
		expect(isWallFor(fence, "p2")).toBe(false);
		expect(isWallFor({ kind: "water" }, "p1")).toBe(true);
		expect(isWallFor({ kind: "hill" }, "p1")).toBe(true);
		expect(isWallFor({ kind: "tree" }, "p1")).toBe(false);
		expect(isWallFor({ kind: "grass" }, "p1")).toBe(false);
	});

	it("lets players walk only on grass and stumps", () => {
		expect(isWalkable({ kind: "grass" })).toBe(true);
		expect(isWalkable({ kind: "stump", choppedAt: T0 })).toBe(true);
		expect(isWalkable({ kind: "tree" })).toBe(false);
		expect(isWalkable({ kind: "water" })).toBe(false);
		expect(isWalkable({ kind: "hill" })).toBe(false);
	});

	it("lets the owner and allies walk through gates, which still count as walls", () => {
		const gate = { kind: "fence", fence: makeGate(buildFence("p1")) } as const;
		expect(isWalkableFor(gate, "p1", () => false)).toBe(true);
		expect(isWalkableFor(gate, "p2", (id) => id === "p1")).toBe(true);
		expect(isWalkableFor(gate, "p3", () => false)).toBe(false);
		expect(isWallFor(gate, "p1")).toBe(true);
	});

	it("turns an ore rock into rubble once emptied, for good (§2 Iron ore)", () => {
		expect(resolveTile("grass", { oreMined: 30 }, 0, false, null, 100)).toEqual({
			kind: "ore",
			remaining: 70,
			capacity: 100,
		});
		const rubble = resolveTile("grass", { oreMined: 100 }, 0, false, null, 100);
		expect(rubble).toEqual({ kind: "rubble" });
		expect(isWalkable(rubble)).toBe(true);
		expect(isWalkable({ kind: "ore", remaining: 1, capacity: 100 })).toBe(false);
		expect(isWallFor({ kind: "ore", remaining: 1, capacity: 100 }, "p")).toBe(false);
	});
});
