import { FENCE, FENCE_LEVELS } from "./config";
import { isWalkable, type Tile } from "./tiles";
import type { AllyCheck, Fence, FenceLevel, PlayerId } from "./types";

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
	return {
		ownerId,
		level: 1,
		woodInvested: fenceBuildCost(),
		ironInvested: 0,
		damage: 0,
		gate: false,
	};
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

export type FenceUpgrade =
	| {
			readonly ok: true;
			readonly kind: "upgrade" | "repair";
			/** Wood to spend. */
			readonly cost: number;
			/** Iron to spend (upgrades to iron and steel levels only). */
			readonly iron: number;
	  }
	| {
			readonly ok: false;
			readonly reason: "notYourFence" | "maxLevel" | "notEnoughWood" | "notEnoughIron";
	  };

/** Iron needed for the next level (0 for wood and stone levels), or null at max level. */
export function upgradeIronCost(fence: Fence): number | null {
	if (fence.level >= MAX_LEVEL) return null;
	return levelInfo((fence.level + 1) as FenceLevel).iron;
}

/**
 * §3: the owner's "improve" action. A damaged fence is repaired first, at any level, for
 * wood proportional to the damage; only a fully repaired fence can be upgraded.
 */
export function canUpgradeFence(
	fence: Fence,
	actorId: PlayerId,
	wood: number,
	iron = 0,
): FenceUpgrade {
	if (fence.ownerId !== actorId) return { ok: false, reason: "notYourFence" };
	const repair = repairCost(fence);
	if (repair > 0) {
		// Repairs are wood only, at every level.
		if (wood < repair) return { ok: false, reason: "notEnoughWood" };
		return { ok: true, kind: "repair", cost: repair, iron: 0 };
	}
	const upgrade = upgradeCost(fence);
	const ironCost = upgradeIronCost(fence);
	if (upgrade === null || ironCost === null) return { ok: false, reason: "maxLevel" };
	if (wood < upgrade) return { ok: false, reason: "notEnoughWood" };
	if (iron < ironCost) return { ok: false, reason: "notEnoughIron" };
	return { ok: true, kind: "upgrade", cost: upgrade, iron: ironCost };
}

export function isMaxLevel(fence: Fence): boolean {
	return fence.level >= MAX_LEVEL;
}

/** Wood to clear a fence's damage, at least 1 when damaged; 0 when undamaged. */
export function repairCost(fence: Fence): number {
	return Math.ceil(fence.damage * FENCE.repairWoodPerChop);
}

/** Repair isn't an investment: it doesn't raise the 50% refund. */
export function repairFence(fence: Fence): Fence {
	return { ...fence, damage: 0 };
}

/** Applies whichever improvement `canUpgradeFence` allowed: repair if damaged, else upgrade. */
export function improveFence(fence: Fence): Fence {
	return fence.damage > 0 ? repairFence(fence) : upgradeFence(fence);
}

/** §3: one level up. The fence must be fully repaired first. */
export function upgradeFence(fence: Fence): Fence {
	const cost = upgradeCost(fence);
	if (cost === null) throw new Error("Fence is already at max level");
	if (fence.damage > 0) throw new Error("Repair the fence before upgrading it");
	return {
		...fence,
		level: (fence.level + 1) as FenceLevel,
		woodInvested: fence.woodInvested + cost,
		ironInvested: fence.ironInvested + (upgradeIronCost(fence) ?? 0),
	};
}

export type GateConversion =
	| { readonly ok: true; readonly cost: number }
	| { readonly ok: false; readonly reason: "notYourFence" | "alreadyGate" | "notEnoughWood" };

/** §3 Gates: the owner converts one of their fences; it keeps its level and damage. */
export function canMakeGate(fence: Fence, actorId: PlayerId, wood: number): GateConversion {
	if (fence.ownerId !== actorId) return { ok: false, reason: "notYourFence" };
	if (fence.gate) return { ok: false, reason: "alreadyGate" };
	if (wood < FENCE.gateConversionCost) return { ok: false, reason: "notEnoughWood" };
	return { ok: true, cost: FENCE.gateConversionCost };
}

export function makeGate(fence: Fence): Fence {
	return { ...fence, gate: true, woodInvested: fence.woodInvested + FENCE.gateConversionCost };
}

/** §3 Gates, §4: only the owner and their allies walk through. */
export function canPassGate(fence: Fence, playerId: PlayerId, isAlly: AllyCheck): boolean {
	return fence.gate && (fence.ownerId === playerId || isAlly(fence.ownerId));
}

/** §3 Chopping fences: the owner opens their own wall in one chop. */
export function chopsToBreak(fence: Fence, actorId: PlayerId): number {
	if (fence.ownerId === actorId) return FENCE.ownFenceChopsToBreak;
	return levelInfo(fence.level).chopsToBreak;
}

export type FenceChop =
	| { readonly broken: true; readonly refund: number; readonly ironRefund: number }
	| { readonly broken: false; readonly fence: Fence };

/** §3 Chopping fences: damage adds up (and persists) until it reaches the chops needed. */
export function chopFence(fence: Fence, actorId: PlayerId): FenceChop {
	const damage = fence.damage + 1;
	if (fence.ownerId === actorId || damage >= chopsToBreak(fence, actorId)) {
		return { broken: true, refund: fenceRefund(fence), ironRefund: fenceIronRefund(fence) };
	}
	return { broken: false, fence: { ...fence, damage } };
}

/** §4: chopping an ally's fence needs the chopper to confirm the warning first. */
export function needsAllyConfirmation(fence: Fence, actorId: PlayerId, isAlly: AllyCheck): boolean {
	return fence.ownerId !== actorId && isAlly(fence.ownerId);
}

/** §3: 50% of everything invested, rounded down, whoever breaks it. */
export function fenceIronRefund(fence: Fence): number {
	return Math.floor(fence.ironInvested * FENCE.refundRatio);
}

export function fenceRefund(fence: Fence): number {
	return Math.floor(fence.woodInvested * FENCE.refundRatio);
}
