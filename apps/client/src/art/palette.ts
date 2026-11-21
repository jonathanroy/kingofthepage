// One small palette per biome (CLAUDE.md Client and art), plus a shared dark outline.
// Natural materials keep their own colors; owner colors appear on hats, scarves, pennants
// and land borders only, so everything stays readable side by side.

export const C = {
	outline: "#2b2233",
	// Grass
	grass: "#9ad86b",
	grassLight: "#b7e68a",
	grassDark: "#6fb04a",
	petalWhite: "#fff6e6",
	petalPink: "#ff9ec0",
	petalCenter: "#ffd23f",
	// Round trees
	leafLight: "#7fd36d",
	leafMid: "#4fae4f",
	leafDark: "#2f7d3b",
	leafShine: "#c4f0a0",
	// Pines
	pineLight: "#5fb070",
	pineMid: "#3d8a52",
	pineDark: "#25603c",
	trunk: "#9a6439",
	trunkDark: "#64391f",
	stumpTop: "#e9c58f",
	stumpRing: "#c9945f",
	// Water and shore
	water: "#5aa9e6",
	waterDeep: "#3f8fd4",
	waterLight: "#a8dcfb",
	foam: "#e8f7ff",
	sand: "#f2dca6",
	sandDark: "#d9bb7c",
	// Hills
	plateau: "#8cc760",
	plateauDark: "#6fae4a",
	cliff: "#c8946a",
	cliffMid: "#a5734c",
	cliffDark: "#7b5233",
	// Mines
	rockLight: "#b9b4c9",
	rockMid: "#8f8aa3",
	rockDark: "#625d78",
	rockShine: "#e6e2f0",
	gold: "#ffd23f",
	oreRust: "#c8663a",
	oreRustLight: "#ec9a62",
	ingot: "#b8c2d0",
	ingotLight: "#e6edf5",
	ingotDark: "#7d8898",
	goldLight: "#fff3b0",
	// Walls
	wood: "#c08a55",
	woodDark: "#875a32",
	woodLight: "#e0b07a",
	iron: "#4a4a55",
	stone: "#c9c6d6",
	stoneDark: "#8c88a1",
	steel: "#dfe6ee",
	steelDark: "#8d9aa8",
	royal: "#ffd23f",
	royalGem: "#ff5a6e",
	// Characters
	skin: "#ffd9b8",
	blush: "#ff9ea8",
	mouth: "#c4586a",
	hair: "#6b4a3a",
	tunic: "#f5ecd7",
	boots: "#5a3d2e",
	// Effects
	dust: "#f3ead2",
	heart: "#ff6b8a",
} as const;
