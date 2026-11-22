import { type Collectible, dailyOffer, priceOf, SHOP, shopDay } from "@kotp/shared/rules";
import { shopCandidate, type TileCoord } from "@kotp/shared/world";
import type { World } from "./world";

export type ShopState = {
	readonly day: number;
	readonly x: number;
	readonly y: number;
	readonly offer: readonly Collectible[];
	readonly movesAt: number;
};

/**
 * §10 The wandering magic shop: a new spot and stock every day, from the seed and the date.
 * The spot must be plain open grass outside any claimed land, so anyone can reach it.
 */
export class MagicShop {
	private cached: ShopState | null = null;

	constructor(
		private readonly world: World,
		private readonly seed: string,
	) {}

	current(now: number): ShopState {
		const day = shopDay(now);
		if (this.cached?.day === day) return this.cached;
		const spot = this.findSpot(day, now);
		this.cached = {
			day,
			...spot,
			offer: dailyOffer(this.seed, day),
			movesAt: (day + 1) * SHOP.dayMs,
		};
		return this.cached;
	}

	/** The previous day's shop, if the day just changed; lets the game tell clients it left. */
	peek(): ShopState | null {
		return this.cached;
	}

	isAt(x: number, y: number, now: number): boolean {
		const shop = this.current(now);
		return shop.x === x && shop.y === y;
	}

	offerInfo(shop: ShopState) {
		return shop.offer.map((c) => ({ id: c.id, price: priceOf(c.tier) }));
	}

	private findSpot(day: number, now: number): TileCoord {
		for (let attempt = 0; attempt < SHOP.placementAttempts; attempt++) {
			const spot = shopCandidate(this.seed, day, attempt);
			const tile = this.world.tileAt(spot.x, spot.y, now);
			if (tile.kind !== "grass") continue;
			if (this.world.land.enclosuresAt(spot.x, spot.y).length > 0) continue;
			if (this.world.isOccupied(spot.x, spot.y)) continue;
			return spot;
		}
		// Practically unreachable: 400 tries within 380 tiles always find open grass.
		return shopCandidate(this.seed, day, 0);
	}
}
