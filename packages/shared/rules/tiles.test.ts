import { describe, expect, it } from "vitest";
import { TREE } from "./config";
import { buildFence } from "./fences";
import { isWalkable, isWall, resolveTile } from "./tiles";

const T0 = 1_000_000;

describe("resolveTile", () => {
	it("shows a stump until the regrow delay has passed, then a tree", () => {
		const diff = { choppedAt: T0 };
		expect(resolveTile("tree", diff, T0).kind).toBe("stump");
		expect(resolveTile("tree", diff, T0 + TREE.regrowDelayMs - 1).kind).toBe("stump");
		expect(resolveTile("tree", diff, T0 + TREE.regrowDelayMs).kind).toBe("tree");
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
	it("treats fences, water and hills as walls, but not trees", () => {
		expect(isWall({ kind: "fence", fence: buildFence("p1") })).toBe(true);
		expect(isWall({ kind: "water" })).toBe(true);
		expect(isWall({ kind: "hill" })).toBe(true);
		expect(isWall({ kind: "tree" })).toBe(false);
		expect(isWall({ kind: "grass" })).toBe(false);
	});

	it("lets players walk only on grass and stumps", () => {
		expect(isWalkable({ kind: "grass" })).toBe(true);
		expect(isWalkable({ kind: "stump", choppedAt: T0 })).toBe(true);
		expect(isWalkable({ kind: "tree" })).toBe(false);
		expect(isWalkable({ kind: "water" })).toBe(false);
		expect(isWalkable({ kind: "hill" })).toBe(false);
	});
});
