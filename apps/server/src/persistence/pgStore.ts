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

/**
 * Arbitrary constant naming the "one game server owns the world" lock. Advisory locks are
 * per database, so different worlds in different databases don't interfere.
 */
const WORLD_LOCK_KEY = 4_839_201_771;

export class PgStore implements WorldStore {
	private readonly client: postgres.Sql;
	private lockHolder: postgres.ReservedSql | null = null;
	private readonly db;

	constructor(databaseUrl: string) {
		// Postgres NOTICEs (e.g. "relation already exists, skipping" on each migration check)
		// are informational; real problems arrive as errors.
		this.client = postgres(databaseUrl, { max: 4, onnotice: () => {} });
		this.db = drizzle(this.client, { schema });
	}

	async migrate(migrationsFolder: string): Promise<void> {
		await migrate(this.db, { migrationsFolder });
	}

	async load(): Promise<WorldSnapshot> {
		const [players, fences, chops, ore, enclosures, alliances, mines] = await Promise.all([
			this.db.select().from(schema.players),
			this.db.select().from(schema.fences),
			this.db.select().from(schema.choppedTrees),
			this.db.select().from(schema.oreMined),
			this.db.select().from(schema.enclosures),
			this.db.select().from(schema.alliances),
			this.db.select().from(schema.mines),
		]);
		return {
			players: players.map((p) => ({ ...p, facing: toDirection(p.facing) })),
			fences,
			chops,
			ore,
			enclosures,
			alliances: alliances.map((a) => ({ a: a.playerA, b: a.playerB })),
			mines,
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
							ironInvested: sql`excluded.iron_invested`,
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
			if (batch.oreSet.length > 0) {
				await tx
					.insert(schema.oreMined)
					.values([...batch.oreSet])
					.onConflictDoUpdate({
						target: [schema.oreMined.x, schema.oreMined.y],
						set: { mined: sql`excluded.mined` },
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
			for (const m of batch.minesRemoved) {
				await tx.delete(schema.mines).where(and(eq(schema.mines.x, m.x), eq(schema.mines.y, m.y)));
			}
			if (batch.minesSet.length > 0) {
				await tx
					.insert(schema.mines)
					.values([...batch.minesSet])
					.onConflictDoUpdate({
						target: [schema.mines.x, schema.mines.y],
						set: {
							controllerId: sql`excluded.controller_id`,
							controlledSince: sql`excluded.controlled_since`,
						},
					});
			}
		});
	}

	/**
	 * Waits until no other game server holds the world, then holds it until `close()`.
	 * The world lives in memory, so two servers on one database (a deploy that starts the new
	 * server before stopping the old one, or a mistake) would overwrite each other's changes.
	 * The lock belongs to one dedicated connection; if the process dies, Postgres releases it.
	 */
	async acquireWorldLock(onWait: () => void): Promise<void> {
		const conn = await this.client.reserve();
		const [row] = await conn`select pg_try_advisory_lock(${WORLD_LOCK_KEY}::bigint) as locked`;
		if (!row?.locked) {
			onWait();
			await conn`select pg_advisory_lock(${WORLD_LOCK_KEY}::bigint)`;
		}
		this.lockHolder = conn;
	}

	async close(): Promise<void> {
		// Called after the final flush, so the next server loads everything this one wrote.
		if (this.lockHolder) {
			await this.lockHolder`select pg_advisory_unlock(${WORLD_LOCK_KEY}::bigint)`;
			this.lockHolder.release();
			this.lockHolder = null;
		}
		await this.client.end();
	}
}
