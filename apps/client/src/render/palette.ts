// Owner colors: hats, scarves, pennants and land borders. Brighter, softer hues than flat UI
// colors so they sit well on the pastel countryside; your own color is always gold.

const OWNER_COLORS = [
	"#ff7070", // red
	"#5b8cff", // blue
	"#b07cff", // violet
	"#ff8fd0", // pink
	"#4fd1e8", // cyan
	"#ff9f43", // orange
	"#3fc7a8", // teal
	"#a3e05a", // lime
] as const;
export const MY_COLOR = "#ffcf3f";

export function ownerColorHex(ownerId: string, myId: string | undefined): string {
	if (ownerId === myId) return MY_COLOR;
	let h = 0;
	for (let i = 0; i < ownerId.length; i++) h = (Math.imul(h, 31) + ownerId.charCodeAt(i)) >>> 0;
	return OWNER_COLORS[h % OWNER_COLORS.length] ?? "#ffffff";
}

/** Same color as a number, for Phaser tints and graphics fills. */
export function ownerColor(ownerId: string, myId: string | undefined): number {
	return Number.parseInt(ownerColorHex(ownerId, myId).slice(1), 16);
}
