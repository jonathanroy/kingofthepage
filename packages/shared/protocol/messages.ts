import { z } from "zod";

export const PROTOCOL_VERSION = 1;

const int = z.number().int();
const seq = int.nonnegative();
export const DirectionSchema = z.enum(["up", "down", "left", "right"]);

// Client → server: intents only. The server decides every outcome.

export const ClientMessageSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("join"), handle: z.string().max(64) }),
	z.object({ type: z.literal("resume"), token: z.string().min(1).max(128) }),
	z.object({ type: z.literal("move"), dir: DirectionSchema, seq }),
	/** Face a direction without moving, e.g. to build on an empty tile. */
	z.object({ type: z.literal("turn"), dir: DirectionSchema, seq }),
	/**
	 * Chop whatever the player faces: tree or fence. `confirmAlly` says the player
	 * accepted the warning about chopping an ally's fence (§4).
	 */
	z.object({ type: z.literal("chop"), seq, confirmAlly: z.boolean().optional() }),
	/** Build a fence on the tile the player faces. */
	z.object({ type: z.literal("build"), seq }),
	/** Upgrade (and repair) the player's own fence they face (§3). */
	z.object({ type: z.literal("upgrade"), seq }),
	/** Turn the player's own fence they face into a gate (§3 Gates). */
	z.object({ type: z.literal("makeGate"), seq }),
	// §4 Alliances.
	z.object({ type: z.literal("allyRequest"), handle: z.string().max(64) }),
	z.object({ type: z.literal("allyAccept"), playerId: z.string().max(64) }),
	z.object({ type: z.literal("allyDecline"), playerId: z.string().max(64) }),
	z.object({ type: z.literal("allyEnd"), playerId: z.string().max(64) }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// Server → client.

export type Facing = z.infer<typeof DirectionSchema>;

export type PlayerInfo = {
	readonly id: string;
	readonly handle: string;
	readonly x: number;
	readonly y: number;
	readonly facing: Facing;
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

export type JoinRejectReason = "handleInvalid" | "handleTaken" | "badToken" | "alreadyOnline";

export type ActionRejectReason =
	| "tooSoon"
	| "blocked"
	| "noAccess"
	| "nothingToChop"
	| "notYourTree"
	| "notYourFence"
	| "notEmptyGround"
	| "occupied"
	| "notEnoughWood"
	| "notJoined"
	| "maxLevel"
	| "alreadyGate"
	| "nothingToUpgrade"
	| "allyConfirmRequired";

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
			readonly serverTime: number;
	  }
	| { readonly type: "joinRejected"; readonly reason: JoinRejectReason; readonly detail?: string }
	| {
			readonly type: "chunk";
			readonly cx: number;
			readonly cy: number;
			/** [x, y, choppedAt] for trees that were chopped and may not have regrown. */
			readonly chopped: readonly (readonly [number, number, number])[];
			readonly fences: readonly FenceInfo[];
			readonly control: ChunkControl;
			readonly handles: Readonly<Record<string, string>>;
	  }
	| {
			readonly type: "tile";
			readonly x: number;
			readonly y: number;
			readonly choppedAt: number | null;
			readonly fence: FenceInfo | null;
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
	| { readonly type: "inventory"; readonly wood: number }
	/** Full alliance state for the receiving player, sent on join and on every change. */
	| {
			readonly type: "alliances";
			readonly allies: readonly PlayerRef[];
			readonly incoming: readonly PlayerRef[];
			readonly outgoing: readonly PlayerRef[];
	  }
	| { readonly type: "notice"; readonly notice: Notice }
	| { readonly type: "rejected"; readonly seq: number; readonly reason: ActionRejectReason };
