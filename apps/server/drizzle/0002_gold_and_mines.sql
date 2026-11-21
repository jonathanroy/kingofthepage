CREATE TABLE "mines" (
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"controller_id" uuid NOT NULL,
	"controlled_since" bigint NOT NULL,
	CONSTRAINT "mines_x_y_pk" PRIMARY KEY("x","y")
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "gold" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mines" ADD CONSTRAINT "mines_controller_id_players_id_fk" FOREIGN KEY ("controller_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;