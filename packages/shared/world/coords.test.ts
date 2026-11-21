import { describe, expect, it } from "vitest";
import {
	CHUNK_SIZE,
	chunkOfTile,
	chunkOrigin,
	neighbors4,
	tileToChunk,
	tileToLocal,
} from "./coords";

describe("tileToChunk", () => {
	it.each([
		[0, 0],
		[31, 0],
		[32, 1],
		[-1, -1],
		[-32, -1],
		[-33, -2],
	])("tile %i is in chunk %i", (tile, chunk) => {
		expect(tileToChunk(tile)).toBe(chunk);
	});
});

describe("tileToLocal", () => {
	it("is always in [0, CHUNK_SIZE), including for negative tiles", () => {
		for (let t = -100; t <= 100; t++) {
			const local = tileToLocal(t);
			expect(local).toBeGreaterThanOrEqual(0);
			expect(local).toBeLessThan(CHUNK_SIZE);
			expect(tileToChunk(t) * CHUNK_SIZE + local).toBe(t);
		}
	});

	it("maps -1 to the last column of chunk -1", () => {
		expect(tileToLocal(-1)).toBe(31);
	});
});

describe("chunk helpers", () => {
	it("round-trips a tile through its chunk origin", () => {
		const { cx, cy } = chunkOfTile(-40, 70);
		expect({ cx, cy }).toEqual({ cx: -2, cy: 2 });
		expect(chunkOrigin(cx, cy)).toEqual({ x: -64, y: 64 });
	});

	it("gives exactly the four orthogonal neighbors", () => {
		expect(neighbors4(0, 0)).toEqual([
			{ x: 0, y: -1 },
			{ x: 1, y: 0 },
			{ x: 0, y: 1 },
			{ x: -1, y: 0 },
		]);
	});
});
