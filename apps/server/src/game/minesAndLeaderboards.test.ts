import { LEADERBOARD, MINES } from "@kotp/shared/rules";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../persistence/memoryStore";
import { buildRing, createHarness } from "../testing/harness";
import { World } from "./world";

const MIN = 60_000;

/** Gold after settling at `at`. */
function goldAt(h: ReturnType<typeof createHarness>, id: string, at: number): number {
	h.world.settlePlayerGold(id, at);
	return h.world.playerById(id)?.gold ?? Number.NaN;
}

describe("gold mines (§6)", () => {
	it("are solid: no walking onto them, no fences on them", () => {
		const h = createHarness({}, { "1,0": "small" });
		const c = h.client();
		const id = c.join("Miner");
		h.relocate(id, 0, 0, "right");
		expect(h.world.move(id, "right", h.now() + 1000)).toMatchObject({
			ok: false,
			reason: "blocked",
		});
		const p = h.world.playerById(id);
		if (!p) throw new Error("missing");
		p.wood = 10;
		expect(h.world.build(id, h.now() + 2000)).toMatchObject({
			ok: false,
			reason: "notEmptyGround",
		});
	});

	it("produce nothing unclaimed, then pay the controller per minute once enclosed", () => {
		const h = createHarness({}, { "0,0": "large" });
		const id = h.client().join("Miner");
		expect(h.world.goldPerMinute(id)).toBe(0);
		buildRing(h, id, 0, 0, 1);
		expect(h.world.goldPerMinute(id)).toBe(MINES.goldPerMinute.large);
		const t0 = h.now() + 100 * MIN;
		const before = goldAt(h, id, t0);
		expect(goldAt(h, id, t0 + 10 * MIN) - before).toBeCloseTo(10 * MINES.goldPerMinute.large);
	});

	it("moves to whoever rings the mine inside someone else's land (mine theft), settling first", () => {
		const h = createHarness({}, { "0,0": "small" });
		const ownerId = h.client().join("Owner");
		const thiefId = h.client().join("Thief");
		buildRing(h, ownerId, 0, 0, 3);
		const t0 = h.now() + 100 * MIN;
		const ownerBefore = goldAt(h, ownerId, t0);

		// The thief, trapped inside, rings the mine 10 minutes later.
		const theftAt = t0 + 10 * MIN;
		const thief = h.world.playerById(thiefId);
		if (!thief) throw new Error("missing");
		thief.wood = 100;
		const ring: [number, number, "up" | "down" | "left" | "right"][] = [
			[-1, -2, "down"],
			[0, -2, "down"],
			[1, -2, "down"],
			[-1, 2, "up"],
			[0, 2, "up"],
			[1, 2, "up"],
			[-2, 0, "right"],
			[2, 0, "left"],
		];
		for (const [sx, sy, facing] of ring) {
			h.relocate(thiefId, sx, sy, facing);
			expect(h.world.build(thiefId, theftAt).ok).toBe(true);
		}
		expect(h.world.land.controllerAt(0, 0)).toBe(thiefId);
		expect(goldAt(h, ownerId, theftAt) - ownerBefore).toBeCloseTo(10 * MINES.goldPerMinute.small);
		expect(goldAt(h, ownerId, theftAt + 30 * MIN) - ownerBefore).toBeCloseTo(
			10 * MINES.goldPerMinute.small,
		);
		expect(goldAt(h, thiefId, theftAt + 30 * MIN)).toBeCloseTo(30 * MINES.goldPerMinute.small);
	});

	it("stops paying when the land is breached, keeping what was earned", () => {
		const h = createHarness({}, { "0,0": "small" });
		const id = h.client().join("Miner");
		buildRing(h, id, 0, 0, 1);
		const t0 = h.now() + 100 * MIN;
		goldAt(h, id, t0);
		h.relocate(id, 0, -2, "down");
		h.world.chop(id, t0 + 5 * MIN);
		const atBreach = h.world.playerById(id)?.gold ?? 0;
		expect(h.world.goldPerMinute(id)).toBe(0);
		expect(goldAt(h, id, t0 + 60 * MIN)).toBe(atBreach);
	});

	it("keeps earning while the owner is offline and shows it when they return", () => {
		const h = createHarness({}, { "0,0": "small" });
		const c = h.client();
		const id = c.join("Miner");
		const token = c.last("joined")?.token ?? "";
		buildRing(h, id, 0, 0, 1);
		h.relocate(id, 5, 5, "down");
		h.game.disconnect(c.sessionId);
		h.skip(120 * MIN);
		const back = h.client();
		back.send({ type: "resume", token });
		const inv = back.last("inventory");
		expect(inv?.gold).toBeGreaterThan(100);
		expect(inv?.goldPerMinute).toBe(MINES.goldPerMinute.small);
	});
});

describe("leaderboards (§7)", () => {
	it("ranks land by controlled tiles and gold by total earned, and rate-limits requests", () => {
		const h = createHarness({}, { "20,0": "large" });
		const small = h.client();
		const smallId = small.join("Small");
		const big = h.client();
		const bigId = big.join("Big");
		buildRing(h, smallId, 0, 0, 1);
		buildRing(h, bigId, 20, 0, 2);
		h.skip(200 * MIN);

		small.send({ type: "leaderboard" });
		const board = small.last("leaderboard");
		// Interior (the mine tile included) plus each player's own wall tiles.
		expect(board?.land.map((e) => [e.handle, e.value])).toEqual([
			["Big", 9 + 16],
			["Small", 1 + 8],
		]);
		expect(board?.gold[0]?.handle).toBe("Big");
		expect(board?.you).toEqual({ land: 9, gold: 0 });

		small.clear();
		small.send({ type: "leaderboard" });
		expect(small.of("leaderboard")).toHaveLength(0);
		h.skip(LEADERBOARD.minRequestIntervalMs);
		small.send({ type: "leaderboard" });
		expect(small.of("leaderboard")).toHaveLength(1);
	});
});

describe("leaderboard reads", () => {
	it("project mine gold without writing, and are cached briefly", () => {
		const h = createHarness({}, { "0,0": "small" });
		const c = h.client();
		const id = c.join("Miner");
		buildRing(h, id, 0, 0, 1);
		h.skip(100 * MIN);
		h.world.takeWriteBatch();

		c.send({ type: "leaderboard" });
		const first = c.last("leaderboard")?.gold[0]?.value ?? 0;
		expect(first).toBeGreaterThan(90);
		expect(h.world.takeWriteBatch().minesSet).toHaveLength(0);

		h.skip(LEADERBOARD.minRequestIntervalMs);
		c.send({ type: "leaderboard" });
		expect(c.last("leaderboard")?.gold[0]?.value).toBe(first);
		// Once the cache expires, a minute of production shows up.
		h.skip(Math.max(LEADERBOARD.cacheMs, MIN));
		c.send({ type: "leaderboard" });
		expect(c.last("leaderboard")?.gold[0]?.value).toBeGreaterThan(first);
	});
});

describe("persistence of gold and mines", () => {
	it("restores gold and each mine's clock", async () => {
		const h = createHarness({}, { "0,0": "small" });
		const id = h.client().join("Miner");
		buildRing(h, id, 0, 0, 1);
		const t0 = h.now() + 100 * MIN;
		const gold = goldAt(h, id, t0);
		const store = new MemoryStore();
		await store.write(h.world.takeWriteBatch());
		expect(store.mines.size).toBe(1);

		const restored = new World({
			seed: "test",
			random: () => 0,
			newId: () => "x",
			terrain: h.world.terrain,
		});
		restored.load(await store.load(), t0 + 10 * MIN);
		restored.settlePlayerGold(id, t0 + 10 * MIN);
		expect(restored.playerById(id)?.gold).toBeCloseTo(gold + 10 * MINES.goldPerMinute.small);
	});
});
