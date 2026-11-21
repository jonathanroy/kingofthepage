import {
	bigint,
	boolean,
	doublePrecision,
	index,
	integer,
	pgTable,
	primaryKey,
	smallint,
	text,
	uuid,
} from "drizzle-orm/pg-core";

// Timestamps are epoch milliseconds, matching the `now` values the rules use.
const ms = (name: string) => bigint(name, { mode: "number" });

export const players = pgTable("players", {
	id: uuid("id").primaryKey(),
	handle: text("handle").notNull(),
	/** Lowercased handle; enforces case-insensitive uniqueness. */
	handleKey: text("handle_key").notNull().unique(),
	tokenHash: text("token_hash").notNull().unique(),
	x: integer("x").notNull(),
	y: integer("y").notNull(),
	facing: text("facing").notNull(),
	wood: integer("wood").notNull(),
	iron: integer("iron").notNull().default(0),
	/** Fractional: gold is settled per millisecond of mine control (§6). */
	gold: doublePrecision("gold").notNull().default(0),
	createdAt: ms("created_at").notNull(),
	lastSeenAt: ms("last_seen_at").notNull(),
});

export const fences = pgTable(
	"fences",
	{
		x: integer("x").notNull(),
		y: integer("y").notNull(),
		ownerId: uuid("owner_id")
			.notNull()
			.references(() => players.id),
		level: smallint("level").notNull(),
		woodInvested: integer("wood_invested").notNull(),
		ironInvested: integer("iron_invested").notNull().default(0),
		damage: integer("damage").notNull().default(0),
		gate: boolean("gate").notNull().default(false),
	},
	(t) => [primaryKey({ columns: [t.x, t.y] }), index("fences_owner_idx").on(t.ownerId)],
);

export const choppedTrees = pgTable(
	"chopped_trees",
	{
		x: integer("x").notNull(),
		y: integer("y").notNull(),
		choppedAt: ms("chopped_at").notNull(),
	},
	(t) => [primaryKey({ columns: [t.x, t.y] })],
);

export const enclosures = pgTable("enclosures", {
	id: uuid("id").primaryKey(),
	ownerId: uuid("owner_id")
		.notNull()
		.references(() => players.id),
	createdAt: ms("created_at").notNull(),
	anchorX: integer("anchor_x").notNull(),
	anchorY: integer("anchor_y").notNull(),
});

/** One row per alliance, with player_a < player_b (§4). */
export const alliances = pgTable(
	"alliances",
	{
		playerA: uuid("player_a")
			.notNull()
			.references(() => players.id),
		playerB: uuid("player_b")
			.notNull()
			.references(() => players.id),
	},
	(t) => [primaryKey({ columns: [t.playerA, t.playerB] })],
);

/** Controlled mines only; position and size come from the seed (§6). */
export const mines = pgTable(
	"mines",
	{
		x: integer("x").notNull(),
		y: integer("y").notNull(),
		controllerId: uuid("controller_id")
			.notNull()
			.references(() => players.id),
		controlledSince: ms("controlled_since").notNull(),
	},
	(t) => [primaryKey({ columns: [t.x, t.y] })],
);

/** Iron mined per ore rock (§2 Iron ore). Position and capacity come from the seed. */
export const oreMined = pgTable(
	"ore_mined",
	{
		x: integer("x").notNull(),
		y: integer("y").notNull(),
		mined: integer("mined").notNull(),
	},
	(t) => [primaryKey({ columns: [t.x, t.y] })],
);
