import { neighbors4, type TileCoord, tileKey } from "../world/coords";
import { ENCLOSURE } from "./config";
import { isWallFor, type Tile } from "./tiles";
import type { PlayerId } from "./types";

/** Read-only access to resolved tiles; the caller decides how chunks are loaded. */
export type TileView = {
	tileAt(x: number, y: number): Tile;
};

export type Enclosure = {
	readonly id: string;
	readonly ownerId: PlayerId;
	/** Used to break ties between equally small overlapping enclosures (§5 Nesting). */
	readonly createdAt: number;
	/** Interior tiles as `tileKey`s. Excludes the owner's walls, includes others' fences. */
	readonly tiles: ReadonlySet<string>;
};

export type EnclosureLimits = {
	readonly maxArea: number;
	readonly minOwnFenceBorderShare: number;
	readonly holeSearchLimit: number;
};

export type Region = {
	readonly tiles: ReadonlySet<string>;
	readonly coords: readonly TileCoord[];
};

type FillResult =
	| { readonly closed: true; readonly region: Region }
	/** `visited` lets callers skip other starts in the same open area. */
	| { readonly closed: false; readonly visited: ReadonlySet<string> };

/**
 * 4-directional fill over tiles that aren't walls for `ownerId`.
 * Growing past `maxArea` means the area is open: in an infinite world that is the only bound.
 */
export function fillRegion(
	ownerId: PlayerId,
	start: TileCoord,
	view: TileView,
	maxArea: number,
): FillResult {
	if (isWallFor(view.tileAt(start.x, start.y), ownerId))
		return { closed: false, visited: new Set() };
	const tiles = new Set<string>([tileKey(start.x, start.y)]);
	const coords: TileCoord[] = [start];
	for (let i = 0; i < coords.length; i++) {
		const c = coords[i] as TileCoord;
		for (const n of neighbors4(c.x, c.y)) {
			const key = tileKey(n.x, n.y);
			if (tiles.has(key) || isWallFor(view.tileAt(n.x, n.y), ownerId)) continue;
			if (tiles.size >= maxArea) return { closed: false, visited: tiles };
			tiles.add(key);
			coords.push(n);
		}
	}
	return { closed: true, region: { tiles, coords } };
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function boundingBox(coords: readonly TileCoord[]): Box {
	const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	for (const { x, y } of coords) {
		box.minX = Math.min(box.minX, x);
		box.minY = Math.min(box.minY, y);
		box.maxX = Math.max(box.maxX, x);
		box.maxY = Math.max(box.maxY, y);
	}
	return box;
}

const NEIGHBORS_8 = [
	[-1, -1],
	[0, -1],
	[1, -1],
	[-1, 0],
	[1, 0],
	[-1, 1],
	[0, 1],
	[1, 1],
] as const;

/**
 * Marks which wall tiles touching the region connect to the outside, as opposed to
 * lakes or hills lying fully inside it. The complement is walked 8-directionally
 * because the region itself is 4-connected.
 */
function findOuterWalls(region: Region, wallKeys: ReadonlySet<string>, limit: number): Set<string> {
	const box = boundingBox(region.coords);
	const outer = new Set<string>();
	const decided = new Set<string>();

	for (const startKey of wallKeys) {
		if (decided.has(startKey)) continue;
		const [sx, sy] = startKey.split(",").map(Number) as [number, number];
		const seen = new Set<string>([startKey]);
		const queue: TileCoord[] = [{ x: sx, y: sy }];
		let escapes = false;
		for (let i = 0; i < queue.length && !escapes; i++) {
			const c = queue[i] as TileCoord;
			if (c.x <= box.minX || c.x >= box.maxX || c.y <= box.minY || c.y >= box.maxY) {
				escapes = true;
				break;
			}
			if (seen.size > limit) {
				escapes = true;
				break;
			}
			for (const [dx, dy] of NEIGHBORS_8) {
				const n = { x: c.x + dx, y: c.y + dy };
				const key = tileKey(n.x, n.y);
				if (seen.has(key) || region.tiles.has(key)) continue;
				seen.add(key);
				queue.push(n);
			}
		}
		for (const key of seen) {
			if (!wallKeys.has(key)) continue;
			decided.add(key);
			if (escapes) outer.add(key);
		}
	}
	return outer;
}

/**
 * Share of the region's outer border made of the owner's own fences, counted per tile edge.
 * Lakes and hills inside the region are holes and don't count (§5).
 */
export function ownFenceBorderShare(
	ownerId: PlayerId,
	region: Region,
	view: TileView,
	holeSearchLimit: number = ENCLOSURE.holeSearchLimit,
): number {
	const edges: { wallKey: string; isFence: boolean }[] = [];
	const wallKeys = new Set<string>();
	for (const c of region.coords) {
		for (const n of neighbors4(c.x, c.y)) {
			const key = tileKey(n.x, n.y);
			if (region.tiles.has(key)) continue;
			// Every non-region neighbor is a wall for the owner, since the fill is maximal.
			wallKeys.add(key);
			const tile = view.tileAt(n.x, n.y);
			edges.push({
				wallKey: key,
				isFence: tile.kind === "fence" && tile.fence.ownerId === ownerId,
			});
		}
	}
	const outer = findOuterWalls(region, wallKeys, holeSearchLimit);
	let fence = 0;
	let total = 0;
	for (const e of edges) {
		if (!outer.has(e.wallKey)) continue;
		total++;
		if (e.isFence) fence++;
	}
	return total === 0 ? 0 : fence / total;
}

export function isClaimableRegion(
	ownerId: PlayerId,
	region: Region,
	view: TileView,
	limits: EnclosureLimits = ENCLOSURE,
): boolean {
	return (
		ownFenceBorderShare(ownerId, region, view, limits.holeSearchLimit) >=
		limits.minOwnFenceBorderShare
	);
}

export type RecomputeInput = {
	readonly ownerId: PlayerId;
	/** The tile where one of `ownerId`'s fences was just placed or removed. */
	readonly changed: TileCoord;
	/** The world after the change. */
	readonly view: TileView;
	/** All current enclosures of `ownerId`. */
	readonly existing: readonly Enclosure[];
	readonly now: number;
	readonly newId: () => string;
	readonly limits?: EnclosureLimits;
};

export type EnclosureChanges = {
	readonly removed: readonly Enclosure[];
	readonly added: readonly Enclosure[];
};

function sameTiles(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
	if (a.size !== b.size) return false;
	for (const k of a) if (!b.has(k)) return false;
	return true;
}

function overlaps(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
	const [small, large] = a.size <= b.size ? [a, b] : [b, a];
	for (const k of small) if (large.has(k)) return true;
	return false;
}

/**
 * §5 / §11: after one of `ownerId`'s fences is placed or removed, find which of their
 * enclosures disappear (breach, split, merge) and which appear.
 * Only that owner's enclosures can change, because other players' fences are open ground to them.
 */
export function recomputeOwnerEnclosures(input: RecomputeInput): EnclosureChanges {
	const { ownerId, changed, view, existing, now, newId } = input;
	const limits = input.limits ?? ENCLOSURE;

	// Any affected region contains the changed tile or one of its neighbors:
	// connectivity through a single tile can only change next to it.
	const starts = [changed, ...neighbors4(changed.x, changed.y)];
	const startKeys = starts.map((s) => tileKey(s.x, s.y));
	const affected = existing.filter((e) => startKeys.some((k) => e.tiles.has(k)));

	const covered = new Set<string>();
	const regions: Region[] = [];
	for (const start of starts) {
		if (covered.has(tileKey(start.x, start.y))) continue;
		const fill = fillRegion(ownerId, start, view, limits.maxArea);
		const reached = fill.closed ? fill.region.tiles : fill.visited;
		for (const k of reached) covered.add(k);
		if (!fill.closed) continue;
		if (isClaimableRegion(ownerId, fill.region, view, limits)) regions.push(fill.region);
	}

	const kept = new Set<Enclosure>();
	const added: Enclosure[] = [];
	for (const region of regions) {
		const unchanged = affected.find((e) => sameTiles(e.tiles, region.tiles));
		if (unchanged) {
			kept.add(unchanged);
			continue;
		}
		// A split or merged area keeps the age of the oldest land it came from.
		const sources = affected.filter((e) => overlaps(e.tiles, region.tiles));
		const createdAt = sources.length ? Math.min(...sources.map((e) => e.createdAt)) : now;
		added.push({ id: newId(), ownerId, createdAt, tiles: region.tiles });
	}
	const removed = affected.filter((e) => !kept.has(e));
	return { removed, added };
}
