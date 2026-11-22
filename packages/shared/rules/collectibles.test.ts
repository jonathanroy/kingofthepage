import { describe, expect, it } from "vitest";
import { shopCandidate } from "../world/shop";
import { basesOf } from "./bases";
import { COLLECTIBLES, canBuy, dailyOffer, equip, priceOf, shopDay, TIERS } from "./collectibles";
import { SHOP } from "./config";

describe("magic shop (§10)", () => {
	it("prices tiers in days of a small mine", () => {
		expect(priceOf("common")).toBe(21_600);
		expect(priceOf("rare")).toBe(43_200);
		expect(priceOf("epic")).toBe(64_800);
		expect(priceOf("legendary")).toBe(129_600);
	});

	it("offers one item per tier, changing with the day", () => {
		const offer = dailyOffer("seed", 100);
		expect(offer.map((c) => c.tier)).toEqual(TIERS);
		const offers = new Set(
			Array.from({ length: 30 }, (_, d) =>
				dailyOffer("seed", d)
					.map((c) => c.id)
					.join(),
			),
		);
		expect(offers.size).toBeGreaterThan(1);
	});

	it("moves at midnight UTC and stays within its radius", () => {
		expect(shopDay(SHOP.dayMs - 1)).toBe(0);
		expect(shopDay(SHOP.dayMs)).toBe(1);
		for (let a = 0; a < 200; a++) {
			const { x, y } = shopCandidate("seed", 5, a);
			expect(Math.hypot(x, y)).toBeLessThanOrEqual(SHOP.radius + 1);
		}
	});

	it("sells each item once, only when offered and affordable", () => {
		const offer = dailyOffer("seed", 1);
		const item = offer[0];
		if (!item) throw new Error("empty offer");
		const price = priceOf(item.tier);
		expect(canBuy(offer, item.id, [], price - 1)).toEqual({ ok: false, reason: "notEnoughGold" });
		expect(canBuy(offer, item.id, [], price)).toEqual({ ok: true, price });
		expect(canBuy(offer, item.id, [item.id], price)).toEqual({ ok: false, reason: "alreadyOwned" });
		const notOffered = COLLECTIBLES.find((c) => !offer.includes(c));
		expect(canBuy(offer, notOffered?.id ?? "", [], 1e9)).toEqual({
			ok: false,
			reason: "notForSale",
		});
	});

	it("wears owned items in their own slot only", () => {
		expect(equip({}, ["wizard-hat"], "hat", "wizard-hat")).toEqual({ hat: "wizard-hat" });
		expect(equip({}, ["wizard-hat"], "cape", "wizard-hat")).toBeNull();
		expect(equip({}, [], "hat", "wizard-hat")).toBeNull();
		expect(equip({ hat: "wizard-hat", pet: "pet-fox" }, [], "hat", null)).toEqual({
			pet: "pet-fox",
		});
	});
});

describe("bases for the compass (§10)", () => {
	it("puts each base at the middle of its enclosure, largest first", () => {
		const small = { id: "a", ownerId: "p", createdAt: 0, tiles: new Set(["10,10"]) };
		const big = {
			id: "b",
			ownerId: "p",
			createdAt: 0,
			tiles: new Set(["0,0", "2,0", "0,2", "2,2"]),
		};
		expect(basesOf([small, big])).toEqual([
			{ x: 1, y: 1, area: 4 },
			{ x: 10, y: 10, area: 1 },
		]);
	});
});
