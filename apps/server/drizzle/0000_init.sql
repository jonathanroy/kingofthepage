CREATE TABLE "chopped_trees" (
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"chopped_at" bigint NOT NULL,
	CONSTRAINT "chopped_trees_x_y_pk" PRIMARY KEY("x","y")
);
--> statement-breakpoint
CREATE TABLE "enclosures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" bigint NOT NULL,
	"anchor_x" integer NOT NULL,
	"anchor_y" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fences" (
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"owner_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"wood_invested" integer NOT NULL,
	CONSTRAINT "fences_x_y_pk" PRIMARY KEY("x","y")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"handle_key" text NOT NULL,
	"token_hash" text NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"facing" text NOT NULL,
	"wood" integer NOT NULL,
	"created_at" bigint NOT NULL,
	"last_seen_at" bigint NOT NULL,
	CONSTRAINT "players_handle_key_unique" UNIQUE("handle_key"),
	CONSTRAINT "players_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "enclosures" ADD CONSTRAINT "enclosures_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fences" ADD CONSTRAINT "fences_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fences_owner_idx" ON "fences" USING btree ("owner_id");