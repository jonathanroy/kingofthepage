export const CHUNK_SIZE = 32;

export type TileCoord = { readonly x: number; readonly y: number };
export type ChunkCoord = { readonly cx: number; readonly cy: number };

// Math.floor, not truncation: tile -1 must be in chunk -1, not chunk 0.
export function tileToChunk(t: number): number {
	return Math.floor(t / CHUNK_SIZE);
}

export function chunkOfTile(x: number, y: number): ChunkCoord {
	return { cx: tileToChunk(x), cy: tileToChunk(y) };
}

/** Position inside its chunk, always in [0, CHUNK_SIZE). */
export function tileToLocal(t: number): number {
	return t - tileToChunk(t) * CHUNK_SIZE;
}

export function chunkOrigin(cx: number, cy: number): TileCoord {
	return { x: cx * CHUNK_SIZE, y: cy * CHUNK_SIZE };
}

/** Index into a chunk's row-major tile array. */
export function localIndex(lx: number, ly: number): number {
	return ly * CHUNK_SIZE + lx;
}

export function tileKey(x: number, y: number): string {
	return `${x},${y}`;
}

export function chunkKey(cx: number, cy: number): string {
	return `${cx},${cy}`;
}

const NEIGHBOR_OFFSETS = [
	[0, -1],
	[1, 0],
	[0, 1],
	[-1, 0],
] as const;

/** 4-directional only: players can't move diagonally (§1, §5 Enclosure). */
export function neighbors4(x: number, y: number): TileCoord[] {
	return NEIGHBOR_OFFSETS.map(([dx, dy]) => ({ x: x + dx, y: y + dy }));
}
