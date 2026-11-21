import type { Direction } from "@kotp/shared/world";
import { C } from "./palette";
import { type Ctx, drawRows, px, shade } from "./pixels";

/** Frame order in a player sheet: four directions, four walk frames each. */
export const PLAYER_DIRECTIONS: readonly Direction[] = ["down", "left", "right", "up"];
export const WALK_FRAMES = 4;

export function playerFrame(dir: Direction, step: number): number {
	return PLAYER_DIRECTIONS.indexOf(dir) * WALK_FRAMES + (step % WALK_FRAMES);
}

/** Chibi player, 16×16: owner color on the hat (H, h) and scarf (S). */
function playerRows(dir: Direction, step: number): string[] {
	const hat = [
		"................",
		".....kkkkkk.....",
		"....kHHHHHHk....",
		"...kHHwHHHHHk...",
		"..kkhhhhhhhhkk..",
	];
	const face =
		dir === "down"
			? [
					"..kbffffffffbk..",
					"..kffkffffkffk..",
					"..kffkffffkffk..",
					"..kfpffffffpfk..",
					"...kffffmfffk...",
				]
			: dir === "up"
				? [
						"..kbbbbbbbbbbk..",
						"..kbbbbbbbbbbk..",
						"..kbbbbbbbbbbk..",
						"..kfbbbbbbbbfk..",
						"...kbbbbbbbbk...",
					]
				: [
						"..kffffffbbbbk..",
						"..kfkffffbbbbk..",
						"..kfkffffbbbbk..",
						"..kffpfffbbbbk..",
						"...kffffbbbbk...",
					];
	const body = [
		"....kkkkkkkk....",
		dir === "up" ? "...kSSSSSSSSk..." : "...kSSSccSSSk...",
		"..kfkSSSSSSkfk..",
		"...kcccccccck...",
	];
	const legs =
		[
			["....knnkknnk....", "....kkk..kkk...."],
			["....knnk.knk....", "....kkk...k....."],
			["....knnkknnk....", "....kkk..kkk...."],
			["....knk.knnk....", ".....k...kkk...."],
		][step % WALK_FRAMES] ?? [];
	return [...hat, ...face, ...body, ...legs];
}

function drawPlayer(ctx: Ctx, x: number, dir: Direction, step: number, main: string): void {
	const map = {
		k: C.outline,
		H: main,
		h: shade(main, 0.75),
		S: main,
		w: "#ffffff",
		b: C.hair,
		f: C.skin,
		p: C.blush,
		m: C.mouth,
		c: C.tunic,
		n: C.boots,
	};
	ctx.globalAlpha = 0.25;
	px(ctx, C.outline, x + 4, 14, 8, 2);
	ctx.globalAlpha = 1;
	// Stepping frames bob up a pixel.
	drawRows(ctx, playerRows(dir, step), map, x, step % 2 === 1 ? -1 : 0, dir === "right");
}

/** A 256×16 sheet: 16 frames ordered by `playerFrame`, colored for one owner. */
export function drawPlayerSheet(ctx: Ctx, ownerColor: string): void {
	PLAYER_DIRECTIONS.forEach((dir) => {
		for (let step = 0; step < WALK_FRAMES; step++) {
			drawPlayer(ctx, playerFrame(dir, step) * 16, dir, step, ownerColor);
		}
	});
}

/** Axe held out in front while chopping: 8×8, blade toward +x. */
export function drawAxe(ctx: Ctx): void {
	px(ctx, C.outline, 0, 3, 6, 2);
	px(ctx, C.trunk, 1, 3, 4, 1);
	px(ctx, C.outline, 4, 0, 4, 7);
	px(ctx, "#cfd8e3", 5, 1, 2, 5);
	px(ctx, "#ffffff", 5, 1, 1, 2);
}

export function drawHeart(ctx: Ctx): void {
	drawRows(
		ctx,
		[".kk.kk.", "kppkppk", "kpppppk", ".kpppk.", "..kpk..", "...k..."],
		{ k: C.outline, p: C.heart },
		0,
		0,
	);
}
