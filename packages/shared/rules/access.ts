import type { Enclosure } from "./enclosure";
import { type AllyCheck, NO_ALLIES, type PlayerId } from "./types";

/**
 * §5 Access: a player may step onto a tile when any of these holds:
 * - nobody claims it;
 * - they or an ally own an enclosure containing it (nested inner areas are shared with
 *   enclosing owners; allies come in through gates, §4);
 * - they are already inside every enclosure there (trapped when it closed, or returning
 *   to a spot that was enclosed meanwhile), so they can move around within it.
 */
export function canEnterTile(
	playerId: PlayerId,
	from: readonly Enclosure[],
	to: readonly Enclosure[],
	isAlly: AllyCheck = NO_ALLIES,
): boolean {
	if (to.some((e) => e.ownerId === playerId || isAlly(e.ownerId))) return true;
	const fromIds = new Set(from.map((e) => e.id));
	return to.every((e) => fromIds.has(e.id));
}
