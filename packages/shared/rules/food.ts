import { FOOD } from "./config";

export type FoodKind = keyof typeof FOOD.kinds;
export const FOOD_KINDS = Object.keys(FOOD.kinds) as FoodKind[];

/** One kind of food carried: how many, and how much online time has worn on the next item. */
export type FoodStack = { readonly count: number; readonly spoil: number };
export type Pantry = Readonly<Record<FoodKind, FoodStack>>;

export function emptyPantry(): Pantry {
	return {
		apple: { count: 0, spoil: 0 },
		berries: { count: 0, spoil: 0 },
		potato: { count: 0, spoil: 0 },
		meat: { count: 0, spoil: 0 },
	};
}

export function pantryTotal(p: Pantry): number {
	return FOOD_KINDS.reduce((sum, k) => sum + p[k].count, 0);
}

/** Adds up to `count` items, limited by carrying capacity (§8). */
export function addFood(
	p: Pantry,
	kind: FoodKind,
	count: number,
): { pantry: Pantry; added: number } {
	const added = Math.max(0, Math.min(count, FOOD.capacity - pantryTotal(p)));
	if (added === 0) return { pantry: p, added };
	const stack = p[kind];
	// A fresh stack starts its spoil clock now.
	return {
		pantry: {
			...p,
			[kind]: { count: stack.count + added, spoil: stack.count === 0 ? 0 : stack.spoil },
		},
		added,
	};
}

/** §8 Spoilage: each kind loses one item per shelf life of online time. */
export function agePantry(p: Pantry, elapsedMs: number): Pantry {
	const next = { ...p };
	for (const kind of FOOD_KINDS) {
		const { shelfMs } = FOOD.kinds[kind];
		let { count, spoil } = p[kind];
		if (count === 0) continue;
		spoil += elapsedMs;
		while (spoil >= shelfMs && count > 0) {
			count--;
			spoil -= shelfMs;
		}
		next[kind] = { count, spoil: count === 0 ? 0 : spoil };
	}
	return next;
}

/** The kind closest to losing an item, which is the one worth eating first. */
export function nextToSpoil(p: Pantry): FoodKind | null {
	let best: FoodKind | null = null;
	let bestLeft = Number.POSITIVE_INFINITY;
	for (const kind of FOOD_KINDS) {
		const stack = p[kind];
		if (stack.count === 0) continue;
		const left = FOOD.kinds[kind].shelfMs - stack.spoil;
		if (left < bestLeft) {
			best = kind;
			bestLeft = left;
		}
	}
	return best;
}

export function takeOne(p: Pantry, kind: FoodKind): Pantry {
	const stack = p[kind];
	if (stack.count === 0) return p;
	return { ...p, [kind]: { count: stack.count - 1, spoil: stack.count === 1 ? 0 : stack.spoil } };
}
