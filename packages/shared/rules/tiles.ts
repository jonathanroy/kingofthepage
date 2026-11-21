import type { MineSize } from "../world/mines";
import type { Terrain } from "../world/terrain";
import { TREE } from "./config";
import type { AllyCheck, Fence, PlayerId } from "./types";

/** What the server stores on top of the generated terrain for one tile. */
export type TileDiff = {
	readonly choppedAt?: number;
	readonly fence?: Fence;
	/** Iron already mined from this tile's ore rock (§2 Iron ore). Never resets. */
	readonly oreMined?: number;
};

/** A tile as players experience it at a given moment. */
export type Tile =
	| { readonly kind: "grass" }
	| { readonly kind: "stump"; readonly choppedAt: number }
	| { readonly kind: "tree" }
	| { readonly kind: "water" }
	| { readonly kind: "hill" }
	/** §6: solid, can't hold a fence, doesn't block enclosure. */
	| { readonly kind: "mine"; readonly size: MineSize }
	/** §2: solid like a tree; `remaining` iron until it turns to rubble for good. */
	| { readonly kind: "ore"; readonly remaining: number; readonly capacity: number }
	/** An emptied ore rock: walkable, buildable ground. */
	| { readonly kind: "rubble" }
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
	mine: MineSize | null = null,
	oreCapacity: number | null = null,
): Tile {
	if (mine) return { kind: "mine", size: mine };
	// A fence on a stump (or on rubble) wins: nothing grows through a fence.
	if (diff?.fence) return { kind: "fence", fence: diff.fence };
	if (oreCapacity !== null) {
		const remaining = oreCapacity - (diff?.oreMined ?? 0);
		return remaining > 0 ? { kind: "ore", remaining, capacity: oreCapacity } : { kind: "rubble" };
	}
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
	return tile.kind === "grass" || tile.kind === "stump" || tile.kind === "rubble";
}

/** Walkable for this player, including gates they may pass (§3 Gates). */
export function isWalkableFor(tile: Tile, playerId: PlayerId, isAlly: AllyCheck): boolean {
	if (tile.kind === "fence") {
		return tile.fence.gate && (tile.fence.ownerId === playerId || isAlly(tile.fence.ownerId));
	}
	return isWalkable(tile);
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
