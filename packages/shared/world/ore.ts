import { IRON } from "../rules/config";
import { tileRandom } from "./hash";
import type { Terrain } from "./terrain";

/**
 * §2 Iron ore: how much iron the rock on this tile started with, or null when there's no
 * rock. Rocks sit on grass right beside a hill (hill tiles can't be walked on, so ore on
 * top would be unreachable). A pure function of the seed, like terrain and gold mines.
 */
export function oreCapacityAt(
	seed: string,
	x: number,
	y: number,
	terrainAt: (x: number, y: number) => Terrain,
): number | null {
	if (terrainAt(x, y) !== "grass") return null;
	if (tileRandom(seed, "ore", x, y) >= IRON.foothillChance) return null;
	const besideHill =
		terrainAt(x, y - 1) === "hill" ||
		terrainAt(x, y + 1) === "hill" ||
		terrainAt(x - 1, y) === "hill" ||
		terrainAt(x + 1, y) === "hill";
	if (!besideHill) return null;
	const span = IRON.capacityMax - IRON.capacityMin + 1;
	return IRON.capacityMin + Math.floor(tileRandom(seed, "ore-capacity", x, y) * span);
}
