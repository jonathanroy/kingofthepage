import { TREE } from "./config";
import type { PlayerId } from "./types";

/**
 * §2 Who can chop a tree. `enclosingOwners` lists the owners of every enclosure
 * containing the tile, innermost and outer (§5 Nesting); empty means unclaimed.
 */
export function canChopTree(actorId: PlayerId, enclosingOwners: readonly PlayerId[]): boolean {
	return enclosingOwners.length === 0 || enclosingOwners.includes(actorId);
}

/** `roll` in [0, 1) comes from the server so this stays pure and testable. */
export function woodFromTree(roll: number): number {
	const span = TREE.woodMax - TREE.woodMin + 1;
	const offset = Math.min(span - 1, Math.max(0, Math.floor(roll * span)));
	return TREE.woodMin + offset;
}
