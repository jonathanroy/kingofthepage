import { C } from "./palette";
import { type Ctx, drawRows, px } from "./pixels";

export type CreatureSprite = "rabbit" | "deer" | "bear";

/** Side views facing left, two walk frames each; the scene mirrors them to face right. */
const SPRITES: Record<CreatureSprite, string[][]> = {
	rabbit: [
		[
			"................",
			"................",
			"................",
			"....kk..........",
			"...kWk.kk.......",
			"...kWkkWk.......",
			"..kWWWWWk.......",
			".kWeWWWWWkkk....",
			".kWWWWWWWWWWk...",
			"..kkWWWWWWSWk...",
			"....kSWWWSSkWk..",
			"....kSkkkSkkkk..",
			"....kk...kk.....",
		],
		[
			"................",
			"................",
			"................",
			"................",
			"....kk..........",
			"...kWk.kk.......",
			"...kWkkWk.......",
			"..kWWWWWk.......",
			".kWeWWWWWkkk....",
			".kWWWWWWWWWWk...",
			"..kkWWWWWWSWWk..",
			"....kSkkkkSkkk..",
			"...kk.....kk....",
		],
	],
	deer: [
		[
			"..a...a.........",
			"..aa.aa.........",
			"...aaa..........",
			"...kkk..........",
			"..kDDDk.........",
			".kDeDDk.........",
			".kDDDDkkkkkkk...",
			"..kkDDDDDDDDDk..",
			"....kDDDDDDDSDk.",
			"....kBBBBBBBSk..",
			"....kDk..kDkSk..",
			"....kDk..kDk....",
			"....kk...kk.....",
		],
		[
			"..a...a.........",
			"..aa.aa.........",
			"...aaa..........",
			"...kkk..........",
			"..kDDDk.........",
			".kDeDDk.........",
			".kDDDDkkkkkkk...",
			"..kkDDDDDDDDDk..",
			"....kDDDDDDDSDk.",
			"....kBBBBBBBSk..",
			"...kDk....kDkk..",
			"..kDk......kDk..",
			"..kk........kk..",
		],
	],
	bear: [
		[
			"...kk...........",
			"..kGGkkkkk......",
			".kGeGGGGGGkk....",
			"kGGGGGGGGGGGk...",
			"kNGGGGGGWGGGGk..",
			".kkGGGGGGGGGGGk.",
			"..kGGGGGGGWGGGk.",
			"..kGGGGGGGGGGGk.",
			"..kSSGGGGGGSSGk.",
			"..kSSkkkkkkSSkk.",
			"..kDk.....kDk...",
			"..kkk.....kkk...",
		],
		[
			"...kk...........",
			"..kGGkkkkk......",
			".kGeGGGGGGkk....",
			"kGGGGGGGGGGGk...",
			"kNGGGGGGWGGGGk..",
			".kkGGGGGGGGGGGk.",
			"..kGGGGGGGWGGGk.",
			"..kGGGGGGGGGGGk.",
			"..kSSGGGGGGSSGk.",
			".kSSkkkkkkkSSk..",
			".kDk.......kDk..",
			".kkk.......kkk..",
		],
	],
};

const MAPS: Record<CreatureSprite, Record<string, string>> = {
	rabbit: { k: C.outline, W: C.rabbit, S: C.rabbitShade, e: C.outline },
	deer: { k: C.outline, D: C.deer, S: C.deerShade, B: C.deerBelly, a: C.antler, e: C.outline },
	bear: {
		k: C.outline,
		G: C.bear,
		S: C.bearShade,
		D: C.bearDark,
		N: C.bearDark,
		e: C.bearEye,
		W: C.bearWound,
	},
};

export const CREATURE_FRAMES = 2;

/** A 32×16 sheet: two walk frames, facing left. */
export function drawCreatureSheet(ctx: Ctx, kind: CreatureSprite): void {
	SPRITES[kind].forEach((rows, frame) => {
		ctx.globalAlpha = 0.25;
		px(ctx, C.outline, frame * 16 + 3, 14, 10, 2);
		ctx.globalAlpha = 1;
		drawRows(ctx, rows, MAPS[kind], frame * 16, 16 - rows.length - 1);
	});
}

/** Spear pointing toward +x, 12×4. */
export function drawSpear(ctx: Ctx): void {
	px(ctx, C.outline, 0, 1, 9, 2);
	px(ctx, C.trunk, 0, 1, 8, 1);
	px(ctx, C.outline, 8, 0, 4, 4);
	px(ctx, "#cfd8e3", 9, 1, 2, 2);
	px(ctx, "#ffffff", 9, 1, 1, 1);
}
