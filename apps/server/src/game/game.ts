import { type ClientMessage, PROTOCOL_VERSION, type ServerMessage } from "@kotp/shared/protocol";
import { checkHandle, NETWORK } from "@kotp/shared/rules";
import { type ChunkCoord, chunkKey, chunkOfTile, type Direction } from "@kotp/shared/world";
import { suggestHandle } from "./names";
import { findSpawnTile } from "./spawn";
import type { ActionResult, PlayerState, World, WorldEvent } from "./world";

export type GameDeps = {
	readonly world: World;
	readonly seed: string;
	readonly now: () => number;
	readonly random: () => number;
	readonly newId: () => string;
	readonly newToken: () => string;
	readonly hashToken: (token: string) => string;
};

type Intent = Extract<ClientMessage, { type: "move" | "turn" | "chop" | "build" }>;

type Session = {
	readonly id: string;
	readonly send: (msg: ServerMessage) => void;
	readonly close: () => void;
	playerId: string | null;
	queue: Intent[];
	knownChunks: Set<string>;
};

/**
 * Connects sessions to the world: join/resume, intent queues paced by the tick loop,
 * and interest management (each client only hears about chunks near its player).
 */
export class Game {
	private readonly sessions = new Map<string, Session>();
	private readonly sessionByPlayer = new Map<string, string>();

	constructor(private readonly deps: GameDeps) {}

	connect(send: (msg: ServerMessage) => void, close: () => void): string {
		const id = this.deps.newId();
		this.sessions.set(id, { id, send, close, playerId: null, queue: [], knownChunks: new Set() });
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
				const readyAt =
					intent.type === "turn"
						? 0
						: intent.type === "move"
							? player.nextMoveAt
							: player.nextActionAt;
				if (now < readyAt) break;
				session.queue.shift();
				this.runIntent(session, player, intent, now);
			}
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
			serverTime: now,
		});
		this.refreshInterest(session, player);
		this.sendNear(
			player.x,
			player.y,
			{ type: "player", player: this.deps.world.playerInfo(player) },
			player.id,
		);
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
				result = world.chop(player.id, now);
				break;
			case "build":
				result = world.build(player.id, now);
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
				case "inventory": {
					const p = world.playerById(e.id);
					const s = this.sessionOf(e.id);
					if (p && s) s.send({ type: "inventory", wood: p.wood });
					break;
				}
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
