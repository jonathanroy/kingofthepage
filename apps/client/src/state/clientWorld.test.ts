import type { ServerMessage } from "@kotp/shared/protocol";
import { CHUNK_SIZE, createTerrainGenerator } from "@kotp/shared/world";
import { describe, expect, it } from "vitest";
import { ClientWorld } from "./clientWorld";

const SEED = "client-test";
const gen = createTerrainGenerator(SEED);

/** First grass tile with grass to its right, near the origin, for movement tests. */
function findOpenSpot(): { x: number; y: number } {
	for (let y = 0; y < CHUNK_SIZE; y++) {
		for (let x = 0; x < CHUNK_SIZE - 3; x++) {
			if ([0, 1, 2].every((d) => gen.terrainAt(x + d, y) === "grass")) return { x, y };
		}
	}
	throw new Error("no open spot");
}

function emptyChunk(cx: number, cy: number): ServerMessage {
	return {
		type: "chunk",
		cx,
		cy,
		chopped: [],
		fences: [],
		control: { owners: [], cells: null },
		handles: {},
	};
}

function setup(serverTime = 5_000) {
	let clock = 1_000;
	const world = new ClientWorld(() => clock);
	const spot = findOpenSpot();
	world.apply({
		type: "hello",
		protocolVersion: 1,
		worldSeed: SEED,
		serverTime,
		suggestedHandle: "x",
	});
	world.apply({
		type: "joined",
		you: { id: "me", handle: "Me", x: spot.x, y: spot.y, facing: "down" },
		token: "t",
		wood: 0,
		gold: 0,
		goldPerMinute: 0,
		serverTime,
	});
	for (let cy = -2; cy <= 2; cy++) for (let cx = -2; cx <= 2; cx++) world.apply(emptyChunk(cx, cy));
	return {
		world,
		spot,
		tick: (ms: number) => {
			clock += ms;
		},
	};
}

describe("ClientWorld", () => {
	it("generates terrain locally from the seed", () => {
		const { world } = setup();
		expect(world.tileAt(3, 4).kind).toBe(gen.terrainAt(3, 4));
	});

	it("tracks server time from the hello offset", () => {
		const { world, tick } = setup(50_000);
		tick(250);
		expect(world.serverNow()).toBe(50_250);
	});

	it("predicts a move and keeps it when the server agrees", () => {
		const { world, spot } = setup();
		world.predictMove("right", 1);
		expect(world.me).toMatchObject({ x: spot.x + 1, facing: "right" });
		world.apply({ type: "moved", seq: 1, x: spot.x + 1, y: spot.y, facing: "right" });
		expect(world.me?.x).toBe(spot.x + 1);
	});

	it("snaps to the server position on a misprediction and drops later guesses", () => {
		const { world, spot } = setup();
		world.predictMove("right", 1);
		world.predictMove("right", 2);
		world.apply({ type: "moved", seq: 1, x: spot.x, y: spot.y, facing: "right" });
		expect(world.me).toMatchObject({ x: spot.x, y: spot.y });
		// A late ack for the dropped guess is still authoritative.
		world.apply({ type: "moved", seq: 2, x: spot.x + 1, y: spot.y, facing: "right" });
		expect(world.me?.x).toBe(spot.x + 1);
	});

	it("counts gold up between server updates (§6)", () => {
		const { world, tick } = setup();
		world.apply({
			type: "inventory",
			wood: 0,
			gold: 10,
			goldPerMinute: 3,
			asOf: world.serverNow(),
		});
		tick(2 * 60_000);
		expect(world.liveGold()).toBeCloseTo(16);
	});

	it("predicts a turn without moving", () => {
		const { world, spot } = setup();
		world.predictTurn("up");
		expect(world.me).toMatchObject({ x: spot.x, y: spot.y, facing: "up" });
	});

	it("doesn't predict walking into a fence", () => {
		const { world, spot } = setup();
		world.apply({
			type: "tile",
			x: spot.x + 1,
			y: spot.y,
			choppedAt: null,
			fence: { x: spot.x + 1, y: spot.y, ownerId: "other", level: 1, damage: 0, gate: false },
		});
		world.predictMove("right", 1);
		expect(world.me).toMatchObject({ x: spot.x, facing: "right" });
	});

	it("shows a stump until the server-time regrow delay passes", () => {
		const { world, tick } = setup();
		let tree: { x: number; y: number } | undefined;
		for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE && !tree; i++) {
			const x = i % CHUNK_SIZE;
			const y = Math.floor(i / CHUNK_SIZE);
			if (gen.terrainAt(x, y) === "tree") tree = { x, y };
		}
		if (!tree) throw new Error("no tree in chunk 0,0 for this seed");
		const { x, y } = tree;
		world.apply({ type: "tile", x, y, choppedAt: world.serverNow(), fence: null });
		expect(world.tileAt(x, y).kind).toBe("stump");
		tick(60 * 60 * 1000);
		expect(world.tileAt(x, y).kind).toBe("tree");
	});

	it("unpacks chunk control cells and applies control updates", () => {
		const { world } = setup();
		const cells = new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(0);
		cells[0] = 1;
		world.apply({
			type: "chunk",
			cx: 1,
			cy: 0,
			chopped: [],
			fences: [],
			control: { owners: ["alice"], cells },
			handles: { alice: "Alice" },
		});
		expect(world.controllerAt(32, 0)).toBe("alice");
		expect(world.handles.get("alice")).toBe("Alice");
		world.apply({ type: "control", changes: [[32, 0, null]], handles: {} });
		expect(world.controllerAt(32, 0)).toBeNull();
	});

	it("drops chunks and players that fall outside the interest radius", () => {
		const { world } = setup();
		world.apply({ type: "player", player: { id: "p2", handle: "P2", x: 1, y: 1, facing: "down" } });
		expect(world.players.has("p2")).toBe(true);
		// The player walks out of view: observers of the old spot get one last update.
		world.apply({
			type: "player",
			player: { id: "p2", handle: "P2", x: 9_999, y: 0, facing: "down" },
		});
		expect(world.players.has("p2")).toBe(false);

		if (!world.me) throw new Error("no me");
		world.me.x = 10 * CHUNK_SIZE;
		world.apply(emptyChunk(10, 0));
		expect(world.chunks.has("0,0")).toBe(false);
		expect(world.chunks.has("10,0")).toBe(true);
	});
});
