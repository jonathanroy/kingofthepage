import { describe, expect, it } from "vitest";
import { MINES } from "./config";
import { mineGoldPerMinute, settleMineGold } from "./gold";
import { isWalkable, isWallFor, resolveTile } from "./tiles";

describe("settleMineGold (§6, §8 Lazy updates)", () => {
	it("credits elapsed minutes times the rate and restarts the clock", () => {
		const result = settleMineGold("large", { controllerId: "p", controlledSince: 0 }, 10 * 60_000);
		expect(result.earned).toBe(10 * MINES.goldPerMinute.large);
		expect(result.control).toEqual({ controllerId: "p", controlledSince: 10 * 60_000 });
	});

	it("credits fractions of a minute and never goes negative", () => {
		expect(settleMineGold("small", { controllerId: "p", controlledSince: 0 }, 30_000).earned).toBe(
			0.5,
		);
		expect(settleMineGold("small", { controllerId: "p", controlledSince: 5000 }, 1000).earned).toBe(
			0,
		);
	});

	it("pays large mines more than small ones", () => {
		expect(mineGoldPerMinute("large")).toBeGreaterThan(mineGoldPerMinute("small"));
	});
});

describe("mine tiles", () => {
	it("are solid, can't hold a fence, and don't block enclosure", () => {
		const tile = resolveTile("grass", undefined, 0, false, "small");
		expect(tile).toEqual({ kind: "mine", size: "small" });
		expect(isWalkable(tile)).toBe(false);
		expect(isWallFor(tile, "p")).toBe(false);
	});
});
