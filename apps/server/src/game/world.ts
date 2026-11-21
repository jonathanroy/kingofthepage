import type {
	ActionRejectReason,
	ChunkControl,
	FenceInfo,
	PlayerInfo,
} from "@kotp/shared/protocol";
import {
	buildFence,
	type ControllerChange,
	canChopTree,
	canEnterTile,
	canPlaceFence,
	ENCLOSURE,
	type Enclosure,
	type EnclosureChanges,
	type Fence,
	type FenceLevel,
	fenceBuildCost,
	fenceRefund,
	fillRegion,
	isWalkable,
	LandRegistry,
	normalizeHandle,
	PACE,
	recomputeOwnerEnclosures,
	resolveTile,
	type Tile,
	type TileDiff,
	type TileView,
	woodFromTree,
} from "@kotp/shared/rules";
import {
	CHUNK_SIZE,
	chunkKey,
	chunkOfTile,
	chunkOrigin,
	createTerrainGenerator,
	type Direction,
	localIndex,
	stepToward,
	type TerrainGenerator,
	type TileCoord,
	tileKey,
} from "@kotp/shared/world";
import type {
	StoredEnclosure,
	StoredFence,
	StoredPlayer,
	WorldSnapshot,
	WriteBatch,
} from "../persistence/store";

export type PlayerState = {
	readonly id: string;
	readonly handle: string;
	readonly tokenHash: string;
	readonly createdAt: number;
	x: number;
	y: number;
	facing: Direction;
	wood: number;
	lastSeenAt: number;
	online: boolean;
	nextMoveAt: number;
	nextActionAt: number;
};

/** Something clients may need to hear about. The game routes these by interest. */
export type WorldEvent =
	| { readonly kind: "tile"; readonly x: number; readonly y: number }
	| { readonly kind: "control"; readonly changes: readonly ControllerChange[] }
	| { readonly kind: "player"; readonly id: string; readonly fromX: number; readonly fromY: number }
	| { readonly kind: "inventory"; readonly id: string };

export type ActionResult =
	| { readonly ok: true; readonly events: readonly WorldEvent[] }
	| {
			readonly ok: false;
			readonly reason: ActionRejectReason;
			readonly events: readonly WorldEvent[];
	  };

type TileDiffAt = TileDiff & { readonly x: number; readonly y: number };

export type WorldDeps = {
	readonly seed: string;
	/** Randomness for wood rolls; injected so tests are deterministic. */
	readonly random: () => number;
	readonly newId: () => string;
	/** Defaults to the seeded generator; tests pass hand-drawn terrain. */
	readonly terrain?: TerrainGenerator;
};

/**
 * Authoritative in-memory world state. Every outcome is decided by the shared rules;
 * this class only stores state, applies results and records what must be persisted.
 */
export class World {
	readonly terrain: TerrainGenerator;
	readonly land = new LandRegistry();
	private readonly players = new Map<string, PlayerState>();
	private readonly handleIndex = new Map<string, string>();
	private readonly tokenIndex = new Map<string, string>();
	private readonly diffsByChunk = new Map<string, Map<string, TileDiffAt>>();
	private readonly fenceKeys = new Set<string>();
	private readonly occupancy = new Map<string, number>();

	private readonly dirtyPlayers = new Set<string>();
	private readonly dirtyTiles = new Map<string, TileCoord>();
	private readonly enclosuresAdded = new Map<string, StoredEnclosure>();
	private readonly enclosuresRemoved = new Set<string>();

	constructor(private readonly deps: WorldDeps) {
		this.terrain = deps.terrain ?? createTerrainGenerator(deps.seed);
	}

	// ---------- Loading and persistence ----------

	load(snapshot: WorldSnapshot, now: number): void {
		for (const p of snapshot.players)
			this.addPlayer({ ...p, online: false, nextMoveAt: 0, nextActionAt: 0 });
		for (const f of snapshot.fences) {
			this.setDiff(f.x, f.y, {
				fence: { ownerId: f.ownerId, level: f.level as FenceLevel, woodInvested: f.woodInvested },
			});
		}
		for (const c of snapshot.chops) {
			this.setDiff(c.x, c.y, { choppedAt: c.choppedAt });
		}
		const view = this.viewAt(now);
		const added: Enclosure[] = [];
		for (const e of snapshot.enclosures) {
			const fill = fillRegion(e.ownerId, { x: e.anchorX, y: e.anchorY }, view, ENCLOSURE.maxArea);
			if (fill.closed) {
				added.push({
					id: e.id,
					ownerId: e.ownerId,
					createdAt: e.createdAt,
					tiles: fill.region.tiles,
				});
			} else {
				// Stored state no longer matches the fences (e.g. a lost write); drop it.
				this.enclosuresRemoved.add(e.id);
			}
		}
		this.land.apply({ removed: [], added });
	}

	takeWriteBatch(): WriteBatch {
		const players = [...this.dirtyPlayers]
			.map((id) => this.players.get(id))
			.filter((p): p is PlayerState => p !== undefined)
			.map(toStoredPlayer);
		const fencesSet: StoredFence[] = [];
		const fencesRemoved: TileCoord[] = [];
		const chopsSet: { x: number; y: number; choppedAt: number }[] = [];
		const chopsRemoved: TileCoord[] = [];
		for (const { x, y } of this.dirtyTiles.values()) {
			const diff = this.getDiff(x, y);
			if (diff?.fence) fencesSet.push({ x, y, ...diff.fence });
			else fencesRemoved.push({ x, y });
			if (diff?.choppedAt !== undefined) chopsSet.push({ x, y, choppedAt: diff.choppedAt });
			else chopsRemoved.push({ x, y });
		}
		const batch: WriteBatch = {
			players,
			fencesSet,
			fencesRemoved,
			chopsSet,
			chopsRemoved,
			enclosuresAdded: [...this.enclosuresAdded.values()],
			enclosuresRemoved: [...this.enclosuresRemoved],
		};
		this.dirtyPlayers.clear();
		this.dirtyTiles.clear();
		this.enclosuresAdded.clear();
		this.enclosuresRemoved.clear();
		return batch;
	}

	// ---------- Tiles ----------

	viewAt(now: number): TileView {
		return { tileAt: (x, y) => this.tileAt(x, y, now) };
	}

	tileAt(x: number, y: number, now: number): Tile {
		const key = tileKey(x, y);
		return resolveTile(
			this.terrain.terrainAt(x, y),
			this.getDiff(x, y),
			now,
			(this.occupancy.get(key) ?? 0) > 0,
		);
	}

	isOccupied(x: number, y: number): boolean {
		return (this.occupancy.get(tileKey(x, y)) ?? 0) > 0;
	}

	fencePositions(): TileCoord[] {
		return [...this.fenceKeys].map(parseKey);
	}

	// ---------- Players ----------

	playerById(id: string): PlayerState | undefined {
		return this.players.get(id);
	}

	playerByHandle(handle: string): PlayerState | undefined {
		const id = this.handleIndex.get(normalizeHandle(handle));
		return id ? this.players.get(id) : undefined;
	}

	playerByTokenHash(tokenHash: string): PlayerState | undefined {
		const id = this.tokenIndex.get(tokenHash);
		return id ? this.players.get(id) : undefined;
	}

	onlinePlayers(): PlayerState[] {
		return [...this.players.values()].filter((p) => p.online);
	}

	handleOf(id: string): string | undefined {
		return this.players.get(id)?.handle;
	}

	createPlayer(input: {
		id: string;
		handle: string;
		tokenHash: string;
		at: TileCoord;
		now: number;
	}): PlayerState {
		const player: PlayerState = {
			id: input.id,
			handle: input.handle,
			tokenHash: input.tokenHash,
			createdAt: input.now,
			x: input.at.x,
			y: input.at.y,
			facing: "down",
			wood: 0,
			lastSeenAt: input.now,
			online: false,
			nextMoveAt: 0,
			nextActionAt: 0,
		};
		this.addPlayer(player);
		this.dirtyPlayers.add(player.id);
		return player;
	}

	setOnline(id: string, online: boolean, now: number): void {
		const p = this.players.get(id);
		if (!p || p.online === online) return;
		p.online = online;
		p.lastSeenAt = now;
		this.dirtyPlayers.add(id);
		if (online) this.occupy(p.x, p.y, 1);
		else this.occupy(p.x, p.y, -1);
	}

	/** Puts a player on a tile directly, bypassing movement rules. For tests and admin tools. */
	relocate(id: string, x: number, y: number, facing: Direction): void {
		const p = this.requirePlayer(id);
		if (p.online) this.occupy(p.x, p.y, -1);
		p.x = x;
		p.y = y;
		p.facing = facing;
		if (p.online) this.occupy(x, y, 1);
		this.dirtyPlayers.add(id);
	}

	playerInfo(p: PlayerState): PlayerInfo {
		return { id: p.id, handle: p.handle, x: p.x, y: p.y, facing: p.facing };
	}

	// ---------- Intents (§1 movement, §2 chopping, §3 fences) ----------

	move(id: string, dir: Direction, now: number): ActionResult {
		const p = this.requirePlayer(id);
		const from = { x: p.x, y: p.y };
		const turned = p.facing !== dir;
		p.facing = dir;
		this.dirtyPlayers.add(id);
		const turnEvents: WorldEvent[] = turned ? [{ kind: "player", id, fromX: p.x, fromY: p.y }] : [];

		const to = stepToward(p.x, p.y, dir);
		if (!isWalkable(this.tileAt(to.x, to.y, now))) {
			return { ok: false, reason: "blocked", events: turnEvents };
		}
		if (
			!canEnterTile(id, this.land.enclosuresAt(from.x, from.y), this.land.enclosuresAt(to.x, to.y))
		) {
			return { ok: false, reason: "noAccess", events: turnEvents };
		}
		this.occupy(from.x, from.y, -1);
		this.occupy(to.x, to.y, 1);
		p.x = to.x;
		p.y = to.y;
		p.nextMoveAt = now + PACE.moveIntervalMs;
		const events: WorldEvent[] = [{ kind: "player", id, fromX: from.x, fromY: from.y }];
		// Leaving a stump can let a waiting tree grow back (§2).
		if (this.getDiff(from.x, from.y)?.choppedAt !== undefined) {
			events.push({ kind: "tile", x: from.x, y: from.y });
		}
		return { ok: true, events };
	}

	chop(id: string, now: number): ActionResult {
		const p = this.requirePlayer(id);
		const target = stepToward(p.x, p.y, p.facing);
		const tile = this.tileAt(target.x, target.y, now);
		p.nextActionAt = now + PACE.actionIntervalMs;

		if (tile.kind === "tree") {
			if (!canChopTree(id, this.land.ownersAt(target.x, target.y))) {
				return { ok: false, reason: "notYourTree", events: [] };
			}
			this.updateDiff(target.x, target.y, { choppedAt: now });
			p.wood += woodFromTree(this.deps.random());
			this.dirtyPlayers.add(id);
			return {
				ok: true,
				events: [
					{ kind: "tile", ...target },
					{ kind: "inventory", id },
				],
			};
		}

		if (tile.kind === "fence") {
			// Breaking other players' fences comes with fence levels (PLAN.md M5).
			if (tile.fence.ownerId !== id) return { ok: false, reason: "notYourFence", events: [] };
			this.updateDiff(target.x, target.y, { fence: undefined });
			p.wood += fenceRefund(tile.fence);
			this.dirtyPlayers.add(id);
			const control = this.recomputeEnclosures(id, target, now);
			return {
				ok: true,
				events: [{ kind: "tile", ...target }, { kind: "inventory", id }, ...control],
			};
		}

		return { ok: false, reason: "nothingToChop", events: [] };
	}

	build(id: string, now: number): ActionResult {
		const p = this.requirePlayer(id);
		const target = stepToward(p.x, p.y, p.facing);
		const tile = this.tileAt(target.x, target.y, now);
		p.nextActionAt = now + PACE.actionIntervalMs;

		const placement = canPlaceFence(tile, this.isOccupied(target.x, target.y), p.wood);
		if (!placement.ok) return { ok: false, reason: placement.reason, events: [] };

		p.wood -= fenceBuildCost();
		this.dirtyPlayers.add(id);
		this.updateDiff(target.x, target.y, { fence: buildFence(id) });
		const control = this.recomputeEnclosures(id, target, now);
		return {
			ok: true,
			events: [{ kind: "tile", ...target }, { kind: "inventory", id }, ...control],
		};
	}

	// ---------- Client snapshots ----------

	chunkSnapshot(
		cx: number,
		cy: number,
	): {
		chopped: [number, number, number][];
		fences: FenceInfo[];
		control: ChunkControl;
		handles: Record<string, string>;
	} {
		const chopped: [number, number, number][] = [];
		const fences: FenceInfo[] = [];
		for (const d of this.diffsByChunk.get(chunkKey(cx, cy))?.values() ?? []) {
			if (d.choppedAt !== undefined) chopped.push([d.x, d.y, d.choppedAt]);
			if (d.fence) fences.push(fenceInfo(d.x, d.y, d.fence));
		}
		const owners: string[] = [];
		const cells = new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(0);
		const origin = chunkOrigin(cx, cy);
		let any = false;
		for (let ly = 0; ly < CHUNK_SIZE; ly++) {
			for (let lx = 0; lx < CHUNK_SIZE; lx++) {
				const owner = this.land.controllerAt(origin.x + lx, origin.y + ly);
				if (owner === null) continue;
				let idx = owners.indexOf(owner);
				if (idx < 0) idx = owners.push(owner) - 1;
				cells[localIndex(lx, ly)] = idx + 1;
				any = true;
			}
		}
		const handleIds = new Set([...owners, ...fences.map((f) => f.ownerId)]);
		return {
			chopped,
			fences,
			control: { owners, cells: any ? cells : null },
			handles: this.handlesFor(handleIds),
		};
	}

	tileSnapshot(x: number, y: number): { choppedAt: number | null; fence: FenceInfo | null } {
		const d = this.getDiff(x, y);
		return { choppedAt: d?.choppedAt ?? null, fence: d?.fence ? fenceInfo(x, y, d.fence) : null };
	}

	handlesFor(ids: Iterable<string>): Record<string, string> {
		const out: Record<string, string> = {};
		for (const id of ids) {
			const h = this.handleOf(id);
			if (h) out[id] = h;
		}
		return out;
	}

	// ---------- Internals ----------

	private recomputeEnclosures(ownerId: string, changed: TileCoord, now: number): WorldEvent[] {
		const changes: EnclosureChanges = recomputeOwnerEnclosures({
			ownerId,
			changed,
			view: this.viewAt(now),
			existing: this.land.enclosuresOf(ownerId),
			now,
			newId: this.deps.newId,
		});
		for (const e of changes.removed) {
			// An enclosure added and removed before a flush never needs to reach the database.
			if (!this.enclosuresAdded.delete(e.id)) this.enclosuresRemoved.add(e.id);
		}
		for (const e of changes.added) this.enclosuresAdded.set(e.id, toStoredEnclosure(e));
		const controllerChanges = this.land.apply(changes);
		return controllerChanges.length > 0 ? [{ kind: "control", changes: controllerChanges }] : [];
	}

	private requirePlayer(id: string): PlayerState {
		const p = this.players.get(id);
		if (!p) throw new Error(`Unknown player ${id}`);
		return p;
	}

	private addPlayer(p: PlayerState): void {
		this.players.set(p.id, p);
		this.handleIndex.set(normalizeHandle(p.handle), p.id);
		this.tokenIndex.set(p.tokenHash, p.id);
	}

	private occupy(x: number, y: number, delta: number): void {
		const key = tileKey(x, y);
		const n = (this.occupancy.get(key) ?? 0) + delta;
		if (n > 0) this.occupancy.set(key, n);
		else this.occupancy.delete(key);
	}

	private getDiff(x: number, y: number): TileDiffAt | undefined {
		const { cx, cy } = chunkOfTile(x, y);
		return this.diffsByChunk.get(chunkKey(cx, cy))?.get(tileKey(x, y));
	}

	/** Sets a diff without marking it dirty (used when loading). */
	private setDiff(x: number, y: number, patch: TileDiff): void {
		const { cx, cy } = chunkOfTile(x, y);
		const ck = chunkKey(cx, cy);
		let chunk = this.diffsByChunk.get(ck);
		if (!chunk) {
			chunk = new Map();
			this.diffsByChunk.set(ck, chunk);
		}
		const key = tileKey(x, y);
		const merged: TileDiffAt = { ...chunk.get(key), ...patch, x, y };
		const clean: TileDiffAt = {
			x,
			y,
			...(merged.choppedAt !== undefined ? { choppedAt: merged.choppedAt } : {}),
			...(merged.fence ? { fence: merged.fence } : {}),
		};
		if (clean.choppedAt === undefined && !clean.fence) chunk.delete(key);
		else chunk.set(key, clean);
		if (clean.fence) this.fenceKeys.add(key);
		else this.fenceKeys.delete(key);
	}

	private updateDiff(
		x: number,
		y: number,
		patch: { choppedAt?: number; fence?: Fence | undefined },
	): void {
		const current = this.getDiff(x, y);
		const next: TileDiff = {
			...(current?.choppedAt !== undefined ? { choppedAt: current.choppedAt } : {}),
			...(current?.fence ? { fence: current.fence } : {}),
		};
		const merged = { ...next, ...patch };
		const clean: TileDiff = {
			...(merged.choppedAt !== undefined ? { choppedAt: merged.choppedAt } : {}),
			...(merged.fence ? { fence: merged.fence } : {}),
		};
		// Replace rather than merge so a removed fence really disappears.
		const { cx, cy } = chunkOfTile(x, y);
		this.diffsByChunk.get(chunkKey(cx, cy))?.delete(tileKey(x, y));
		this.fenceKeys.delete(tileKey(x, y));
		this.setDiff(x, y, clean);
		this.dirtyTiles.set(tileKey(x, y), { x, y });
	}
}

function parseKey(key: string): TileCoord {
	const [x, y] = key.split(",").map(Number) as [number, number];
	return { x, y };
}

function fenceInfo(x: number, y: number, f: Fence): FenceInfo {
	return { x, y, ownerId: f.ownerId, level: f.level };
}

function toStoredPlayer(p: PlayerState): StoredPlayer {
	return {
		id: p.id,
		handle: p.handle,
		tokenHash: p.tokenHash,
		x: p.x,
		y: p.y,
		facing: p.facing,
		wood: p.wood,
		createdAt: p.createdAt,
		lastSeenAt: p.lastSeenAt,
	};
}

function toStoredEnclosure(e: Enclosure): StoredEnclosure {
	const first = e.tiles.values().next().value;
	if (first === undefined) throw new Error(`Enclosure ${e.id} has no tiles`);
	const { x, y } = parseKey(first);
	return { id: e.id, ownerId: e.ownerId, createdAt: e.createdAt, anchorX: x, anchorY: y };
}
