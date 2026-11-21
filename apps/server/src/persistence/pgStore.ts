import type { Direction } from "@kotp/shared/world";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";
import type { WorldSnapshot, WorldStore, WriteBatch } from "./store";

const DIRECTIONS: readonly Direction[] = ["up", "down", "left", "right"];

function toDirection(value: string): Direction {
	return DIRECTIONS.find((d) => d === value) ?? "down";
}

export class PgStore implements WorldStore {
	private readonly client: postgres.Sql;
	private readonly db;

	constructor(databaseUrl: string) {
		this.client = postgres(databaseUrl, { max: 4 });
		this.db = drizzle(this.client, { schema });
	}

	async migrate(migrationsFolder: string): Promise<void> {
		await migrate(this.db, { migrationsFolder });
	}

	async load(): Promise<WorldSnapshot> {
		const [players, fences, chops, enclosures, alliances] = await Promise.all([
			this.db.select().from(schema.players),
			this.db.select().from(schema.fences),
			this.db.select().from(schema.choppedTrees),
			this.db.select().from(schema.enclosures),
			this.db.select().from(schema.alliances),
		]);
		return {
			players: players.map((p) => ({ ...p, facing: toDirection(p.facing) })),
			fences,
			chops,
			enclosures,
			alliances: alliances.map((a) => ({ a: a.playerA, b: a.playerB })),
		};
	}

	async write(batch: WriteBatch): Promise<void> {
		await this.db.transaction(async (tx) => {
			// Order matters for foreign keys: players first, enclosures removed before added.
			for (const p of batch.players) {
				const { id, ...rest } = p;
				const row = { ...rest, handleKey: p.handle.toLowerCase() };
				await tx
					.insert(schema.players)
					.values({ id, ...row })
					.onConflictDoUpdate({ target: schema.players.id, set: row });
			}
			for (const f of batch.fencesRemoved) {
				await tx
					.delete(schema.fences)
					.where(and(eq(schema.fences.x, f.x), eq(schema.fences.y, f.y)));
			}
			if (batch.fencesSet.length > 0) {
				await tx
					.insert(schema.fences)
					.values([...batch.fencesSet])
					.onConflictDoUpdate({
						target: [schema.fences.x, schema.fences.y],
						set: {
							ownerId: sql`excluded.owner_id`,
							level: sql`excluded.level`,
							woodInvested: sql`excluded.wood_invested`,
							damage: sql`excluded.damage`,
							gate: sql`excluded.gate`,
						},
					});
			}
			for (const c of batch.chopsRemoved) {
				await tx
					.delete(schema.choppedTrees)
					.where(and(eq(schema.choppedTrees.x, c.x), eq(schema.choppedTrees.y, c.y)));
			}
			if (batch.chopsSet.length > 0) {
				await tx
					.insert(schema.choppedTrees)
					.values([...batch.chopsSet])
					.onConflictDoUpdate({
						target: [schema.choppedTrees.x, schema.choppedTrees.y],
						set: { choppedAt: sql`excluded.chopped_at` },
					});
			}
			if (batch.enclosuresRemoved.length > 0) {
				await tx
					.delete(schema.enclosures)
					.where(inArray(schema.enclosures.id, [...batch.enclosuresRemoved]));
			}
			if (batch.enclosuresAdded.length > 0) {
				await tx
					.insert(schema.enclosures)
					.values([...batch.enclosuresAdded])
					.onConflictDoNothing();
			}
			for (const a of batch.alliancesRemoved) {
				await tx
					.delete(schema.alliances)
					.where(and(eq(schema.alliances.playerA, a.a), eq(schema.alliances.playerB, a.b)));
			}
			if (batch.alliancesSet.length > 0) {
				await tx
					.insert(schema.alliances)
					.values(batch.alliancesSet.map((a) => ({ playerA: a.a, playerB: a.b })))
					.onConflictDoNothing();
			}
		});
	}

	async close(): Promise<void> {
		await this.client.end();
	}
}
