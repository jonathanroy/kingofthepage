import { describe, expect, it } from "vitest";
import { CREATURES, FOOD, FORAGE, SURVIVAL } from "./config";
import { bearCanClaw, meatFrom } from "./creatures";
import { buildFence, upgradeFence } from "./fences";
import { addFood, agePantry, emptyPantry, nextToSpoil, pantryTotal, takeOne } from "./food";
import { drainSurvival, drink, FULL_SURVIVAL, hurt, isDead, nourish, spendWork } from "./survival";
import { isForageReady, isWalkable, resolveTile } from "./tiles";

const MIN = 60_000;

describe("survival meters (§8)", () => {
	it("drains food and water over time without hurting while fed", () => {
		const s = drainSurvival(FULL_SURVIVAL, 10 * MIN);
		expect(s.food).toBeCloseTo(SURVIVAL.max - 10 * SURVIVAL.foodPerMinute);
		expect(s.water).toBeCloseTo(SURVIVAL.max - 10 * SURVIVAL.waterPerMinute);
		expect(s.health).toBe(SURVIVAL.max);
	});

	it("loses health for each empty meter, and dies at zero", () => {
		const starving = { health: 10, food: 0, water: 0 };
		const after = drainSurvival(starving, MIN);
		expect(after.health).toBeCloseTo(10 - 2 * SURVIVAL.starvePerMinute);
		expect(isDead(drainSurvival(starving, 10 * MIN))).toBe(true);
	});

	it("recovers health while both meters are at least half full", () => {
		expect(drainSurvival({ health: 50, food: 90, water: 90 }, MIN).health).toBeCloseTo(
			50 + SURVIVAL.regenPerMinute,
		);
		expect(drainSurvival({ health: 50, food: 40, water: 90 }, MIN).health).toBe(50);
	});

	it("makes work costly and lets eating, drinking and bites change the meters", () => {
		const worked = spendWork(FULL_SURVIVAL);
		expect(worked.food).toBe(SURVIVAL.max - SURVIVAL.workFood);
		expect(drink({ ...FULL_SURVIVAL, water: 10 }).water).toBe(10 + SURVIVAL.waterPerSip);
		expect(nourish({ ...FULL_SURVIVAL, food: 95 }, 30).food).toBe(SURVIVAL.max);
		expect(hurt(FULL_SURVIVAL, CREATURES.bear.biteDamage).health).toBe(
			SURVIVAL.max - CREATURES.bear.biteDamage,
		);
	});
});

describe("food bag (§8 Food)", () => {
	it("holds a limited number of items", () => {
		const { pantry, added } = addFood(emptyPantry(), "apple", FOOD.capacity + 5);
		expect(added).toBe(FOOD.capacity);
		expect(addFood(pantry, "meat", 1).added).toBe(0);
	});

	it("spoils one item per shelf life of each kind", () => {
		let p = addFood(emptyPantry(), "meat", 3).pantry;
		p = addFood(p, "potato", 2).pantry;
		p = agePantry(p, FOOD.kinds.meat.shelfMs * 2 + 1);
		expect(p.meat.count).toBe(1);
		expect(p.potato.count).toBe(2);
		expect(pantryTotal(agePantry(p, FOOD.kinds.potato.shelfMs * 3))).toBe(0);
	});

	it("eats the item closest to spoiling first", () => {
		let p = addFood(emptyPantry(), "potato", 1).pantry;
		p = addFood(p, "meat", 1).pantry;
		expect(nextToSpoil(p)).toBe("meat");
		p = takeOne(p, "meat");
		expect(nextToSpoil(p)).toBe("potato");
		expect(nextToSpoil(emptyPantry())).toBeNull();
	});
});

describe("forage tiles (§8 Food)", () => {
	it("shows ripe apples, then picked trees until they regrow", () => {
		expect(resolveTile("tree", undefined, 0, { forage: "apple" })).toEqual({
			kind: "tree",
			apples: true,
		});
		expect(resolveTile("tree", { harvestedAt: 0 }, 1000, { forage: "apple" })).toEqual({
			kind: "tree",
			apples: false,
		});
		expect(isForageReady("apple", 0, FORAGE.apple.regrowMs)).toBe(true);
	});

	it("makes berry bushes solid and potato patches walkable", () => {
		const bush = resolveTile("grass", undefined, 0, { forage: "berry" });
		const potato = resolveTile("grass", { harvestedAt: 0 }, 10, { forage: "potato" });
		expect(bush).toEqual({ kind: "bush", ready: true });
		expect(isWalkable(bush)).toBe(false);
		expect(potato).toEqual({ kind: "potato", ready: false });
		expect(isWalkable(potato)).toBe(true);
	});
});

describe("creatures (§9)", () => {
	it("lets bears claw levels 1-3 only", () => {
		let f = buildFence("p");
		for (let level = 1; level <= 3; level++) {
			expect(bearCanClaw(f)).toBe(true);
			f = upgradeFence(f);
		}
		expect(bearCanClaw(f)).toBe(false);
	});

	it("gives meat for animals but none for zombie bears", () => {
		expect(meatFrom("deer")).toBe(CREATURES.deer.meat);
		expect(meatFrom("bear")).toBe(0);
	});
});
