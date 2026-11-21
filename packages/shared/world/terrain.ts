import alea from "alea";
import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import { TERRAIN } from "../rules/config";
import { CHUNK_SIZE, chunkKey, chunkOrigin, localIndex, tileToChunk } from "./coords";
import { tileRandom } from "./hash";
import { type Mine, type MineSize, mineInChunk } from "./mines";
import { oreCapacityAt } from "./ore";

/** Base terrain only. Chopped trees, fences and ownership are diffs on top. */
export type Terrain = "grass" | "tree" | "water" | "hill";

export const TERRAIN_CODES: readonly Terrain[] = ["grass", "tree", "water", "hill"];

export type TerrainGenerator = {
	readonly seed: string;
	terrainAt(x: number, y: number): Terrain;
	/** The gold mine on this tile, if any (§6). */
	mineAt(x: number, y: number): MineSize | null;
	/** Starting iron of the ore rock on this tile, if any (§2 Iron ore). */
	oreAt(x: number, y: number): number | null;
};

/** Ore needs a few terrain lookups per tile and is asked for constantly, so it's cached. */
const ORE_CACHE_LIMIT = 65_536;

/** Mines per chunk are cheap to compute but looked up per tile, so a small cache helps. */
const MINE_CACHE_LIMIT = 4096;

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

	const mineCache = new Map<string, Mine | null>();
	function mineAt(x: number, y: number): MineSize | null {
		const cx = tileToChunk(x);
		const cy = tileToChunk(y);
		const key = chunkKey(cx, cy);
		let mine = mineCache.get(key);
		if (mine === undefined) {
			if (mineCache.size >= MINE_CACHE_LIMIT) mineCache.clear();
			mine = mineInChunk(seed, cx, cy, terrainAt);
			mineCache.set(key, mine);
		}
		return mine && mine.x === x && mine.y === y ? mine.size : null;
	}

	const oreCache = new Map<string, number | null>();
	function oreAt(x: number, y: number): number | null {
		const key = `${x},${y}`;
		let ore = oreCache.get(key);
		if (ore === undefined) {
			if (oreCache.size >= ORE_CACHE_LIMIT) oreCache.clear();
			ore = oreCapacityAt(seed, x, y, terrainAt);
			oreCache.set(key, ore);
		}
		return ore;
	}

	return { seed, terrainAt, mineAt, oreAt };
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
