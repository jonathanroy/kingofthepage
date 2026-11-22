import { z } from "zod";
import { PROFILE } from "../rules/config";

export const PROTOCOL_VERSION = 1;

const int = z.number().int();
const seq = int.nonnegative();
export const DirectionSchema = z.enum(["up", "down", "left", "right"]);

// Client → server: intents only. The server decides every outcome.

export const ClientMessageSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("join"), handle: z.string().max(64) }),
	z.object({ type: z.literal("resume"), token: z.string().min(1).max(128) }),
	/** Log back in to a saved profile, e.g. from another browser. */
	z.object({
		type: z.literal("login"),
		handle: z.string().max(64),
		password: z.string().min(1).max(PROFILE.passwordMaxLength),
	}),
	/** Save the profile with a password; changing it needs the current one. */
	z.object({
		type: z.literal("setPassword"),
		password: z.string().min(PROFILE.passwordMinLength).max(PROFILE.passwordMaxLength),
		current: z.string().max(PROFILE.passwordMaxLength).optional(),
	}),
	z.object({ type: z.literal("move"), dir: DirectionSchema, seq }),
	/** Face a direction without moving, e.g. to build on an empty tile. */
	z.object({ type: z.literal("turn"), dir: DirectionSchema, seq }),
	/**
	 * Chop whatever the player faces: tree or fence. `confirmAlly` says the player
	 * accepted the warning about chopping an ally's fence (§4).
	 */
	z.object({ type: z.literal("chop"), seq, confirmAlly: z.boolean().optional() }),
	/**
	 * Build a fence on a tile next to the player: the faced one, or the one in `dir`
	 * (used to lay fences behind you while walking).
	 */
	z.object({ type: z.literal("build"), seq, dir: DirectionSchema.optional() }),
	/** Upgrade (and repair) the player's own fence they face (§3). */
	z.object({ type: z.literal("upgrade"), seq }),
	/** Turn the player's own fence they face into a gate (§3 Gates). */
	z.object({ type: z.literal("makeGate"), seq }),
	// §4 Alliances.
	z.object({ type: z.literal("allyRequest"), handle: z.string().max(64) }),
	z.object({ type: z.literal("allyAccept"), playerId: z.string().max(64) }),
	z.object({ type: z.literal("allyDecline"), playerId: z.string().max(64) }),
	z.object({ type: z.literal("allyEnd"), playerId: z.string().max(64) }),
	/** §7: ask for both leaderboards. */
	z.object({ type: z.literal("leaderboard") }),
	/** §8: drink from the lake, pick apples or berries, or dig potatoes on the faced tile. */
	z.object({ type: z.literal("interact"), seq }),
	/** §8: eat the carried food closest to spoiling. */
	z.object({ type: z.literal("eat"), seq }),
	/** §9: craft a spear. */
	z.object({ type: z.literal("craftSpear"), seq }),
	/** §10: buy one of today's collectibles while facing the magic shop. */
	z.object({ type: z.literal("buy"), itemId: z.string().max(64), seq }),
	/** §10: wear an owned collectible, or take a slot off with itemId null. */
	z.object({
		type: z.literal("equip"),
		slot: z.enum(["hat", "cape", "pet", "aura", "name", "banner"]),
		itemId: z.string().max(64).nullable(),
		seq,
	}),
	/** §9: choose what the chop key uses. */
	z.object({ type: z.literal("selectTool"), tool: z.enum(["axe", "spear"]), seq }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// Server → client.

export type Facing = z.infer<typeof DirectionSchema>;

/** Collectibles a player wears, one per slot (§10). */
export type LookInfo = Readonly<
	Partial<Record<"hat" | "cape" | "pet" | "aura" | "name" | "banner", string>>
>;

export type PlayerInfo = {
	readonly id: string;
	readonly handle: string;
	readonly x: number;
	readonly y: number;
	readonly facing: Facing;
	readonly look: LookInfo;
};

export type FenceInfo = {
	readonly x: number;
	readonly y: number;
	readonly ownerId: string;
	readonly level: number;
	readonly damage: number;
	readonly gate: boolean;
};

export type PlayerRef = { readonly id: string; readonly handle: string };

export type FoodCounts = {
	readonly apple: number;
	readonly berries: number;
	readonly potato: number;
	readonly meat: number;
};

export type CreatureInfo = {
	readonly id: string;
	readonly kind: "rabbit" | "deer" | "bear";
	readonly x: number;
	readonly y: number;
	readonly facing: Facing;
	readonly hp: number;
	readonly maxHp: number;
};

export type LeaderboardEntry = PlayerRef & { readonly value: number };

export type Notice =
	| {
			readonly kind: "allyChoppingFence";
			readonly by: PlayerRef;
			readonly x: number;
			readonly y: number;
	  }
	| { readonly kind: "allianceRequest"; readonly from: PlayerRef }
	| { readonly kind: "allianceRequestSent"; readonly to: PlayerRef }
	| { readonly kind: "allianceFormed"; readonly with: PlayerRef }
	| { readonly kind: "allianceEnded"; readonly with: PlayerRef }
	| { readonly kind: "bearComing" }
	| { readonly kind: "bought"; readonly itemId: string }
	| { readonly kind: "died"; readonly cause: "starved" | "bear" }
	| { readonly kind: "ate"; readonly food: "apple" | "berries" | "potato" | "meat" }
	| { readonly kind: "spoiled"; readonly food: "apple" | "berries" | "potato" | "meat" }
	| {
			readonly kind: "allianceRequestFailed";
			readonly reason: "unknownHandle" | "self" | "alreadyAllies" | "alreadyRequested";
	  };

export type ChunkControl = {
	/** Player ids referenced by `cells`; cell value n > 0 means owners[n - 1]. */
	readonly owners: readonly string[];
	/** Row-major controller per tile, 0 when unclaimed. Omitted cells array means all unclaimed. */
	readonly cells: readonly number[] | null;
};

export type JoinRejectReason =
	| "handleInvalid"
	| "handleTaken"
	| "badToken"
	| "alreadyOnline"
	/** Unknown handle or wrong password: deliberately the same answer for both. */
	| "badLogin"
	| "tooManyAttempts";

export type ProfileRejectReason = "wrongCurrent" | "busy";

export type ActionRejectReason =
	| "tooSoon"
	| "blocked"
	| "noAccess"
	| "nothingToChop"
	| "notYourFence"
	| "notEmptyGround"
	| "occupied"
	| "notEnoughWood"
	| "notEnoughIron"
	| "notJoined"
	| "maxLevel"
	| "alreadyGate"
	| "nothingToUpgrade"
	| "allyConfirmRequired"
	| "nothingToInteract"
	| "notReady"
	| "bagFull"
	| "nothingToEat"
	| "noSpear"
	| "alreadyHaveSpear"
	| "useAxe"
	| "useSpear"
	| "nothingToHit"
	| "notForSale"
	| "alreadyOwned"
	| "notEnoughGold"
	| "notAtShop"
	| "notOwned";

export type ServerMessage =
	| {
			readonly type: "hello";
			readonly protocolVersion: number;
			readonly worldSeed: string;
			readonly serverTime: number;
			readonly suggestedHandle: string;
	  }
	| {
			readonly type: "joined";
			readonly you: PlayerInfo;
			/** Keep this to resume as the same player later. */
			readonly token: string;
			readonly wood: number;
			readonly iron: number;
			readonly gold: number;
			readonly goldPerMinute: number;
			readonly serverTime: number;
			/** Whether this profile is saved with a password. */
			readonly hasPassword: boolean;
	  }
	| { readonly type: "joinRejected"; readonly reason: JoinRejectReason; readonly detail?: string }
	| { readonly type: "profileSaved" }
	| { readonly type: "profileRejected"; readonly reason: ProfileRejectReason }
	| {
			readonly type: "chunk";
			readonly cx: number;
			readonly cy: number;
			/** [x, y, choppedAt] for trees that were chopped and may not have regrown. */
			readonly chopped: readonly (readonly [number, number, number])[];
			readonly fences: readonly FenceInfo[];
			/** [x, y, harvestedAt] for food plants harvested recently enough to still be regrowing. */
			readonly harvested: readonly (readonly [number, number, number])[];
			/** [x, y, iron mined] for ore rocks that have been mined at all. */
			readonly ore: readonly (readonly [number, number, number])[];
			readonly control: ChunkControl;
			readonly handles: Readonly<Record<string, string>>;
			/** Owners in this chunk whose walls fly the royal banner (§10). */
			readonly royal: readonly string[];
	  }
	| {
			readonly type: "tile";
			readonly x: number;
			readonly y: number;
			readonly choppedAt: number | null;
			readonly fence: FenceInfo | null;
			readonly oreMined: number | null;
			readonly harvestedAt: number | null;
	  }
	| {
			readonly type: "control";
			/** [x, y, ownerId or null]. */
			readonly changes: readonly (readonly [number, number, string | null])[];
			readonly handles: Readonly<Record<string, string>>;
	  }
	| { readonly type: "player"; readonly player: PlayerInfo }
	| { readonly type: "playerGone"; readonly id: string }
	/** Authoritative position after a move intent, for client reconciliation. */
	| {
			readonly type: "moved";
			readonly seq: number;
			readonly x: number;
			readonly y: number;
			readonly facing: Facing;
	  }
	/**
	 * Gold is settled at `asOf` (server time). Clients extrapolate with `goldPerMinute`
	 * to show a live counter between updates.
	 */
	| {
			readonly type: "inventory";
			readonly wood: number;
			readonly iron: number;
			readonly gold: number;
			readonly goldPerMinute: number;
			readonly asOf: number;
	  }
	| {
			readonly type: "leaderboard";
			readonly land: readonly LeaderboardEntry[];
			readonly gold: readonly LeaderboardEntry[];
			/** The requesting player's own values, even when outside the top list. */
			readonly you: { readonly land: number; readonly gold: number };
	  }
	/** Full alliance state for the receiving player, sent on join and on every change. */
	| {
			readonly type: "alliances";
			readonly allies: readonly PlayerRef[];
			readonly incoming: readonly PlayerRef[];
			readonly outgoing: readonly PlayerRef[];
	  }
	| { readonly type: "notice"; readonly notice: Notice }
	/** §8, §9: the receiving player's meters, carried food and tools. */
	| {
			readonly type: "status";
			readonly health: number;
			readonly food: number;
			readonly water: number;
			readonly pantry: FoodCounts;
			readonly hasSpear: boolean;
			readonly tool: "axe" | "spear";
	  }
	| { readonly type: "creature"; readonly creature: CreatureInfo }
	| { readonly type: "creatureGone"; readonly id: string }
	/** §10: the receiving player's bases, largest first, for the flag compass. */
	| {
			readonly type: "bases";
			readonly bases: readonly { readonly x: number; readonly y: number; readonly area: number }[];
	  }
	/** §10: the magic shop, sent only to players whose view includes it. */
	| {
			readonly type: "shop";
			readonly x: number;
			readonly y: number;
			readonly offer: readonly { readonly id: string; readonly price: number }[];
			readonly movesAt: number;
	  }
	| { readonly type: "shopGone" }
	/** §10: what the receiving player owns and wears. */
	| { readonly type: "collection"; readonly owned: readonly string[]; readonly equipped: LookInfo }
	/** After dying, the player starts again here (§8). */
	| { readonly type: "respawned"; readonly x: number; readonly y: number; readonly facing: Facing }
	| { readonly type: "rejected"; readonly seq: number; readonly reason: ActionRejectReason };
