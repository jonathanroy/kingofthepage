import type {
	StoredAlliance,
	StoredChop,
	StoredEnclosure,
	StoredFence,
	StoredMine,
	StoredPlayer,
	WorldSnapshot,
	WorldStore,
	WriteBatch,
} from "./store";

/** For tests and for running without a database. */
export class MemoryStore implements WorldStore {
	readonly players = new Map<string, StoredPlayer>();
	readonly fences = new Map<string, StoredFence>();
	readonly chops = new Map<string, StoredChop>();
	readonly enclosures = new Map<string, StoredEnclosure>();
	readonly alliances = new Map<string, StoredAlliance>();
	readonly mines = new Map<string, StoredMine>();
	writes = 0;

	async load(): Promise<WorldSnapshot> {
		return {
			players: [...this.players.values()],
			fences: [...this.fences.values()],
			chops: [...this.chops.values()],
			enclosures: [...this.enclosures.values()],
			alliances: [...this.alliances.values()],
			mines: [...this.mines.values()],
		};
	}

	async write(batch: WriteBatch): Promise<void> {
		this.writes++;
		for (const p of batch.players) this.players.set(p.id, p);
		for (const f of batch.fencesRemoved) this.fences.delete(`${f.x},${f.y}`);
		for (const f of batch.fencesSet) this.fences.set(`${f.x},${f.y}`, f);
		for (const c of batch.chopsRemoved) this.chops.delete(`${c.x},${c.y}`);
		for (const c of batch.chopsSet) this.chops.set(`${c.x},${c.y}`, c);
		for (const id of batch.enclosuresRemoved) this.enclosures.delete(id);
		for (const e of batch.enclosuresAdded) this.enclosures.set(e.id, e);
		for (const a of batch.alliancesRemoved) this.alliances.delete(`${a.a}|${a.b}`);
		for (const a of batch.alliancesSet) this.alliances.set(`${a.a}|${a.b}`, a);
		for (const m of batch.minesRemoved) this.mines.delete(`${m.x},${m.y}`);
		for (const m of batch.minesSet) this.mines.set(`${m.x},${m.y}`, m);
	}

	async close(): Promise<void> {}
}
