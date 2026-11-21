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
	/** Chop whatever the player faces: tree or fence. */
	z.object({ type: z.literal("chop"), seq }),
	/** Build a fence on the tile the player faces. */
	z.object({ type: z.literal("build"), seq }),
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
	| "notJoined";

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
	| { readonly type: "rejected"; readonly seq: number; readonly reason: ActionRejectReason };
