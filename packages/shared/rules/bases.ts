import type { Enclosure } from "./enclosure";

export type Base = { readonly x: number; readonly y: number; readonly area: number };

/** §10 Flag compass: a base's spot is the middle of its enclosure, rounded to a tile. */
export function baseOf(e: Enclosure): Base {
	let sx = 0;
	let sy = 0;
	for (const key of e.tiles) {
		const [x, y] = key.split(",").map(Number) as [number, number];
		sx += x;
		sy += y;
	}
	const n = Math.max(1, e.tiles.size);
	return { x: Math.round(sx / n), y: Math.round(sy / n), area: e.tiles.size };
}

/** Largest first, so the main base comes first in the compass. */
export function basesOf(enclosures: readonly Enclosure[]): Base[] {
	return enclosures.map(baseOf).sort((a, b) => b.area - a.area);
}
