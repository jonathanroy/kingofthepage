import { C } from "./palette";
import { type Ctx, drawRows, px } from "./pixels";

// §10 collectibles. Overlays line up with the chibi player (art/characters.ts): hats cover
// the owner-colored hat, capes sit behind the body. Hats get 4 extra rows on top so tall
// ones (the wizard hat) can rise above the tile.

export const HAT_OVERHANG = 4;
const HAT_H = 16 + HAT_OVERHANG;

const GOLD = "#ffd23f";
const GOLD_DARK = "#d4961c";
const PURPLE = "#7b4fd6";
const PURPLE_DARK = "#4f2fa0";

const HATS: Record<string, { rows: string[]; map: Record<string, string> }> = {
	"straw-hat": {
		rows: [
			".....kkkkkk.....",
			"....kyyyyyyk....",
			"...kyyyYyyyyk...",
			"...kkrrrrrrkk...",
			".kkyyyyyyyyyykk.",
			"kyyyyyyyyyyyyyyk",
			".kkkkkkkkkkkkkk.",
		],
		map: { k: C.outline, y: "#f2d27a", Y: "#fff0b0", r: "#c8663a" },
	},
	"flower-crown": {
		rows: ["..kk.kkk.kkk.kk.", ".kpk.kwk.kyk.kpk", "..kgggggggggggk.", "..kkkkkkkkkkkkk."],
		map: { k: C.outline, p: C.petalPink, w: C.petalWhite, y: C.petalCenter, g: C.leafMid },
	},
	"wizard-hat": {
		rows: [
			"..........kk....",
			".........kpk....",
			"........kppk....",
			".......kppsk....",
			"......kpppk.....",
			".....kpsppk.....",
			"....kppppppk....",
			"...kppppspppk...",
			"..kkpppppppppkk.",
			".kppppppppppppk.",
			"..kkkkkkkkkkkk..",
		],
		map: { k: C.outline, p: PURPLE, s: GOLD },
	},
	"golden-crown": {
		rows: [
			"...k..k..k..k...",
			"..kgk.kgkkgk.kg.",
			"..kgggggggggggk.",
			"..kgrgggbgggrgk.",
			"..kgggggggggggk.",
			"..kkkkkkkkkkkkk.",
		],
		map: { k: C.outline, g: GOLD, r: C.royalGem, b: "#4fd1e8" },
	},
};

/** A 16×20 hat overlay; `top` is the row where the base of the hat should sit. */
export function drawHat(ctx: Ctx, id: string): void {
	const hat = HATS[id];
	if (!hat) return;
	const bottom = HAT_OVERHANG + 5; // just above the eyes
	drawRows(ctx, hat.rows, hat.map, 0, bottom - hat.rows.length);
}

export function hatHeight(): number {
	return HAT_H;
}

const CAPES: Record<string, { main: string; dark: string; trim?: string }> = {
	"red-cape": { main: "#e8423f", dark: "#a8262a" },
	"royal-cape": { main: PURPLE, dark: PURPLE_DARK, trim: "#ffffff" },
};

/** A 16×16 cape behind the body: shoulders to ankles, wider than the body so it shows. */
export function drawCape(ctx: Ctx, id: string): void {
	const cape = CAPES[id];
	if (!cape) return;
	// Wider than the body (x 4-11) so its edges show from the front.
	px(ctx, C.outline, 1, 8, 14, 7);
	px(ctx, cape.main, 2, 8, 12, 6);
	px(ctx, cape.dark, 2, 11, 12, 3);
	if (cape.trim) {
		px(ctx, cape.trim, 2, 13, 12, 1);
		for (let x = 3; x < 14; x += 3) px(ctx, C.outline, x, 13, 1, 1);
	}
}

const PETS: Record<string, { frames: string[][]; map: Record<string, string> }> = {
	"pet-chick": {
		frames: [
			["....kkk.", "...kyyyk", "..kyeyyk", ".okyyyyk", "..kyyyk.", "...kkk..", "...o.o.."],
			["....kkk.", "...kyyyk", "..kyeyyk", ".okyyyyk", "..kyyyk.", "...kkk..", "..o...o."],
		],
		map: { k: C.outline, y: "#ffe066", e: C.outline, o: "#ff9f43" },
	},
	"pet-fox": {
		frames: [
			[
				".k...k....",
				"kok.kok...",
				"koooook...",
				"kowooek...",
				".koooookkk",
				"..koooooowk",
				"..kok.kok.",
			],
			[
				".k...k....",
				"kok.kok...",
				"koooook...",
				"kowooek...",
				".koooookkk",
				"..koooooowk",
				".kok...kok",
			],
		],
		map: { k: C.outline, o: "#ff8c3a", w: "#fff6e6", e: C.outline },
	},
	"pet-dragon": {
		frames: [
			[
				"....kk..kk.",
				"...kwwkkwwk",
				"..kggkwwwk.",
				".kgeggkkk..",
				"kggggggk...",
				".kgbbggggk.",
				"..kgk.kgk..",
			],
			[
				"...kk....kk",
				"..kwwk..kww",
				"..kggkkwwk.",
				".kgeggkkk..",
				"kggggggk...",
				".kgbbggggk.",
				".kgk...kgk.",
			],
		],
		map: { k: C.outline, g: "#5fc08a", b: "#c8f0d8", w: "#b07cff", e: "#ff3b3b" },
	},
};

export const PET_FRAMES = 2;

/** A 32×16 sheet: two hop frames of a small pet, facing left. */
export function drawPetSheet(ctx: Ctx, id: string): void {
	const pet = PETS[id];
	if (!pet) return;
	pet.frames.forEach((rows, f) => {
		ctx.globalAlpha = 0.25;
		px(ctx, C.outline, f * 16 + 4, 14, 8, 1);
		ctx.globalAlpha = 1;
		drawRows(ctx, rows, pet.map, f * 16 + 3, 14 - rows.length - (f === 1 ? 1 : 0));
	});
}

/** Gold crowned pennant frames (2), 6×9 each, for walls of a royal banner owner. */
export function drawRoyalPennantSheet(ctx: Ctx): void {
	for (let f = 0; f < 2; f++) {
		const x = f * 6;
		px(ctx, C.outline, x, 0, 1, 9);
		px(ctx, C.outline, x + 1, 0, 5, 6);
		px(ctx, GOLD, x + 1, 1, 4, 4);
		px(ctx, C.royalGem, x + 2, 2, 2, 1);
		px(ctx, GOLD_DARK, x + 4, 3 + f, 1, 1);
	}
}

/** The magic shop: a purple tent with stars and a hanging lantern, 16×16. */
export function drawShopTent(ctx: Ctx): void {
	drawRows(
		ctx,
		[
			".......kk.......",
			"......kppk......",
			".....kpppsk.....",
			"....kpsppppk....",
			"...kpppppsppk...",
			"..kppspppppppk..",
			".kpppppppsppppk.",
			"kkkkkkkkkkkkkkkk",
			".kPPPPkddkPPPPk.",
			".kPsPPkddkPPsPk.",
			".kPPPPkddkPPPPk.",
			".kPPPPkddkPPPPk.",
			".kkkkkkkkkkkkkk.",
		],
		{ k: C.outline, p: PURPLE, P: PURPLE_DARK, s: GOLD, d: "#2b2233" },
		0,
		2,
	);
	// Lantern by the door.
	px(ctx, C.outline, 12, 9, 3, 4);
	px(ctx, "#fff3b0", 13, 10, 1, 2);
}

/** A 16×16 preview of any collectible, for the shop and the wardrobe. */
export function drawItemPreview(ctx: Ctx, id: string, slot: string): void {
	if (slot === "hat") {
		const hat = HATS[id];
		if (hat) drawRows(ctx, hat.rows, hat.map, 0, Math.max(0, 12 - hat.rows.length));
	} else if (slot === "cape") {
		const cape = CAPES[id];
		if (cape) {
			px(ctx, C.outline, 2, 3, 12, 11);
			px(ctx, cape.main, 3, 4, 10, 9);
			px(ctx, cape.dark, 3, 10, 10, 3);
			if (cape.trim) px(ctx, cape.trim, 3, 12, 10, 1);
		}
	} else if (slot === "pet") {
		const pet = PETS[id];
		const rows = pet?.frames[0];
		if (pet && rows) drawRows(ctx, rows, pet.map, 3, 4);
	} else if (slot === "aura") {
		for (const [x, y, r] of [
			[4, 4, 2],
			[11, 6, 1],
			[7, 11, 2],
		] as const) {
			px(ctx, "#ffffff", x, y);
			for (let i = 1; i <= r; i++) {
				px(ctx, C.goldLight, x - i, y);
				px(ctx, C.goldLight, x + i, y);
				px(ctx, C.goldLight, x, y - i);
				px(ctx, C.goldLight, x, y + i);
			}
		}
	} else if (slot === "name") {
		px(ctx, C.outline, 1, 5, 14, 7);
		px(ctx, GOLD, 2, 6, 12, 5);
		px(ctx, "#fff3b0", 3, 7, 3, 1);
		px(ctx, C.outline, 4, 8, 8, 1);
	} else if (slot === "banner") {
		px(ctx, C.outline, 4, 2, 1, 12);
		px(ctx, C.outline, 5, 2, 7, 7);
		px(ctx, GOLD, 5, 3, 6, 5);
		px(ctx, C.royalGem, 7, 4, 2, 2);
	}
}
