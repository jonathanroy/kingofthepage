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
	readonly iron: number;
	readonly gold: number;
	readonly createdAt: number;
	readonly lastSeenAt: number;
};

export type StoredFence = {
	readonly x: number;
	readonly y: number;
	readonly ownerId: string;
	readonly level: number;
	readonly woodInvested: number;
	readonly ironInvested: number;
	readonly damage: number;
	readonly gate: boolean;
};

/** Only controlled mines are stored; size and position come from the seed (§6). */
export type StoredMine = {
	readonly x: number;
	readonly y: number;
	readonly controllerId: string;
	readonly controlledSince: number;
};

/** Stored with `a < b` so each pair has one row. */
export type StoredAlliance = { readonly a: string; readonly b: string };

export type StoredChop = { readonly x: number; readonly y: number; readonly choppedAt: number };

/** Iron mined from the ore rock on a tile; rocks never regrow, so rows are never removed. */
export type StoredOre = { readonly x: number; readonly y: number; readonly mined: number };

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
	readonly ore: readonly StoredOre[];
	readonly enclosures: readonly StoredEnclosure[];
	readonly alliances: readonly StoredAlliance[];
	readonly mines: readonly StoredMine[];
};

export type WriteBatch = {
	readonly players: readonly StoredPlayer[];
	readonly fencesSet: readonly StoredFence[];
	readonly fencesRemoved: readonly { readonly x: number; readonly y: number }[];
	readonly chopsSet: readonly StoredChop[];
	readonly chopsRemoved: readonly { readonly x: number; readonly y: number }[];
	readonly oreSet: readonly StoredOre[];
	readonly enclosuresAdded: readonly StoredEnclosure[];
	readonly enclosuresRemoved: readonly string[];
	readonly alliancesSet: readonly StoredAlliance[];
	readonly alliancesRemoved: readonly StoredAlliance[];
	readonly minesSet: readonly StoredMine[];
	readonly minesRemoved: readonly { readonly x: number; readonly y: number }[];
};

export function isEmptyBatch(b: WriteBatch): boolean {
	return (
		b.players.length +
			b.fencesSet.length +
			b.fencesRemoved.length +
			b.chopsSet.length +
			b.chopsRemoved.length +
			b.oreSet.length +
			b.enclosuresAdded.length +
			b.enclosuresRemoved.length +
			b.alliancesSet.length +
			b.alliancesRemoved.length +
			b.minesSet.length +
			b.minesRemoved.length ===
		0
	);
}

export interface WorldStore {
	load(): Promise<WorldSnapshot>;
	write(batch: WriteBatch): Promise<void>;
	close(): Promise<void>;
}
