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
	fenceRefund,
	makeGate,
	needsAllyConfirmation,
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

describe("chopFence (§3 Chopping fences)", () => {
	it("adds damage until the level's chops are reached, then breaks with a refund", () => {
		let f = buildFence("owner");
		for (let i = 1; i < 3; i++) {
			const r = chopFence(f, "enemy");
			if (r.broken) throw new Error("broke too early");
			expect(r.fence.damage).toBe(i);
			f = r.fence;
		}
		expect(chopFence(f, "enemy")).toEqual({ broken: true, refund: 1 });
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

describe("upgrades repair (§3)", () => {
	it("resets damage when upgrading", () => {
		expect(upgradeFence({ ...buildFence("owner"), damage: 2 }).damage).toBe(0);
	});

	it("checks ownership, max level and wood", () => {
		expect(canUpgradeFence(buildFence("owner"), "other", 99)).toEqual({
			ok: false,
			reason: "notYourFence",
		});
		expect(canUpgradeFence(upgradeTo(4), "owner", 99)).toEqual({ ok: false, reason: "maxLevel" });
		expect(canUpgradeFence(buildFence("owner"), "owner", 2)).toEqual({
			ok: false,
			reason: "notEnoughWood",
		});
		expect(canUpgradeFence(buildFence("owner"), "owner", 3)).toEqual({ ok: true, cost: 3 });
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
