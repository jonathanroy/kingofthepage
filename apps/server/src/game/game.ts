import {
	type ClientMessage,
	type LeaderboardEntry,
	PROTOCOL_VERSION,
	type ServerMessage,
} from "@kotp/shared/protocol";
import { checkHandle, LEADERBOARD, NETWORK, SURVIVAL } from "@kotp/shared/rules";
import {
	type ChunkCoord,
	chunkKey,
	chunkOfTile,
	type Direction,
	stepToward,
} from "@kotp/shared/world";
import { suggestHandle } from "./names";
import { MagicShop, type ShopState } from "./shop";
import { findSpawnTile } from "./spawn";
import { Wildlife } from "./wildlife";
import type { ActionResult, PlayerState, World, WorldEvent } from "./world";

export type GameDeps = {
	readonly world: World;
	readonly seed: string;
	readonly now: () => number;
	readonly random: () => number;
	readonly newId: () => string;
	readonly newToken: () => string;
	readonly hashToken: (token: string) => string;
	/** Spawn animals and bears around players; tests usually place them by hand. */
	readonly autoSpawnCreatures?: boolean;
};

type Intent = Extract<
	ClientMessage,
	{
		type:
			| "move"
			| "turn"
			| "chop"
			| "build"
			| "upgrade"
			| "makeGate"
			| "interact"
			| "eat"
			| "craftSpear"
			| "selectTool"
			| "buy"
			| "equip";
	}
>;

type Session = {
	readonly id: string;
	readonly send: (msg: ServerMessage) => void;
	readonly close: () => void;
	playerId: string | null;
	queue: Intent[];
	knownChunks: Set<string>;
	lastLeaderboardAt: number;
};

/**
 * Connects sessions to the world: join/resume, intent queues paced by the tick loop,
 * and interest management (each client only hears about chunks near its player).
 */
export class Game {
	private readonly sessions = new Map<string, Session>();
	private readonly sessionByPlayer = new Map<string, string>();

	readonly wildlife: Wildlife;
	readonly shop: MagicShop;
	private shopDay = -1;
	private lastSurvivalTick = 0;

	constructor(private readonly deps: GameDeps) {
		this.shop = new MagicShop(deps.world, deps.seed);
		deps.world.setStructureLookup((x, y) => this.shop.isAt(x, y, deps.now()));
		this.wildlife = new Wildlife(deps.world, {
			random: deps.random,
			newId: deps.newId,
			autoSpawn: deps.autoSpawnCreatures ?? true,
		});
	}

	connect(send: (msg: ServerMessage) => void, close: () => void): string {
		const id = this.deps.newId();
		this.sessions.set(id, {
			id,
			send,
			close,
			playerId: null,
			queue: [],
			knownChunks: new Set(),
			lastLeaderboardAt: Number.NEGATIVE_INFINITY,
		});
		send({
			type: "hello",
			protocolVersion: PROTOCOL_VERSION,
			worldSeed: this.deps.seed,
			serverTime: this.deps.now(),
			suggestedHandle: suggestHandle(this.deps.random, (h) => !!this.deps.world.playerByHandle(h)),
		});
		return id;
	}

	disconnect(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		this.sessions.delete(sessionId);
		const playerId = session.playerId;
		if (!playerId || this.sessionByPlayer.get(playerId) !== sessionId) return;
		this.sessionByPlayer.delete(playerId);
		const player = this.deps.world.playerById(playerId);
		this.deps.world.setOnline(playerId, false, this.deps.now());
		// §1 Presence: offline characters are not shown.
		if (player) this.sendNear(player.x, player.y, { type: "playerGone", id: playerId }, playerId);
	}

	receive(sessionId: string, msg: ClientMessage): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		switch (msg.type) {
			case "join":
				this.join(session, msg.handle);
				break;
			case "resume":
				this.resume(session, msg.token);
				break;
			// Alliance changes aren't paced or ordered with movement, so they apply at once.
			case "allyRequest":
			case "allyAccept":
			case "allyDecline":
			case "allyEnd":
				if (session.playerId) this.handleAlliance(session.playerId, msg);
				break;
			case "leaderboard":
				this.sendLeaderboard(session);
				break;
			default:
				this.enqueue(session, msg);
		}
	}

	/** One server tick: run every intent whose pacing allows it. */
	tick(): void {
		const now = this.deps.now();
		for (const session of this.sessions.values()) {
			if (!session.playerId) continue;
			const player = this.deps.world.playerById(session.playerId);
			if (!player) continue;
			while (session.queue.length > 0) {
				const intent = session.queue[0] as Intent;
				const instant =
					intent.type === "turn" ||
					intent.type === "eat" ||
					intent.type === "craftSpear" ||
					intent.type === "selectTool" ||
					intent.type === "buy" ||
					intent.type === "equip";
				const readyAt = instant
					? 0
					: intent.type === "move"
						? player.nextMoveAt
						: player.nextActionAt;
				if (now < readyAt) break;
				session.queue.shift();
				this.runIntent(session, player, intent, now);
			}
		}
		this.moveShopIfDue(now);
		const wild = this.wildlife.update(now);
		this.publish(wild.events);
		for (const id of wild.killed) this.killPlayer(id, "bear");
		if (now - this.lastSurvivalTick >= SURVIVAL.tickMs) {
			const elapsed = this.lastSurvivalTick === 0 ? SURVIVAL.tickMs : now - this.lastSurvivalTick;
			this.lastSurvivalTick = now;
			this.tickSurvival(elapsed);
		}
	}

	/** Moves a player directly (admin tools, tests) and keeps clients' views consistent. */
	relocatePlayer(playerId: string, x: number, y: number, facing: Direction): void {
		const { world } = this.deps;
		const before = world.playerById(playerId);
		if (!before) return;
		const from = { x: before.x, y: before.y };
		world.relocate(playerId, x, y, facing);
		const session = this.sessionOf(playerId);
		if (session) this.refreshInterest(session, before);
		this.publish([{ kind: "player", id: playerId, fromX: from.x, fromY: from.y }]);
	}

	onlineCount(): number {
		return this.sessionByPlayer.size;
	}

	// ---------- Join ----------

	private join(session: Session, handle: string): void {
		if (session.playerId) return;
		const { world } = this.deps;
		const check = checkHandle(handle);
		if (!check.ok) {
			session.send({ type: "joinRejected", reason: "handleInvalid", detail: check.reason });
			return;
		}
		if (world.playerByHandle(handle)) {
			session.send({ type: "joinRejected", reason: "handleTaken" });
			return;
		}
		const now = this.deps.now();
		const token = this.deps.newToken();
		const player = world.createPlayer({
			id: this.deps.newId(),
			handle,
			tokenHash: this.deps.hashToken(token),
			at: findSpawnTile(world, this.deps.random, now),
			now,
		});
		this.enterWorld(session, player, token);
	}

	private resume(session: Session, token: string): void {
		if (session.playerId) return;
		const player = this.deps.world.playerByTokenHash(this.deps.hashToken(token));
		if (!player) {
			session.send({ type: "joinRejected", reason: "badToken" });
			return;
		}
		// A second tab or a reconnect before the old socket timed out: the newest wins.
		const previous = this.sessionByPlayer.get(player.id);
		if (previous) {
			const old = this.sessions.get(previous);
			this.disconnect(previous);
			old?.close();
		}
		this.enterWorld(session, player, token);
	}

	private enterWorld(session: Session, player: PlayerState, token: string): void {
		const now = this.deps.now();
		session.playerId = player.id;
		this.sessionByPlayer.set(player.id, session.id);
		this.deps.world.setOnline(player.id, true, now);
		session.send({
			type: "joined",
			you: this.deps.world.playerInfo(player),
			token,
			wood: player.wood,
			iron: player.iron,
			gold: 0,
			goldPerMinute: 0,
			serverTime: now,
		});
		// Offline earnings (§6) are settled and shown as soon as the player is back.
		this.sendInventory(player.id);
		this.refreshInterest(session, player);
		this.sendAlliances(player.id);
		this.sendStatus(player.id);
		this.sendBases(player.id);
		this.sendCollection(player.id);
		this.sendNear(
			player.x,
			player.y,
			{ type: "player", player: this.deps.world.playerInfo(player) },
			player.id,
		);
	}

	private axeAtCreature(player: PlayerState): boolean {
		const at = stepToward(player.x, player.y, player.facing);
		return this.wildlife.hasCreatureAt(at.x, at.y);
	}

	// ---------- Compass and magic shop (§10) ----------

	private sendBases(playerId: string): void {
		this.sessionOf(playerId)?.send({ type: "bases", bases: this.deps.world.bases(playerId) });
	}

	private sendCollection(playerId: string): void {
		const p = this.deps.world.playerById(playerId);
		if (!p) return;
		this.sessionOf(playerId)?.send({ type: "collection", owned: p.owned, equipped: p.look });
	}

	private shopMessage(shop: ShopState): ServerMessage {
		return {
			type: "shop",
			x: shop.x,
			y: shop.y,
			offer: this.shop.offerInfo(shop),
			movesAt: shop.movesAt,
		};
	}

	/** At midnight UTC the shop vanishes from its old spot and appears at the new one. */
	private moveShopIfDue(now: number): void {
		const previous = this.shop.peek();
		const shop = this.shop.current(now);
		if (shop.day === this.shopDay) return;
		this.shopDay = shop.day;
		if (previous && previous.day !== shop.day)
			this.sendNear(previous.x, previous.y, { type: "shopGone" });
		this.sendNear(shop.x, shop.y, this.shopMessage(shop));
	}

	// ---------- Survival (§8) ----------

	/** Online players only: meters and spoilage pause while offline. */
	private tickSurvival(elapsedMs: number): void {
		const { world } = this.deps;
		for (const p of world.onlinePlayers()) {
			const { dead, spoiled } = world.tickSurvival(p.id, elapsedMs);
			for (const food of spoiled)
				this.sessionOf(p.id)?.send({ type: "notice", notice: { kind: "spoiled", food } });
			if (dead) this.killPlayer(p.id, "starved");
			else this.sendStatus(p.id);
		}
	}

	/** §8 Death: respawn like a new player, losing what was carried. */
	private killPlayer(playerId: string, cause: "starved" | "bear"): void {
		const { world } = this.deps;
		const player = world.playerById(playerId);
		if (!player) return;
		const at = findSpawnTile(world, this.deps.random, this.deps.now());
		const events = world.respawn(playerId, at);
		const session = this.sessionOf(playerId);
		session?.send({ type: "notice", notice: { kind: "died", cause } });
		session?.send({ type: "respawned", x: at.x, y: at.y, facing: player.facing });
		this.publish(events);
		if (session) this.refreshInterest(session, player);
	}

	private sendStatus(playerId: string): void {
		const p = this.deps.world.playerById(playerId);
		if (!p) return;
		this.sessionOf(playerId)?.send({ type: "status", ...this.deps.world.statusOf(p) });
	}

	// ---------- Gold and leaderboards (§6, §7) ----------

	/** Settles the player's mines first: reading a balance is a settlement point (§11). */
	private sendInventory(playerId: string): void {
		const { world } = this.deps;
		const p = world.playerById(playerId);
		const s = this.sessionOf(playerId);
		if (!p || !s) return;
		const now = this.deps.now();
		// Clients show the spendable balance; the leaderboard keeps ranking gold earned (§10).
		const balance = world.balance(playerId, now);
		s.send({
			type: "inventory",
			wood: p.wood,
			iron: p.iron,
			gold: balance,
			goldPerMinute: world.goldPerMinute(playerId),
			asOf: now,
		});
	}

	private sendLeaderboard(session: Session): void {
		const playerId = session.playerId;
		if (!playerId) return;
		const now = this.deps.now();
		if (now - session.lastLeaderboardAt < LEADERBOARD.minRequestIntervalMs) return;
		session.lastLeaderboardAt = now;
		const boards = this.cachedBoards(now);
		session.send({
			type: "leaderboard",
			land: boards.land,
			gold: boards.gold,
			you: {
				land: boards.scores.land.get(playerId) ?? 0,
				gold: Math.floor(boards.scores.gold.get(playerId) ?? 0),
			},
		});
	}

	private boardsCache: {
		at: number;
		scores: { land: Map<string, number>; gold: Map<string, number> };
		land: LeaderboardEntry[];
		gold: LeaderboardEntry[];
	} | null = null;

	/** Every client asks every 10 s, so the boards are computed once per cache period and shared. */
	private cachedBoards(now: number) {
		if (this.boardsCache && now - this.boardsCache.at < LEADERBOARD.cacheMs)
			return this.boardsCache;
		const scores = this.deps.world.scores(now);
		const top = (m: Map<string, number>): LeaderboardEntry[] =>
			[...m]
				.map(([id, value]) => ({
					id,
					handle: this.deps.world.handleOf(id) ?? "?",
					value: Math.floor(value),
				}))
				.filter((e) => e.value > 0)
				.sort((a, b) => b.value - a.value || a.handle.localeCompare(b.handle))
				.slice(0, LEADERBOARD.size);
		this.boardsCache = { at: now, scores, land: top(scores.land), gold: top(scores.gold) };
		return this.boardsCache;
	}

	// ---------- Alliances (§4) ----------

	private handleAlliance(
		playerId: string,
		msg: Extract<ClientMessage, { type: "allyRequest" | "allyAccept" | "allyDecline" | "allyEnd" }>,
	): void {
		const { world } = this.deps;
		const book = world.alliances;
		const me = this.ref(playerId);
		if (!me) return;
		const notify = (to: string, notice: Extract<ServerMessage, { type: "notice" }>["notice"]) =>
			this.sessionOf(to)?.send({ type: "notice", notice });

		if (msg.type === "allyRequest") {
			const target = world.playerByHandle(msg.handle);
			if (!target) {
				notify(playerId, { kind: "allianceRequestFailed", reason: "unknownHandle" });
				return;
			}
			const them = { id: target.id, handle: target.handle };
			const result = book.request(playerId, target.id);
			if (result === "formed") {
				this.allianceFormed(me, them);
			} else if (result === "requested") {
				notify(playerId, { kind: "allianceRequestSent", to: them });
				notify(target.id, { kind: "allianceRequest", from: me });
			} else {
				notify(playerId, { kind: "allianceRequestFailed", reason: result });
			}
			this.sendAlliances(playerId, target.id);
			return;
		}

		const other = this.ref(msg.playerId);
		if (!other) return;
		if (msg.type === "allyAccept" && book.accept(playerId, other.id)) {
			this.allianceFormed(me, other);
		} else if (msg.type === "allyDecline") {
			book.decline(playerId, other.id);
		} else if (msg.type === "allyEnd" && book.end(playerId, other.id)) {
			// Gate access ends immediately (§4); anyone already inside stays, like any trapped player.
			world.markAlliance(playerId, other.id, false);
			notify(other.id, { kind: "allianceEnded", with: me });
			notify(playerId, { kind: "allianceEnded", with: other });
		}
		this.sendAlliances(playerId, other.id);
	}

	private allianceFormed(
		a: { id: string; handle: string },
		b: { id: string; handle: string },
	): void {
		this.deps.world.markAlliance(a.id, b.id, true);
		this.sessionOf(a.id)?.send({ type: "notice", notice: { kind: "allianceFormed", with: b } });
		this.sessionOf(b.id)?.send({ type: "notice", notice: { kind: "allianceFormed", with: a } });
	}

	private sendAlliances(...playerIds: string[]): void {
		const book = this.deps.world.alliances;
		const refs = (ids: string[]) =>
			ids.map((id) => this.ref(id)).filter((r): r is { id: string; handle: string } => r !== null);
		for (const id of playerIds) {
			this.sessionOf(id)?.send({
				type: "alliances",
				allies: refs(book.alliesOf(id)),
				incoming: refs(book.incomingRequests(id)),
				outgoing: refs(book.outgoingRequests(id)),
			});
		}
	}

	private ref(playerId: string): { id: string; handle: string } | null {
		const handle = this.deps.world.handleOf(playerId);
		return handle ? { id: playerId, handle } : null;
	}

	// ---------- Intents ----------

	private enqueue(session: Session, intent: Intent): void {
		if (!session.playerId) {
			session.send({ type: "rejected", seq: intent.seq, reason: "notJoined" });
			return;
		}
		if (session.queue.length >= NETWORK.maxQueuedIntents) {
			this.reject(session, intent, "tooSoon");
			return;
		}
		session.queue.push(intent);
	}

	private runIntent(session: Session, player: PlayerState, intent: Intent, now: number): void {
		const { world } = this.deps;
		let result: ActionResult;
		switch (intent.type) {
			case "move":
				result = world.move(player.id, intent.dir, now);
				break;
			case "turn":
				result = world.turn(player.id, intent.dir);
				break;
			case "chop":
				// The chop key uses the selected tool (§9): the spear hits creatures instead.
				result =
					player.tool === "spear"
						? this.wildlife.spearHit(player, now)
						: this.axeAtCreature(player)
							? // Swinging the axe at an animal: point the player at the spear instead.
								{ ok: false, reason: player.hasSpear ? "useSpear" : "noSpear", events: [] }
							: world.chop(player.id, now, intent.confirmAlly ?? false);
				break;
			case "interact":
				result = world.interact(player.id, now);
				break;
			case "eat":
				result = world.eat(player.id);
				break;
			case "craftSpear":
				result = world.craftSpear(player.id);
				break;
			case "selectTool":
				result = world.selectTool(player.id, intent.tool);
				break;
			case "buy": {
				const shop = this.shop.current(now);
				result = world.buy(player.id, intent.itemId, shop.offer, shop, now);
				break;
			}
			case "equip":
				result = world.equip(player.id, intent.slot, intent.itemId);
				break;
			case "build":
				result = world.build(player.id, now, intent.dir);
				break;
			case "upgrade":
				result = world.upgrade(player.id, now);
				break;
			case "makeGate":
				result = world.makeGate(player.id, now);
				break;
		}
		if (intent.type === "move") {
			session.send({
				type: "moved",
				seq: intent.seq,
				x: player.x,
				y: player.y,
				facing: player.facing,
			});
		}
		if (!result.ok) this.reject(session, intent, result.reason);
		this.publish(result.events);
		if (intent.type === "move" && result.ok) this.refreshInterest(session, player);
	}

	private reject(
		session: Session,
		intent: Intent,
		reason: Extract<ServerMessage, { type: "rejected" }>["reason"],
	): void {
		const player = session.playerId ? this.deps.world.playerById(session.playerId) : undefined;
		if (intent.type === "move" && player && reason === "tooSoon") {
			session.send({
				type: "moved",
				seq: intent.seq,
				x: player.x,
				y: player.y,
				facing: player.facing,
			});
		}
		session.send({ type: "rejected", seq: intent.seq, reason });
	}

	// ---------- Interest management ----------

	private publish(events: readonly WorldEvent[]): void {
		const { world } = this.deps;
		for (const e of events) {
			switch (e.kind) {
				case "tile":
					this.sendNear(e.x, e.y, {
						type: "tile",
						x: e.x,
						y: e.y,
						...world.tileSnapshot(e.x, e.y),
					});
					break;
				case "inventory":
					this.sendInventory(e.id);
					break;
				case "player": {
					const p = world.playerById(e.id);
					if (!p) break;
					const msg: ServerMessage = { type: "player", player: world.playerInfo(p) };
					// Observers of the old spot also hear it, so they can drop a player who walked out of view.
					const targets = new Set([
						...this.sessionsNear(p.x, p.y),
						...this.sessionsNear(e.fromX, e.fromY),
					]);
					for (const s of targets) if (s.playerId !== e.id) s.send(msg);
					break;
				}
				case "control":
					this.publishControl(e.changes);
					break;
				case "status":
					this.sendStatus(e.id);
					break;
				case "bases":
					this.sendBases(e.id);
					break;
				case "collection":
					this.sendCollection(e.id);
					break;
				case "notice":
					this.sessionOf(e.id)?.send({ type: "notice", notice: e.notice });
					break;
				case "creature": {
					const info = this.wildlife.info(e.id);
					if (!info) break;
					const targets = new Set([
						...this.sessionsNear(info.x, info.y),
						...this.sessionsNear(e.fromX, e.fromY),
					]);
					for (const s of targets) s.send({ type: "creature", creature: info });
					break;
				}
				case "creatureGone":
					this.sendNear(e.x, e.y, { type: "creatureGone", id: e.id });
					break;
				case "allyChop": {
					const by = this.ref(e.byId);
					if (by) {
						this.sessionOf(e.ownerId)?.send({
							type: "notice",
							notice: { kind: "allyChoppingFence", by, x: e.x, y: e.y },
						});
					}
					break;
				}
			}
		}
	}

	private publishControl(changes: Extract<WorldEvent, { kind: "control" }>["changes"]): void {
		for (const session of this.sessions.values()) {
			if (!session.playerId) continue;
			const visible: [number, number, string | null][] = [];
			for (const c of changes) {
				const [x, y] = c.tile.split(",").map(Number) as [number, number];
				const { cx, cy } = chunkOfTile(x, y);
				if (session.knownChunks.has(chunkKey(cx, cy))) visible.push([x, y, c.to]);
			}
			if (visible.length === 0) continue;
			const owners = visible.map(([, , o]) => o).filter((o): o is string => o !== null);
			session.send({
				type: "control",
				changes: visible,
				handles: this.deps.world.handlesFor(owners),
			});
		}
	}

	/** Sends chunks that just came into range, and the players standing in them. */
	private refreshInterest(session: Session, player: PlayerState): void {
		const { world } = this.deps;
		const wanted = chunksAround(chunkOfTile(player.x, player.y));
		const fresh = [...wanted.keys()].filter((k) => !session.knownChunks.has(k));
		session.knownChunks = new Set(wanted.keys());
		const freshSet = new Set(fresh);
		for (const key of fresh) {
			const { cx, cy } = wanted.get(key) as ChunkCoord;
			session.send({ type: "chunk", cx, cy, ...world.chunkSnapshot(cx, cy) });
		}
		const shop = this.shop.current(this.deps.now());
		if (freshSet.has(chunkKey(chunkOfTile(shop.x, shop.y).cx, chunkOfTile(shop.x, shop.y).cy))) {
			session.send(this.shopMessage(shop));
		}
		for (const creature of this.wildlife.all()) {
			const { cx, cy } = chunkOfTile(creature.x, creature.y);
			if (freshSet.has(chunkKey(cx, cy))) session.send({ type: "creature", creature });
		}
		for (const other of world.onlinePlayers()) {
			if (other.id === player.id) continue;
			const { cx, cy } = chunkOfTile(other.x, other.y);
			if (freshSet.has(chunkKey(cx, cy))) {
				session.send({ type: "player", player: world.playerInfo(other) });
			}
		}
	}

	private sessionsNear(x: number, y: number): Session[] {
		const { cx, cy } = chunkOfTile(x, y);
		const key = chunkKey(cx, cy);
		return [...this.sessions.values()].filter((s) => s.playerId && s.knownChunks.has(key));
	}

	private sendNear(x: number, y: number, msg: ServerMessage, exceptPlayerId?: string): void {
		for (const s of this.sessionsNear(x, y)) {
			if (s.playerId !== exceptPlayerId) s.send(msg);
		}
	}

	private sessionOf(playerId: string): Session | undefined {
		const id = this.sessionByPlayer.get(playerId);
		return id ? this.sessions.get(id) : undefined;
	}
}

function chunksAround(center: ChunkCoord): Map<string, ChunkCoord> {
	const r = NETWORK.interestRadiusChunks;
	const out = new Map<string, ChunkCoord>();
	for (let dy = -r; dy <= r; dy++) {
		for (let dx = -r; dx <= r; dx++) {
			const c = { cx: center.cx + dx, cy: center.cy + dy };
			out.set(chunkKey(c.cx, c.cy), c);
		}
	}
	return out;
}
