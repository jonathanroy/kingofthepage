import type Phaser from "phaser";
import { PALETTE } from "./palette";

export const TILE = 16;

/** Frame index of each tile kind in the "tiles" sheet. */
export const TILE_FRAME = {
	grass: 0,
	tree: 1,
	water: 2,
	hill: 3,
	stump: 4,
	mineSmall: 5,
	mineLarge: 6,
} as const;

type Ctx = CanvasRenderingContext2D;

function px(ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1): void {
	ctx.fillStyle = color;
	ctx.fillRect(x, y, w, h);
}

function grass(ctx: Ctx, ox: number): void {
	px(ctx, PALETTE.grass[0], ox, 0, TILE, TILE);
	for (const [x, y] of [
		[2, 3],
		[9, 1],
		[13, 7],
		[5, 10],
		[11, 13],
		[1, 14],
	] as const) {
		px(ctx, PALETTE.grass[1], ox + x, y, 1, 2);
		px(ctx, PALETTE.grass[2], ox + x + 1, y + 1);
	}
}

function tree(ctx: Ctx, ox: number): void {
	grass(ctx, ox);
	px(ctx, PALETTE.forest[2], ox + 7, 11, 2, 4);
	px(ctx, PALETTE.forest[1], ox + 3, 2, 10, 9);
	px(ctx, PALETTE.forest[1], ox + 2, 4, 12, 5);
	px(ctx, PALETTE.forest[0], ox + 4, 3, 7, 6);
	px(ctx, PALETTE.grass[0], ox + 5, 4, 2, 1);
}

function water(ctx: Ctx, ox: number): void {
	px(ctx, PALETTE.water[0], ox, 0, TILE, TILE);
	px(ctx, PALETTE.water[2], ox + 2, 4, 4, 1);
	px(ctx, PALETTE.water[2], ox + 9, 10, 4, 1);
	px(ctx, PALETTE.water[1], ox + 6, 13, 3, 1);
}

function hill(ctx: Ctx, ox: number): void {
	px(ctx, PALETTE.hill[0], ox, 0, TILE, TILE);
	for (let i = 0; i < 4; i++) {
		px(ctx, PALETTE.hill[1], ox + 2 + i * 3, 12 - i * 3, 4, 1);
		px(ctx, PALETTE.hill[2], ox + 3 + i * 3, 11 - i * 3, 2, 1);
	}
}

/** A rocky mound with gold; large mines get more and bigger nuggets so they stand out. */
function mine(ctx: Ctx, ox: number, large: boolean): void {
	grass(ctx, ox);
	px(ctx, "#5a5a5a", ox + 2, 6, 12, 9);
	px(ctx, "#7a7a7a", ox + 3, 4, 10, 4);
	px(ctx, "#3a3a3a", ox + 6, 10, 4, 5);
	const nuggets = large
		? [
				[3, 6, 2],
				[10, 5, 3],
				[5, 11, 2],
				[11, 10, 2],
				[7, 4, 2],
			]
		: [
				[4, 7, 2],
				[10, 8, 2],
			];
	for (const [x, y, n] of nuggets as [number, number, number][]) {
		px(ctx, "#ffd60a", ox + x, y, n, n);
		px(ctx, "#fff3a0", ox + x, y, 1, 1);
	}
}

function stump(ctx: Ctx, ox: number): void {
	grass(ctx, ox);
	px(ctx, PALETTE.stump[1], ox + 5, 8, 6, 5);
	px(ctx, PALETTE.stump[0], ox + 6, 8, 4, 2);
}

// Fences are drawn light and neutral, then tinted with the owner's color at draw time.
// Each level must read differently at a glance (CLAUDE.md Client and art).

/** Level 1, twig fence: thin posts and rails. */
function fenceL1(ctx: Ctx): void {
	px(ctx, PALETTE.fence[1], 3, 3, 2, 12);
	px(ctx, PALETTE.fence[1], 11, 3, 2, 12);
	px(ctx, PALETTE.fence[0], 0, 6, 16, 1);
	px(ctx, PALETTE.fence[0], 0, 11, 16, 1);
}

/** Level 2, plank fence: wide boards. */
function fenceL2(ctx: Ctx): void {
	px(ctx, PALETTE.fence[1], 2, 2, 3, 13);
	px(ctx, PALETTE.fence[1], 11, 2, 3, 13);
	px(ctx, PALETTE.fence[0], 0, 4, 16, 3);
	px(ctx, PALETTE.fence[0], 0, 9, 16, 3);
	px(ctx, PALETTE.fence[1], 0, 6, 16, 1);
	px(ctx, PALETTE.fence[1], 0, 11, 16, 1);
}

/** Level 3, log palisade: tall vertical logs with pointed tops. */
function fenceL3(ctx: Ctx): void {
	for (let x = 0; x < 16; x += 4) {
		px(ctx, PALETTE.fence[0], x, 2, 4, 13);
		px(ctx, PALETTE.fence[1], x + 3, 2, 1, 13);
		px(ctx, PALETTE.fence[0], x + 1, 1, 2, 1);
	}
}

/** Level 4, reinforced palisade: logs with dark iron bands. */
function fenceL4(ctx: Ctx): void {
	fenceL3(ctx);
	px(ctx, "#404040", 0, 5, 16, 2);
	px(ctx, "#404040", 0, 11, 16, 2);
	for (let x = 1; x < 16; x += 4) px(ctx, "#a0a0a0", x, 5, 1, 1);
}

const FENCE_DRAWERS = [fenceL1, fenceL2, fenceL3, fenceL4] as const;

/** A gate: the level's fence with a doorway cut in the middle and dark hinges. */
function gate(ctx: Ctx, level: number): void {
	FENCE_DRAWERS[level - 1]?.(ctx);
	ctx.clearRect(5, 0, 6, 16);
	px(ctx, PALETTE.fence[1], 5, 3, 1, 12);
	px(ctx, PALETTE.fence[1], 10, 3, 1, 12);
	px(ctx, PALETTE.fence[0], 6, 7, 4, 1);
	px(ctx, "#202020", 5, 5, 1, 1);
	px(ctx, "#202020", 5, 12, 1, 1);
}

/** Cracks drawn over a damaged fence; alpha grows with damage. */
function cracks(ctx: Ctx): void {
	for (const [x, y, w, h] of [
		[4, 3, 1, 3],
		[5, 6, 1, 2],
		[6, 8, 1, 3],
		[11, 4, 1, 4],
		[10, 8, 1, 3],
		[12, 10, 1, 2],
	] as const) {
		px(ctx, "#1a0d00", x, y, w, h);
	}
}

const FACINGS = ["down", "up", "left", "right"] as const;

/** Light body so the owner tint reads clearly; eyes show facing. */
function player(ctx: Ctx, facing: (typeof FACINGS)[number]): void {
	px(ctx, "#202020", 4, 1, 8, 14);
	px(ctx, "#ffffff", 5, 2, 6, 12);
	px(ctx, "#f0f0f0", 3, 8, 10, 5);
	px(ctx, "#202020", 3, 13, 10, 1);
	const eyes: Record<typeof facing, [number, number][]> = {
		down: [
			[6, 5],
			[9, 5],
		],
		up: [],
		left: [[5, 5]],
		right: [[10, 5]],
	};
	for (const [x, y] of eyes[facing]) px(ctx, "#202020", x, y, 1, 2);
}

function canvasTexture(
	scene: Phaser.Scene,
	key: string,
	w: number,
	h: number,
	draw: (ctx: Ctx) => void,
): void {
	const tex = scene.textures.createCanvas(key, w, h);
	if (!tex) throw new Error(`Could not create texture ${key}`);
	draw(tex.getContext());
	tex.refresh();
}

export function createTextures(scene: Phaser.Scene): void {
	canvasTexture(scene, "tiles", TILE * 7, TILE, (ctx) => {
		grass(ctx, TILE * TILE_FRAME.grass);
		tree(ctx, TILE * TILE_FRAME.tree);
		water(ctx, TILE * TILE_FRAME.water);
		hill(ctx, TILE * TILE_FRAME.hill);
		stump(ctx, TILE * TILE_FRAME.stump);
		mine(ctx, TILE * TILE_FRAME.mineSmall, false);
		mine(ctx, TILE * TILE_FRAME.mineLarge, true);
	});
	FENCE_DRAWERS.forEach((draw, i) => {
		canvasTexture(scene, `fence-${i + 1}`, TILE, TILE, draw);
		canvasTexture(scene, `gate-${i + 1}`, TILE, TILE, (ctx) => gate(ctx, i + 1));
	});
	canvasTexture(scene, "cracks", TILE, TILE, cracks);
	for (const f of FACINGS) canvasTexture(scene, `player-${f}`, TILE, TILE, (ctx) => player(ctx, f));
}
