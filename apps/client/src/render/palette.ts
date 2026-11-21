// GameBoy-flavoured palettes, one small set per biome (CLAUDE.md Client and art).

export const PALETTE = {
	grass: ["#9bbc0f", "#8bac0f", "#7a9a0c"],
	forest: ["#306230", "#0f380f", "#5a3a1a"],
	water: ["#3a7bd5", "#2a5ba5", "#8ec5ff"],
	hill: ["#b08a4f", "#8c6a38", "#d2b07a"],
	stump: ["#7a5230", "#5a3a1a"],
	fence: ["#e8d8b0", "#a07840"],
	text: "#0f380f",
} as const;

/** Distinct, readable colors for land owners. Your own land is always gold. */
const OWNER_COLORS = [
	0xe63946, 0x4361ee, 0x9b5de5, 0xf15bb5, 0x00b4d8, 0xff7f11, 0x2a9d8f, 0x6d597a,
];
export const MY_COLOR = 0xffd60a;

export function ownerColor(ownerId: string, myId: string | undefined): number {
	if (ownerId === myId) return MY_COLOR;
	let h = 0;
	for (let i = 0; i < ownerId.length; i++) h = (Math.imul(h, 31) + ownerId.charCodeAt(i)) >>> 0;
	return OWNER_COLORS[h % OWNER_COLORS.length] ?? 0xffffff;
}
