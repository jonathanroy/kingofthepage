import type { MineSize } from "../world/mines";
import { MINES } from "./config";
import type { PlayerId } from "./types";

export function mineGoldPerMinute(size: MineSize): number {
	return MINES.goldPerMinute[size];
}

/** Who gets a mine's gold, and since when it hasn't been paid out (§10 Lazy updates). */
export type MineControl = {
	readonly controllerId: PlayerId;
	readonly controlledSince: number;
};

/**
 * §6, §10: credit `elapsed minutes × rate` to the controller and restart the clock.
 * Called when control changes, and before any balance or leaderboard is read.
 */
export function settleMineGold(
	size: MineSize,
	control: MineControl,
	now: number,
): { readonly earned: number; readonly control: MineControl } {
	const minutes = Math.max(0, now - control.controlledSince) / 60_000;
	return {
		earned: minutes * mineGoldPerMinute(size),
		control: { ...control, controlledSince: Math.max(now, control.controlledSince) },
	};
}
