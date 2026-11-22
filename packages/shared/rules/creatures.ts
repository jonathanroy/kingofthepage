import { CREATURES } from "./config";
import type { Fence } from "./types";

export type CreatureKind = "rabbit" | "deer" | "bear";
export type Tool = "axe" | "spear";

/** §9: bears claw through wooden fences and gates; iron-reinforced walls hold them back. */
export function bearCanClaw(fence: Fence): boolean {
	return fence.level <= CREATURES.bearMaxFenceLevel;
}

/** §9: online play time until the next zombie bear, a random draw within the configured range. */
export function drawBearDelay(random: () => number): number {
	const { bearDelayMinMs: min, bearDelayMaxMs: max } = CREATURES;
	return Math.round(min + random() * (max - min));
}

export function creatureMaxHp(kind: CreatureKind): number {
	return CREATURES[kind].hp;
}

/** Meat from a hunted animal; zombie bears are inedible. */
export function meatFrom(kind: CreatureKind): number {
	return kind === "bear" ? 0 : CREATURES[kind].meat;
}
