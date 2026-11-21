import type Phaser from "phaser";
import { PALETTE } from "./palette";

export const TILE = 16;

/** Frame index of each tile kind in the "tiles" sheet. */
export const TILE_FRAME = { grass: 0, tree: 1, water: 2, hill: 3, stump: 4 } as const;

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

function stump(ctx: Ctx, ox: number): void {
	grass(ctx, ox);
	px(ctx, PALETTE.stump[1], ox + 5, 8, 6, 5);
	px(ctx, PALETTE.stump[0], ox + 6, 8, 4, 2);
}

/** Neutral light fence; tinted with the owner's color at draw time. */
function fence(ctx: Ctx): void {
	px(ctx, PALETTE.fence[1], 2, 2, 3, 13);
	px(ctx, PALETTE.fence[1], 11, 2, 3, 13);
	px(ctx, PALETTE.fence[0], 0, 5, 16, 2);
	px(ctx, PALETTE.fence[0], 0, 10, 16, 2);
	px(ctx, PALETTE.fence[0], 3, 1, 1, 13);
	px(ctx, PALETTE.fence[0], 12, 1, 1, 13);
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
	canvasTexture(scene, "tiles", TILE * 5, TILE, (ctx) => {
		grass(ctx, TILE * TILE_FRAME.grass);
		tree(ctx, TILE * TILE_FRAME.tree);
		water(ctx, TILE * TILE_FRAME.water);
		hill(ctx, TILE * TILE_FRAME.hill);
		stump(ctx, TILE * TILE_FRAME.stump);
	});
	canvasTexture(scene, "fence", TILE, TILE, fence);
	for (const f of FACINGS) canvasTexture(scene, `player-${f}`, TILE, TILE, (ctx) => player(ctx, f));
}
