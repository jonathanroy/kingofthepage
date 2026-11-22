import { SURVIVAL } from "./config";

/** §8 Survival meters, each 0..100. */
export type Survival = { readonly health: number; readonly food: number; readonly water: number };

export const FULL_SURVIVAL: Survival = {
	health: SURVIVAL.max,
	food: SURVIVAL.max,
	water: SURVIVAL.max,
};

const clamp = (v: number) => Math.max(0, Math.min(SURVIVAL.max, v));

/**
 * Advances the meters by `elapsedMs` of online time: food and water drain; health falls for
 * each empty meter and recovers while both are at least half full.
 */
export function drainSurvival(s: Survival, elapsedMs: number): Survival {
	const minutes = elapsedMs / 60_000;
	const food = clamp(s.food - SURVIVAL.foodPerMinute * minutes);
	const water = clamp(s.water - SURVIVAL.waterPerMinute * minutes);
	const empty = (food === 0 ? 1 : 0) + (water === 0 ? 1 : 0);
	const half = SURVIVAL.max / 2;
	let health = s.health - empty * SURVIVAL.starvePerMinute * minutes;
	if (empty === 0 && food >= half && water >= half) health += SURVIVAL.regenPerMinute * minutes;
	return { health: clamp(health), food, water };
}

/** Every work action makes you hungrier and thirstier (§8). */
export function spendWork(s: Survival): Survival {
	return {
		...s,
		food: clamp(s.food - SURVIVAL.workFood),
		water: clamp(s.water - SURVIVAL.workWater),
	};
}

export function drink(s: Survival): Survival {
	return { ...s, water: clamp(s.water + SURVIVAL.waterPerSip) };
}

export function nourish(s: Survival, amount: number): Survival {
	return { ...s, food: clamp(s.food + amount) };
}

export function hurt(s: Survival, damage: number): Survival {
	return { ...s, health: clamp(s.health - damage) };
}

export function isDead(s: Survival): boolean {
	return s.health <= 0;
}
