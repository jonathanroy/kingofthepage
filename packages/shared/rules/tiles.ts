import type { Terrain } from "../world/terrain";
import { TREE } from "./config";
import type { Fence, PlayerId } from "./types";

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

/**
 * @param occupied whether a player stands on the tile: a tree waits for the stump
 *   to be empty before growing back (§2).
 */
export function resolveTile(
	terrain: Terrain,
	diff: TileDiff | undefined,
	now: number,
	occupied = false,
): Tile {
	// A fence on a stump wins: a tree can't grow through a fence.
	if (diff?.fence) return { kind: "fence", fence: diff.fence };
	if (terrain === "tree") {
		const choppedAt = diff?.choppedAt;
		if (choppedAt !== undefined && (occupied || !isTreeRegrown(choppedAt, now))) {
			return { kind: "stump", choppedAt };
		}
		return { kind: "tree" };
	}
	return { kind: terrain };
}

export function isWalkable(tile: Tile): boolean {
	return tile.kind === "grass" || tile.kind === "stump";
}

/**
 * §5 Enclosure: an owner's own fences, water and hills close an area for that owner.
 * Other players' fences are open ground for this purpose. Trees never count.
 */
export function isWallFor(tile: Tile, ownerId: PlayerId): boolean {
	if (tile.kind === "fence") return tile.fence.ownerId === ownerId;
	return isTerrainWall(tile);
}

export function isTerrainWall(tile: Tile): boolean {
	return tile.kind === "water" || tile.kind === "hill";
}
