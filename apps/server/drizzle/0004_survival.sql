CREATE TABLE "forage" (
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"harvested_at" bigint NOT NULL,
	CONSTRAINT "forage_x_y_pk" PRIMARY KEY("x","y")
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "health" double precision DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "food" double precision DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "water" double precision DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "pantry" jsonb DEFAULT '{"apple":{"count":0,"spoil":0},"berries":{"count":0,"spoil":0},"potato":{"count":0,"spoil":0},"meat":{"count":0,"spoil":0}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "has_spear" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "tool" text DEFAULT 'axe' NOT NULL;