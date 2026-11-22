import { tileKey } from "../world/coords";
import type { Enclosure, EnclosureChanges } from "./enclosure";
import type { PlayerId } from "./types";

export type FenceAt = { readonly x: number; readonly y: number; readonly ownerId: PlayerId };

const AROUND = [
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
 * §7 Land leaderboard score per player:
 * - every tile they control (innermost owner), except other players' fences standing in it;
 * - plus their own fence and gate tiles that wall one of their enclosures (corners included).
 * Stray fences that wall nothing don't count, so scattering fences can't farm the score.
 */
export function landScores(land: LandRegistry, fences: Iterable<FenceAt>): Map<PlayerId, number> {
	const scores = land.controlledTileCounts();
	const bump = (id: PlayerId, delta: number) => scores.set(id, (scores.get(id) ?? 0) + delta);
	for (const f of fences) {
		const controller = land.controllerAt(f.x, f.y);
		// A fence is never inside its own owner's enclosure, so this is always someone else's land.
		if (controller !== null && controller !== f.ownerId) bump(controller, -1);
		const wallsOwnLand = AROUND.some(([dx, dy]) =>
			land.enclosuresAt(f.x + dx, f.y + dy).some((e) => e.ownerId === f.ownerId),
		);
		if (wallsOwnLand) bump(f.ownerId, 1);
	}
	for (const [id, n] of scores) if (n <= 0) scores.delete(id);
	return scores;
}

/** §5 Nesting: the smallest enclosure controls the tile; on a tie, the older one. */
export function pickController(containing: readonly Enclosure[]): PlayerId | null {
	let best: Enclosure | null = null;
	for (const e of containing) {
		if (
			best === null ||
			e.tiles.size < best.tiles.size ||
			(e.tiles.size === best.tiles.size &&
				(e.createdAt < best.createdAt || (e.createdAt === best.createdAt && e.id < best.id)))
		) {
			best = e;
		}
	}
	return best?.ownerId ?? null;
}

export type ControllerChange = {
	readonly tile: string;
	readonly from: PlayerId | null;
	readonly to: PlayerId | null;
};

/**
 * In-memory index of every enclosure, by tile and by owner.
 * The server applies enclosure changes here and gets back the tiles whose controller
 * changed, which is when mine gold must be settled (§11).
 */
export class LandRegistry {
	private readonly byId = new Map<string, Enclosure>();
	private readonly byTile = new Map<string, Set<string>>();
	/** §7 Land leaderboard: tiles each player currently controls. */
	private readonly controlledCounts = new Map<PlayerId, number>();

	enclosuresOf(ownerId: PlayerId): Enclosure[] {
		return [...this.byId.values()].filter((e) => e.ownerId === ownerId);
	}

	enclosuresAt(x: number, y: number): Enclosure[] {
		return this.enclosuresAtKey(tileKey(x, y));
	}

	/** Every owner with an enclosure here: all of them may enter (§5 Nesting). */
	ownersAt(x: number, y: number): PlayerId[] {
		return [...new Set(this.enclosuresAt(x, y).map((e) => e.ownerId))];
	}

	controllerAt(x: number, y: number): PlayerId | null {
		return pickController(this.enclosuresAt(x, y));
	}

	apply(changes: EnclosureChanges): ControllerChange[] {
		const touched = new Set<string>();
		for (const e of [...changes.removed, ...changes.added]) {
			for (const k of e.tiles) touched.add(k);
		}
		const before = new Map<string, PlayerId | null>();
		for (const k of touched) before.set(k, pickController(this.enclosuresAtKey(k)));

		for (const e of changes.removed) this.remove(e.id);
		for (const e of changes.added) this.add(e);

		const result: ControllerChange[] = [];
		for (const k of touched) {
			const from = before.get(k) ?? null;
			const to = pickController(this.enclosuresAtKey(k));
			if (from !== to) {
				result.push({ tile: k, from, to });
				if (from) this.bumpCount(from, -1);
				if (to) this.bumpCount(to, 1);
			}
		}
		return result;
	}

	controlledTileCount(ownerId: PlayerId): number {
		return this.controlledCounts.get(ownerId) ?? 0;
	}

	/** Every player with at least one controlled tile, with their count. */
	controlledTileCounts(): Map<PlayerId, number> {
		return new Map(this.controlledCounts);
	}

	private bumpCount(ownerId: PlayerId, delta: number): void {
		const n = (this.controlledCounts.get(ownerId) ?? 0) + delta;
		if (n > 0) this.controlledCounts.set(ownerId, n);
		else this.controlledCounts.delete(ownerId);
	}

	private enclosuresAtKey(key: string): Enclosure[] {
		const ids = this.byTile.get(key);
		if (!ids) return [];
		return [...ids].map((id) => this.byId.get(id)).filter((e): e is Enclosure => e !== undefined);
	}

	private add(e: Enclosure): void {
		this.byId.set(e.id, e);
		for (const k of e.tiles) {
			let ids = this.byTile.get(k);
			if (!ids) {
				ids = new Set();
				this.byTile.set(k, ids);
			}
			ids.add(e.id);
		}
	}

	private remove(id: string): void {
		const e = this.byId.get(id);
		if (!e) return;
		this.byId.delete(id);
		for (const k of e.tiles) {
			const ids = this.byTile.get(k);
			ids?.delete(id);
			if (ids?.size === 0) this.byTile.delete(k);
		}
	}
}
