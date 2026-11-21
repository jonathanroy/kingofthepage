import type { Terrain } from "@kotp/shared/world";
import { describe, expect, it } from "vitest";
import { PLAYER_DIRECTIONS, playerFrame, WALK_FRAMES } from "./characters";
import { type GroundLookup, groundKey, hillMask, isPine, waterMask } from "./ground";
import { joinsFromMask, joinsMask, wantsPennant } from "./walls";

/** Tiny hand-drawn map: ~ water, ^ hill, T tree, anything else grass. Off-map is grass. */
function lookup(rows: string[]): GroundLookup {
	return {
		terrainAt: (x, y): Terrain => {
			const c = rows[y]?.[x];
			return c === "~" ? "water" : c === "^" ? "hill" : c === "T" ? "tree" : "grass";
		},
		mineAt: () => null,
	};
}

describe("ground keys", () => {
	it("marks the shore sides of a water tile", () => {
		const base = lookup(["...", ".~~", ".~~"]);
		// Water at (1,1): land north, west and north-west; water east, south, south-east.
		const mask = waterMask(base, 1, 1);
		expect(mask & 1).toBe(1); // n
		expect(mask & 2).toBe(0); // s
		expect(mask & 4).toBe(4); // w
		expect(mask & 8).toBe(0); // e
		expect(mask & 16).toBe(16); // nw
	});

	it("gives hills a cliff face only above lower ground", () => {
		const base = lookup(["^^", "^^", ".."]);
		expect(hillMask(base, 0, 0) & 8).toBe(0);
		expect(hillMask(base, 0, 1) & 8).toBe(8);
	});

	it("draws trees deep in a forest as pines, decided by base terrain", () => {
		const base = lookup([".T.", "TTT", ".T.", "..."]);
		expect(isPine(base, 1, 1)).toBe(true);
		expect(isPine(base, 1, 0)).toBe(false);
	});

	it("is stable per tile and keys fences on chopped forest as stumps", () => {
		const base = lookup(["T"]);
		const fence = {
			ownerId: "p",
			level: 1 as const,
			woodInvested: 2,
			ironInvested: 0,
			damage: 0,
			gate: false,
		};
		expect(groundKey({ kind: "grass" }, 3, 4, base)).toBe(groundKey({ kind: "grass" }, 3, 4, base));
		expect(groundKey({ kind: "fence", fence }, 0, 0, base)[0]).toBe("s");
		expect(groundKey({ kind: "fence", fence }, 5, 5, base)[0]).toBe("g");
		expect(groundKey({ kind: "mine", size: "large" }, 0, 0, base).slice(0, 2)).toBe("mL");
		expect(groundKey({ kind: "rubble" }, 0, 0, base)[0]).toBe("r");
	});

	it("shows how much is left in an ore rock in three sizes", () => {
		const base = lookup(["."]);
		const size = (remaining: number) =>
			groundKey({ kind: "ore", remaining, capacity: 90 }, 0, 0, base).slice(0, 2);
		expect(size(90)).toBe("o3");
		expect(size(45)).toBe("o2");
		expect(size(5)).toBe("o1");
	});
});

describe("wall joins", () => {
	it("round-trips through a mask", () => {
		for (let m = 0; m < 16; m++) expect(joinsMask(joinsFromMask(m))).toBe(m);
	});

	it("puts pennants on corners, ends and lone posts, not on straight runs", () => {
		expect(wantsPennant({ n: false, s: false, w: true, e: true })).toBe(false);
		expect(wantsPennant({ n: true, s: false, w: false, e: true })).toBe(true);
		expect(wantsPennant({ n: false, s: false, w: true, e: false })).toBe(true);
		expect(wantsPennant({ n: false, s: false, w: false, e: false })).toBe(true);
	});
});

describe("player frames", () => {
	it("gives every direction and step its own frame", () => {
		const frames = new Set<number>();
		for (const d of PLAYER_DIRECTIONS)
			for (let s = 0; s < WALK_FRAMES; s++) frames.add(playerFrame(d, s));
		expect(frames.size).toBe(PLAYER_DIRECTIONS.length * WALK_FRAMES);
		expect(playerFrame("down", 0)).toBe(0);
		expect(playerFrame("down", WALK_FRAMES)).toBe(0);
	});
});
