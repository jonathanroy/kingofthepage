import { tileKey } from "../../world/coords";
import { type EnclosureLimits, recomputeOwnerEnclosures, type TileView } from "../enclosure";
import { buildFence } from "../fences";
import { type ControllerChange, type FenceAt, LandRegistry } from "../land";
import type { Tile } from "../tiles";

/**
 * Test world drawn as ASCII. `.` grass, `~` water, `^` hill, `T` tree,
 * a lowercase letter is a fence owned by that player. Everything off the map is grass.
 * The map's top-left tile is at (originX, originY).
 */
export class AsciiWorld implements TileView {
	readonly land = new LandRegistry();
	private readonly tiles = new Map<string, Tile>();
	private nextId = 1;
	now = 1000;

	constructor(
		map: string,
		private readonly originX = 0,
		private readonly originY = 0,
		private readonly limits?: EnclosureLimits,
	) {
		const rows = map
			.split("\n")
			.map((r) => r.replace(/\s+/g, ""))
			.filter((r) => r.length > 0);
		rows.forEach((row, y) => {
			[...row].forEach((ch, x) => {
				this.tiles.set(tileKey(originX + x, originY + y), parseTile(ch));
			});
		});
	}

	tileAt(x: number, y: number): Tile {
		return this.tiles.get(tileKey(x, y)) ?? { kind: "grass" };
	}

	/**
	 * Builds every fence on the map one at a time, in reading order.
	 * With `ownerOrder`, all of the first owner's fences are built before the next owner's.
	 */
	buildAllFences(ownerOrder: readonly string[] = []): void {
		const rank = (t: Tile) => (t.kind === "fence" ? ownerOrder.indexOf(t.fence.ownerId) : -1);
		const fences = [...this.tiles.entries()]
			.filter(([, t]) => t.kind === "fence")
			.sort(([, a], [, b]) => rank(a) - rank(b));
		for (const [key] of fences) this.tiles.set(key, { kind: "grass" });
		for (const [key, t] of fences) {
			if (t.kind !== "fence") continue;
			const [x, y] = key.split(",").map(Number) as [number, number];
			this.placeFence(x - this.originX, y - this.originY, t.fence.ownerId);
		}
	}

	/** Coordinates are relative to the map's top-left corner. */
	placeFence(mx: number, my: number, ownerId: string): ControllerChange[] {
		const x = mx + this.originX;
		const y = my + this.originY;
		this.tiles.set(tileKey(x, y), { kind: "fence", fence: buildFence(ownerId) });
		return this.recompute(ownerId, x, y);
	}

	breakFence(mx: number, my: number): ControllerChange[] {
		const x = mx + this.originX;
		const y = my + this.originY;
		const tile = this.tileAt(x, y);
		if (tile.kind !== "fence") throw new Error(`No fence at ${mx},${my}`);
		this.tiles.set(tileKey(x, y), { kind: "grass" });
		return this.recompute(tile.fence.ownerId, x, y);
	}

	fences(): FenceAt[] {
		return [...this.tiles.entries()].flatMap(([key, t]) => {
			if (t.kind !== "fence") return [];
			const [x, y] = key.split(",").map(Number) as [number, number];
			return [{ x, y, ownerId: t.fence.ownerId }];
		});
	}

	controllerAt(mx: number, my: number): string | null {
		return this.land.controllerAt(mx + this.originX, my + this.originY);
	}

	ownersAt(mx: number, my: number): string[] {
		return this.land.ownersAt(mx + this.originX, my + this.originY).sort();
	}

	/** Controller map in the same shape as the input: owner letter, or `.` when unclaimed. */
	controllerMap(width: number, height: number): string {
		const rows: string[] = [];
		for (let y = 0; y < height; y++) {
			let row = "";
			for (let x = 0; x < width; x++) row += this.controllerAt(x, y) ?? ".";
			rows.push(row);
		}
		return rows.join("\n");
	}

	private recompute(ownerId: string, x: number, y: number): ControllerChange[] {
		this.now += 1;
		const changes = recomputeOwnerEnclosures({
			ownerId,
			changed: { x, y },
			view: this,
			existing: this.land.enclosuresOf(ownerId),
			now: this.now,
			newId: () => `e${this.nextId++}`,
			...(this.limits ? { limits: this.limits } : {}),
		});
		return this.land.apply(changes);
	}
}

function parseTile(ch: string): Tile {
	switch (ch) {
		case ".":
			return { kind: "grass" };
		case "~":
			return { kind: "water" };
		case "^":
			return { kind: "hill" };
		case "T":
			return { kind: "tree" };
		default:
			if (/^[a-z]$/.test(ch)) return { kind: "fence", fence: buildFence(ch) };
			throw new Error(`Unknown map character "${ch}"`);
	}
}

/** Trims the indentation of a template-literal map. */
export function map(strings: TemplateStringsArray): string {
	return strings.join("").trim();
}
