import { describe, expect, it } from "vitest";
import { createTerrainGenerator } from "./terrain";

describe("forage placement (§8 Food)", () => {
	const gen = createTerrainGenerator("forage-test");
	const counts = { apple: 0, berry: 0, potato: 0 };
	for (let y = -150; y < 150; y++) {
		for (let x = -150; x < 150; x++) {
			const f = gen.forageAt(x, y);
			if (!f) continue;
			counts[f]++;
			const t = gen.terrainAt(x, y);
			expect(f === "apple" ? t === "tree" : t === "grass").toBe(true);
			expect(gen.oreAt(x, y)).toBeNull();
		}
	}

	it("grows all three foods, apples most often", () => {
		expect(counts.berry).toBeGreaterThan(10);
		expect(counts.potato).toBeGreaterThan(5);
		expect(counts.apple).toBeGreaterThan(counts.berry);
	});
});
