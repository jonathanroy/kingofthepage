import type { Terrain } from "../world/terrain";
import { TREE } from "./config";
import type { Fence } from "./types";

/** What the server stores on top of the generated terrain for one tile. */
export type TileDiff = {
	readonly choppedAt?: number;
	readonly fence?: Fence;
};

/** A tile as players experience it at a given moment. */
export type Tile =
	| { readonly kind: "grass" }
	| { readonly kind: "stump"; readonly choppedAt: number }
	| { readonly kind: "tree" }
	| { readonly kind: "water" }
	| { readonly kind: "hill" }
	| { readonly kind: "fence"; readonly fence: Fence };

/** §8 Lazy updates: a chopped tree exists again once the regrow delay has passed. */
export function isTreeRegrown(choppedAt: number, now: number): boolean {
	return now - choppedAt >= TREE.regrowDelayMs;
}

export function resolveTile(terrain: Terrain, diff: TileDiff | undefined, now: number): Tile {
	// A fence on a stump wins: a tree can't grow through a fence.
	if (diff?.fence) return { kind: "fence", fence: diff.fence };
	if (terrain === "tree") {
		if (diff?.choppedAt !== undefined && !isTreeRegrown(diff.choppedAt, now)) {
			return { kind: "stump", choppedAt: diff.choppedAt };
		}
		return { kind: "tree" };
	}
	return { kind: terrain };
}

export function isWalkable(tile: Tile): boolean {
	return tile.kind === "grass" || tile.kind === "stump";
}

/** §5 Enclosure: fences (and later gates), water and hills close an area. Trees don't. */
export function isWall(tile: Tile): boolean {
	return tile.kind === "fence" || tile.kind === "water" || tile.kind === "hill";
}
