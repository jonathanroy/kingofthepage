import { describe, expect, it } from "vitest";
import { FENCE, FENCE_LEVELS } from "./config";
import {
	buildFence,
	canMakeGate,
	canPassGate,
	canPlaceFence,
	canUpgradeFence,
	chopFence,
	chopsToBreak,
	fenceBuildCost,
	fenceIronRefund,
	fenceRefund,
	improveFence,
	makeGate,
	needsAllyConfirmation,
	repairCost,
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
		const f = upgradeTo(10);
		expect(f.level).toBe(10);
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
		expect(fenceRefund(upgradeTo(10))).toBe(92); // 185 → 92
	});
});

describe("chopFence (§3 Chopping fences)", () => {
	it("adds damage until the level's chops are reached, then breaks with a refund", () => {
		let f = buildFence("owner");
		const needed = FENCE_LEVELS[0].chopsToBreak;
		for (let i = 1; i < needed; i++) {
			const r = chopFence(f, "enemy");
			if (r.broken) throw new Error("broke too early");
			expect(r.fence.damage).toBe(i);
			f = r.fence;
		}
		expect(chopFence(f, "enemy")).toEqual({ broken: true, refund: 1, ironRefund: 0 });
	});

	it("keeps damage from one attacker for the next (damage persists)", () => {
		const r = chopFence(upgradeTo(2), "alice");
		if (r.broken) throw new Error("unexpected");
		const r2 = chopFence(r.fence, "bob");
		expect(r2.broken ? -1 : r2.fence.damage).toBe(2);
	});

	it("breaks in one chop for the owner, even when damaged", () => {
		expect(chopFence({ ...upgradeTo(4), damage: 5 }, "owner").broken).toBe(true);
	});
});

describe("upgrades need a fully repaired fence (§3)", () => {
	it("refuses to upgrade a damaged fence directly", () => {
		expect(() => upgradeFence({ ...buildFence("owner"), damage: 2 })).toThrow();
	});

	it("checks ownership, max level and wood", () => {
		expect(canUpgradeFence(buildFence("owner"), "other", 99)).toEqual({
			ok: false,
			reason: "notYourFence",
		});
		expect(canUpgradeFence(upgradeTo(10), "owner", 999)).toEqual({ ok: false, reason: "maxLevel" });
		expect(canUpgradeFence(buildFence("owner"), "owner", 2)).toEqual({
			ok: false,
			reason: "notEnoughWood",
		});
		expect(canUpgradeFence(buildFence("owner"), "owner", 3)).toEqual({
			ok: true,
			kind: "upgrade",
			cost: 3,
			iron: 0,
		});
	});
});

describe("repair (§3)", () => {
	it("has ten levels", () => {
		expect(FENCE_LEVELS).toHaveLength(10);
		expect(upgradeCost(upgradeTo(10))).toBeNull();
	});

	it("costs wood per chop of damage, rounded up, and only clears damage", () => {
		const damaged = { ...upgradeTo(10), damage: 7 };
		expect(repairCost(damaged)).toBe(Math.ceil(7 * FENCE.repairWoodPerChop));
		expect(canUpgradeFence(damaged, "owner", 999)).toEqual({
			ok: true,
			kind: "repair",
			cost: repairCost(damaged),
			iron: 0,
		});
		expect(canUpgradeFence(damaged, "owner", 0)).toEqual({ ok: false, reason: "notEnoughWood" });
		const repaired = improveFence(damaged);
		expect(repaired).toMatchObject({ level: 10, damage: 0, woodInvested: damaged.woodInvested });
	});

	it("repairs first at any level, then upgrades once undamaged", () => {
		const damaged = { ...upgradeTo(3), damage: 40 };
		expect(canUpgradeFence(damaged, "owner", 999)).toMatchObject({
			ok: true,
			kind: "repair",
			cost: 2,
		});
		const repaired = improveFence(damaged);
		expect(repaired).toMatchObject({ level: 3, damage: 0 });
		expect(canUpgradeFence(repaired, "owner", 999, 99)).toMatchObject({
			ok: true,
			kind: "upgrade",
		});
		expect(improveFence(repaired)).toMatchObject({ level: 4, damage: 0 });
	});

	it("charges at least 1 wood for any damage", () => {
		expect(repairCost({ ...buildFence("owner"), damage: 1 })).toBe(1);
		expect(repairCost(buildFence("owner"))).toBe(0);
	});
});

describe("iron (§2 Iron ore, §3)", () => {
	it("needs iron for the iron and steel levels only", () => {
		const levels = FENCE_LEVELS.filter((l) => l.iron > 0).map((l) => l.level);
		expect(levels).toEqual([4, 8, 9, 10]);
		expect(canUpgradeFence(upgradeTo(3), "owner", 999, 0)).toEqual({
			ok: false,
			reason: "notEnoughIron",
		});
		expect(canUpgradeFence(upgradeTo(3), "owner", 999, 2)).toMatchObject({
			ok: true,
			kind: "upgrade",
			iron: 2,
		});
		expect(canUpgradeFence(upgradeTo(4), "owner", 999, 0)).toMatchObject({ ok: true, iron: 0 });
	});

	it("repairs with wood only, even on iron walls", () => {
		expect(canUpgradeFence({ ...upgradeTo(9), damage: 40 }, "owner", 999, 0)).toMatchObject({
			ok: true,
			kind: "repair",
			iron: 0,
		});
	});

	it("tracks iron invested and refunds half of it when the wall breaks", () => {
		const wall = upgradeTo(10);
		expect(wall.ironInvested).toBe(2 + 4 + 6 + 10);
		expect(fenceIronRefund(wall)).toBe(11);
		expect(chopFence(wall, "owner")).toMatchObject({ broken: true, ironRefund: 11 });
	});
});

describe("gates (§3 Gates)", () => {
	it("converts an owner's fence, keeping level and damage, and counts the cost in the refund", () => {
		const fence = { ...upgradeTo(2), damage: 1 };
		expect(canMakeGate(fence, "owner", FENCE.gateConversionCost)).toEqual({
			ok: true,
			cost: FENCE.gateConversionCost,
		});
		const gate = makeGate(fence);
		expect(gate).toMatchObject({ gate: true, level: 2, damage: 1 });
		expect(gate.woodInvested).toBe(fence.woodInvested + FENCE.gateConversionCost);
		expect(canMakeGate(gate, "owner", 99)).toEqual({ ok: false, reason: "alreadyGate" });
		expect(canMakeGate(fence, "other", 99)).toEqual({ ok: false, reason: "notYourFence" });
	});

	it("lets only the owner and allies pass", () => {
		const gate = makeGate(buildFence("owner"));
		const allies = (id: string) => id === "owner";
		expect(canPassGate(gate, "owner", () => false)).toBe(true);
		expect(canPassGate(gate, "friend", allies)).toBe(true);
		expect(canPassGate(gate, "stranger", () => false)).toBe(false);
		expect(canPassGate(buildFence("owner"), "owner", () => false)).toBe(false);
	});
});

describe("needsAllyConfirmation (§4)", () => {
	it("applies only to an ally's fence", () => {
		const f = buildFence("ally");
		expect(needsAllyConfirmation(f, "me", (id) => id === "ally")).toBe(true);
		expect(needsAllyConfirmation(f, "me", () => false)).toBe(false);
		expect(needsAllyConfirmation(f, "ally", () => true)).toBe(false);
	});
});
