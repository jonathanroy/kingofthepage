import type {
	CreatureInfo,
	FenceInfo,
	FoodCounts,
	LookInfo,
	PlayerInfo,
	PlayerRef,
	ServerMessage,
} from "@kotp/shared/protocol";
import {
	type AllyCheck,
	type Fence,
	isWalkableFor,
	NETWORK,
	resolveTile,
	type Tile,
	type TileDiff,
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
	tileKey,
} from "@kotp/shared/world";

export type ChunkData = {
	readonly cx: number;
	readonly cy: number;
	readonly diffs: Map<string, TileDiff>;
	/** Controller per tile key; absent means unclaimed. */
	readonly control: Map<string, string>;
};

export type Me = {
	id: string;
	handle: string;
	x: number;
	y: number;
	facing: Direction;
	wood: number;
	iron: number;
	/** Settled gold at `goldAsOf` (server time); extrapolate with `goldPerMinute`. */
	gold: number;
	goldPerMinute: number;
	goldAsOf: number;
};

type PendingMove = { readonly seq: number; readonly x: number; readonly y: number };

/** What changed since the renderer last looked. */
export type Changes = {
	readonly chunksAdded: string[];
	readonly chunksRemoved: string[];
	readonly tiles: Set<string>;
	readonly controlChunks: Set<string>;
	readonly players: Set<string>;
	readonly playersRemoved: Set<string>;
	meChanged: boolean;
	alliancesChanged: boolean;
	readonly creatures: Set<string>;
	readonly creaturesRemoved: Set<string>;
	statusChanged: boolean;
	shopChanged: boolean;
	basesChanged: boolean;
	collectionChanged: boolean;
	/** Owners whose walls fly the royal banner changed (§10). */
	royalChanged: boolean;
};

export type ShopView = {
	readonly x: number;
	readonly y: number;
	readonly offer: readonly { readonly id: string; readonly price: number }[];
	readonly movesAt: number;
};

export type Base = { readonly x: number; readonly y: number; readonly area: number };

/** §8, §9: the local player's meters, carried food and tools. */
export type Status = {
	health: number;
	food: number;
	water: number;
	pantry: FoodCounts;
	hasSpear: boolean;
	tool: "axe" | "spear";
};

function emptyChanges(): Changes {
	return {
		chunksAdded: [],
		chunksRemoved: [],
		tiles: new Set(),
		controlChunks: new Set(),
		players: new Set(),
		playersRemoved: new Set(),
		meChanged: false,
		alliancesChanged: false,
		creatures: new Set(),
		creaturesRemoved: new Set(),
		statusChanged: false,
		shopChanged: false,
		basesChanged: false,
		collectionChanged: false,
		royalChanged: false,
	};
}

/**
 * The client's copy of the world near its player: base terrain generated locally from
 * the seed, plus the diffs and ownership the server sent. Holds the predicted position
 * of the local player and reconciles it with the server's acknowledgements.
 */
export class ClientWorld {
	terrain: TerrainGenerator | null = null;
	me: Me | null = null;
	readonly chunks = new Map<string, ChunkData>();
	readonly players = new Map<string, PlayerInfo>();
	readonly handles = new Map<string, string>();
	alliances: { allies: PlayerRef[]; incoming: PlayerRef[]; outgoing: PlayerRef[] } = {
		allies: [],
		incoming: [],
		outgoing: [],
	};
	readonly isAlly: AllyCheck = (id) => this.alliances.allies.some((a) => a.id === id);
	readonly creatures = new Map<string, CreatureInfo>();
	status: Status | null = null;
	shop: ShopView | null = null;
	bases: Base[] = [];
	collection: { owned: string[]; equipped: LookInfo } = { owned: [], equipped: {} };
	/** Players whose walls fly the royal banner (§10). */
	readonly royal = new Set<string>();
	private serverOffset = 0;
	private pending: PendingMove[] = [];
	private changes = emptyChanges();

	constructor(private readonly clock: () => number = Date.now) {}

	serverNow(): number {
		return this.clock() + this.serverOffset;
	}

	takeChanges(): Changes {
		const c = this.changes;
		this.changes = emptyChanges();
		return c;
	}

	apply(msg: ServerMessage): void {
		switch (msg.type) {
			case "hello":
				this.terrain = createTerrainGenerator(msg.worldSeed);
				this.syncClock(msg.serverTime);
				break;
			case "joined":
				this.syncClock(msg.serverTime);
				this.me = {
					...msg.you,
					wood: msg.wood,
					iron: msg.iron,
					gold: msg.gold,
					goldPerMinute: msg.goldPerMinute,
					goldAsOf: msg.serverTime,
				};
				this.handles.set(msg.you.id, msg.you.handle);
				this.pending = [];
				this.changes.meChanged = true;
				break;
			case "chunk":
				this.applyChunk(msg);
				break;
			case "tile":
				this.applyTile(msg.x, msg.y, msg.choppedAt, msg.fence, msg.oreMined, msg.harvestedAt);
				break;
			case "control":
				for (const [id, h] of Object.entries(msg.handles)) this.handles.set(id, h);
				for (const [x, y, owner] of msg.changes) this.setControl(x, y, owner);
				break;
			case "player":
				if (msg.player.id === this.me?.id) break;
				// Observers of a player's old spot hear about them leaving view too.
				if (!this.isLoaded(msg.player.x, msg.player.y)) {
					this.removePlayer(msg.player.id);
					break;
				}
				this.players.set(msg.player.id, msg.player);
				this.setRoyal(msg.player.id, msg.player.look.banner === "royal-banner");
				this.handles.set(msg.player.id, msg.player.handle);
				this.changes.players.add(msg.player.id);
				break;
			case "playerGone":
				this.removePlayer(msg.id);
				break;
			case "moved":
				this.reconcile(msg.seq, msg.x, msg.y, msg.facing);
				break;
			case "inventory":
				if (this.me) {
					this.me.wood = msg.wood;
					this.me.iron = msg.iron;
					this.me.gold = msg.gold;
					this.me.goldPerMinute = msg.goldPerMinute;
					this.me.goldAsOf = msg.asOf;
					this.changes.meChanged = true;
				}
				break;
			case "alliances":
				this.alliances = {
					allies: [...msg.allies],
					incoming: [...msg.incoming],
					outgoing: [...msg.outgoing],
				};
				for (const r of [...msg.allies, ...msg.incoming, ...msg.outgoing])
					this.handles.set(r.id, r.handle);
				this.changes.alliancesChanged = true;
				break;
			case "status": {
				const { type: _type, ...status } = msg;
				this.status = status;
				this.changes.statusChanged = true;
				break;
			}
			case "creature":
				this.creatures.set(msg.creature.id, msg.creature);
				this.changes.creatures.add(msg.creature.id);
				break;
			case "creatureGone":
				if (this.creatures.delete(msg.id)) this.changes.creaturesRemoved.add(msg.id);
				break;
			case "shop":
				this.shop = { x: msg.x, y: msg.y, offer: msg.offer, movesAt: msg.movesAt };
				this.changes.shopChanged = true;
				break;
			case "shopGone":
				this.shop = null;
				this.changes.shopChanged = true;
				break;
			case "bases":
				this.bases = [...msg.bases];
				this.changes.basesChanged = true;
				break;
			case "collection":
				this.collection = { owned: [...msg.owned], equipped: msg.equipped };
				if (this.me) this.setRoyal(this.me.id, msg.equipped.banner === "royal-banner");
				this.changes.collectionChanged = true;
				this.changes.meChanged = true;
				break;
			case "respawned":
				if (this.me) {
					this.me.x = msg.x;
					this.me.y = msg.y;
					this.me.facing = msg.facing;
					this.pending = [];
					this.changes.meChanged = true;
				}
				break;
			case "joinRejected":
			case "rejected":
			case "notice":
			case "leaderboard":
				break;
		}
	}

	// ---------- Tiles ----------

	isLoaded(x: number, y: number): boolean {
		const { cx, cy } = chunkOfTile(x, y);
		return this.chunks.has(chunkKey(cx, cy));
	}

	/** The fence on a tile, if any. */
	fenceAt(x: number, y: number): Fence | null {
		const tile = this.tileAt(x, y);
		return tile.kind === "fence" ? tile.fence : null;
	}

	tileAt(x: number, y: number): Tile {
		if (!this.terrain) return { kind: "water" };
		return resolveTile(this.terrain.terrainAt(x, y), this.diffAt(x, y), this.serverNow(), {
			occupied: this.isOccupied(x, y),
			mine: this.terrain.mineAt(x, y),
			ore: this.terrain.oreAt(x, y),
			forage: this.terrain.forageAt(x, y),
		});
	}

	controllerAt(x: number, y: number): string | null {
		const { cx, cy } = chunkOfTile(x, y);
		return this.chunks.get(chunkKey(cx, cy))?.control.get(tileKey(x, y)) ?? null;
	}

	/** Stumps whose regrow delay has passed need a redraw; the renderer calls this periodically. */
	markRegrowableStumps(): void {
		for (const chunk of this.chunks.values()) {
			for (const [key, diff] of chunk.diffs) {
				if (diff.choppedAt !== undefined && !diff.fence) this.changes.tiles.add(key);
			}
		}
	}

	/** Gold shown right now: the last settled value plus what the mines produced since (§6). */
	liveGold(): number {
		const me = this.me;
		if (!me) return 0;
		const minutes = Math.max(0, this.serverNow() - me.goldAsOf) / 60_000;
		return me.gold + minutes * me.goldPerMinute;
	}

	// ---------- Local player prediction ----------

	predictTurn(dir: Direction): void {
		if (!this.me) return;
		this.me.facing = dir;
		this.changes.meChanged = true;
	}

	/**
	 * Predicts a move so the game feels instant. The server has the final word:
	 * `moved` acknowledgements correct any mismatch.
	 */
	predictMove(dir: Direction, seq: number): void {
		const me = this.me;
		if (!me) return;
		me.facing = dir;
		this.changes.meChanged = true;
		const to = stepToward(me.x, me.y, dir);
		const walkable = isWalkableFor(this.tileAt(to.x, to.y), me.id, this.isAlly);
		const shopHere = this.shop?.x === to.x && this.shop?.y === to.y;
		if (!this.isLoaded(to.x, to.y) || !walkable || this.creatureAt(to.x, to.y) || shopHere) {
			return;
		}
		// Approximates §5 Access with controllers only; the server decides with full enclosures.
		const target = this.controllerAt(to.x, to.y);
		const mayEnter = target === null || target === me.id || this.isAlly(target);
		if (!mayEnter && target !== this.controllerAt(me.x, me.y)) return;
		me.x = to.x;
		me.y = to.y;
		this.pending.push({ seq, x: to.x, y: to.y });
	}

	private reconcile(seq: number, x: number, y: number, facing: Direction): void {
		const me = this.me;
		if (!me) return;
		const match = this.pending.find((p) => p.seq === seq);
		this.pending = this.pending.filter((p) => p.seq > seq);
		if (match && match.x === x && match.y === y) return;
		if (!match && this.pending.length > 0) return;
		// Misprediction, or a move we didn't predict: snap to the server and drop later guesses.
		me.x = x;
		me.y = y;
		me.facing = facing;
		this.pending = [];
		this.changes.meChanged = true;
	}

	// ---------- Internals ----------

	private syncClock(serverTime: number): void {
		this.serverOffset = serverTime - this.clock();
	}

	private applyChunk(msg: Extract<ServerMessage, { type: "chunk" }>): void {
		const key = chunkKey(msg.cx, msg.cy);
		const chunk: ChunkData = { cx: msg.cx, cy: msg.cy, diffs: new Map(), control: new Map() };
		for (const [x, y, choppedAt] of msg.chopped) chunk.diffs.set(tileKey(x, y), { choppedAt });
		for (const [x, y, harvestedAt] of msg.harvested) {
			const k = tileKey(x, y);
			chunk.diffs.set(k, { ...chunk.diffs.get(k), harvestedAt });
		}
		for (const [x, y, mined] of msg.ore) {
			const k = tileKey(x, y);
			chunk.diffs.set(k, { ...chunk.diffs.get(k), oreMined: mined });
		}
		for (const f of msg.fences) {
			const k = tileKey(f.x, f.y);
			chunk.diffs.set(k, { ...chunk.diffs.get(k), fence: toFence(f) });
		}
		if (msg.control.cells) {
			const origin = chunkOrigin(msg.cx, msg.cy);
			for (let ly = 0; ly < CHUNK_SIZE; ly++) {
				for (let lx = 0; lx < CHUNK_SIZE; lx++) {
					const cell = msg.control.cells[localIndex(lx, ly)] ?? 0;
					const owner = cell > 0 ? msg.control.owners[cell - 1] : undefined;
					if (owner) chunk.control.set(tileKey(origin.x + lx, origin.y + ly), owner);
				}
			}
		}
		for (const [id, h] of Object.entries(msg.handles)) this.handles.set(id, h);
		for (const id of msg.royal) this.setRoyal(id, true);
		const existed = this.chunks.has(key);
		this.chunks.set(key, chunk);
		if (existed) this.changes.chunksRemoved.push(key);
		this.changes.chunksAdded.push(key);
		this.evictFarChunks();
	}

	private applyTile(
		x: number,
		y: number,
		choppedAt: number | null,
		fence: FenceInfo | null,
		oreMined: number | null,
		harvestedAt: number | null,
	): void {
		const chunk = this.chunkOf(x, y);
		if (!chunk) return;
		const key = tileKey(x, y);
		const diff: TileDiff = {
			...(choppedAt !== null ? { choppedAt } : {}),
			...(fence ? { fence: toFence(fence) } : {}),
			...(oreMined !== null ? { oreMined } : {}),
			...(harvestedAt !== null ? { harvestedAt } : {}),
		};
		const empty =
			diff.choppedAt === undefined &&
			!diff.fence &&
			diff.oreMined === undefined &&
			diff.harvestedAt === undefined;
		if (empty) {
			chunk.diffs.delete(key);
		} else chunk.diffs.set(key, diff);
		this.changes.tiles.add(key);
	}

	private setControl(x: number, y: number, owner: string | null): void {
		const chunk = this.chunkOf(x, y);
		if (!chunk) return;
		const key = tileKey(x, y);
		if (owner) chunk.control.set(key, owner);
		else chunk.control.delete(key);
		this.changes.controlChunks.add(chunkKey(chunk.cx, chunk.cy));
	}

	/** The server stops updating chunks outside the interest radius, so their data goes stale. */
	private evictFarChunks(): void {
		const me = this.me;
		if (!me) return;
		const center = chunkOfTile(me.x, me.y);
		const keep = NETWORK.interestRadiusChunks + 1;
		for (const [key, c] of this.chunks) {
			if (Math.abs(c.cx - center.cx) > keep || Math.abs(c.cy - center.cy) > keep) {
				this.chunks.delete(key);
				this.changes.chunksRemoved.push(key);
			}
		}
		for (const [id, p] of this.players) {
			if (!this.isLoaded(p.x, p.y)) this.removePlayer(id);
		}
		if (this.shop && !this.isLoaded(this.shop.x, this.shop.y)) {
			this.shop = null;
			this.changes.shopChanged = true;
		}
		for (const [id, c] of this.creatures) {
			if (this.isLoaded(c.x, c.y)) continue;
			this.creatures.delete(id);
			this.changes.creaturesRemoved.add(id);
		}
	}

	private removePlayer(id: string): void {
		if (this.players.delete(id)) this.changes.playersRemoved.add(id);
	}

	private chunkOf(x: number, y: number): ChunkData | undefined {
		const { cx, cy } = chunkOfTile(x, y);
		return this.chunks.get(chunkKey(cx, cy));
	}

	private diffAt(x: number, y: number): TileDiff | undefined {
		return this.chunkOf(x, y)?.diffs.get(tileKey(x, y));
	}

	private setRoyal(id: string, royal: boolean): void {
		if (royal === this.royal.has(id)) return;
		if (royal) this.royal.add(id);
		else this.royal.delete(id);
		this.changes.royalChanged = true;
	}

	creatureAt(x: number, y: number): CreatureInfo | null {
		for (const c of this.creatures.values()) if (c.x === x && c.y === y) return c;
		return null;
	}

	private isOccupied(x: number, y: number): boolean {
		if (this.me && this.me.x === x && this.me.y === y) return true;
		for (const p of this.players.values()) if (p.x === x && p.y === y) return true;
		return false;
	}
}

function toFence(f: FenceInfo): Fence {
	// The client never needs wood invested; the server owns that number.
	return {
		ownerId: f.ownerId,
		level: f.level as Fence["level"],
		woodInvested: 0,
		ironInvested: 0,
		damage: f.damage,
		gate: f.gate,
	};
}
