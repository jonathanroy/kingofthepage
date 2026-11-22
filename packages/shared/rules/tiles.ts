import type { Forage } from "../world/forage";
import type { MineSize } from "../world/mines";
import type { Terrain } from "../world/terrain";
import { FORAGE, TREE } from "./config";
import type { AllyCheck, Fence, PlayerId } from "./types";

/** What the server stores on top of the generated terrain for one tile. */
export type TileDiff = {
	readonly choppedAt?: number;
	readonly fence?: Fence;
	/** Iron already mined from this tile's ore rock (§2 Iron ore). Never resets. */
	readonly oreMined?: number;
	/** When this tile's apples, berries or potatoes were last harvested (§8 Food). */
	readonly harvestedAt?: number;
};

/** A tile as players experience it at a given moment. */
export type Tile =
	| { readonly kind: "grass" }
	| { readonly kind: "stump"; readonly choppedAt: number }
	/** `apples` is set on apple trees only: true when ripe, false right after picking (§8). */
	| { readonly kind: "tree"; readonly apples?: boolean }
	| { readonly kind: "water" }
	| { readonly kind: "hill" }
	/** §6: solid, can't hold a fence, doesn't block enclosure. */
	| { readonly kind: "mine"; readonly size: MineSize }
	/** §2: solid like a tree; `remaining` iron until it turns to rubble for good. */
	| { readonly kind: "ore"; readonly remaining: number; readonly capacity: number }
	/** An emptied ore rock: walkable, buildable ground. */
	| { readonly kind: "rubble" }
	/** §8: a berry bush, solid like a tree; `ready` when berries can be picked. */
	| { readonly kind: "bush"; readonly ready: boolean }
	/** §8: a wild potato patch, walkable; `ready` when potatoes can be dug. */
	| { readonly kind: "potato"; readonly ready: boolean }
	| { readonly kind: "fence"; readonly fence: Fence };

/** Seed-placed features and live facts that change how a tile resolves. */
export type TileExtras = {
	/** A player stands here: a tree waits for the stump to be empty before growing back (§2). */
	readonly occupied?: boolean;
	readonly mine?: MineSize | null;
	/** Starting iron of an ore rock here. */
	readonly ore?: number | null;
	readonly forage?: Forage | null;
};

/** §11 Lazy updates: a chopped tree exists again once the regrow delay has passed. */
export function isTreeRegrown(choppedAt: number, now: number): boolean {
	return now - choppedAt >= TREE.regrowDelayMs;
}

/** §8: a harvested plant is ready again once its regrow delay has passed. */
export function isForageReady(
	forage: Forage,
	harvestedAt: number | undefined,
	now: number,
): boolean {
	return harvestedAt === undefined || now - harvestedAt >= FORAGE[forage].regrowMs;
}

export function resolveTile(
	terrain: Terrain,
	diff: TileDiff | undefined,
	now: number,
	extras: TileExtras = {},
): Tile {
	if (extras.mine) return { kind: "mine", size: extras.mine };
	// A fence on a stump (or on rubble) wins: nothing grows through a fence.
	if (diff?.fence) return { kind: "fence", fence: diff.fence };
	if (extras.ore !== undefined && extras.ore !== null) {
		const remaining = extras.ore - (diff?.oreMined ?? 0);
		return remaining > 0 ? { kind: "ore", remaining, capacity: extras.ore } : { kind: "rubble" };
	}
	const forage = extras.forage ?? null;
	const ready = forage !== null && isForageReady(forage, diff?.harvestedAt, now);
	if (forage === "berry") return { kind: "bush", ready };
	if (forage === "potato") return { kind: "potato", ready };
	if (terrain === "tree") {
		const choppedAt = diff?.choppedAt;
		if (choppedAt !== undefined && (extras.occupied || !isTreeRegrown(choppedAt, now))) {
			return { kind: "stump", choppedAt };
		}
		return forage === "apple" ? { kind: "tree", apples: ready } : { kind: "tree" };
	}
	return { kind: terrain };
}

export function isWalkable(tile: Tile): boolean {
	return (
		tile.kind === "grass" ||
		tile.kind === "stump" ||
		tile.kind === "rubble" ||
		tile.kind === "potato"
	);
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
 * Other players' fences are open ground for this purpose. Trees, bushes and rocks never count.
 */
export function isWallFor(tile: Tile, ownerId: PlayerId): boolean {
	if (tile.kind === "fence") return tile.fence.ownerId === ownerId;
	return isTerrainWall(tile);
}

export function isTerrainWall(tile: Tile): boolean {
	return tile.kind === "water" || tile.kind === "hill";
}
