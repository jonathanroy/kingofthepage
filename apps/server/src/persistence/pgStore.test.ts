import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { PgStore } from "./pgStore";

// Runs only against a disposable database, e.g.:
// TEST_DATABASE_URL=postgres://kotp:kotp@localhost:5432/kotp_test pnpm test
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PgStore", () => {
	const store = new PgStore(url ?? "");
	afterAll(() => store.close());

	it("lets only one game server hold the world at a time", async () => {
		const first = new PgStore(url ?? "");
		const second = new PgStore(url ?? "");
		await first.acquireWorldLock(() => {});
		let waited = false;
		let acquired = false;
		const pending = second
			.acquireWorldLock(() => {
				waited = true;
			})
			.then(() => {
				acquired = true;
			});
		await new Promise((r) => setTimeout(r, 300));
		expect(waited).toBe(true);
		expect(acquired).toBe(false);
		await first.close();
		await pending;
		expect(acquired).toBe(true);
		await second.close();
	});

	it("migrates, writes a batch and loads it back", async () => {
		await store.migrate(fileURLToPath(new URL("../../drizzle", import.meta.url)));
		const id = crypto.randomUUID();
		const enclosureId = crypto.randomUUID();
		const player = {
			id,
			handle: `T${id.slice(0, 8)}`,
			tokenHash: `hash-${id}`,
			x: -5,
			y: 7,
			facing: "left" as const,
			wood: 3,
			gold: 1.5,
			createdAt: 1000,
			lastSeenAt: 2000,
		};
		await store.write({
			players: [player],
			fencesSet: [
				{ x: 900_001, y: 1, ownerId: id, level: 1, woodInvested: 2, damage: 1, gate: true },
			],
			fencesRemoved: [],
			chopsSet: [{ x: 900_002, y: 1, choppedAt: 1234 }],
			chopsRemoved: [],
			enclosuresAdded: [{ id: enclosureId, ownerId: id, createdAt: 5, anchorX: 1, anchorY: 2 }],
			enclosuresRemoved: [],
			alliancesSet: [],
			alliancesRemoved: [],
			minesSet: [],
			minesRemoved: [],
		});
		// Updating and removing in a second batch.
		await store.write({
			players: [{ ...player, wood: 9 }],
			fencesSet: [],
			fencesRemoved: [{ x: 900_001, y: 1 }],
			chopsSet: [{ x: 900_002, y: 1, choppedAt: 5678 }],
			chopsRemoved: [],
			enclosuresAdded: [],
			enclosuresRemoved: [enclosureId],
			alliancesSet: [],
			alliancesRemoved: [],
			minesSet: [],
			minesRemoved: [],
		});
		const snap = await store.load();
		expect(snap.players.find((p) => p.id === id)).toMatchObject({ wood: 9, facing: "left", x: -5 });
		expect(snap.fences.find((f) => f.x === 900_001)).toBeUndefined();
		expect(snap.chops.find((c) => c.x === 900_002)?.choppedAt).toBe(5678);
		expect(snap.enclosures.find((e) => e.id === enclosureId)).toBeUndefined();
	});
});
