import type Phaser from "phaser";
import { drawAxe, drawPlayerSheet, PLAYER_DIRECTIONS, WALK_FRAMES } from "../art/characters";
import { CREATURE_FRAMES, drawCreatureSheet, drawSpear } from "../art/creatures";
import {
	drawAppleIcon,
	drawBerriesIcon,
	drawChip,
	drawCoinIcon,
	drawDust,
	drawGlint,
	drawIngotIcon,
	drawLogIcon,
	drawMeatIcon,
	drawPotatoIcon,
	drawSparkleSheet,
} from "../art/effects";
import { drawGround, T } from "../art/ground";
import { type Ctx, context, makeCanvas } from "../art/pixels";
import {
	drawCracks,
	drawGate,
	drawPennantSheet,
	drawWall,
	joinsFromMask,
	WALL_TEX_HEIGHT,
} from "../art/walls";

export const TILE = T;

/**
 * Registers a canvas as a texture, optionally split into equal frames named 0, 1, 2...
 * Every sprite is drawn in code today; a hand-drawn PNG sheet with the same layout can
 * replace any of them later.
 */
function addCanvasTexture(
	scene: Phaser.Scene,
	key: string,
	width: number,
	height: number,
	draw: (ctx: Ctx) => void,
	frameWidth?: number,
): void {
	if (scene.textures.exists(key)) return;
	const canvas = makeCanvas(width, height);
	draw(context(canvas));
	const tex = scene.textures.addCanvas(key, canvas);
	if (!tex || !frameWidth) return;
	for (let i = 0; i * frameWidth < width; i++) tex.add(i, 0, i * frameWidth, 0, frameWidth, height);
}

/** Textures and animations that don't depend on any player. */
export function createStaticTextures(scene: Phaser.Scene): void {
	addCanvasTexture(scene, "sparkle", 42, 7, drawSparkleSheet, 7);
	addCanvasTexture(scene, "pennant", 12, 9, drawPennantSheet, 6);
	addCanvasTexture(scene, "cracks", TILE, WALL_TEX_HEIGHT, drawCracks);
	addCanvasTexture(scene, "log", 7, 5, drawLogIcon);
	addCanvasTexture(scene, "coin", 5, 5, drawCoinIcon);
	addCanvasTexture(scene, "ingot", 7, 4, drawIngotIcon);
	addCanvasTexture(scene, "food-apple", 7, 6, drawAppleIcon);
	addCanvasTexture(scene, "food-berries", 7, 6, drawBerriesIcon);
	addCanvasTexture(scene, "food-potato", 7, 6, drawPotatoIcon);
	addCanvasTexture(scene, "food-meat", 7, 6, drawMeatIcon);
	addCanvasTexture(scene, "spear", 12, 4, drawSpear);
	for (const kind of ["rabbit", "deer", "bear"] as const) {
		addCanvasTexture(
			scene,
			`creature-${kind}`,
			TILE * CREATURE_FRAMES,
			TILE,
			(ctx) => drawCreatureSheet(ctx, kind),
			TILE,
		);
	}
	addCanvasTexture(scene, "chip", 2, 2, drawChip);
	addCanvasTexture(scene, "dust", 4, 3, drawDust);
	addCanvasTexture(scene, "glint", 3, 1, drawGlint);
	addCanvasTexture(scene, "axe", 8, 8, drawAxe);
	const frames = (key: string, count: number) =>
		Array.from({ length: count }, (_, i) => ({ key, frame: i }));
	if (!scene.anims.exists("sparkle")) {
		scene.anims.create({
			key: "sparkle",
			frames: frames("sparkle", 6),
			frameRate: 12,
			repeat: -1,
			repeatDelay: 1400,
		});
	}
	if (!scene.anims.exists("pennant")) {
		scene.anims.create({ key: "pennant", frames: frames("pennant", 2), frameRate: 3, repeat: -1 });
	}
}

/** A walk-cycle sheet for one owner color (`playerFrame` picks the frame). */
export function playerSheet(scene: Phaser.Scene, ownerHex: string): string {
	const key = `player-${ownerHex}`;
	const count = PLAYER_DIRECTIONS.length * WALK_FRAMES;
	addCanvasTexture(scene, key, TILE * count, TILE, (ctx) => drawPlayerSheet(ctx, ownerHex), TILE);
	return key;
}

export function wallTexture(scene: Phaser.Scene, level: number, joinMask: number): string {
	const key = `wall-${level}-${joinMask}`;
	addCanvasTexture(scene, key, TILE, WALL_TEX_HEIGHT, (ctx) =>
		drawWall(ctx, level, joinsFromMask(joinMask)),
	);
	return key;
}

export function gateTexture(scene: Phaser.Scene, level: number, open: boolean): string {
	const key = `gate-${level}-${open ? "open" : "shut"}`;
	addCanvasTexture(scene, key, TILE, WALL_TEX_HEIGHT, (ctx) => drawGate(ctx, level, open));
	return key;
}

/** Ground tiles by `groundKey`, each drawn once on first use. */
export class GroundTiles {
	private readonly cache = new Map<string, HTMLCanvasElement>();

	get(key: string): HTMLCanvasElement {
		let canvas = this.cache.get(key);
		if (!canvas) {
			canvas = makeCanvas(TILE, TILE);
			drawGround(context(canvas), key);
			this.cache.set(key, canvas);
		}
		return canvas;
	}
}
