// Phones and tablets get on-screen controls instead of keyboard hints. Decided once at load:
// a coarse pointer means touch is the main input. `?touch=1` forces it for testing on a desktop.

export const TOUCH: boolean =
	new URLSearchParams(window.location.search).get("touch") === "1" ||
	window.matchMedia("(pointer: coarse)").matches;

/** Game actions players trigger with a key or an on-screen button. */
export type ControlAction =
	| "chop"
	| "build"
	| "upgrade"
	| "makeGate"
	| "interact"
	| "eat"
	| "craftSpear"
	| "switchTool"
	| "wardrobe"
	| "cycleBase";

const KEYS: Record<ControlAction, string> = {
	chop: "Space",
	build: "F",
	upgrade: "U",
	makeGate: "G",
	interact: "E",
	eat: "X",
	craftSpear: "C",
	switchTool: "Q",
	wardrobe: "V",
	cycleBase: "B",
};

/** Labels of the on-screen buttons (ui/touch.ts). */
export const BUTTON_LABELS: Record<ControlAction, string> = {
	chop: "Use",
	build: "Fence",
	upgrade: "Upgrade",
	makeGate: "Gate",
	interact: "Pick",
	eat: "Eat",
	craftSpear: "Spear",
	switchTool: "Tool",
	wardrobe: "Wardrobe",
	cycleBase: "Base",
};

/** "Press C" on a keyboard, "Tap Spear" on a phone, for hints and messages. */
export function pressHint(action: ControlAction): string {
	return TOUCH ? `Tap ${BUTTON_LABELS[action]}` : `Press ${KEYS[action]}`;
}

/** A short inline control reference: a keycap on desktop, the button name on touch. */
export function controlCap(action: ControlAction): string {
	return TOUCH ? `<kbd>${BUTTON_LABELS[action]}</kbd>` : `<kbd>${KEYS[action]}</kbd>`;
}
