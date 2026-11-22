import type {
	ActionRejectReason,
	ChunkControl,
	FenceInfo,
	Notice,
	PlayerInfo,
} from "@kotp/shared/protocol";
import {
	AllianceBook,
	type AllyCheck,
	addFood,
	agePantry,
	bearCanClaw,
	buildFence,
	type ControllerChange,
	canEnterTile,
	canMakeGate,
	canPlaceFence,
	canUpgradeFence,
	chopFence,
	drainSurvival,
	drink,
	ENCLOSURE,
	type Enclosure,
	type EnclosureChanges,
	emptyPantry,
	FENCE_LEVELS,
	type Fence,
	type FenceAt,
	type FenceLevel,
	FOOD,
	FOOD_KINDS,
	FORAGE,
	type FoodKind,
	FULL_SURVIVAL,
	fenceBuildCost,
	fillRegion,
	hurt,
	improveFence,
	ironFromHit,
	isDead,
	isWalkable,
	isWalkableFor,
	LandRegistry,
	landScores,
	makeGate,
	mineGoldPerMinute,
	needsAllyConfirmation,
	nextToSpoil,
	normalizeHandle,
	nourish,
	PACE,
	type Pantry,
	recomputeOwnerEnclosures,
	resolveTile,
	type Survival,
	settleMineGold,
	spendWork,
	type Tile,
	type TileDiff,
	type TileView,
	TOOLS,
	type Tool,
	takeOne,
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
	type MineSize,
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
	/** Mined from ore rocks; needed for iron and steel wall levels (§2 Iron ore). */
	iron: number;
	lastSeenAt: number;
	/** Total gold earned (§6), settled lazily from the mines this player controls. */
	gold: number;
	online: boolean;
	nextMoveAt: number;
	nextActionAt: number;
	/** §8 meters; only advance while online. */
	survival: Survival;
	pantry: Pantry;
	hasSpear: boolean;
	tool: Tool;
};

/** Something clients may need to hear about. The game routes these by interest. */
export type WorldEvent =
	| { readonly kind: "tile"; readonly x: number; readonly y: number }
	| { readonly kind: "control"; readonly changes: readonly ControllerChange[] }
	| { readonly kind: "player"; readonly id: string; readonly fromX: number; readonly fromY: number }
	| { readonly kind: "inventory"; readonly id: string }
	/** Meters, food or tools of this player changed (§8, §9). */
	| { readonly kind: "status"; readonly id: string }
	| { readonly kind: "notice"; readonly id: string; readonly notice: Notice }
	/** A creature appeared, moved or was hurt (§9). */
	| {
			readonly kind: "creature";
			readonly id: string;
			readonly fromX: number;
			readonly fromY: number;
	  }
	| { readonly kind: "creatureGone"; readonly id: string; readonly x: number; readonly y: number }
	/** §4: tell a fence's owner that an ally started chopping it. */
	| {
			readonly kind: "allyChop";
			readonly ownerId: string;
			readonly byId: string;
			readonly x: number;
			readonly y: number;
	  };

export type ActionResult =
	| { readonly ok: true; readonly events: readonly WorldEvent[] }
	| {
			readonly ok: false;
			readonly reason: ActionRejectReason;
			readonly events: readonly WorldEvent[];
	  };

type TileDiffAt = TileDiff & { readonly x: number; readonly y: number };

type MineState = {
	readonly x: number;
	readonly y: number;
	readonly size: MineSize;
	readonly controllerId: string;
	controlledSince: number;
};

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
	readonly alliances = new AllianceBook();
	/** Ally chopper + fence pairs already reported to the owner, so they hear it once per fence. */
	private readonly allyChopsReported = new Set<string>();
	private readonly mines = new Map<string, MineState>();
	private readonly dirtyMines = new Set<string>();
	private readonly dirtyAlliances = new Map<string, { a: string; b: string; formed: boolean }>();
	private readonly players = new Map<string, PlayerState>();
	private readonly handleIndex = new Map<string, string>();
	private readonly tokenIndex = new Map<string, string>();
	private readonly diffsByChunk = new Map<string, Map<string, TileDiffAt>>();
	private readonly fenceKeys = new Set<string>();
	private readonly occupancy = new Map<string, number>();
	/** Set by the wildlife system: players can't walk into a creature (§9). */
	private creatureAt: (x: number, y: number) => boolean = () => false;

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
			this.addPlayer({
				...p,
				online: false,
				nextMoveAt: 0,
				nextActionAt: 0,
				survival: { health: p.health, food: p.food, water: p.water },
			});
		for (const f of snapshot.fences) {
			this.setDiff(f.x, f.y, {
				fence: {
					ownerId: f.ownerId,
					level: f.level as FenceLevel,
					woodInvested: f.woodInvested,
					ironInvested: f.ironInvested,
					damage: f.damage,
					gate: f.gate,
				},
			});
		}
		for (const a of snapshot.alliances) this.alliances.form(a.a, a.b);
		for (const c of snapshot.chops) {
			this.setDiff(c.x, c.y, { choppedAt: c.choppedAt });
		}
		for (const o of snapshot.ore) this.setDiff(o.x, o.y, { oreMined: o.mined });
		for (const f of snapshot.forage) this.setDiff(f.x, f.y, { harvestedAt: f.harvestedAt });
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
		const changes = this.land.apply({ removed: [], added });
		// Restore each mine's clock; if stored control disagrees with the land (a lost write),
		// trust the land and restart the clock now.
		const stored = new Map(snapshot.mines.map((m) => [tileKey(m.x, m.y), m]));
		for (const c of changes) {
			const { x, y } = parseKey(c.tile);
			const size = this.terrain.mineAt(x, y);
			if (!size || !c.to) continue;
			const saved = stored.get(c.tile);
			const since = saved && saved.controllerId === c.to ? saved.controlledSince : now;
			this.mines.set(c.tile, { x, y, size, controllerId: c.to, controlledSince: since });
			if (since === now) this.dirtyMines.add(c.tile);
		}
		for (const key of stored.keys()) if (!this.mines.has(key)) this.dirtyMines.add(key);
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
		const oreSet: { x: number; y: number; mined: number }[] = [];
		const forageSet: { x: number; y: number; harvestedAt: number }[] = [];
		for (const { x, y } of this.dirtyTiles.values()) {
			const diff = this.getDiff(x, y);
			if (diff?.fence) fencesSet.push({ x, y, ...diff.fence });
			else fencesRemoved.push({ x, y });
			if (diff?.choppedAt !== undefined) chopsSet.push({ x, y, choppedAt: diff.choppedAt });
			else chopsRemoved.push({ x, y });
			// Mined ore never resets, so there is nothing to remove.
			if (diff?.oreMined !== undefined) oreSet.push({ x, y, mined: diff.oreMined });
			if (diff?.harvestedAt !== undefined) forageSet.push({ x, y, harvestedAt: diff.harvestedAt });
		}
		const batch: WriteBatch = {
			players,
			fencesSet,
			fencesRemoved,
			chopsSet,
			chopsRemoved,
			oreSet,
			forageSet,
			enclosuresAdded: [...this.enclosuresAdded.values()],
			enclosuresRemoved: [...this.enclosuresRemoved],
			minesSet: [...this.dirtyMines]
				.map((k) => this.mines.get(k))
				.filter((m): m is MineState => m !== undefined)
				.map((m) => ({
					x: m.x,
					y: m.y,
					controllerId: m.controllerId,
					controlledSince: m.controlledSince,
				})),
			minesRemoved: [...this.dirtyMines].filter((k) => !this.mines.has(k)).map(parseKey),
			alliancesSet: [...this.dirtyAlliances.values()]
				.filter((d) => d.formed)
				.map((d) => ({ a: d.a, b: d.b })),
			alliancesRemoved: [...this.dirtyAlliances.values()]
				.filter((d) => !d.formed)
				.map((d) => ({ a: d.a, b: d.b })),
		};
		this.dirtyAlliances.clear();
		this.dirtyMines.clear();
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
		return resolveTile(this.terrain.terrainAt(x, y), this.getDiff(x, y), now, {
			occupied: (this.occupancy.get(tileKey(x, y)) ?? 0) > 0,
			mine: this.terrain.mineAt(x, y),
			ore: this.terrain.oreAt(x, y),
			forage: this.terrain.forageAt(x, y),
		});
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
			iron: 0,
			gold: 0,
			lastSeenAt: input.now,
			survival: FULL_SURVIVAL,
			pantry: emptyPantry(),
			hasSpear: false,
			tool: "axe",
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
		if (
			!isWalkableFor(this.tileAt(to.x, to.y, now), id, this.allyCheck(id)) ||
			this.creatureAt(to.x, to.y)
		) {
			return { ok: false, reason: "blocked", events: turnEvents };
		}
		if (
			!canEnterTile(
				id,
				this.land.enclosuresAt(from.x, from.y),
				this.land.enclosuresAt(to.x, to.y),
				this.allyCheck(id),
			)
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

	turn(id: string, dir: Direction): ActionResult {
		const p = this.requirePlayer(id);
		if (p.facing === dir) return { ok: true, events: [] };
		p.facing = dir;
		this.dirtyPlayers.add(id);
		return { ok: true, events: [{ kind: "player", id, fromX: p.x, fromY: p.y }] };
	}

	chop(id: string, now: number, confirmAlly = false): ActionResult {
		const p = this.requirePlayer(id);
		const target = stepToward(p.x, p.y, p.facing);
		const tile = this.tileAt(target.x, target.y, now);
		p.nextActionAt = now + PACE.actionIntervalMs;
		if (p.tool !== "axe") return { ok: false, reason: "useAxe", events: [] };

		if (tile.kind === "tree") {
			this.updateDiff(target.x, target.y, { choppedAt: now });
			p.wood += woodFromTree(this.deps.random());
			this.work(p);
			return {
				ok: true,
				events: [
					{ kind: "tile", ...target },
					{ kind: "inventory", id },
				],
			};
		}

		if (tile.kind === "fence") return this.chopFenceAt(p, target, tile.fence, now, confirmAlly);

		if (tile.kind === "ore") {
			// §2 Iron ore: anyone can mine; the rock empties for good, leaving rubble.
			const iron = ironFromHit(tile.remaining);
			const mined = tile.capacity - tile.remaining + iron;
			this.updateDiff(target.x, target.y, { oreMined: mined });
			p.iron += iron;
			this.work(p);
			return {
				ok: true,
				events: [
					{ kind: "tile", ...target },
					{ kind: "inventory", id },
				],
			};
		}

		return { ok: false, reason: "nothingToChop", events: [] };
	}

	private chopFenceAt(
		p: PlayerState,
		at: TileCoord,
		fence: Fence,
		now: number,
		confirmAlly: boolean,
	): ActionResult {
		const allies = this.allyCheck(p.id);
		if (needsAllyConfirmation(fence, p.id, allies) && !confirmAlly) {
			return { ok: false, reason: "allyConfirmRequired", events: [] };
		}
		this.work(p);
		const events: WorldEvent[] = [{ kind: "tile", ...at }];
		const reportKey = `${p.id}|${tileKey(at.x, at.y)}`;
		if (allies(fence.ownerId) && !this.allyChopsReported.has(reportKey)) {
			this.allyChopsReported.add(reportKey);
			events.push({ kind: "allyChop", ownerId: fence.ownerId, byId: p.id, ...at });
		}

		const result = chopFence(fence, p.id);
		if (!result.broken) {
			this.updateDiff(at.x, at.y, { fence: result.fence });
			return { ok: true, events };
		}
		this.updateDiff(at.x, at.y, { fence: undefined });
		this.clearAllyChopReports(at);
		p.wood += result.refund;
		p.iron += result.ironRefund;
		this.dirtyPlayers.add(p.id);
		// The fence's owner is the one whose enclosures can change (§5).
		const control = this.recomputeEnclosures(fence.ownerId, at, now);
		return { ok: true, events: [...events, { kind: "inventory", id: p.id }, ...control] };
	}

	/** §3: the owner upgrades the fence they face (which repairs it); at max level this only repairs. */
	upgrade(id: string, now: number): ActionResult {
		const p = this.requirePlayer(id);
		const target = stepToward(p.x, p.y, p.facing);
		const tile = this.tileAt(target.x, target.y, now);
		p.nextActionAt = now + PACE.actionIntervalMs;
		if (tile.kind !== "fence") return { ok: false, reason: "nothingToUpgrade", events: [] };
		const check = canUpgradeFence(tile.fence, id, p.wood, p.iron);
		if (!check.ok) return { ok: false, reason: check.reason, events: [] };
		p.wood -= check.cost;
		p.iron -= check.iron;
		this.work(p);
		this.updateDiff(target.x, target.y, { fence: improveFence(tile.fence) });
		return {
			ok: true,
			events: [
				{ kind: "tile", ...target },
				{ kind: "inventory", id },
			],
		};
	}

	/** §3 Gates: gates still count as walls, so enclosures don't change. */
	makeGate(id: string, now: number): ActionResult {
		const p = this.requirePlayer(id);
		const target = stepToward(p.x, p.y, p.facing);
		const tile = this.tileAt(target.x, target.y, now);
		p.nextActionAt = now + PACE.actionIntervalMs;
		if (tile.kind !== "fence") return { ok: false, reason: "nothingToUpgrade", events: [] };
		const check = canMakeGate(tile.fence, id, p.wood);
		if (!check.ok) return { ok: false, reason: check.reason, events: [] };
		p.wood -= check.cost;
		this.dirtyPlayers.add(id);
		this.updateDiff(target.x, target.y, { fence: makeGate(tile.fence) });
		return {
			ok: true,
			events: [
				{ kind: "tile", ...target },
				{ kind: "inventory", id },
			],
		};
	}

	// ---------- Alliances (§4) ----------

	allyCheck(playerId: string): AllyCheck {
		return (otherId) => this.alliances.areAllies(playerId, otherId);
	}

	/** Records a formed or ended alliance for persistence. */
	markAlliance(a: string, b: string, formed: boolean): void {
		const [x, y] = a < b ? [a, b] : [b, a];
		this.dirtyAlliances.set(`${x}|${y}`, { a: x, b: y, formed });
	}

	// ---------- Survival (§8) and tools (§9) ----------

	setCreatureLookup(lookup: (x: number, y: number) => boolean): void {
		this.creatureAt = lookup;
	}

	/** Every work action makes the player hungrier and thirstier. */
	private work(p: PlayerState): void {
		p.survival = spendWork(p.survival);
		this.dirtyPlayers.add(p.id);
	}

	/** Spear thrusts count as work too; the wildlife system calls this. */
	spendWork(id: string): void {
		this.work(this.requirePlayer(id));
	}

	/** Drink from a lake, or harvest apples, berries or potatoes on the faced tile. */
	interact(id: string, now: number): ActionResult {
		const p = this.requirePlayer(id);
		const at = stepToward(p.x, p.y, p.facing);
		const tile = this.tileAt(at.x, at.y, now);
		p.nextActionAt = now + PACE.actionIntervalMs;
		if (tile.kind === "water") {
			p.survival = drink(p.survival);
			this.dirtyPlayers.add(id);
			return { ok: true, events: [{ kind: "status", id }] };
		}
		const forage =
			tile.kind === "tree" && tile.apples !== undefined
				? { kind: "apple" as const, ready: tile.apples, food: "apple" as const }
				: tile.kind === "bush"
					? { kind: "berry" as const, ready: tile.ready, food: "berries" as const }
					: tile.kind === "potato"
						? { kind: "potato" as const, ready: tile.ready, food: "potato" as const }
						: null;
		if (!forage) return { ok: false, reason: "nothingToInteract", events: [] };
		if (!forage.ready) return { ok: false, reason: "notReady", events: [] };
		const { pantry, added } = addFood(p.pantry, forage.food, FORAGE[forage.kind].yield);
		if (added === 0) return { ok: false, reason: "bagFull", events: [] };
		p.pantry = pantry;
		this.updateDiff(at.x, at.y, { harvestedAt: now });
		this.work(p);
		return {
			ok: true,
			events: [
				{ kind: "tile", ...at },
				{ kind: "status", id },
			],
		};
	}

	/** §8: eat the carried food closest to spoiling. */
	eat(id: string): ActionResult {
		const p = this.requirePlayer(id);
		const kind = nextToSpoil(p.pantry);
		if (!kind) return { ok: false, reason: "nothingToEat", events: [] };
		p.pantry = takeOne(p.pantry, kind);
		p.survival = nourish(p.survival, FOOD.kinds[kind].restores);
		this.dirtyPlayers.add(id);
		return {
			ok: true,
			events: [
				{ kind: "status", id },
				{ kind: "notice", id, notice: { kind: "ate", food: kind } },
			],
		};
	}

	craftSpear(id: string): ActionResult {
		const p = this.requirePlayer(id);
		if (p.hasSpear) return { ok: false, reason: "alreadyHaveSpear", events: [] };
		if (p.wood < TOOLS.spearWood) return { ok: false, reason: "notEnoughWood", events: [] };
		if (p.iron < TOOLS.spearIron) return { ok: false, reason: "notEnoughIron", events: [] };
		p.wood -= TOOLS.spearWood;
		p.iron -= TOOLS.spearIron;
		p.hasSpear = true;
		p.tool = "spear";
		this.dirtyPlayers.add(id);
		return {
			ok: true,
			events: [
				{ kind: "inventory", id },
				{ kind: "status", id },
			],
		};
	}

	selectTool(id: string, tool: Tool): ActionResult {
		const p = this.requirePlayer(id);
		if (tool === "spear" && !p.hasSpear) return { ok: false, reason: "noSpear", events: [] };
		p.tool = tool;
		this.dirtyPlayers.add(id);
		return { ok: true, events: [{ kind: "status", id }] };
	}

	/** Food gained from hunting; returns how much fit in the bag. */
	addFood(id: string, kind: FoodKind, count: number): number {
		const p = this.requirePlayer(id);
		const result = addFood(p.pantry, kind, count);
		p.pantry = result.pantry;
		this.dirtyPlayers.add(id);
		return result.added;
	}

	/**
	 * Advances an online player's meters and food by `elapsedMs`. Called from the game loop
	 * for online players only, so everything pauses while offline (§8).
	 */
	tickSurvival(id: string, elapsedMs: number): { dead: boolean; spoiled: FoodKind[] } {
		const p = this.requirePlayer(id);
		const before = p.pantry;
		p.survival = drainSurvival(p.survival, elapsedMs);
		p.pantry = agePantry(p.pantry, elapsedMs);
		this.dirtyPlayers.add(id);
		const spoiled = FOOD_KINDS.filter((k) => p.pantry[k].count < before[k].count);
		return { dead: isDead(p.survival), spoiled };
	}

	/** A bear bite; returns true when it was fatal. */
	hurtPlayer(id: string, damage: number): boolean {
		const p = this.requirePlayer(id);
		p.survival = hurt(p.survival, damage);
		this.dirtyPlayers.add(id);
		return isDead(p.survival);
	}

	/**
	 * §8 Death: start again at `at` with full meters, losing everything carried. Land,
	 * walls, gold and alliances stay; the axe is never lost.
	 */
	respawn(id: string, at: TileCoord): WorldEvent[] {
		const p = this.requirePlayer(id);
		const from = { x: p.x, y: p.y };
		this.relocate(id, at.x, at.y, "down");
		p.wood = 0;
		p.iron = 0;
		p.pantry = emptyPantry();
		p.hasSpear = false;
		p.tool = "axe";
		p.survival = FULL_SURVIVAL;
		return [
			{ kind: "player", id, fromX: from.x, fromY: from.y },
			{ kind: "inventory", id },
			{ kind: "status", id },
		];
	}

	/** Open, unoccupied ground a creature may step onto. */
	isOpenForCreature(x: number, y: number, now: number): boolean {
		return isWalkable(this.tileAt(x, y, now)) && !this.isOccupied(x, y);
	}

	/**
	 * §9: a zombie bear claws a fence. Bears only harm levels 1-3; a broken fence refunds
	 * nobody, and its owner's enclosures are recomputed like any breach.
	 */
	clawFence(x: number, y: number, damage: number, now: number): WorldEvent[] {
		const tile = this.tileAt(x, y, now);
		if (tile.kind !== "fence" || !bearCanClaw(tile.fence)) return [];
		const fence = tile.fence;
		const needed = FENCE_LEVELS[fence.level - 1]?.chopsToBreak ?? 1;
		const next = fence.damage + damage;
		if (next < needed) {
			this.updateDiff(x, y, { fence: { ...fence, damage: next } });
			return [{ kind: "tile", x, y }];
		}
		this.updateDiff(x, y, { fence: undefined });
		this.clearAllyChopReports({ x, y });
		return [{ kind: "tile", x, y }, ...this.recomputeEnclosures(fence.ownerId, { x, y }, now)];
	}

	statusOf(p: PlayerState) {
		const counts = Object.fromEntries(FOOD_KINDS.map((k) => [k, p.pantry[k].count])) as Record<
			FoodKind,
			number
		>;
		return {
			health: Math.round(p.survival.health * 10) / 10,
			food: Math.round(p.survival.food * 10) / 10,
			water: Math.round(p.survival.water * 10) / 10,
			pantry: counts,
			hasSpear: p.hasSpear,
			tool: p.tool,
		};
	}

	build(id: string, now: number): ActionResult {
		const p = this.requirePlayer(id);
		const target = stepToward(p.x, p.y, p.facing);
		const tile = this.tileAt(target.x, target.y, now);
		p.nextActionAt = now + PACE.actionIntervalMs;

		const placement = canPlaceFence(tile, this.isOccupied(target.x, target.y), p.wood);
		if (!placement.ok) return { ok: false, reason: placement.reason, events: [] };

		p.wood -= fenceBuildCost();
		this.work(p);
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
		ore: [number, number, number][];
		harvested: [number, number, number][];
		control: ChunkControl;
		handles: Record<string, string>;
	} {
		const chopped: [number, number, number][] = [];
		const fences: FenceInfo[] = [];
		const ore: [number, number, number][] = [];
		const harvested: [number, number, number][] = [];
		for (const d of this.diffsByChunk.get(chunkKey(cx, cy))?.values() ?? []) {
			if (d.choppedAt !== undefined) chopped.push([d.x, d.y, d.choppedAt]);
			if (d.oreMined !== undefined) ore.push([d.x, d.y, d.oreMined]);
			if (d.harvestedAt !== undefined) harvested.push([d.x, d.y, d.harvestedAt]);
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
			ore,
			harvested,
			control: { owners, cells: any ? cells : null },
			handles: this.handlesFor(handleIds),
		};
	}

	tileSnapshot(
		x: number,
		y: number,
	): {
		choppedAt: number | null;
		fence: FenceInfo | null;
		oreMined: number | null;
		harvestedAt: number | null;
	} {
		const d = this.getDiff(x, y);
		return {
			choppedAt: d?.choppedAt ?? null,
			fence: d?.fence ? fenceInfo(x, y, d.fence) : null,
			oreMined: d?.oreMined ?? null,
			harvestedAt: d?.harvestedAt ?? null,
		};
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
		if (controllerChanges.length === 0) return [];
		return [
			{ kind: "control", changes: controllerChanges },
			...this.updateMineControl(controllerChanges, now),
		];
	}

	// ---------- Gold mines (§6) ----------

	/**
	 * §10: when a mine's controller changes, pay out the old controller first, then start
	 * the new one's clock. Returns inventory events for everyone whose income changed.
	 */
	private updateMineControl(changes: readonly ControllerChange[], now: number): WorldEvent[] {
		const affected = new Set<string>();
		for (const c of changes) {
			const { x, y } = parseKey(c.tile);
			const size = this.terrain.mineAt(x, y);
			if (!size) continue;
			const current = this.mines.get(c.tile);
			if (current) {
				this.creditMine(current, now);
				affected.add(current.controllerId);
			}
			if (c.to) {
				this.mines.set(c.tile, { x, y, size, controllerId: c.to, controlledSince: now });
				affected.add(c.to);
			} else {
				this.mines.delete(c.tile);
			}
			this.dirtyMines.add(c.tile);
		}
		return [...affected].map((id) => ({ kind: "inventory", id }));
	}

	private creditMine(mine: MineState, now: number): void {
		const result = settleMineGold(mine.size, mine, now);
		mine.controlledSince = result.control.controlledSince;
		const p = this.players.get(mine.controllerId);
		if (p) {
			p.gold += result.earned;
			this.dirtyPlayers.add(p.id);
		}
		this.dirtyMines.add(tileKey(mine.x, mine.y));
	}

	/** Brings a player's gold up to date; done before their balance is shown. */
	settlePlayerGold(playerId: string, now: number): void {
		for (const mine of this.mines.values()) {
			if (mine.controllerId === playerId) this.creditMine(mine, now);
		}
	}

	goldPerMinute(playerId: string): number {
		let rate = 0;
		for (const mine of this.mines.values()) {
			if (mine.controllerId === playerId) rate += mineGoldPerMinute(mine.size);
		}
		return rate;
	}

	/**
	 * §7: every player's Land and Gold scores. Read-only: unsettled mine gold is projected
	 * rather than credited, so viewing the boards never dirties state for the database.
	 */
	scores(now: number): { land: Map<string, number>; gold: Map<string, number> } {
		const fences: FenceAt[] = [];
		for (const key of this.fenceKeys) {
			const { x, y } = parseKey(key);
			const f = this.getDiff(x, y)?.fence;
			if (f) fences.push({ x, y, ownerId: f.ownerId });
		}
		const gold = new Map<string, number>();
		for (const p of this.players.values()) if (p.gold > 0) gold.set(p.id, p.gold);
		for (const mine of this.mines.values()) {
			const pending = settleMineGold(mine.size, mine, now).earned;
			gold.set(mine.controllerId, (gold.get(mine.controllerId) ?? 0) + pending);
		}
		return { land: landScores(this.land, fences), gold };
	}

	private clearAllyChopReports(at: TileCoord): void {
		const suffix = `|${tileKey(at.x, at.y)}`;
		for (const key of this.allyChopsReported) {
			if (key.endsWith(suffix)) this.allyChopsReported.delete(key);
		}
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
			...(merged.oreMined !== undefined ? { oreMined: merged.oreMined } : {}),
			...(merged.harvestedAt !== undefined ? { harvestedAt: merged.harvestedAt } : {}),
		};
		const empty =
			clean.choppedAt === undefined &&
			!clean.fence &&
			clean.oreMined === undefined &&
			clean.harvestedAt === undefined;
		if (empty) chunk.delete(key);
		else chunk.set(key, clean);
		if (clean.fence) this.fenceKeys.add(key);
		else this.fenceKeys.delete(key);
	}

	private updateDiff(
		x: number,
		y: number,
		patch: {
			choppedAt?: number;
			fence?: Fence | undefined;
			oreMined?: number;
			harvestedAt?: number;
		},
	): void {
		const current = this.getDiff(x, y);
		const next: TileDiff = {
			...(current?.choppedAt !== undefined ? { choppedAt: current.choppedAt } : {}),
			...(current?.fence ? { fence: current.fence } : {}),
			...(current?.oreMined !== undefined ? { oreMined: current.oreMined } : {}),
			...(current?.harvestedAt !== undefined ? { harvestedAt: current.harvestedAt } : {}),
		};
		const merged = { ...next, ...patch };
		const clean: TileDiff = {
			...(merged.choppedAt !== undefined ? { choppedAt: merged.choppedAt } : {}),
			...(merged.fence ? { fence: merged.fence } : {}),
			...(merged.oreMined !== undefined ? { oreMined: merged.oreMined } : {}),
			...(merged.harvestedAt !== undefined ? { harvestedAt: merged.harvestedAt } : {}),
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
	return { x, y, ownerId: f.ownerId, level: f.level, damage: f.damage, gate: f.gate };
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
		iron: p.iron,
		gold: p.gold,
		health: p.survival.health,
		food: p.survival.food,
		water: p.survival.water,
		pantry: p.pantry,
		hasSpear: p.hasSpear,
		tool: p.tool,
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
