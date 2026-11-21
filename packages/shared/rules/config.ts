// Every tunable number lives here (GAME_DESIGN.md values marked "tunable").
// Changing a TERRAIN value changes the generated world for every existing seed.

/** §2 Wood and trees */
export const TREE = {
	chopsToFell: 1,
	woodMin: 1,
	woodMax: 2,
	regrowDelayMs: 10 * 60 * 1000,
} as const;

/** §3 Fences: index = level - 1. */
// Costs grow faster than durability past level 4, so high walls are a deliberate investment
// rather than the default (chops per wood invested: 1.1 at level 4, about 0.6 at level 10).
export const FENCE_LEVELS = [
	{ level: 1, chopsToBreak: 3, cost: 2, name: "Twig fence" },
	{ level: 2, chopsToBreak: 6, cost: 3, name: "Plank fence" },
	{ level: 3, chopsToBreak: 12, cost: 5, name: "Log palisade" },
	{ level: 4, chopsToBreak: 20, cost: 8, name: "Reinforced palisade" },
	{ level: 5, chopsToBreak: 30, cost: 12, name: "Stone wall" },
	{ level: 6, chopsToBreak: 42, cost: 17, name: "Brick wall" },
	{ level: 7, chopsToBreak: 56, cost: 23, name: "Fortified wall" },
	{ level: 8, chopsToBreak: 72, cost: 30, name: "Iron-bound wall" },
	{ level: 9, chopsToBreak: 90, cost: 38, name: "Steel wall" },
	{ level: 10, chopsToBreak: 110, cost: 47, name: "King's wall" },
] as const;

export const FENCE = {
	ownFenceChopsToBreak: 1,
	/** Applies to every broken fence, own or not. */
	refundRatio: 0.5,
	/** Repairing a max-level fence costs this much wood per chop of damage, rounded up (§3). */
	repairWoodPerChop: 0.5,
	/** Extra wood to turn one of your fences into a gate (§3 Gates). */
	gateConversionCost: 2,
} as const;

/** §1 World generation. */
export const TERRAIN = {
	/** World units per noise period; larger = bigger lakes and hills. */
	elevationScale: 96,
	forestScale: 48,
	/** Elevation in [-1, 1]. */
	waterBelow: -0.45,
	hillAbove: 0.55,
	/** Forest noise in [-1, 1]; above this, trees become dense. */
	forestAbove: 0.25,
	denseForestTreeChance: 0.65,
	scatteredTreeChance: 0.04,
} as const;

/** §5 Claiming land. */
export const ENCLOSURE = {
	/** Larger areas claim nothing; also bounds every flood fill. */
	maxArea: 10_000,
	/** Share of the outer border that must be the owner's own fences. */
	minOwnFenceBorderShare: 0.5,
	/**
	 * Work cap when deciding whether a lake or hill next to an area is a hole inside it.
	 * Hitting it counts the wall as outer border, the conservative choice.
	 */
	holeSearchLimit: 40_000,
} as const;

/** Movement and action pacing. Walking speed is what bounds exploration (§1). */
export const PACE = {
	moveIntervalMs: 150,
	actionIntervalMs: 250,
} as const;

/** §1 Players and spawning. */
export const HANDLE = {
	minLength: 3,
	maxLength: 16,
	pattern: /^[A-Za-z0-9_]+$/,
} as const;

export const SPAWN = {
	/** Distance range from a random existing fence. */
	nearFenceMin: 3,
	nearFenceMax: 20,
	/** With no fences in the world, spawn within this distance of the origin. */
	wildernessRadius: 200,
	/** The spawn tile must connect to open ground at least this far away, so nobody starts boxed in by terrain. */
	escapeDistance: 40,
	attempts: 300,
} as const;

export const NETWORK = {
	tickRateHz: 20,
	/** Clients receive updates for chunks within this many chunks of their own. */
	interestRadiusChunks: 2,
	maxQueuedIntents: 8,
	persistIntervalMs: 2000,
} as const;

/** §6 Gold mines. */
export const MINES = {
	/** Chance that a chunk holds a mine: about 1 per 40 chunks. */
	chunkChance: 1 / 40,
	/** Share of mines that are large; large mines are rarer and richer. */
	largeShare: 0.25,
	goldPerMinute: { small: 1, large: 3 },
	/** Tries to find a non-water, non-hill tile in the chunk before giving up on its mine. */
	placementAttempts: 8,
} as const;

/** §7 Leaderboards. */
export const LEADERBOARD = {
	size: 10,
	/** Minimum time between leaderboard requests from one client. */
	minRequestIntervalMs: 2000,
	/** The server recomputes the boards at most this often and serves the cached copy in between. */
	cacheMs: 5000,
} as const;
