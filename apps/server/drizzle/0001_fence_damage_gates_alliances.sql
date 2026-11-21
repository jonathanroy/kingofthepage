CREATE TABLE "alliances" (
	"player_a" uuid NOT NULL,
	"player_b" uuid NOT NULL,
	CONSTRAINT "alliances_player_a_player_b_pk" PRIMARY KEY("player_a","player_b")
);
--> statement-breakpoint
ALTER TABLE "fences" ADD COLUMN "damage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fences" ADD COLUMN "gate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "alliances" ADD CONSTRAINT "alliances_player_a_players_id_fk" FOREIGN KEY ("player_a") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alliances" ADD CONSTRAINT "alliances_player_b_players_id_fk" FOREIGN KEY ("player_b") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;