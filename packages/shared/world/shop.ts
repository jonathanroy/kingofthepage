import { SHOP } from "../rules/config";
import type { TileCoord } from "./coords";
import { tileRandom } from "./hash";

/**
 * §10: the `attempt`-th candidate spot for the shop on `day`, spread evenly over a disc
 * around the world's center. The server takes the first candidate on open, unclaimed land.
 */
export function shopCandidate(seed: string, day: number, attempt: number): TileCoord {
	const r = SHOP.radius * Math.sqrt(tileRandom(seed, "shop-r", day, attempt));
	const angle = tileRandom(seed, "shop-a", day, attempt) * Math.PI * 2;
	return { x: Math.round(Math.cos(angle) * r), y: Math.round(Math.sin(angle) * r) };
}
