import { z } from "zod";

const EnvSchema = z.object({
	NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
	PORT: z.coerce.number().int().positive().default(8080),
	WORLD_SEED: z.string().min(1).optional(),
	/** Without it the server keeps everything in memory, which is lost on restart. */
	DATABASE_URL: z.string().url().optional(),
});

export type Env = {
	readonly production: boolean;
	readonly port: number;
	readonly worldSeed: string;
	readonly databaseUrl: string | undefined;
};

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
	const env = EnvSchema.parse(source);
	const production = env.NODE_ENV === "production";
	if (production && (!env.WORLD_SEED || !env.DATABASE_URL)) {
		throw new Error("WORLD_SEED and DATABASE_URL are required in production");
	}
	return {
		production,
		port: env.PORT,
		worldSeed: env.WORLD_SEED ?? "kotp-dev-seed",
		databaseUrl: env.DATABASE_URL,
	};
}
