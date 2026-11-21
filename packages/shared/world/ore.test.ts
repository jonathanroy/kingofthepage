import { describe, expect, it } from "vitest";
import { IRON } from "../rules/config";
import { oreCapacityAt } from "./ore";
import { createTerrainGenerator, type Terrain } from "./terrain";

describe("iron ore placement (§2 Iron ore)", () => {
	const gen = createTerrainGenerator("ore-test");
	const found: { x: number; y: number; cap: number }[] = [];
	for (let y = -300; y < 300; y++) {
		for (let x = -300; x < 300; x++) {
			const cap = gen.oreAt(x, y);
			if (cap !== null) found.push({ x, y, cap });
		}
	}

	it("places rocks only on grass right beside a hill", () => {
		expect(found.length).toBeGreaterThan(20);
		for (const { x, y } of found) {
			expect(gen.terrainAt(x, y)).toBe("grass");
			const near = [
				gen.terrainAt(x, y - 1),
				gen.terrainAt(x, y + 1),
				gen.terrainAt(x - 1, y),
				gen.terrainAt(x + 1, y),
			];
			expect(near).toContain("hill");
		}
	});

	it("fills each rock with a lot of iron, within the configured range", () => {
		for (const { cap } of found) {
			expect(cap).toBeGreaterThanOrEqual(IRON.capacityMin);
			expect(cap).toBeLessThanOrEqual(IRON.capacityMax);
		}
	});

	it("is deterministic and ignores tiles away from hills", () => {
		const flat = (): Terrain => "grass";
		const first = found[0];
		if (!first) throw new Error("no ore found");
		expect(oreCapacityAt(gen.seed, first.x, first.y, gen.terrainAt)).toBe(first.cap);
		for (let i = 0; i < 200; i++) expect(oreCapacityAt("x", i, 0, flat)).toBeNull();
	});
});
