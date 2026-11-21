import { tileKey } from "../world/coords";
import type { Enclosure, EnclosureChanges } from "./enclosure";
import type { PlayerId } from "./types";

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
 * changed, which is when mine gold must be settled (§8).
 */
export class LandRegistry {
	private readonly byId = new Map<string, Enclosure>();
	private readonly byTile = new Map<string, Set<string>>();

	enclosuresOf(ownerId: PlayerId): Enclosure[] {
		return [...this.byId.values()].filter((e) => e.ownerId === ownerId);
	}

	enclosuresAt(x: number, y: number): Enclosure[] {
		return this.enclosuresAtKey(tileKey(x, y));
	}

	/** Every owner with an enclosure here: all of them may enter and chop (§2, §5 Nesting). */
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
			if (from !== to) result.push({ tile: k, from, to });
		}
		return result;
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
