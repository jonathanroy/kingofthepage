ALTER TABLE "players" ADD COLUMN "gold_spent" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "owned" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "look" jsonb DEFAULT '{}'::jsonb NOT NULL;