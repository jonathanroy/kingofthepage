import type { ClientMessage, ServerMessage } from "@kotp/shared/protocol";
import type { Direction, Forage, MineSize, Terrain, TerrainGenerator } from "@kotp/shared/world";
import type { PasswordHasher } from "../auth/passwords";
import { Game } from "../game/game";
import { World } from "../game/world";

/** Flat grass everywhere except the listed tiles and mines. */
export function terrainFrom(
	features: Record<string, Terrain> = {},
	mines: Record<string, MineSize> = {},
	ore: Record<string, number> = {},
	forage: Record<string, Forage> = {},
): TerrainGenerator {
	return {
		seed: "test",
		terrainAt: (x, y) => features[`${x},${y}`] ?? "grass",
		mineAt: (x, y) => mines[`${x},${y}`] ?? null,
		oreAt: (x, y) => ore[`${x},${y}`] ?? null,
		forageAt: (x, y) => forage[`${x},${y}`] ?? null,
	};
}

/** Instant, reversible stand-in for scrypt so game tests stay fast; the real hasher has its own tests. */
const fakePasswords: PasswordHasher = {
	hash: async (password) => `pw:${password}`,
	verify: async (password, stored) => stored === `pw:${password}`,
};

/** Small deterministic PRNG (mulberry32) so test runs are repeatable. */
export function seededRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export type TestClient = {
	readonly sessionId: string;
	readonly inbox: ServerMessage[];
	closed: boolean;
	send(msg: ClientMessage): void;
	of<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }>[];
	last<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }> | undefined;
	clear(): void;
	/** Joins and returns the new player's id. */
	join(handle: string): string;
};

export function createHarness(
	features: Record<string, Terrain> = {},
	mines: Record<string, MineSize> = {},
	ore: Record<string, number> = {},
	forage: Record<string, Forage> = {},
) {
	let time = 1_000_000;
	let ids = 0;
	const random = seededRandom(42);
	const world = new World({
		seed: "test",
		random,
		newId: () => `id${++ids}`,
		terrain: terrainFrom(features, mines, ore, forage),
	});
	const game = new Game({
		world,
		seed: "test",
		now: () => time,
		random,
		newId: () => `id${++ids}`,
		newToken: () => `token${++ids}`,
		hashToken: (t) => `hash:${t}`,
		passwords: fakePasswords,
		autoSpawnCreatures: false,
	});

	function client(): TestClient {
		const inbox: ServerMessage[] = [];
		const c: TestClient = {
			sessionId: "",
			inbox,
			closed: false,
			send: (msg) => game.receive(c.sessionId, msg),
			of: <T extends ServerMessage["type"]>(type: T) =>
				inbox.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type),
			last: <T extends ServerMessage["type"]>(type: T) => c.of(type).at(-1),
			clear: () => {
				inbox.length = 0;
			},
			join: (handle) => {
				c.send({ type: "join", handle });
				const joined = c.last("joined");
				if (!joined) throw new Error(`Join failed: ${JSON.stringify(c.last("joinRejected"))}`);
				return joined.you.id;
			},
		};
		(c as { sessionId: string }).sessionId = game.connect(
			(msg) => inbox.push(msg),
			() => {
				c.closed = true;
			},
		);
		return c;
	}

	return {
		world,
		game,
		client,
		now: () => time,
		relocate(id: string, x: number, y: number, facing: Direction): void {
			game.relocatePlayer(id, x, y, facing);
		},
		/** Advances the clock without ticking. */
		skip(ms: number): void {
			time += ms;
		},
		/** Advances the clock and runs one tick. */
		advance(ms: number): void {
			time += ms;
			game.tick();
		},
		tick(): void {
			game.tick();
		},
	};
}

type Harness = ReturnType<typeof createHarness>;

/** Builds a closed square ring of radius `r` around (cx, cy) for `id`, placing each fence from outside. */
export function buildRing(h: Harness, id: string, cx: number, cy: number, r = 1): void {
	const p = h.world.playerById(id);
	if (!p) throw new Error("missing player");
	// Plenty of both resources so tests can upgrade the ring freely afterwards.
	p.wood += 1000;
	p.iron += 1000;
	let t = h.now();
	for (let x = cx - r; x <= cx + r; x++) {
		for (let y = cy - r; y <= cy + r; y++) {
			if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
			const dx = Math.sign(x - cx);
			const dy = Math.sign(y - cy);
			const [sx, sy, facing]: [number, number, Direction] =
				dy !== 0 ? [x, y + dy, dy < 0 ? "down" : "up"] : [x + dx, y, dx < 0 ? "right" : "left"];
			h.world.relocate(id, sx, sy, facing);
			t += 1000;
			const result = h.world.build(id, t);
			if (!result.ok) throw new Error(`build failed at ${x},${y}: ${result.reason}`);
		}
	}
}
