import { CREATURES, FOOD, FORAGE, PACE, SURVIVAL, TOOLS } from "@kotp/shared/rules";
import { describe, expect, it } from "vitest";
import { buildRing, createHarness } from "../testing/harness";
import { Wildlife } from "./wildlife";

const ACT = PACE.actionIntervalMs;
const MIN = 60_000;

function solo(features = {}, forage = {}) {
	const h = createHarness(features, {}, {}, forage);
	const c = h.client();
	const id = c.join("Survivor");
	h.relocate(id, 0, 0, "right");
	const p = h.world.playerById(id);
	if (!p) throw new Error("missing player");
	return { h, c, id, p };
}

describe("water and food (§8)", () => {
	it("drinks from a lake with interact", () => {
		const { h, c, p } = solo({ "1,0": "water" });
		p.survival = { ...p.survival, water: 10 };
		c.send({ type: "interact", seq: 1 });
		h.tick();
		// The same tick also drains a sliver of water, hence "close to".
		expect(p.survival.water).toBeCloseTo(10 + SURVIVAL.waterPerSip, 0);
		expect(c.last("status")?.water).toBeCloseTo(10 + SURVIVAL.waterPerSip, 0);
	});

	it("picks apples, then waits for them to grow back", () => {
		const { h, id, p } = solo({ "1,0": "tree" }, { "1,0": "apple" });
		const t = h.now();
		expect(h.world.interact(id, t).ok).toBe(true);
		expect(p.pantry.apple.count).toBe(FORAGE.apple.yield);
		expect(h.world.tileAt(1, 0, t)).toEqual({ kind: "tree", apples: false });
		expect(h.world.interact(id, t + ACT)).toMatchObject({ ok: false, reason: "notReady" });
		expect(h.world.interact(id, t + FORAGE.apple.regrowMs).ok).toBe(true);
	});

	it("refuses a harvest when the bag is full", () => {
		const { h, id, p } = solo({}, { "1,0": "berry" });
		h.world.addFood(id, "potato", FOOD.capacity);
		expect(h.world.interact(id, h.now())).toMatchObject({ ok: false, reason: "bagFull" });
		expect(p.pantry.berries.count).toBe(0);
	});

	it("eats the food closest to spoiling", () => {
		const { h, c, id, p } = solo();
		h.world.addFood(id, "potato", 1);
		h.world.addFood(id, "meat", 1);
		p.survival = { ...p.survival, food: 20 };
		c.send({ type: "eat", seq: 1 });
		h.tick();
		expect(p.pantry.meat.count).toBe(0);
		expect(p.survival.food).toBeCloseTo(20 + FOOD.kinds.meat.restores, 0);
		expect(c.last("notice")?.notice).toEqual({ kind: "ate", food: "meat" });
	});
});

describe("meters over time (§8)", () => {
	it("drain while online, faster with work, and pause while offline", () => {
		const { h, c, id, p } = solo({ "1,0": "tree" });
		h.advance(SURVIVAL.tickMs);
		h.advance(MIN);
		const afterMinute = p.survival.food;
		expect(afterMinute).toBeLessThan(SURVIVAL.max);
		h.world.chop(id, h.now() + ACT);
		expect(p.survival.food).toBeCloseTo(afterMinute - SURVIVAL.workFood);
		h.game.disconnect(c.sessionId);
		const offline = { ...p.survival };
		h.advance(10 * MIN);
		expect(p.survival).toEqual(offline);
	});

	it("respawns a starving player with nothing carried, keeping land", () => {
		const { h, c, id, p } = solo();
		buildRing(h, id, 10, 10, 1);
		h.world.addFood(id, "apple", 3);
		p.survival = { health: 1, food: 0, water: 0 };
		h.relocate(id, 0, 0, "down");
		h.advance(SURVIVAL.tickMs);
		h.advance(MIN);
		expect(c.of("notice").some((n) => n.notice.kind === "died")).toBe(true);
		expect(c.last("respawned")).toBeTruthy();
		expect(p).toMatchObject({ wood: 0, iron: 0, hasSpear: false });
		expect(p.pantry.apple.count).toBe(0);
		expect(p.survival.health).toBe(SURVIVAL.max);
		expect(h.world.land.controllerAt(10, 10)).toBe(id);
	});
});

describe("tools and hunting (§9)", () => {
	it("crafts one spear for wood and iron, and switches tools", () => {
		const { h, c, id, p } = solo({ "1,0": "tree" });
		c.send({ type: "craftSpear", seq: 1 });
		h.tick();
		expect(c.last("rejected")?.reason).toBe("notEnoughWood");
		p.wood = TOOLS.spearWood;
		p.iron = TOOLS.spearIron;
		c.send({ type: "craftSpear", seq: 2 });
		h.tick();
		expect(p).toMatchObject({ hasSpear: true, tool: "spear", wood: 0, iron: 0 });
		// The spear doesn't chop; the axe does.
		expect(h.world.chop(id, h.now() + ACT)).toMatchObject({ ok: false, reason: "useAxe" });
		c.send({ type: "selectTool", tool: "axe", seq: 3 });
		h.advance(ACT);
		expect(p.tool).toBe("axe");
	});

	it("hunts a rabbit with the spear for meat", () => {
		const { h, c, p } = solo();
		p.hasSpear = true;
		p.tool = "spear";
		const rabbit = h.game.wildlife.spawn("rabbit", 1, 0, h.now());
		c.send({ type: "chop", seq: 1 });
		h.tick();
		expect(p.pantry.meat.count).toBe(CREATURES.rabbit.meat);
		expect(c.last("creatureGone")?.id).toBe(rabbit);
		expect(h.game.wildlife.info(rabbit)).toBeNull();
	});

	it("tells axe users to craft or switch to the spear when facing an animal", () => {
		const { h, c, p } = solo();
		h.game.wildlife.spawn("rabbit", 1, 0, h.now());
		c.send({ type: "chop", seq: 1 });
		h.tick();
		expect(c.last("rejected")?.reason).toBe("noSpear");
		p.hasSpear = true;
		c.send({ type: "chop", seq: 2 });
		h.advance(ACT);
		expect(c.last("rejected")?.reason).toBe("useSpear");
	});

	it("doesn't let players walk into a creature", () => {
		const { h, id } = solo();
		h.game.wildlife.spawn("deer", 1, 0, h.now());
		expect(h.world.move(id, "right", h.now() + ACT)).toMatchObject({
			ok: false,
			reason: "blocked",
		});
	});
});

describe("zombie bears (§9)", () => {
	function bearAtWall(level: number) {
		const s = solo();
		s.p.wood = 500;
		s.p.iron = 500;
		// Player at (0,0) builds a fence at (1,0); the bear waits on the other side at (2,0).
		const t = s.h.now();
		expect(s.h.world.build(s.id, t).ok).toBe(true);
		for (let i = 1; i < level; i++) expect(s.h.world.upgrade(s.id, t + i * ACT).ok).toBe(true);
		const bear = s.h.game.wildlife.spawn("bear", 2, 0, t);
		return { ...s, bear };
	}

	it("claws through a wooden fence", () => {
		const { h } = bearAtWall(1);
		for (let i = 0; i < 20; i++) h.advance(CREATURES.bear.clawMs);
		expect(h.world.tileAt(1, 0, h.now()).kind).not.toBe("fence");
	});

	it("can't harm a level 4 wall", () => {
		const { h } = bearAtWall(4);
		for (let i = 0; i < 40; i++) h.advance(CREATURES.bear.clawMs);
		expect(h.world.tileAt(1, 0, h.now())).toMatchObject({
			kind: "fence",
			fence: { level: 4, damage: 0 },
		});
	});

	it("bites an adjacent player and can be killed with the spear", () => {
		const { h, c, p } = solo();
		p.hasSpear = true;
		p.tool = "spear";
		const bear = h.game.wildlife.spawn("bear", 1, 0, h.now());
		h.advance(CREATURES.bear.biteMs);
		expect(p.survival.health).toBeCloseTo(SURVIVAL.max - CREATURES.bear.biteDamage, 0);
		for (let i = 0; i < CREATURES.bear.hp; i++) h.game.wildlife.spearHit(p, h.now() + i * ACT);
		expect(h.game.wildlife.info(bear)).toBeNull();
		expect(p.pantry.meat.count).toBe(0);
		c.clear();
	});
});

describe("automatic spawning", () => {
	it("brings animals near online players, never inside claimed land", () => {
		const h = createHarness();
		const wild = new Wildlife(h.world, {
			random: Math.random,
			newId: () => `w${Math.random()}`,
			autoSpawn: true,
		});
		const c = h.client();
		const id = c.join("Watcher");
		h.relocate(id, 0, 0, "down");
		for (let i = 0; i < 10; i++) wild.update(h.now() + i * 1000);
		const animals = wild.all().filter((a) => a.kind !== "bear");
		expect(animals.length).toBeGreaterThan(0);
		for (const a of animals) {
			expect(Math.abs(a.x) + Math.abs(a.y)).toBeLessThanOrEqual(CREATURES.despawnRange);
			expect(h.world.land.enclosuresAt(a.x, a.y)).toHaveLength(0);
		}
	});
});

describe("zombie bear timing (§9)", () => {
	const bearsSent = (c: { of: (t: "creature") => { creature: { kind: string } }[] }) =>
		c.of("creature").filter((m) => m.creature.kind === "bear").length;

	it("sends a bear when the player's online countdown runs out, then draws a new one", () => {
		const h = createHarness({}, {}, {}, {}, { autoSpawnCreatures: true });
		const c = h.client();
		const id = c.join("Marco");
		h.relocate(id, 0, 0, "down");
		h.world.setBearDueIn(id, 9_000);
		h.advance(5_000);
		expect(h.world.playerById(id)?.bearDueIn).toBe(4_000);
		expect(bearsSent(c)).toBe(0);
		h.advance(5_000);
		expect(bearsSent(c)).toBe(1);
		const next = h.world.playerById(id)?.bearDueIn ?? 0;
		expect(next).toBeGreaterThanOrEqual(CREATURES.bearDelayMinMs);
		expect(next).toBeLessThanOrEqual(CREATURES.bearDelayMaxMs);
	});

	it("pauses while offline and keeps the countdown through a save and reload", () => {
		const h = createHarness({}, {}, {}, {}, { autoSpawnCreatures: true });
		const c = h.client();
		const id = c.join("Marco");
		h.world.setBearDueIn(id, 60_000);
		h.game.disconnect(c.sessionId);
		for (let i = 0; i < 30; i++) h.advance(5_000);
		expect(h.world.playerById(id)?.bearDueIn).toBe(60_000);
		const saved = h.world.takeWriteBatch().players.find((p) => p.id === id);
		expect(saved?.bearDueIn).toBe(60_000);
	});
});
