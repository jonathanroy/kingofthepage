import {
	bigint,
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
