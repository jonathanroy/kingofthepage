import { MINES } from "../rules/config";
import { CHUNK_SIZE, chunkOrigin } from "./coords";
import { tileRandom } from "./hash";
import type { Terrain } from "./terrain";

export type MineSize = "small" | "large";

export type Mine = { readonly x: number; readonly y: number; readonly size: MineSize };

/**
 * §6: at most one mine per chunk, a pure function of (seed, chunk) like the terrain.
 * Mines go on land the player can reach (grass or forest), never in water or hills.
 */
export function mineInChunk(
	seed: string,
	cx: number,
	cy: number,
	terrainAt: (x: number, y: number) => Terrain,
): Mine | null {
	if (tileRandom(seed, "mine", cx, cy) >= MINES.chunkChance) return null;
	const size: MineSize =
		tileRandom(seed, "mine-size", cx, cy) < MINES.largeShare ? "large" : "small";
	const origin = chunkOrigin(cx, cy);
	for (let attempt = 0; attempt < MINES.placementAttempts; attempt++) {
		const x = origin.x + Math.floor(tileRandom(seed, `mine-x${attempt}`, cx, cy) * CHUNK_SIZE);
		const y = origin.y + Math.floor(tileRandom(seed, `mine-y${attempt}`, cx, cy) * CHUNK_SIZE);
		const t = terrainAt(x, y);
		if (t === "grass" || t === "tree") return { x, y, size };
	}
	return null;
}
