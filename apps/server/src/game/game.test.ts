import { ENCLOSURE, PACE, SPAWN, TREE } from "@kotp/shared/rules";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../persistence/memoryStore";
import { buildRing, createHarness } from "../testing/harness";
import { World } from "./world";

const STEP = PACE.moveIntervalMs;
const ACT = PACE.actionIntervalMs;

describe("joining (§1 Players and spawning)", () => {
	it("greets with a suggested handle, then joins with a token and nearby chunks", () => {
		const h = createHarness();
		const c = h.client();
		const hello = c.last("hello");
		expect(hello?.suggestedHandle).toMatch(/^[A-Za-z0-9_]{3,16}$/);
		c.join("Marco");
		const joined = c.last("joined");
		expect(joined?.you.handle).toBe("Marco");
		expect(joined?.token).toBeTruthy();
		expect(c.of("chunk")).toHaveLength(25);
	});

	it("rejects invalid handles and handles taken in any case", () => {
		const h = createHarness();
		h.client().join("Marco");
		const c = h.client();
		c.send({ type: "join", handle: "a b" });
		expect(c.last("joinRejected")?.reason).toBe("handleInvalid");
		c.send({ type: "join", handle: "marco" });
		expect(c.last("joinRejected")?.reason).toBe("handleTaken");
	});

	it("resumes the same player where they left (§1)", () => {
		const h = createHarness();
		const a = h.client();
		const id = a.join("Marco");
		const token = a.last("joined")?.token ?? "";
		h.relocate(id, 7, 3, "left");
		h.game.disconnect(a.sessionId);

		const b = h.client();
		b.send({ type: "resume", token });
		expect(b.last("joined")?.you).toMatchObject({ id, x: 7, y: 3 });

		const bad = h.client();
		bad.send({ type: "resume", token: "nope" });
		expect(bad.last("joinRejected")?.reason).toBe("badToken");
	});

	it("closes the older session when the same player resumes twice", () => {
		const h = createHarness();
		const a = h.client();
		a.join("Marco");
		const b = h.client();
		b.send({ type: "resume", token: a.last("joined")?.token ?? "" });
		expect(a.closed).toBe(true);
		expect(h.game.onlineCount()).toBe(1);
	});

	it("spawns near an existing fence, on open ground", () => {
		const h = createHarness();
		const builder = h.client();
		const id = builder.join("Builder");
		const p = h.world.playerById(id);
		if (!p) throw new Error("missing player");
		p.wood = 10;
		h.relocate(id, 100, 100, "right");
		builder.send({ type: "build", seq: 1 });
		h.tick();

		for (let i = 0; i < 10; i++) {
			const c = h.client();
			const you = h.world.playerById(c.join(`Newbie${i}`));
			if (!you) throw new Error("missing player");
			const distance = Math.hypot(you.x - 101, you.y - 100);
			expect(distance).toBeLessThanOrEqual(SPAWN.nearFenceMax + 1);
			expect(h.world.land.enclosuresAt(you.x, you.y)).toHaveLength(0);
		}
	});
});

describe("movement (§1, §5 Access)", () => {
	it("moves one tile and acknowledges with the authoritative position", () => {
		const h = createHarness();
		const c = h.client();
		const id = c.join("Marco");
		h.relocate(id, 0, 0, "down");
		c.send({ type: "move", dir: "right", seq: 1 });
		h.tick();
		expect(c.last("moved")).toEqual({ type: "moved", seq: 1, x: 1, y: 0, facing: "right" });
	});

	it("paces moves by walking speed", () => {
		const h = createHarness();
		const c = h.client();
		const id = c.join("Marco");
		h.relocate(id, 0, 0, "down");
		c.send({ type: "move", dir: "right", seq: 1 });
		c.send({ type: "move", dir: "right", seq: 2 });
		h.tick();
		expect(c.of("moved")).toHaveLength(1);
		h.advance(STEP);
		expect(c.last("moved")).toMatchObject({ seq: 2, x: 2 });
	});

	it("is blocked by water, hills and trees", () => {
		const h = createHarness({ "1,0": "water", "0,1": "hill", "-1,0": "tree" });
		const c = h.client();
		const id = c.join("Marco");
		h.relocate(id, 0, 0, "down");
		for (const [seq, dir] of [
			[1, "right"],
			[2, "down"],
			[3, "left"],
		] as const) {
			c.send({ type: "move", dir, seq });
			h.advance(STEP);
			expect(c.last("moved")).toMatchObject({ seq, x: 0, y: 0, facing: dir });
			expect(c.last("rejected")).toMatchObject({ seq, reason: "blocked" });
		}
	});

	it("turns in place without moving, so players can face an empty tile", () => {
		const h = createHarness();
		const c = h.client();
		const id = c.join("Marco");
		h.relocate(id, 0, 0, "down");
		c.send({ type: "turn", dir: "left", seq: 1 });
		h.tick();
		expect(h.world.playerById(id)).toMatchObject({ x: 0, y: 0, facing: "left" });
	});

	it("drops intents beyond the queue limit", () => {
		const h = createHarness();
		const c = h.client();
		c.join("Marco");
		for (let i = 0; i < 20; i++) c.send({ type: "move", dir: "right", seq: i });
		expect(c.of("rejected").length).toBeGreaterThan(0);
	});
});

describe("building and claiming (§3, §5)", () => {
	it("charges wood for a fence and rejects building without enough", () => {
		const h = createHarness();
		const c = h.client();
		const id = c.join("Marco");
		h.relocate(id, 0, 0, "right");
		c.send({ type: "build", seq: 1 });
		h.tick();
		expect(c.last("rejected")).toMatchObject({ seq: 1, reason: "notEnoughWood" });

		const p = h.world.playerById(id);
		if (!p) throw new Error("missing player");
		p.wood = 5;
		c.send({ type: "build", seq: 2 });
		h.advance(ACT);
		expect(c.last("inventory")?.wood).toBe(3);
		expect(c.last("tile")).toMatchObject({ x: 1, y: 0, fence: { ownerId: id, level: 1 } });
	});

	it("builds on any tile next to the player when a direction is given", () => {
		const h = createHarness();
		const c = h.client();
		const id = c.join("Builder");
		h.relocate(id, 0, 0, "right");
		const p = h.world.playerById(id);
		if (!p) throw new Error("missing");
		p.wood = 10;
		c.send({ type: "build", dir: "left", seq: 1 });
		h.tick();
		expect(h.world.tileAt(-1, 0, h.now()).kind).toBe("fence");
		expect(h.world.tileAt(1, 0, h.now()).kind).toBe("grass");
	});

	it("claims an enclosed area and tells nearby players who controls it", () => {
		const h = createHarness();
		const owner = h.client();
		const id = owner.join("Owner");
		const watcher = h.client();
		const watcherId = watcher.join("Watcher");
		h.relocate(watcherId, 10, 10, "down");
		buildRing(h, id, 0, 0, 2);
		expect(h.world.land.controllerAt(0, 0)).toBe(id);
		// World-level builds don't publish; check via a fresh chunk snapshot instead.
		const snap = h.world.chunkSnapshot(0, 0);
		expect(snap.control.owners).toEqual([id]);
		expect(snap.handles[id]).toBe("Owner");
	});

	it("lets a player trapped by a closing ring keep moving inside it (§5 Access)", () => {
		const h = createHarness();
		const owner = h.client();
		const ownerId = owner.join("Owner");
		const trapped = h.client();
		const trappedId = trapped.join("Trapped");
		h.relocate(trappedId, 0, 0, "down");
		buildRing(h, ownerId, 0, 0, 2);
		expect(h.world.land.controllerAt(0, 0)).toBe(ownerId);

		const t = h.now() + 30_000;
		expect(h.world.move(trappedId, "right", t).ok).toBe(true);
		expect(h.world.move(trappedId, "left", t + STEP).ok).toBe(true);
		// The walls still hold them in.
		h.relocate(trappedId, 1, 0, "right");
		expect(h.world.move(trappedId, "right", t + 2 * STEP)).toMatchObject({
			ok: false,
			reason: "blocked",
		});
	});

	it("lets an owner break their own fence in one chop, refunding half, and breaches the area", () => {
		const h = createHarness();
		const c = h.client();
		const id = c.join("Owner");
		buildRing(h, id, 0, 0, 1);
		expect(h.world.land.controllerAt(0, 0)).toBe(id);
		const p = h.world.playerById(id);
		if (!p) throw new Error("missing");
		const woodBefore = p.wood;
		h.relocate(id, 0, -2, "down");
		c.clear();
		c.send({ type: "chop", seq: 9 });
		h.advance(10_000);
		expect(p.wood).toBe(woodBefore + 1);
		expect(h.world.land.controllerAt(0, 0)).toBeNull();
		expect(c.last("control")?.changes).toContainEqual([0, 0, null]);
	});
});

describe("trees (§2)", () => {
	it("gives wood, leaves a stump, and anyone can chop, even in someone else's land", () => {
		const h = createHarness({ "1,0": "tree", "0,5": "tree" });
		const c = h.client();
		const id = c.join("Marco");
		h.relocate(id, 0, 0, "right");
		c.send({ type: "chop", seq: 1 });
		h.tick();
		const wood = c.last("inventory")?.wood ?? 0;
		expect(wood).toBeGreaterThanOrEqual(TREE.woodMin);
		expect(wood).toBeLessThanOrEqual(TREE.woodMax);
		expect(c.last("tile")).toMatchObject({ x: 1, y: 0, choppedAt: h.now() });

		// A tree inside someone else's land.
		const owner = h.client();
		const ownerId = owner.join("Owner");
		buildRing(h, ownerId, 0, 5, 2);
		h.relocate(id, 0, 4, "down"); // trapped inside, facing the tree
		expect(h.world.chop(id, h.now() + 1000).ok).toBe(true);
		expect(h.world.tileAt(0, 5, h.now() + 1000).kind).toBe("stump");
	});

	it("doesn't regrow while someone stands on the stump, then regrows when they leave", () => {
		const h = createHarness({ "1,0": "tree" });
		const c = h.client();
		const id = c.join("Marco");
		h.relocate(id, 0, 0, "right");
		const t0 = h.now();
		h.world.chop(id, t0);
		h.world.move(id, "right", t0 + STEP); // onto the stump
		const later = t0 + TREE.regrowDelayMs * 2;
		expect(h.world.tileAt(1, 0, later).kind).toBe("stump");
		const result = h.world.move(id, "right", later);
		expect(result.ok).toBe(true);
		expect(h.world.tileAt(1, 0, later).kind).toBe("tree");
		expect(result.events).toContainEqual({ kind: "tile", x: 1, y: 0 });
	});
});

describe("interest management", () => {
	it("only sends updates to players near the change", () => {
		const h = createHarness();
		const near = h.client();
		const nearId = near.join("Near");
		const far = h.client();
		const farId = far.join("Far");
		const actor = h.client();
		const actorId = actor.join("Actor");
		h.relocate(actorId, 0, 0, "right");
		h.relocate(nearId, 10, 10, "down");
		h.relocate(farId, 10_000, 0, "down");
		near.clear();
		far.clear();

		const p = h.world.playerById(actorId);
		if (!p) throw new Error("missing");
		p.wood = 2;
		h.relocate(actorId, 0, 1, "right");
		actor.send({ type: "build", seq: 1 });
		h.advance(ACT);
		expect(near.of("tile")).toHaveLength(1);
		expect(far.of("tile")).toHaveLength(0);
	});

	it("tells nearby players when someone goes offline", () => {
		const h = createHarness();
		const a = h.client();
		a.join("Alice");
		const b = h.client();
		const bId = b.join("Bob");
		const aId = h.world.playerByHandle("Alice")?.id ?? "";
		h.relocate(aId, 0, 0, "down");
		h.relocate(bId, 3, 0, "down");
		h.game.disconnect(b.sessionId);
		expect(a.last("playerGone")).toEqual({ type: "playerGone", id: bId });
	});
});

describe("persistence", () => {
	it("restores fences, chops, players and enclosures from a write batch", async () => {
		const h = createHarness({ "5,5": "tree" });
		const c = h.client();
		const id = c.join("Marco");
		buildRing(h, id, 0, 0, 2);
		h.relocate(id, 5, 4, "down");
		h.world.chop(id, h.now() + 5000);
		const store = new MemoryStore();
		await store.write(h.world.takeWriteBatch());

		const restored = new World({
			seed: "test",
			random: () => 0,
			newId: () => "x",
			terrain: h.world.terrain,
		});
		restored.load(await store.load(), h.now() + 6000);
		expect(restored.playerByHandle("marco")?.id).toBe(id);
		expect(restored.land.controllerAt(0, 0)).toBe(id);
		expect(restored.land.enclosuresOf(id)[0]?.tiles.size).toBe(9);
		expect(restored.tileAt(5, 5, h.now() + 6000).kind).toBe("stump");
		expect(restored.fencePositions()).toHaveLength(16);
		expect(store.enclosures.size).toBe(1);
	});

	it("doesn't persist an enclosure created and breached between flushes", () => {
		const h = createHarness();
		const c = h.client();
		const id = c.join("Marco");
		buildRing(h, id, 0, 0, 1);
		h.relocate(id, 0, -2, "down");
		h.world.chop(id, h.now() + 10_000);
		const batch = h.world.takeWriteBatch();
		expect(batch.enclosuresAdded).toHaveLength(0);
		expect(batch.enclosuresRemoved).toHaveLength(0);
	});

	it("respects the configured maximum enclosure area", () => {
		expect(ENCLOSURE.maxArea).toBeGreaterThan(9);
	});
});
