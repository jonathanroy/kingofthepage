import { describe, expect, it } from "vitest";
import { CHUNK_SIZE } from "./coords";
import { createTerrainGenerator, generateChunk, TERRAIN_CODES } from "./terrain";

describe("terrain generation", () => {
	it("is deterministic for the same seed and chunk", () => {
		const a = generateChunk(createTerrainGenerator("seed-a"), -3, 5);
		const b = generateChunk(createTerrainGenerator("seed-a"), -3, 5);
		expect(a).toEqual(b);
	});

	it("differs between seeds", () => {
		const a = generateChunk(createTerrainGenerator("seed-a"), 0, 0);
		const b = generateChunk(createTerrainGenerator("seed-b"), 0, 0);
		expect(a).not.toEqual(b);
	});

	it("matches terrainAt tile by tile, across negative chunks", () => {
		const gen = createTerrainGenerator("seed-a");
		const chunk = generateChunk(gen, -1, -1);
		expect(TERRAIN_CODES[chunk[0] ?? -1]).toBe(gen.terrainAt(-32, -32));
		expect(TERRAIN_CODES[chunk[CHUNK_SIZE * CHUNK_SIZE - 1] ?? -1]).toBe(gen.terrainAt(-1, -1));
	});

	it("produces every terrain kind over a wide area", () => {
		const gen = createTerrainGenerator("seed-a");
		const seen = new Set<string>();
		for (let y = -400; y < 400; y += 4) {
			for (let x = -400; x < 400; x += 4) seen.add(gen.terrainAt(x, y));
		}
		expect([...seen].sort()).toEqual(["grass", "hill", "tree", "water"]);
	});

	// Guards against accidental world changes (library upgrade, config edit).
	it("keeps a known fingerprint for a fixed seed", () => {
		const chunk = generateChunk(createTerrainGenerator("fingerprint"), 7, -2);
		expect(Array.from(chunk).join("")).toMatchSnapshot();
	});
});
