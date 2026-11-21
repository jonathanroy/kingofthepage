import { PACE } from "@kotp/shared/rules";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../persistence/memoryStore";
import { createHarness } from "../testing/harness";
import { World } from "./world";

const ACT = PACE.actionIntervalMs;

function miner(capacity = 3) {
	const h = createHarness({}, {}, { "1,0": capacity });
	const c = h.client();
	const id = c.join("Miner");
	h.relocate(id, 0, 0, "right");
	const p = h.world.playerById(id);
	if (!p) throw new Error("missing player");
	return { h, c, id, p };
}

describe("mining iron ore (§2 Iron ore)", () => {
	it("gives iron per hit until the rock is empty, then leaves rubble for good", () => {
		const { h, c, id, p } = miner(3);
		let t = h.now();
		for (let i = 1; i <= 3; i++) {
			t += ACT;
			expect(h.world.chop(id, t).ok).toBe(true);
			expect(p.iron).toBe(i);
		}
		expect(h.world.tileAt(1, 0, t).kind).toBe("rubble");
		expect(h.world.chop(id, t + ACT)).toMatchObject({ ok: false, reason: "nothingToChop" });
		// Rubble is ground: walkable, and it stays rubble long after.
		expect(h.world.move(id, "right", t + 2 * ACT).ok).toBe(true);
		expect(h.world.tileAt(1, 0, t + 365 * 24 * 3600 * 1000).kind).toBe("rubble");
		c.clear();
	});

	it("sends mining progress and the new iron total to the client", () => {
		const { h, c } = miner(5);
		c.send({ type: "chop", seq: 1 });
		h.tick();
		expect(c.last("tile")).toMatchObject({ x: 1, y: 0, oreMined: 1 });
		expect(c.last("inventory")).toMatchObject({ iron: 1 });
	});
});

describe("iron in wall upgrades (§3)", () => {
	function wallAtLevel3() {
		const s = miner(50);
		s.p.wood = 200;
		s.h.relocate(s.id, 0, 0, "down");
		const t = s.h.now();
		expect(s.h.world.build(s.id, t + ACT).ok).toBe(true);
		expect(s.h.world.upgrade(s.id, t + 2 * ACT).ok).toBe(true);
		expect(s.h.world.upgrade(s.id, t + 3 * ACT).ok).toBe(true);
		return { ...s, t: t + 3 * ACT };
	}

	it("refuses level 4 without iron, then takes the iron", () => {
		const { h, id, p, t } = wallAtLevel3();
		expect(h.world.upgrade(id, t + ACT)).toMatchObject({ ok: false, reason: "notEnoughIron" });
		p.iron = 5;
		expect(h.world.upgrade(id, t + 2 * ACT).ok).toBe(true);
		expect(p.iron).toBe(3);
		const tile = h.world.tileAt(0, 1, t + 2 * ACT);
		expect(tile).toMatchObject({ kind: "fence", fence: { level: 4, ironInvested: 2 } });
	});

	it("refunds half the iron when the wall is broken", () => {
		const { h, id, p, t } = wallAtLevel3();
		p.iron = 2;
		h.world.upgrade(id, t + ACT);
		h.world.chop(id, t + 2 * ACT);
		expect(p.iron).toBe(1);
	});
});

describe("persistence of iron", () => {
	it("restores mined ore and iron totals", async () => {
		const { h, id, p } = miner(10);
		h.world.chop(id, h.now() + ACT);
		h.world.chop(id, h.now() + 2 * ACT);
		const store = new MemoryStore();
		await store.write(h.world.takeWriteBatch());
		const restored = new World({
			seed: "test",
			random: () => 0,
			newId: () => "x",
			terrain: h.world.terrain,
		});
		restored.load(await store.load(), h.now());
		expect(restored.playerById(id)?.iron).toBe(p.iron);
		expect(restored.tileAt(1, 0, h.now())).toMatchObject({ kind: "ore", remaining: 8 });
	});
});
