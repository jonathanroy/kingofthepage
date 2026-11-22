import { FORAGE } from "../rules/config";
import { tileRandom } from "./hash";
import type { Terrain } from "./terrain";

export type Forage = "apple" | "berry" | "potato";

/**
 * §8 Food: which plant grows on this tile, a pure function of the seed like the terrain.
 * Some round trees bear apples; berry bushes and potato patches grow in open grass.
 */
export function forageAt(seed: string, x: number, y: number, terrain: Terrain): Forage | null {
	if (terrain === "tree")
		return tileRandom(seed, "apple", x, y) < FORAGE.apple.chance ? "apple" : null;
	if (terrain !== "grass") return null;
	const roll = tileRandom(seed, "forage", x, y);
	if (roll < FORAGE.berry.chance) return "berry";
	if (roll < FORAGE.berry.chance + FORAGE.potato.chance) return "potato";
	return null;
}
