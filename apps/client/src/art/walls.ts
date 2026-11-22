import { C } from "./palette";
import { type Ctx, px } from "./pixels";

const T = 16;
/** Wall textures are taller than a tile so battlements and crowns can rise above it. */
export const WALL_TEX_HEIGHT = 20;
export const WALL_OVERHANG = WALL_TEX_HEIGHT - T;

/**
 * Which neighbors a wall piece joins: north, south, west, east, and diagonals. A diagonal join
 * is drawn only when the two tiles beside it aren't walls: fences touching at a corner close
 * an area (§5), so they should look joined too.
 */
export type WallJoins = {
	readonly n: boolean;
	readonly s: boolean;
	readonly w: boolean;
	readonly e: boolean;
	readonly ne?: boolean;
	readonly nw?: boolean;
	readonly se?: boolean;
	readonly sw?: boolean;
};

export function joinsMask(j: WallJoins): number {
	return (
		(j.n ? 1 : 0) |
		(j.s ? 2 : 0) |
		(j.w ? 4 : 0) |
		(j.e ? 8 : 0) |
		(j.ne ? 16 : 0) |
		(j.nw ? 32 : 0) |
		(j.se ? 64 : 0) |
		(j.sw ? 128 : 0)
	);
}

export function joinsFromMask(mask: number): WallJoins {
	return {
		n: !!(mask & 1),
		s: !!(mask & 2),
		w: !!(mask & 4),
		e: !!(mask & 8),
		ne: !!(mask & 16),
		nw: !!(mask & 32),
		se: !!(mask & 64),
		sw: !!(mask & 128),
	};
}

/**
 * Where a pennant goes: on corners, on loose ends and on lone posts, so a wall's owner is
 * visible along every run without flagging every tile.
 */
export function wantsPennant(j: WallJoins): boolean {
	const vertical = j.n || j.s;
	const horizontal = j.w || j.e;
	const diagonal = !!(j.ne || j.nw || j.se || j.sw);
	const links = [j.n, j.s, j.w, j.e, diagonal].filter(Boolean).length;
	return (vertical && horizontal) || diagonal || links <= 1;
}

/** Each diagonal join and the direction of the tile corner it runs toward. */
const DIAGONALS = [
	["ne", 1, -1],
	["nw", -1, -1],
	["se", 1, 1],
	["sw", -1, 1],
] as const;

/**
 * A stair-stepped run from the tile's center to one of its corners, so walls that touch their
 * neighbor only at a corner still look continuous.
 */
function drawDiagonals(ctx: Ctx, level: number, j: WallJoins, y0: number): void {
	const color =
		level <= 2
			? level === 1
				? C.wood
				: C.woodLight
			: level >= 9
				? C.steel
				: level >= 5
					? C.stone
					: C.wood;
	const dark =
		level <= 2 ? C.woodDark : level >= 9 ? C.steelDark : level >= 5 ? C.stoneDark : C.woodDark;
	const size = level <= 2 ? 2 : 4;
	const cx = 8;
	const cy = y0 + 8;
	for (const [key, dx, dy] of DIAGONALS) {
		if (!j[key]) continue;
		const steps = [0, 2, 4, 6, 8].map((i) => ({
			x: cx + dx * i - size / 2,
			y: cy + dy * i - size / 2,
		}));
		for (const { x, y } of steps) px(ctx, C.outline, x - 1, y - 1, size + 2, size + 2);
		for (const { x, y } of steps) {
			px(ctx, color, x, y, size, size);
			px(ctx, dark, x, y + size - 1, size, 1);
		}
	}
}

function fillMaterial(ctx: Ctx, level: number, x: number, y: number, w: number, h: number): void {
	if (level === 3 || level === 4) {
		for (let i = 0; i < w; i++) {
			const m = (i + x) % 3;
			px(ctx, m === 0 ? C.woodDark : m === 1 ? C.wood : C.woodLight, x + i, y, 1, h);
		}
		if (level === 4) {
			px(ctx, C.iron, x, y + 3, w, 2);
			px(ctx, C.iron, x, y + h - 4, w, 2);
		}
	} else if (level <= 8) {
		px(ctx, C.stone, x, y, w, h);
		const brick = level === 6 ? 3 : 4;
		for (let row = 0; row * brick < h; row++) {
			px(ctx, C.stoneDark, x, y + row * brick + brick - 1, w, 1);
			for (let i = (row % 2) * 3; i < w; i += 6)
				px(ctx, C.stoneDark, x + i, y + row * brick, 1, brick - 1);
		}
		if (level === 8) px(ctx, C.iron, x, y + 5, w, 2);
	} else {
		px(ctx, C.steel, x, y, w, h);
		px(ctx, C.steelDark, x, y + h - 2, w, 1);
		for (let i = 4; i < w; i += 6) px(ctx, C.steelDark, x + i, y, 1, h);
		if (level === 10) {
			px(ctx, C.royal, x, y, w, 2);
			px(ctx, C.royal, x, y + h - 3, w, 1);
		}
	}
}

/**
 * One wall piece in a 16×20 texture (tile occupies the bottom 16 rows), joined toward its
 * neighbors. Each level keeps a distinct silhouette so attackers can judge it at a glance.
 */
export function drawWall(ctx: Ctx, level: number, j: WallJoins): void {
	const y0 = WALL_OVERHANG;
	drawDiagonals(ctx, level, j, y0);
	if (level <= 2) {
		const rail = level === 1 ? 1 : 2;
		const color = level === 1 ? C.wood : C.woodLight;
		for (const ry of [7, 11]) {
			const x0 = j.w ? 0 : 7,
				x1 = j.e ? T : 9;
			px(ctx, C.outline, x0, y0 + ry - 1, x1 - x0, rail + 2);
			px(ctx, color, x0, y0 + ry, x1 - x0, rail);
		}
		const post = (py: number, ph: number) => {
			px(ctx, C.outline, 6, y0 + py - 1, 4, ph + 2);
			px(ctx, color, 7, y0 + py, 2, ph);
			px(ctx, C.woodDark, 8, y0 + py, 1, ph);
		};
		if (j.n) post(0, 6);
		if (j.s) post(10, 6);
		post(4, 12);
		return;
	}
	const top = 2;
	const parts: [number, number, number, number][] = [[5, y0 + top, 6, T - top]];
	if (j.w) parts.push([0, y0 + top, 6, T - top]);
	if (j.e) parts.push([10, y0 + top, 6, T - top]);
	if (j.n) parts.push([5, y0 - 1, 6, top + 2]);
	if (j.s) parts.push([5, y0 + top, 6, T - top]);
	for (const [x, y, w, h] of parts) px(ctx, C.outline, x - 1, y - 1, w + 2, h + 1);
	for (const [x, y, w, h] of parts) fillMaterial(ctx, level, x, y, w, h);
	if (level === 3 || level === 4) {
		for (const [x, , w] of parts)
			for (let i = 1; i < w; i += 3) px(ctx, C.outline, x + i, y0 + top - 1, 1, 1);
	}
	if (level === 7 || level === 8) {
		for (const [x, , w] of parts) {
			for (let i = 0; i < w; i += 4) {
				px(ctx, C.outline, x + i - 1, y0 + top - 3, 4, 3);
				px(ctx, C.stone, x + i, y0 + top - 2, 2, 2);
			}
		}
	}
	if (level === 10 && !j.n) {
		px(ctx, C.royal, 6, y0 + top - 3, 4, 2);
		px(ctx, C.royal, 6, y0 + top - 4, 1, 1);
		px(ctx, C.royal, 9, y0 + top - 4, 1, 1);
		px(ctx, C.royalGem, 7, y0 + top - 3, 2, 1);
	}
}

/** A gate: posts in the wall's material and a wooden door, closed or folded open. */
export function drawGate(ctx: Ctx, level: number, open: boolean): void {
	const y0 = WALL_OVERHANG;
	const postH = level >= 3 ? 14 : 12;
	const py = y0 + T - postH;
	const postColor = level >= 9 ? C.steel : level >= 5 ? C.stone : C.wood;
	const postDark = level >= 9 ? C.steelDark : level >= 5 ? C.stoneDark : C.woodDark;
	for (const gx of [1, 12]) {
		px(ctx, C.outline, gx - 1, py - 1, 5, postH + 1);
		px(ctx, postColor, gx, py, 3, postH);
		px(ctx, postDark, gx + 2, py, 1, postH);
	}
	if (level === 10) for (const gx of [1, 12]) px(ctx, C.royal, gx, py, 3, 2);
	if (open) {
		px(ctx, C.outline, 4, py + 1, 3, postH - 1);
		px(ctx, C.woodLight, 5, py + 2, 1, postH - 3);
		return;
	}
	const door = level >= 9 ? C.steel : C.woodLight;
	const doorDark = level >= 9 ? C.steelDark : C.woodDark;
	px(ctx, C.outline, 4, py + 2, 8, postH - 2);
	px(ctx, door, 5, py + 3, 6, postH - 4);
	px(ctx, doorDark, 5, py + 6, 6, 1);
	px(ctx, doorDark, 5, py + postH - 4, 6, 1);
	px(ctx, C.iron, 10, py + 7, 1, 2);
}

/** Pennant frames (2) side by side, 6×9 each, drawn white so the owner color tints it. */
export function drawPennantSheet(ctx: Ctx): void {
	for (let f = 0; f < 2; f++) {
		const x = f * 6;
		px(ctx, C.outline, x, 0, 1, 9);
		px(ctx, C.outline, x + 1, 0, 4, 5);
		px(ctx, "#ffffff", x + 1, 1, 3, 3);
		px(ctx, "#ffffff", x + 4, 1 + f, 1, 2);
	}
}

/** Cracks over a damaged wall; the scene raises their opacity as damage grows. */
export function drawCracks(ctx: Ctx): void {
	for (const [x, y, h] of [
		[6, 6, 3],
		[7, 9, 3],
		[9, 7, 4],
		[10, 11, 2],
		[4, 12, 2],
	] as const) {
		px(ctx, "#1a0d00", x, WALL_OVERHANG + y, 1, h);
	}
}
