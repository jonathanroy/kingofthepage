import { describe, expect, it } from "vitest";
import { MINES } from "../rules/config";
import { mineInChunk } from "./mines";
import { createTerrainGenerator } from "./terrain";

describe("mine placement (§6)", () => {
	const gen = createTerrainGenerator("mines-test");
	const chunks: [number, number][] = [];
	for (let cy = -40; cy < 40; cy++) for (let cx = -40; cx < 40; cx++) chunks.push([cx, cy]);
	const mines = chunks
		.map(([cx, cy]) => mineInChunk(gen.seed, cx, cy, gen.terrainAt))
		.filter((m) => m !== null);

	it("is deterministic", () => {
		const again = chunks
			.map(([cx, cy]) => mineInChunk(gen.seed, cx, cy, gen.terrainAt))
			.filter((m) => m !== null);
		expect(again).toEqual(mines);
	});

	it("places about one mine per 40 chunks, a minority of them large", () => {
		const expected = chunks.length * MINES.chunkChance;
		expect(mines.length).toBeGreaterThan(expected * 0.6);
		expect(mines.length).toBeLessThan(expected * 1.4);
		const large = mines.filter((m) => m.size === "large").length;
		expect(large).toBeGreaterThan(0);
		expect(large).toBeLessThan(mines.length / 2);
	});

	it("only places mines on reachable land", () => {
		for (const m of mines) expect(["grass", "tree"]).toContain(gen.terrainAt(m.x, m.y));
	});

	it("is exposed per tile through the terrain generator", () => {
		const m = mines[0];
		if (!m) throw new Error("no mine found");
		expect(gen.mineAt(m.x, m.y)).toBe(m.size);
		expect(gen.mineAt(m.x + 1, m.y)).toBeNull();
	});
});
