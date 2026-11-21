import alea from "alea";
import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import { TERRAIN } from "../rules/config";
import { CHUNK_SIZE, chunkOrigin, localIndex } from "./coords";
import { tileRandom } from "./hash";

/** Base terrain only. Chopped trees, fences and ownership are diffs on top. */
export type Terrain = "grass" | "tree" | "water" | "hill";

export const TERRAIN_CODES: readonly Terrain[] = ["grass", "tree", "water", "hill"];

export type TerrainGenerator = {
	readonly seed: string;
	terrainAt(x: number, y: number): Terrain;
};

export function createTerrainGenerator(seed: string): TerrainGenerator {
	const elevation: NoiseFunction2D = createNoise2D(alea(`${seed}:elevation`));
	const forest: NoiseFunction2D = createNoise2D(alea(`${seed}:forest`));

	function terrainAt(x: number, y: number): Terrain {
		const e = elevation(x / TERRAIN.elevationScale, y / TERRAIN.elevationScale);
		if (e < TERRAIN.waterBelow) return "water";
		if (e > TERRAIN.hillAbove) return "hill";

		const f = forest(x / TERRAIN.forestScale, y / TERRAIN.forestScale);
		const treeChance =
			f > TERRAIN.forestAbove ? TERRAIN.denseForestTreeChance : TERRAIN.scatteredTreeChance;
		return tileRandom(seed, "tree", x, y) < treeChance ? "tree" : "grass";
	}

	return { seed, terrainAt };
}

/** Row-major terrain codes (indices into TERRAIN_CODES) for one 32×32 chunk. */
export function generateChunk(gen: TerrainGenerator, cx: number, cy: number): Uint8Array {
	const out = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
	const origin = chunkOrigin(cx, cy);
	for (let ly = 0; ly < CHUNK_SIZE; ly++) {
		for (let lx = 0; lx < CHUNK_SIZE; lx++) {
			const t = gen.terrainAt(origin.x + lx, origin.y + ly);
			out[localIndex(lx, ly)] = TERRAIN_CODES.indexOf(t);
		}
	}
	return out;
}
