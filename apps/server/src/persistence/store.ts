import type { Direction } from "@kotp/shared/world";

// Only what can't be derived from the seed and these rows is stored (CLAUDE.md Persistence).
// Enclosure tiles and tile controllers are rebuilt on load from fences and an anchor tile.

export type StoredPlayer = {
	readonly id: string;
	readonly handle: string;
	readonly tokenHash: string;
	readonly x: number;
	readonly y: number;
	readonly facing: Direction;
	readonly wood: number;
	readonly createdAt: number;
	readonly lastSeenAt: number;
};

export type StoredFence = {
	readonly x: number;
	readonly y: number;
	readonly ownerId: string;
	readonly level: number;
	readonly woodInvested: number;
};

export type StoredChop = { readonly x: number; readonly y: number; readonly choppedAt: number };

export type StoredEnclosure = {
	readonly id: string;
	readonly ownerId: string;
	readonly createdAt: number;
	/** Any interior tile; the enclosure is refilled from here on load. */
	readonly anchorX: number;
	readonly anchorY: number;
};

export type WorldSnapshot = {
	readonly players: readonly StoredPlayer[];
	readonly fences: readonly StoredFence[];
	readonly chops: readonly StoredChop[];
	readonly enclosures: readonly StoredEnclosure[];
};

export type WriteBatch = {
	readonly players: readonly StoredPlayer[];
	readonly fencesSet: readonly StoredFence[];
	readonly fencesRemoved: readonly { readonly x: number; readonly y: number }[];
	readonly chopsSet: readonly StoredChop[];
	readonly chopsRemoved: readonly { readonly x: number; readonly y: number }[];
	readonly enclosuresAdded: readonly StoredEnclosure[];
	readonly enclosuresRemoved: readonly string[];
};

export function isEmptyBatch(b: WriteBatch): boolean {
	return (
		b.players.length +
			b.fencesSet.length +
			b.fencesRemoved.length +
			b.chopsSet.length +
			b.chopsRemoved.length +
			b.enclosuresAdded.length +
			b.enclosuresRemoved.length ===
		0
	);
}

export interface WorldStore {
	load(): Promise<WorldSnapshot>;
	write(batch: WriteBatch): Promise<void>;
	close(): Promise<void>;
}
