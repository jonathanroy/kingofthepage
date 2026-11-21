import { IRON } from "./config";

/** §2 Iron ore: iron from one hit on a rock with `remaining` iron left. */
export function ironFromHit(remaining: number): number {
	return Math.max(0, Math.min(IRON.perHit, remaining));
}
