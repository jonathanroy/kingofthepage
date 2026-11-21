import { FENCE, FENCE_LEVELS, PACE } from "@kotp/shared/rules";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../persistence/memoryStore";
import { buildRing, createHarness } from "../testing/harness";
import { World } from "./world";

const ACT = PACE.actionIntervalMs;
const STEP = PACE.moveIntervalMs;

function setupPair() {
	const h = createHarness();
	const owner = h.client();
	const ownerId = owner.join("Owner");
	const other = h.client();
	const otherId = other.join("Other");
	return { h, owner, ownerId, other, otherId };
}

function fenceAt(h: ReturnType<typeof createHarness>, x: number, y: number) {
	const tile = h.world.tileAt(x, y, h.now());
	if (tile.kind !== "fence") throw new Error(`no fence at ${x},${y}`);
	return tile.fence;
}

function ally(h: ReturnType<typeof createHarness>, a: string, b: string) {
	h.world.alliances.request(a, b);
	h.world.alliances.accept(b, a);
}

describe("breaking fences (§3 Chopping fences)", () => {
	it("takes the level's chops for an enemy, refunds half, and breaches the owner's land", () => {
		const { h, ownerId, otherId } = setupPair();
		buildRing(h, ownerId, 0, 0, 1);
		expect(h.world.land.controllerAt(0, 0)).toBe(ownerId);
		const attacker = h.world.playerById(otherId);
		if (!attacker) throw new Error("missing");
		attacker.wood = 0;
		h.relocate(otherId, 0, -2, "down");
		let t = h.now();
		const later = (ms: number) => {
			t += ms;
			return t;
		};
		const needed = FENCE_LEVELS[0]?.chopsToBreak ?? 0;
		for (let i = 1; i < needed; i++) {
			expect(h.world.chop(otherId, later(ACT)).ok).toBe(true);
			expect(fenceAt(h, 0, -1).damage).toBe(i);
		}
		h.world.chop(otherId, later(ACT));
		expect(h.world.tileAt(0, -1, t).kind).toBe("grass");
		expect(attacker.wood).toBe(1);
		expect(h.world.land.controllerAt(0, 0)).toBeNull();
	});

	it("keeps damage between attackers", () => {
		const { h, ownerId, otherId } = setupPair();
		const third = h.client().join("Third");
		buildRing(h, ownerId, 0, 0, 1);
		h.relocate(otherId, 0, -2, "down");
		h.world.chop(otherId, h.now() + ACT);
		h.relocate(otherId, 5, 5, "down");
		h.relocate(third, 0, -2, "down");
		h.world.chop(third, h.now() + 2 * ACT);
		expect(fenceAt(h, 0, -1).damage).toBe(2);
	});
});

describe("upgrades (§3 Upgrade levels)", () => {
	it("repairs a damaged fence first, then upgrades it, and only the owner can do either", () => {
		const { h, ownerId, otherId } = setupPair();
		buildRing(h, ownerId, 0, 0, 1);
		h.relocate(otherId, 0, -2, "down");
		h.world.chop(otherId, h.now() + ACT);
		expect(h.world.upgrade(otherId, h.now() + 2 * ACT)).toMatchObject({
			ok: false,
			reason: "notYourFence",
		});

		const owner = h.world.playerById(ownerId);
		if (!owner) throw new Error("missing");
		owner.wood = 4;
		h.relocate(otherId, 9, 9, "down");
		h.relocate(ownerId, 0, -2, "down");
		// First press repairs the one chop of damage (1 wood), the second upgrades (3 wood).
		expect(h.world.upgrade(ownerId, h.now() + 3 * ACT).ok).toBe(true);
		expect(fenceAt(h, 0, -1)).toMatchObject({ level: 1, damage: 0, woodInvested: 2 });
		expect(h.world.upgrade(ownerId, h.now() + 4 * ACT).ok).toBe(true);
		expect(fenceAt(h, 0, -1)).toMatchObject({ level: 2, damage: 0, woodInvested: 5 });
		expect(owner.wood).toBe(0);
		expect(h.world.upgrade(ownerId, h.now() + 5 * ACT)).toMatchObject({
			ok: false,
			reason: "notEnoughWood",
		});
	});

	it("repairs a damaged max-level fence for wood", () => {
		const { h, ownerId, otherId } = setupPair();
		buildRing(h, ownerId, 0, 0, 1);
		h.relocate(ownerId, 0, -2, "down");
		let t = h.now();
		const later = (ms: number) => {
			t += ms;
			return t;
		};
		for (let level = 1; level < FENCE_LEVELS.length; level++) {
			expect(h.world.upgrade(ownerId, later(ACT)).ok).toBe(true);
		}
		expect(fenceAt(h, 0, -1).level).toBe(FENCE_LEVELS.length);
		h.relocate(ownerId, 9, 9, "down");
		h.relocate(otherId, 0, -2, "down");
		for (let i = 0; i < 6; i++) h.world.chop(otherId, later(ACT));
		h.relocate(otherId, 9, 8, "down");
		h.relocate(ownerId, 0, -2, "down");
		const owner = h.world.playerById(ownerId);
		if (!owner) throw new Error("missing");
		const wood = owner.wood;
		expect(h.world.upgrade(ownerId, later(ACT)).ok).toBe(true);
		expect(fenceAt(h, 0, -1)).toMatchObject({ level: FENCE_LEVELS.length, damage: 0 });
		expect(owner.wood).toBe(wood - Math.ceil(6 * FENCE.repairWoodPerChop));
		expect(h.world.upgrade(ownerId, later(ACT))).toMatchObject({ ok: false, reason: "maxLevel" });
	});

	it("needs more chops at higher levels", () => {
		const { h, ownerId, otherId } = setupPair();
		buildRing(h, ownerId, 0, 0, 1);
		h.relocate(ownerId, 0, -2, "down");
		for (let i = 0; i < 3; i++) h.world.upgrade(ownerId, h.now() + i * ACT);
		expect(fenceAt(h, 0, -1).level).toBe(4);
		h.relocate(ownerId, 9, 9, "down");
		h.relocate(otherId, 0, -2, "down");
		const needed = FENCE_LEVELS[3]?.chopsToBreak ?? 0;
		let t = h.now() + 10 * ACT;
		const later = (ms: number) => {
			t += ms;
			return t;
		};
		for (let i = 1; i < needed; i++) h.world.chop(otherId, later(ACT));
		expect(fenceAt(h, 0, -1).damage).toBe(needed - 1);
		h.world.chop(otherId, later(ACT));
		expect(h.world.tileAt(0, -1, t).kind).toBe("grass");
	});
});

describe("gates (§3 Gates, §4)", () => {
	function gatedLand() {
		const s = setupPair();
		buildRing(s.h, s.ownerId, 0, 0, 2);
		const owner = s.h.world.playerById(s.ownerId);
		if (!owner) throw new Error("missing");
		owner.wood = 10;
		s.h.relocate(s.ownerId, 0, -3, "down");
		expect(s.h.world.makeGate(s.ownerId, s.h.now() + ACT).ok).toBe(true);
		return s;
	}

	it("converts a fence into a gate without changing the enclosure", () => {
		const { h, ownerId } = gatedLand();
		expect(fenceAt(h, 0, -2)).toMatchObject({ gate: true, level: 1 });
		expect(fenceAt(h, 0, -2).woodInvested).toBe(2 + FENCE.gateConversionCost);
		expect(h.world.land.controllerAt(0, 0)).toBe(ownerId);
	});

	it("lets the owner and allies through, but not strangers or ex-allies", () => {
		const { h, ownerId, otherId } = gatedLand();
		let t = h.now() + 10_000;
		const later = (ms: number) => {
			t += ms;
			return t;
		};
		// Owner walks through the gate into their land.
		expect(h.world.move(ownerId, "down", later(STEP)).ok).toBe(true);
		expect(h.world.move(ownerId, "down", later(STEP)).ok).toBe(true);
		expect(h.world.land.controllerAt(0, -1)).toBe(ownerId);

		h.relocate(otherId, 0, -3, "down");
		expect(h.world.move(otherId, "down", later(STEP))).toMatchObject({
			ok: false,
			reason: "blocked",
		});

		ally(h, ownerId, otherId);
		expect(h.world.move(otherId, "down", later(STEP)).ok).toBe(true);
		expect(h.world.move(otherId, "down", later(STEP)).ok).toBe(true);

		h.relocate(otherId, 0, -3, "down");
		h.world.alliances.end(otherId, ownerId);
		expect(h.world.move(otherId, "down", later(STEP)).ok).toBe(false);
	});
});

describe("chopping an ally's fence (§4)", () => {
	it("needs confirmation, then notifies the owner once and keeps the alliance", () => {
		const { h, owner, ownerId, other, otherId } = setupPair();
		buildRing(h, ownerId, 0, 0, 1);
		ally(h, ownerId, otherId);
		h.relocate(ownerId, 0, 3, "down");
		h.relocate(otherId, 0, -2, "down");
		owner.clear();

		other.send({ type: "chop", seq: 1 });
		h.advance(ACT);
		expect(other.last("rejected")).toMatchObject({ seq: 1, reason: "allyConfirmRequired" });
		expect(fenceAt(h, 0, -1).damage).toBe(0);

		other.send({ type: "chop", seq: 2, confirmAlly: true });
		h.advance(ACT);
		other.send({ type: "chop", seq: 3, confirmAlly: true });
		h.advance(ACT);
		expect(fenceAt(h, 0, -1).damage).toBe(2);
		const notices = owner.of("notice").filter((n) => n.notice.kind === "allyChoppingFence");
		expect(notices).toHaveLength(1);
		expect(notices[0]?.notice).toMatchObject({ by: { handle: "Other" }, x: 0, y: -1 });
		expect(h.world.alliances.areAllies(ownerId, otherId)).toBe(true);
	});
});

describe("alliance messages (§4)", () => {
	it("requests by handle, notifies, accepts, and ends", () => {
		const { h, owner, ownerId, other, otherId } = setupPair();
		owner.send({ type: "allyRequest", handle: "other" });
		expect(owner.last("notice")?.notice).toMatchObject({ kind: "allianceRequestSent" });
		expect(other.last("notice")?.notice).toMatchObject({
			kind: "allianceRequest",
			from: { id: ownerId },
		});
		expect(other.last("alliances")?.incoming).toEqual([{ id: ownerId, handle: "Owner" }]);

		other.send({ type: "allyAccept", playerId: ownerId });
		expect(h.world.alliances.areAllies(ownerId, otherId)).toBe(true);
		expect(owner.last("alliances")?.allies).toEqual([{ id: otherId, handle: "Other" }]);
		expect(owner.last("notice")?.notice).toMatchObject({ kind: "allianceFormed" });

		owner.send({ type: "allyEnd", playerId: otherId });
		expect(h.world.alliances.areAllies(ownerId, otherId)).toBe(false);
		expect(other.last("notice")?.notice).toMatchObject({
			kind: "allianceEnded",
			with: { id: ownerId },
		});
	});

	it("reports unknown handles and self-requests", () => {
		const { owner } = setupPair();
		owner.send({ type: "allyRequest", handle: "Nobody" });
		expect(owner.last("notice")?.notice).toEqual({
			kind: "allianceRequestFailed",
			reason: "unknownHandle",
		});
		owner.send({ type: "allyRequest", handle: "Owner" });
		expect(owner.last("notice")?.notice).toEqual({ kind: "allianceRequestFailed", reason: "self" });
	});
});

describe("persistence of M5 state", () => {
	it("restores fence damage, gates and alliances", async () => {
		const { h, ownerId, otherId } = setupPair();
		buildRing(h, ownerId, 0, 0, 1);
		h.relocate(ownerId, 0, -2, "down");
		h.world.makeGate(ownerId, h.now() + ACT);
		h.relocate(ownerId, 2, 0, "left");
		h.relocate(otherId, 0, 2, "up");
		h.world.chop(otherId, h.now() + 2 * ACT);
		h.world.alliances.request(ownerId, otherId);
		h.world.alliances.accept(otherId, ownerId);
		h.world.markAlliance(ownerId, otherId, true);

		const store = new MemoryStore();
		await store.write(h.world.takeWriteBatch());
		const restored = new World({
			seed: "test",
			random: () => 0,
			newId: () => "x",
			terrain: h.world.terrain,
		});
		restored.load(await store.load(), h.now());
		const at = (x: number, y: number) => restored.tileAt(x, y, h.now());
		expect(at(0, -1)).toMatchObject({ kind: "fence", fence: { gate: true } });
		expect(at(0, 1)).toMatchObject({ kind: "fence", fence: { damage: 1 } });
		expect(restored.alliances.areAllies(ownerId, otherId)).toBe(true);
	});
});
