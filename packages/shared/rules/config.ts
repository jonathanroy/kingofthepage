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
// Breaking walls is deliberately slow so land changes hands through sustained effort, not
// drive-by chops. Costs grow faster than durability past level 4, so high walls are an
// investment rather than the default (chops per wood: 11 at level 4, about 6 at level 10).
export const FENCE_LEVELS = [
	{ level: 1, chopsToBreak: 30, cost: 2, iron: 0, name: "Twig fence" },
	{ level: 2, chopsToBreak: 60, cost: 3, iron: 0, name: "Plank fence" },
	{ level: 3, chopsToBreak: 120, cost: 5, iron: 0, name: "Log palisade" },
	{ level: 4, chopsToBreak: 200, cost: 8, iron: 2, name: "Reinforced palisade" },
	{ level: 5, chopsToBreak: 300, cost: 12, iron: 0, name: "Stone wall" },
	{ level: 6, chopsToBreak: 420, cost: 17, iron: 0, name: "Brick wall" },
	{ level: 7, chopsToBreak: 560, cost: 23, iron: 0, name: "Fortified wall" },
	{ level: 8, chopsToBreak: 720, cost: 30, iron: 4, name: "Iron-bound wall" },
	{ level: 9, chopsToBreak: 900, cost: 38, iron: 6, name: "Steel wall" },
	{ level: 10, chopsToBreak: 1100, cost: 47, iron: 10, name: "King's wall" },
] as const;

export const FENCE = {
	ownFenceChopsToBreak: 1,
	/** Applies to every broken fence, own or not. */
	refundRatio: 0.5,
	/**
	 * Repairing costs this much wood per chop of damage, rounded up (§3). A full repair of
	 * a nearly broken fence costs 2 wood at level 1, 10 at level 4 and 55 at level 10.
	 */
	repairWoodPerChop: 0.05,
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

/** §2 Iron ore: rocks beside hills, mined until empty, never regrow. */
export const IRON = {
	/** Chance that a grass tile touching a hill holds an ore rock. */
	foothillChance: 0.1,
	/** Iron in a fresh rock, picked from this range by the world seed. */
	capacityMin: 80,
	capacityMax: 120,
	perHit: 1,
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

/** §8 Survival. Rates are per minute of online time. */
export const SURVIVAL = {
	max: 100,
	foodPerMinute: 1,
	waterPerMinute: 1.5,
	/** Extra drain for each work action: chop, mine, build, upgrade, spear thrust, harvest. */
	workFood: 0.15,
	workWater: 0.25,
	/** Health lost per minute for each empty meter. */
	starvePerMinute: 4,
	/** Health regained per minute while food and water are both at least half full. */
	regenPerMinute: 2,
	waterPerSip: 30,
	/** How often the server advances online players' meters. */
	tickMs: 1000,
} as const;

/** §8 Food. `shelfMs`: one item of the kind spoils every this much online time. */
export const FOOD = {
	capacity: 12,
	kinds: {
		apple: { restores: 15, shelfMs: 30 * 60_000 },
		berries: { restores: 8, shelfMs: 15 * 60_000 },
		potato: { restores: 25, shelfMs: 60 * 60_000 },
		meat: { restores: 35, shelfMs: 12 * 60_000 },
	},
} as const;

/** §8 Foraging: where plants grow (chance per eligible tile), how much a harvest gives, regrowth. */
export const FORAGE = {
	// Scarce on purpose: finding food should take some searching, not a few steps.
	apple: { chance: 0.03, yield: 2, regrowMs: 30 * 60_000 },
	berry: { chance: 0.005, yield: 3, regrowMs: 20 * 60_000 },
	potato: { chance: 0.003, yield: 2, regrowMs: 45 * 60_000 },
} as const;

/** §9 Tools. */
export const TOOLS = {
	spearWood: 4,
	spearIron: 1,
} as const;

/** §9 Animals and zombie bears. Times in milliseconds. */
export const CREATURES = {
	rabbit: { hp: 1, meat: 1, moveMs: 450, fleeRange: 3 },
	deer: { hp: 3, meat: 3, moveMs: 380, fleeRange: 4 },
	bear: {
		hp: 12,
		moveMs: 650,
		biteDamage: 20,
		biteMs: 1200,
		clawDamage: 10,
		clawMs: 900,
		lifetimeMs: 5 * 60_000,
	},
	/** Bears claw through fences up to this level; higher walls hold them back. */
	bearMaxFenceLevel: 3,
	animalsPerPlayer: 2,
	animalSpawnMin: 10,
	animalSpawnMax: 18,
	/** Animals farther than this from every player are removed. */
	despawnRange: 40,
	/** Chance per online player per minute that a zombie bear comes. */
	bearChancePerMinute: 1 / 40,
	bearSpawnMin: 15,
	bearSpawnMax: 20,
} as const;

/** §10 The magic shop. */
export const SHOP = {
	/** The shop moves at every multiple of this (midnight UTC). */
	dayMs: 24 * 60 * 60_000,
	/** Spots are picked within this many tiles of the world's center. */
	radius: 380,
	placementAttempts: 400,
	/** Prices are measured in days of one small mine. */
	goldPerDay: 1440,
	tierDays: { common: 15, rare: 30, epic: 45, legendary: 90 },
} as const;
