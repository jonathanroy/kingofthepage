import { TREE } from "./config";

// §2: anyone can chop any tree. Fences, not ownership, protect a player's trees.

/** `roll` in [0, 1) comes from the server so this stays pure and testable. */
export function woodFromTree(roll: number): number {
	const span = TREE.woodMax - TREE.woodMin + 1;
	const offset = Math.min(span - 1, Math.max(0, Math.floor(roll * span)));
	return TREE.woodMin + offset;
}
