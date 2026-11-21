import { C } from "./palette";
import { type Ctx, drawRows, px } from "./pixels";

/** Six sparkle frames, 7×7 each: grows, peaks, fades. */
export function drawSparkleSheet(ctx: Ctx): void {
	for (let f = 0; f < 6; f++) {
		const r = f < 3 ? f : 5 - f;
		const cx = f * 7 + 3,
			cy = 3;
		px(ctx, "#ffffff", cx, cy);
		for (let i = 1; i <= r; i++) {
			px(ctx, C.goldLight, cx - i, cy);
			px(ctx, C.goldLight, cx + i, cy);
			px(ctx, C.goldLight, cx, cy - i);
			px(ctx, C.goldLight, cx, cy + i);
		}
	}
}

export function drawLogIcon(ctx: Ctx): void {
	drawRows(
		ctx,
		["kkkkkk.", "kttttdk", "ktrrtdk", "kttttdk", "kkkkkk."],
		{ k: C.outline, t: C.trunk, d: C.trunkDark, r: C.stumpTop },
		0,
		0,
	);
}

export function drawIngotIcon(ctx: Ctx): void {
	drawRows(
		ctx,
		[".kkkkk.", "kLsssdk", "ksssddk", "kkkkkkk"],
		{ k: C.outline, L: C.ingotLight, s: C.ingot, d: C.ingotDark },
		0,
		0,
	);
}

export function drawCoinIcon(ctx: Ctx): void {
	drawRows(
		ctx,
		[".kkk.", "kyYyk", "kyyyk", "kyyyk", ".kkk."],
		{ k: C.outline, y: C.gold, Y: C.goldLight },
		0,
		0,
	);
}

/** 2×2 chip, light wood. */
export function drawChip(ctx: Ctx): void {
	px(ctx, C.stumpTop, 0, 0, 2, 2);
	px(ctx, C.trunk, 1, 1, 1, 1);
}

export function drawDust(ctx: Ctx): void {
	px(ctx, C.dust, 1, 0, 2, 1);
	px(ctx, C.dust, 0, 1, 4, 2);
}

/** A short water glint. */
export function drawGlint(ctx: Ctx): void {
	px(ctx, "#ffffff", 0, 0, 3, 1);
}
