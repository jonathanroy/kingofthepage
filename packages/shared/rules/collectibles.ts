import { tileRandom } from "../world/hash";
import { SHOP } from "./config";

export type Tier = keyof typeof SHOP.tierDays;
export const TIERS: readonly Tier[] = ["common", "rare", "epic", "legendary"];

export type Slot = "hat" | "cape" | "pet" | "aura" | "name" | "banner";
export const SLOTS: readonly Slot[] = ["hat", "cape", "pet", "aura", "name", "banner"];

export type Collectible = {
	readonly id: string;
	readonly name: string;
	readonly slot: Slot;
	readonly tier: Tier;
	readonly description: string;
};

/** §10: purely cosmetic and visible to everyone. */
export const COLLECTIBLES: readonly Collectible[] = [
	{
		id: "straw-hat",
		name: "Straw Hat",
		slot: "hat",
		tier: "common",
		description: "Sun-bleached and slightly chewed.",
	},
	{
		id: "flower-crown",
		name: "Flower Crown",
		slot: "hat",
		tier: "common",
		description: "Fresh every morning, somehow.",
	},
	{
		id: "red-cape",
		name: "Red Cape",
		slot: "cape",
		tier: "common",
		description: "Flutters dramatically when you walk.",
	},
	{
		id: "wizard-hat",
		name: "Wizard Hat",
		slot: "hat",
		tier: "rare",
		description: "Pointy, starry, mysterious.",
	},
	{
		id: "pet-chick",
		name: "Pet Chick",
		slot: "pet",
		tier: "rare",
		description: "Follows you everywhere. Peeps.",
	},
	{
		id: "royal-cape",
		name: "Royal Cape",
		slot: "cape",
		tier: "rare",
		description: "Purple velvet with ermine trim.",
	},
	{
		id: "golden-crown",
		name: "Golden Crown",
		slot: "hat",
		tier: "epic",
		description: "Heavy is the head.",
	},
	{
		id: "pet-fox",
		name: "Pet Fox",
		slot: "pet",
		tier: "epic",
		description: "Clever, loyal, a little smug.",
	},
	{
		id: "glowing-name",
		name: "Glowing Name",
		slot: "name",
		tier: "epic",
		description: "Your name shimmers in gold.",
	},
	{
		id: "pet-dragon",
		name: "Baby Dragon",
		slot: "pet",
		tier: "legendary",
		description: "Tiny wings, enormous attitude.",
	},
	{
		id: "starlight-aura",
		name: "Starlight Aura",
		slot: "aura",
		tier: "legendary",
		description: "Stars drift around you.",
	},
	{
		id: "royal-banner",
		name: "Royal Banner",
		slot: "banner",
		tier: "legendary",
		description: "Your walls fly gold crowned banners.",
	},
];

export function collectible(id: string): Collectible | undefined {
	return COLLECTIBLES.find((c) => c.id === id);
}

export function priceOf(tier: Tier): number {
	return SHOP.tierDays[tier] * SHOP.goldPerDay;
}

/** What a player has on, one item per slot. */
export type Look = Partial<Record<Slot, string>>;

/** Which day the shop is on: it moves at every multiple of `SHOP.dayMs`. */
export function shopDay(now: number): number {
	return Math.floor(now / SHOP.dayMs);
}

/** §10: one item per tier each day, rotating through the catalog by seed and day. */
export function dailyOffer(seed: string, day: number): Collectible[] {
	return TIERS.map((tier) => {
		const options = COLLECTIBLES.filter((c) => c.tier === tier);
		const pick = Math.floor(tileRandom(seed, `shop-offer-${tier}`, day, 0) * options.length);
		return options[Math.min(pick, options.length - 1)] as Collectible;
	});
}

export type Purchase =
	| { readonly ok: true; readonly price: number }
	| { readonly ok: false; readonly reason: "notForSale" | "alreadyOwned" | "notEnoughGold" };

export function canBuy(
	offer: readonly Collectible[],
	itemId: string,
	owned: readonly string[],
	balance: number,
): Purchase {
	const item = offer.find((c) => c.id === itemId);
	if (!item) return { ok: false, reason: "notForSale" };
	if (owned.includes(itemId)) return { ok: false, reason: "alreadyOwned" };
	const price = priceOf(item.tier);
	if (balance < price) return { ok: false, reason: "notEnoughGold" };
	return { ok: true, price };
}

/** Wear an owned item in its slot, or take a slot off with `itemId` null. */
export function equip(
	look: Look,
	owned: readonly string[],
	slot: Slot,
	itemId: string | null,
): Look | null {
	if (itemId === null) {
		const { [slot]: _removed, ...rest } = look;
		return rest;
	}
	const item = collectible(itemId);
	if (!item || item.slot !== slot || !owned.includes(itemId)) return null;
	return { ...look, [slot]: itemId };
}
