import { fileURLToPath } from "node:url";
import { emptyPantry } from "@kotp/shared/rules";
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
			passwordHash: "scrypt$16384$8$1$c2FsdA==$a2V5" as string | null,
			x: -5,
			y: 7,
			facing: "left" as const,
			wood: 3,
			iron: 7,
			gold: 1.5,
			health: 80,
			food: 55.5,
			water: 40,
			pantry: { ...emptyPantry(), apple: { count: 2, spoil: 1000 } },
			hasSpear: true,
			tool: "spear" as const,
			goldSpent: 21_600,
			bearDueIn: 123_456 as number | null,
			owned: ["straw-hat"],
			look: { hat: "straw-hat" },
			createdAt: 1000,
			lastSeenAt: 2000,
		};
		await store.write({
			players: [player],
			fencesSet: [
				{
					x: 900_001,
					y: 1,
					ownerId: id,
					level: 1,
					woodInvested: 2,
					ironInvested: 4,
					damage: 1,
					gate: true,
				},
			],
			fencesRemoved: [],
			chopsSet: [{ x: 900_002, y: 1, choppedAt: 1234 }],
			chopsRemoved: [],
			oreSet: [{ x: 900_003, y: 1, mined: 12 }],
			forageSet: [{ x: 900_004, y: 1, harvestedAt: 4321 }],
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
			oreSet: [{ x: 900_003, y: 1, mined: 30 }],
			forageSet: [],
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
		expect(snap.ore.find((o) => o.x === 900_003)?.mined).toBe(30);
		expect(snap.forage.find((f) => f.x === 900_004)?.harvestedAt).toBe(4321);
		expect(snap.players.find((p) => p.id === id)).toMatchObject({
			iron: 7,
			food: 55.5,
			hasSpear: true,
			tool: "spear",
			pantry: { apple: { count: 2, spoil: 1000 } },
			goldSpent: 21_600,
			bearDueIn: 123_456 as number | null,
			owned: ["straw-hat"],
			look: { hat: "straw-hat" },
		});
		expect(snap.enclosures.find((e) => e.id === enclosureId)).toBeUndefined();
	});
});
