import { FENCE, FENCE_LEVELS } from "./config";
import { isWalkable, type Tile } from "./tiles";
import type { Fence, FenceLevel, PlayerId } from "./types";

const MAX_LEVEL = FENCE_LEVELS.length as FenceLevel;

function levelInfo(level: FenceLevel) {
	const info = FENCE_LEVELS[level - 1];
	if (!info) throw new Error(`Unknown fence level ${level}`);
	return info;
}

export function fenceBuildCost(): number {
	return levelInfo(1).cost;
}

export function buildFence(ownerId: PlayerId): Fence {
	return { ownerId, level: 1, woodInvested: fenceBuildCost() };
}

export type FencePlacement =
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: "notEmptyGround" | "occupied" | "notEnoughWood" };

/** §3 Building: fences go on empty ground (grass or a stump), never on a player. */
export function canPlaceFence(tile: Tile, occupied: boolean, wood: number): FencePlacement {
	if (!isWalkable(tile)) return { ok: false, reason: "notEmptyGround" };
	if (occupied) return { ok: false, reason: "occupied" };
	if (wood < fenceBuildCost()) return { ok: false, reason: "notEnoughWood" };
	return { ok: true };
}

/** Wood needed for the next level, or null at max level. */
export function upgradeCost(fence: Fence): number | null {
	if (fence.level >= MAX_LEVEL) return null;
	return levelInfo((fence.level + 1) as FenceLevel).cost;
}

export function upgradeFence(fence: Fence): Fence {
	const cost = upgradeCost(fence);
	if (cost === null) throw new Error("Fence is already at max level");
	return {
		...fence,
		level: (fence.level + 1) as FenceLevel,
		woodInvested: fence.woodInvested + cost,
	};
}

/** §3 Chopping fences: the owner opens their own wall in one chop. */
export function chopsToBreak(fence: Fence, actorId: PlayerId): number {
	if (fence.ownerId === actorId) return FENCE.ownFenceChopsToBreak;
	return levelInfo(fence.level).chopsToBreak;
}

/** §3: 50% of everything invested, rounded down, whoever breaks it. */
export function fenceRefund(fence: Fence): number {
	return Math.floor(fence.woodInvested * FENCE.refundRatio);
}
