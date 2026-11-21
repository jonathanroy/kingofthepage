// Small drawing helpers shared by every sprite. Plain canvas 2D, no Phaser, so the art can be
// previewed or replaced by hand-drawn sheets without touching game code.

export type Ctx = CanvasRenderingContext2D;

export function px(ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1): void {
	ctx.fillStyle = color;
	ctx.fillRect(x, y, w, h);
}

/**
 * Draws a sprite written as rows of palette keys. "." is transparent; keys missing from
 * `map` are skipped. `flip` mirrors it horizontally (right-facing from left-facing art).
 */
export function drawRows(
	ctx: Ctx,
	rows: readonly string[],
	map: Readonly<Record<string, string>>,
	x: number,
	y: number,
	flip = false,
): void {
	rows.forEach((row, ry) => {
		for (let rx = 0; rx < row.length; rx++) {
			const color = map[row[rx] ?? "."];
			if (!color) continue;
			px(ctx, color, flip ? x + row.length - 1 - rx : x + rx, y + ry);
		}
	});
}

/** Stable per-tile randomness for cosmetic variation (grass shades, flowers). */
export function tileHash(x: number, y: number, salt = 0): number {
	let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 1274126177)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

export function context(canvas: HTMLCanvasElement): Ctx {
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas 2D is not available");
	ctx.imageSmoothingEnabled = false;
	return ctx;
}

/** Darker shade of a #rrggbb color, for owner-colored outlines and borders. */
export function shade(hex: string, factor: number): string {
	const n = Number.parseInt(hex.slice(1), 16);
	const ch = (s: number) => Math.round(((n >> s) & 255) * factor);
	return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}
