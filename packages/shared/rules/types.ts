export type PlayerId = string;

export type FenceLevel = 1 | 2 | 3 | 4;

export type Fence = {
	readonly ownerId: PlayerId;
	readonly level: FenceLevel;
	/** Build cost plus every upgrade, used for the 50% refund (§3). */
	readonly woodInvested: number;
};
