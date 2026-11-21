export type PlayerId = string;

export type FenceLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type Fence = {
	readonly ownerId: PlayerId;
	readonly level: FenceLevel;
	/** Build cost plus every upgrade and gate conversion, used for the 50% refund (§3). */
	readonly woodInvested: number;
	/** Iron spent on upgrades (§3, iron ore); half comes back when the fence breaks. */
	readonly ironInvested: number;
	/** Chops landed so far by non-owners. Persists until the fence breaks or is upgraded (§3). */
	readonly damage: number;
	/** Gates are fences the owner and allies can walk through; they still count as walls (§3 Gates). */
	readonly gate: boolean;
};

/** Whether `otherId` is an ally of the player asking. */
export type AllyCheck = (otherId: PlayerId) => boolean;

export const NO_ALLIES: AllyCheck = () => false;
