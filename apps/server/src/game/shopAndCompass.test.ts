import { priceOf, SHOP } from "@kotp/shared/rules";
import { describe, expect, it } from "vitest";
import { buildRing, createHarness } from "../testing/harness";

describe("flag compass (§10)", () => {
	it("tells a player where their bases are, and when one is lost", () => {
		const h = createHarness();
		const c = h.client();
		const id = c.join("Homebody");
		expect(c.last("bases")?.bases).toEqual([]);
		buildRing(h, id, 20, -5, 2);
		h.tick();
		// World-level builds don't publish, so ask the game the way a reconnect would.
		expect(h.world.bases(id)).toEqual([{ x: 20, y: -5, area: 9 }]);
		h.relocate(id, 20, -8, "down");
		c.send({ type: "chop", seq: 1 });
		h.advance(1000);
		expect(c.last("bases")?.bases).toEqual([]);
	});
});

function atShop() {
	const h = createHarness();
	const c = h.client();
	const id = c.join("Shopper");
	const shop = h.game.shop.current(h.now());
	h.relocate(id, shop.x - 1, shop.y, "right");
	const p = h.world.playerById(id);
	if (!p) throw new Error("missing player");
	return { h, c, id, p, shop };
}

describe("magic shop (§10)", () => {
	it("stands on open, unclaimed grass and moves at midnight UTC", () => {
		const h = createHarness();
		const today = h.game.shop.current(h.now());
		expect(h.world.tileAt(today.x, today.y, h.now()).kind).toBe("grass");
		expect(Math.hypot(today.x, today.y)).toBeLessThanOrEqual(SHOP.radius + 1);
		expect(h.game.shop.current(today.movesAt - 1)).toBe(today);
		const tomorrow = h.game.shop.current(today.movesAt);
		expect(tomorrow.day).toBe(today.day + 1);
	});

	it("sells today's items for gold without lowering the gold leaderboard", () => {
		const { h, c, p, shop } = atShop();
		const item = shop.offer[0];
		if (!item) throw new Error("no offer");
		const price = priceOf(item.tier);
		p.gold = price + 100;
		c.send({ type: "buy", itemId: item.id, seq: 1 });
		h.tick();
		expect(p.owned).toEqual([item.id]);
		expect(c.last("inventory")?.gold).toBeCloseTo(100);
		expect(c.last("collection")?.owned).toEqual([item.id]);
		expect(h.world.scores(h.now()).gold.get(p.id)).toBe(price + 100);

		c.send({ type: "buy", itemId: item.id, seq: 2 });
		h.tick();
		expect(c.last("rejected")?.reason).toBe("alreadyOwned");
	});

	it("refuses buyers who aren't at the shop or can't afford it", () => {
		const { h, c, id, p, shop } = atShop();
		const item = shop.offer[3];
		if (!item) throw new Error("no offer");
		c.send({ type: "buy", itemId: item.id, seq: 1 });
		h.tick();
		expect(c.last("rejected")?.reason).toBe("notEnoughGold");
		p.gold = 1e9;
		h.relocate(id, shop.x - 5, shop.y, "right");
		c.send({ type: "buy", itemId: item.id, seq: 2 });
		h.tick();
		expect(c.last("rejected")?.reason).toBe("notAtShop");
	});

	it("is solid: nobody walks onto it or builds on it", () => {
		const { h, id, p } = atShop();
		p.wood = 10;
		expect(h.world.move(id, "right", h.now() + 1000)).toMatchObject({
			ok: false,
			reason: "blocked",
		});
		expect(h.world.build(id, h.now() + 2000)).toMatchObject({ ok: false, reason: "occupied" });
	});
});

describe("wearing collectibles (§10)", () => {
	it("shows equipped items to other players and refuses items you don't own", () => {
		const { h, c, id, p } = atShop();
		const other = h.client();
		other.join("Neighbor");
		h.relocate(h.world.playerByHandle("Neighbor")?.id ?? "", p.x + 2, p.y + 2, "down");
		c.send({ type: "equip", slot: "hat", itemId: "golden-crown", seq: 1 });
		h.tick();
		expect(c.last("rejected")?.reason).toBe("notOwned");
		p.owned = ["golden-crown"];
		c.send({ type: "equip", slot: "hat", itemId: "golden-crown", seq: 2 });
		h.tick();
		expect(p.look).toEqual({ hat: "golden-crown" });
		const seen = other
			.of("player")
			.filter((m) => m.player.id === id)
			.at(-1);
		expect(seen?.player.look).toEqual({ hat: "golden-crown" });
	});
});
