CREATE TABLE "ore_mined" (
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"mined" integer NOT NULL,
	CONSTRAINT "ore_mined_x_y_pk" PRIMARY KEY("x","y")
);
--> statement-breakpoint
ALTER TABLE "fences" ADD COLUMN "iron_invested" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "iron" integer DEFAULT 0 NOT NULL;