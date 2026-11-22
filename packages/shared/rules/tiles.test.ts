import { describe, expect, it } from "vitest";
import { PACE, TREE } from "./config";
import { buildFence, makeGate } from "./fences";
import {
	canMoveOnto,
	isWalkable,
	isWalkableFor,
	isWallFor,
	moveIntervalFor,
	resolveTile,
} from "./tiles";
import type { Fence } from "./types";

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
		expect(resolveTile("tree", diff, later, { occupied: true }).kind).toBe("stump");
		expect(resolveTile("tree", diff, later, { occupied: false }).kind).toBe("tree");
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
		expect(resolveTile("grass", { oreMined: 30 }, 0, { ore: 100 })).toEqual({
			kind: "ore",
			remaining: 70,
			capacity: 100,
		});
		const rubble = resolveTile("grass", { oreMined: 100 }, 0, { ore: 100 });
		expect(rubble).toEqual({ kind: "rubble" });
		expect(isWalkable(rubble)).toBe(true);
		expect(isWalkable({ kind: "ore", remaining: 1, capacity: 100 })).toBe(false);
		expect(isWallFor({ kind: "ore", remaining: 1, capacity: 100 }, "p")).toBe(false);
	});
});

describe("swimming (§1 Movement)", () => {
	const noAllies = () => false;

	it("lets players move onto water, slower than walking", () => {
		expect(canMoveOnto({ kind: "water" }, "me", noAllies)).toBe(true);
		expect(moveIntervalFor({ kind: "water" })).toBe(PACE.swimMoveIntervalMs);
		expect(moveIntervalFor({ kind: "grass" })).toBe(PACE.moveIntervalMs);
		expect(PACE.swimMoveIntervalMs).toBeGreaterThan(PACE.moveIntervalMs);
	});

	it("keeps water unwalkable for creatures, spawns and building, and a wall for enclosures", () => {
		expect(isWalkable({ kind: "water" })).toBe(false);
		expect(isWallFor({ kind: "water" }, "me")).toBe(true);
	});

	it("still blocks hills and others' fences", () => {
		expect(canMoveOnto({ kind: "hill" }, "me", noAllies)).toBe(false);
		const fence: Fence = {
			ownerId: "other",
			level: 1,
			damage: 0,
			woodInvested: 2,
			ironInvested: 0,
			gate: false,
		};
		expect(canMoveOnto({ kind: "fence", fence }, "me", noAllies)).toBe(false);
	});
});
