import { describe, expect, it } from "vitest";
import { FENCE_LEVELS } from "./config";
import {
	buildFence,
	canPlaceFence,
	chopsToBreak,
	fenceBuildCost,
	fenceRefund,
	upgradeCost,
	upgradeFence,
} from "./fences";
import type { Fence } from "./types";

function upgradeTo(level: number): Fence {
	let f = buildFence("owner");
	while (f.level < level) f = upgradeFence(f);
	return f;
}

describe("canPlaceFence (§3 Building)", () => {
	const wood = fenceBuildCost();

	it("allows grass and stumps", () => {
		expect(canPlaceFence({ kind: "grass" }, false, wood)).toEqual({ ok: true });
		expect(canPlaceFence({ kind: "stump", choppedAt: 0 }, false, wood)).toEqual({ ok: true });
	});

	it.each(["tree", "water", "hill"] as const)("rejects %s", (kind) => {
		expect(canPlaceFence({ kind }, false, wood)).toEqual({ ok: false, reason: "notEmptyGround" });
	});

	it("rejects an existing fence, an occupied tile, and too little wood", () => {
		expect(canPlaceFence({ kind: "fence", fence: buildFence("x") }, false, wood).ok).toBe(false);
		expect(canPlaceFence({ kind: "grass" }, true, wood)).toEqual({ ok: false, reason: "occupied" });
		expect(canPlaceFence({ kind: "grass" }, false, wood - 1)).toEqual({
			ok: false,
			reason: "notEnoughWood",
		});
	});
});

describe("upgrades", () => {
	it("follows the level table and tracks wood invested", () => {
		const f = upgradeTo(4);
		expect(f.level).toBe(4);
		expect(f.woodInvested).toBe(FENCE_LEVELS.reduce((sum, l) => sum + l.cost, 0));
		expect(upgradeCost(f)).toBeNull();
		expect(() => upgradeFence(f)).toThrow();
	});
});

describe("chopsToBreak (§3 Chopping fences)", () => {
	it("takes one chop for the owner at any level", () => {
		expect(chopsToBreak(upgradeTo(4), "owner")).toBe(1);
	});

	it("follows the level table for anyone else", () => {
		for (const { level, chopsToBreak: chops } of FENCE_LEVELS) {
			expect(chopsToBreak(upgradeTo(level), "enemy")).toBe(chops);
		}
	});
});

describe("fenceRefund", () => {
	it("returns 50% of wood invested, rounded down", () => {
		expect(fenceRefund(buildFence("owner"))).toBe(1); // 2 → 1
		expect(fenceRefund(upgradeTo(2))).toBe(2); // 5 → 2
		expect(fenceRefund(upgradeTo(4))).toBe(9); // 18 → 9
	});
});
