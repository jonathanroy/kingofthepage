import type { Tile } from "@kotp/shared/rules";
import type { MineSize, Terrain } from "@kotp/shared/world";
import { C } from "./palette";
import { type Ctx, drawRows, px, tileHash } from "./pixels";

export const T = 16;
const GRASS_VARIANTS = 8;
const SHIMMER_VARIANTS = 4;

/** Base terrain around a tile; the client derives it from the world seed. */
export type GroundLookup = {
	terrainAt(x: number, y: number): Terrain;
	mineAt(x: number, y: number): MineSize | null;
};

// ---------- Keys ----------

/** Bits set where water borders land: n, s, w, e, then the diagonals nw, ne, sw, se. */
export function waterMask(base: GroundLookup, x: number, y: number): number {
	const land = (dx: number, dy: number) => (base.terrainAt(x + dx, y + dy) === "water" ? 0 : 1);
	return (
		land(0, -1) |
		(land(0, 1) << 1) |
		(land(-1, 0) << 2) |
		(land(1, 0) << 3) |
		(land(-1, -1) << 4) |
		(land(1, -1) << 5) |
		(land(-1, 1) << 6) |
		(land(1, 1) << 7)
	);
}

/** Bits for a hill tile's open sides: top, left, right, and a cliff face below. */
export function hillMask(base: GroundLookup, x: number, y: number): number {
	const open = (dx: number, dy: number) => (base.terrainAt(x + dx, y + dy) === "hill" ? 0 : 1);
	return open(0, -1) | (open(-1, 0) << 1) | (open(1, 0) << 2) | (open(0, 1) << 3);
}

/**
 * Trees deep in a forest are drawn as pines. Decided from base terrain, so chopping a
 * neighbor never changes how a tree looks.
 */
export function isPine(base: GroundLookup, x: number, y: number): boolean {
	let trees = 0;
	for (const [dx, dy] of [
		[0, -1],
		[0, 1],
		[-1, 0],
		[1, 0],
	] as const) {
		if (base.terrainAt(x + dx, y + dy) === "tree") trees++;
	}
	return trees >= 3;
}

/**
 * What a tile's ground looks like. Tiles with the same key draw identically, so each key is
 * drawn once and reused. Fences and players are separate sprites on top.
 */
export function groundKey(tile: Tile, x: number, y: number, base: GroundLookup): string {
	const v = Math.floor(tileHash(x, y) * GRASS_VARIANTS);
	switch (tile.kind) {
		case "grass":
			return `g${v}`;
		case "stump":
			return `s${v}`;
		case "fence":
			// Fences stand on grass, or on the stump of a chopped tree.
			return base.terrainAt(x, y) === "tree" ? `s${v}` : `g${v}`;
		case "tree":
			return `${isPine(base, x, y) ? "p" : "t"}${v}`;
		case "mine":
			return `m${tile.size === "large" ? "L" : "S"}${v}`;
		case "ore": {
			// Three sizes, so players can see how much is left in a rock at a glance.
			const left = tile.remaining / tile.capacity;
			return `o${left > 0.66 ? 3 : left > 0.33 ? 2 : 1}${v}`;
		}
		case "rubble":
			return `r${v}`;
		case "water":
			return `w${waterMask(base, x, y)}.${Math.floor(tileHash(x, y, 2) * SHIMMER_VARIANTS)}`;
		case "hill":
			return `h${hillMask(base, x, y)}.${v}`;
	}
}

// ---------- Drawing ----------

function grass(ctx: Ctx, variant: number): void {
	// One base green everywhere: per-tile shades read as a checkerboard at game zoom.
	px(ctx, C.grass, 0, 0, T, T);
	for (let i = 0; i < 3; i++) {
		const gx = 1 + Math.floor(tileHash(variant, i, 11) * 13);
		const gy = 1 + Math.floor(tileHash(variant, i, 12) * 13);
		px(ctx, C.grassDark, gx, gy, 1, 2);
		px(ctx, C.grassLight, gx + 1, gy, 1, 1);
	}
	// A quarter of the variants carry a flower.
	if (variant >= 6) {
		const fx = 4 + Math.floor(tileHash(variant, 0, 13) * 8);
		const fy = 4 + Math.floor(tileHash(variant, 0, 14) * 8);
		const petal = variant === 7 ? C.petalPink : C.petalWhite;
		px(ctx, petal, fx - 1, fy);
		px(ctx, petal, fx + 1, fy);
		px(ctx, petal, fx, fy - 1);
		px(ctx, petal, fx, fy + 1);
		px(ctx, C.petalCenter, fx, fy);
	}
}

const TREE = [
	"......kkkk......",
	"....kkLLLMkk....",
	"...kLLWWLLMMk...",
	"..kLLWWLLLMMDk..",
	"..kLLLLLLMMMDk..",
	".kLLLLLLMMMMMDk.",
	".kMLLLLMMMMMDDk.",
	".kMMLLMMMMMDDDk.",
	".kMMMMMMMMDDDDk.",
	"..kDMMMMMDDDDk..",
	"..kkDDDDDDDDkk..",
	"....kkkttdkk....",
	"......kttdk.....",
	".....kttttdk....",
	".....kkkkkkk....",
];
const PINE = [
	".......kk.......",
	"......kLLk......",
	".....kLLLMk.....",
	"....kLLLMMMk....",
	".....kLMMMk.....",
	"....kLLMMMMk....",
	"...kLLLMMMMDk...",
	"....kLMMMMDk....",
	"...kLLMMMMMDk...",
	"..kLLLMMMMMDDk..",
	"..kLMMMMMMDDDk..",
	"...kkDDDDDDkk...",
	"......kttk......",
	"......kttk......",
	".....kkkkkk.....",
];
const STUMP = [
	".....kkkkkk.....",
	"....ksssssdk....",
	"....ksrrrsdk....",
	"....kssssstk....",
	"....kttttttk....",
	".....kkkkkk.....",
];

function treeShadow(ctx: Ctx): void {
	ctx.globalAlpha = 0.22;
	px(ctx, C.outline, 3, 13, 10, 3);
	ctx.globalAlpha = 1;
}

export function mineRows(large: boolean): string[] {
	const rows = [
		"................",
		"......kkkk......",
		"....kkaaaakk....",
		"...kaaaaaaaak...",
		"..kaavaaaaabbk..",
		"..kaaaaaaabbbk..",
		".kaayaaaabbbbbk.",
		".kaaaattttbbbbk.",
		".kaaatkkkktbbck.",
		"kbaaatkkkktbycck",
		"kbbbbtkkkktbbcck",
		"kbybbtkkkktbbcck",
		"kccbbtkkkktbccck",
		".kccctkkkktccck.",
		"..kkkkkkkkkkkk..",
		"................",
	];
	if (large) {
		rows[4] = "..kaavaaayabbk..";
		rows[5] = "..kayaaaaabbbk..";
		rows[12] = "kccbbtkkkktbcyck";
	}
	return rows;
}

/** Iron ore rock: grey boulder with rusty veins, smaller as it's mined out (stage 3 → 1). */
const ORE_ROCKS: Record<number, string[]> = {
	3: [
		"......kkkk......",
		"....kkaaaakk....",
		"...kaavaaaabk...",
		"..kaaooaaaabbk..",
		"..kaaaaaoOobbk..",
		".kaoOaaaaabbbbk.",
		".kaooaaaoabbcbk.",
		".kaaaaaaoOobcck.",
		".kbaaoabbbbbcck.",
		"..kbbbbbooobck..",
		"...kccccccccck..",
		"....kkkkkkkkk...",
	],
	2: [
		".....kkkkk......",
		"...kkaavaakk....",
		"..kaaoOaaabbk...",
		"..kaaaaaaoobk...",
		".kaoaaaaabbbck..",
		".kaOoaabbooock..",
		"..kbbbbbbbcck...",
		"...kkkkkkkkk....",
	],
	1: [
		"......kkkk......",
		"....kkavaabk....",
		"...kaoOabbcck...",
		"...kbbbbooock...",
		"....kkkkkkkk....",
	],
};

function rubble(ctx: Ctx, variant: number): void {
	grass(ctx, variant);
	for (let i = 0; i < 4; i++) {
		const rx = 2 + Math.floor(tileHash(variant, i, 41) * 11);
		const ry = 4 + Math.floor(tileHash(variant, i, 42) * 9);
		px(ctx, C.outline, rx - 1, ry, 3, 2);
		px(ctx, i === 0 ? C.oreRust : C.rockMid, rx, ry, 1, 1);
	}
}

function water(ctx: Ctx, mask: number, shimmer: number): void {
	const n = mask & 1,
		s = mask & 2,
		w = mask & 4,
		e = mask & 8;
	px(ctx, C.water, 0, 0, T, T);
	for (let i = 0; i < 2; i++) {
		const sx = (Math.floor(tileHash(shimmer, i, 21) * 10) + i * 5) % 11;
		const sy = 3 + i * 7 + Math.floor(tileHash(shimmer, i, 22) * 3);
		px(ctx, C.waterLight, sx + 2, sy, 3, 1);
		px(ctx, C.waterDeep, ((sx + 7) % 11) + 2, sy + 2, 2, 1);
	}
	// Sand rim with a line of foam wherever the water meets land.
	const inner = n ? 3 : 0,
		innerEnd = T - (s ? 3 : 0);
	if (n) {
		px(ctx, C.sand, 0, 0, T, 3);
		px(ctx, C.foam, 0, 3, T, 1);
	}
	if (s) {
		px(ctx, C.sandDark, 0, T - 3, T, 3);
		px(ctx, C.foam, 0, T - 4, T, 1);
	}
	if (w) {
		px(ctx, C.sand, 0, 0, 3, T);
		px(ctx, C.foam, 3, inner, 1, innerEnd - inner);
	}
	if (e) {
		px(ctx, C.sandDark, T - 3, 0, 3, T);
		px(ctx, C.foam, T - 4, inner, 1, innerEnd - inner);
	}
	const round = (x: number, y: number, dx: number, dy: number) => {
		px(ctx, C.sand, x, y);
		px(ctx, C.sand, x + dx, y);
		px(ctx, C.sand, x, y + dy);
	};
	if (n && w) round(3, 3, 1, 1);
	if (n && e) round(T - 4, 3, -1, 1);
	if (s && w) round(3, T - 4, 1, -1);
	if (s && e) round(T - 4, T - 4, -1, -1);
	// Land touching only at a corner.
	if (!n && !w && mask & 16) px(ctx, C.sand, 0, 0, 2, 2);
	if (!n && !e && mask & 32) px(ctx, C.sand, T - 2, 0, 2, 2);
	if (!s && !w && mask & 64) px(ctx, C.sandDark, 0, T - 2, 2, 2);
	if (!s && !e && mask & 128) px(ctx, C.sandDark, T - 2, T - 2, 2, 2);
}

function hill(ctx: Ctx, mask: number, variant: number): void {
	px(ctx, C.plateau, 0, 0, T, T);
	// Texture so wide plateaus don't read as flat paint: tufts, and a pebble on some tiles.
	for (let i = 0; i < 3; i++) {
		const gx = 1 + Math.floor(tileHash(variant, i, 31) * 13);
		const gy = 1 + Math.floor(tileHash(variant, i, 32) * 11);
		px(ctx, C.plateauDark, gx, gy, 1, 2);
		px(ctx, C.plateauDark, gx + 2, gy + 1, 1, 1);
	}
	if (variant === 7) {
		const rx = 3 + Math.floor(tileHash(variant, 0, 33) * 9);
		const ry = 3 + Math.floor(tileHash(variant, 0, 34) * 6);
		// Soft pebble without an outline: outlined 4-pixel pebbles read as stray dots.
		px(ctx, C.rockMid, rx, ry, 3, 2);
		px(ctx, C.rockShine, rx, ry, 1, 1);
	}
	// Rim on the plateau's open edges: outline plus a light lip on top, darker sides.
	if (mask & 1) {
		px(ctx, C.outline, 0, 0, T, 1);
		px(ctx, C.grassLight, 0, 1, T, 1);
	}
	if (mask & 2) {
		px(ctx, C.outline, 0, 0, 1, T);
		px(ctx, C.plateauDark, 1, 0, 1, T);
	}
	if (mask & 4) {
		px(ctx, C.outline, T - 1, 0, 1, T);
		px(ctx, C.plateauDark, T - 2, 0, 1, T);
	}
	if (mask & 8) {
		// Cliff face where the hill drops to lower ground.
		px(ctx, C.cliff, 0, 7, T, 9);
		px(ctx, C.cliffMid, 0, 11, T, 5);
		for (let i = 0; i < 4; i++) px(ctx, C.cliffDark, 2 + i * 4, 9 + (i % 2) * 3, 1, 3);
		px(ctx, C.outline, 0, 7, T, 1);
		px(ctx, C.outline, 0, 15, T, 1);
	}
}

/** Draws the ground for `key` (from `groundKey`) into a 16×16 area at the origin. */
export function drawGround(ctx: Ctx, key: string): void {
	const kind = key[0];
	const v = Number(key.slice(kind === "m" ? 2 : 1).split(".")[0]);
	switch (kind) {
		case "g":
			grass(ctx, v);
			break;
		case "s":
			grass(ctx, v);
			drawRows(
				ctx,
				STUMP,
				{ k: C.outline, s: C.stumpTop, r: C.stumpRing, t: C.trunk, d: C.trunkDark },
				0,
				8,
			);
			break;
		case "t":
			grass(ctx, v);
			treeShadow(ctx);
			drawRows(
				ctx,
				TREE,
				{
					k: C.outline,
					L: C.leafLight,
					M: C.leafMid,
					D: C.leafDark,
					W: C.leafShine,
					t: C.trunk,
					d: C.trunkDark,
				},
				0,
				0,
			);
			break;
		case "p":
			grass(ctx, v);
			treeShadow(ctx);
			drawRows(
				ctx,
				PINE,
				{ k: C.outline, L: C.pineLight, M: C.pineMid, D: C.pineDark, t: C.trunk },
				0,
				0,
			);
			break;
		case "m": {
			grass(ctx, v);
			const map = {
				k: C.outline,
				a: C.rockLight,
				b: C.rockMid,
				c: C.rockDark,
				v: C.rockShine,
				y: C.gold,
				t: C.trunk,
			};
			drawRows(ctx, mineRows(key[1] === "L"), map, 0, 0);
			break;
		}
		case "o": {
			const stage = Number(key[1]);
			const rows = ORE_ROCKS[stage] ?? ORE_ROCKS[1] ?? [];
			grass(ctx, Number(key.slice(2)));
			treeShadow(ctx);
			const map = {
				k: C.outline,
				a: C.rockLight,
				b: C.rockMid,
				c: C.rockDark,
				v: C.rockShine,
				o: C.oreRust,
				O: C.oreRustLight,
			};
			drawRows(ctx, rows, map, 0, 15 - rows.length);
			break;
		}
		case "r":
			rubble(ctx, v);
			break;
		case "w": {
			const [mask, shimmer] = key.slice(1).split(".").map(Number) as [number, number];
			water(ctx, mask, shimmer);
			break;
		}
		case "h": {
			const [mask, variant] = key.slice(1).split(".").map(Number) as [number, number];
			hill(ctx, mask, variant);
			break;
		}
	}
}
