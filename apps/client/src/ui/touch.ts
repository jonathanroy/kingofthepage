import type { Direction } from "@kotp/shared/world";
import { BUTTON_LABELS, type ControlAction } from "./device";

/** What the on-screen controls press and release; the scene treats it like keyboard input. */
export type TouchInput = Direction | ControlAction;

export type TouchSink = {
	press(input: TouchInput): void;
	release(input: TouchInput): void;
};

const MAIN: readonly ControlAction[] = ["chop", "build"];
const QUICK: readonly ControlAction[] = ["interact", "eat", "switchTool", "upgrade"];
const MORE: readonly ControlAction[] = ["makeGate", "craftSpear", "wardrobe", "cycleBase"];
/** Thumb distance from the pad's center, in px, before a direction counts. */
const DEAD_ZONE = 12;

/**
 * On-screen controls for phones and tablets: a D-pad you can slide your thumb around, and
 * action buttons. Holding works like holding a key: walk, keep chopping, or lay a fence line.
 */
export class TouchControls {
	private readonly root = document.getElementById("touch") as HTMLDivElement;
	private sink: TouchSink | null = null;
	private padDir: Direction | null = null;

	constructor() {
		const pad = this.root.querySelector<HTMLDivElement>(".dpad");
		const actions = this.root.querySelector<HTMLDivElement>(".actions");
		if (!pad || !actions) throw new Error("Touch controls markup missing");
		actions.innerHTML = [
			`<div class="more" hidden>${MORE.map((a) => this.button(a, "small")).join("")}</div>`,
			`<div class="quick">${QUICK.map((a) => this.button(a, "small")).join("")}<button type="button" class="small toggle-more" aria-expanded="false">More</button></div>`,
			`<div class="main">${MAIN.map((a) => this.button(a, a === "chop" ? "big use" : "big fence")).join("")}</div>`,
		].join("");
		this.bindPad(pad);
		this.bindButtons(actions);
		// Long presses would otherwise open the text selection or context menu.
		this.root.addEventListener("contextmenu", (e) => e.preventDefault());
	}

	attach(sink: TouchSink): void {
		this.sink = sink;
	}

	show(): void {
		this.root.hidden = false;
	}

	private button(action: ControlAction, cls: string): string {
		return `<button type="button" class="${cls}" data-action="${action}">${BUTTON_LABELS[action]}</button>`;
	}

	private bindPad(pad: HTMLDivElement): void {
		let pointer: number | null = null;
		const update = (e: PointerEvent) => {
			const rect = pad.getBoundingClientRect();
			const dx = e.clientX - (rect.left + rect.width / 2);
			const dy = e.clientY - (rect.top + rect.height / 2);
			const dir: Direction | null =
				Math.hypot(dx, dy) < DEAD_ZONE
					? null
					: Math.abs(dx) > Math.abs(dy)
						? dx > 0
							? "right"
							: "left"
						: dy > 0
							? "down"
							: "up";
			this.setPadDir(dir, pad);
		};
		pad.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			pointer = e.pointerId;
			pad.setPointerCapture(e.pointerId);
			update(e);
		});
		pad.addEventListener("pointermove", (e) => {
			if (e.pointerId === pointer) update(e);
		});
		const end = (e: PointerEvent) => {
			if (e.pointerId !== pointer) return;
			pointer = null;
			this.setPadDir(null, pad);
		};
		pad.addEventListener("pointerup", end);
		pad.addEventListener("pointercancel", end);
	}

	private setPadDir(dir: Direction | null, pad: HTMLDivElement): void {
		if (dir === this.padDir) return;
		if (this.padDir) this.sink?.release(this.padDir);
		this.padDir = dir;
		pad.dataset.dir = dir ?? "";
		if (dir) {
			this.sink?.press(dir);
			navigator.vibrate?.(8);
		}
	}

	private bindButtons(actions: HTMLDivElement): void {
		const more = actions.querySelector<HTMLDivElement>(".more");
		const toggle = actions.querySelector<HTMLButtonElement>(".toggle-more");
		toggle?.addEventListener("click", () => {
			if (!more) return;
			more.hidden = !more.hidden;
			toggle.setAttribute("aria-expanded", String(!more.hidden));
			toggle.textContent = more.hidden ? "More" : "Less";
		});
		for (const button of actions.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
			const action = button.dataset.action as ControlAction;
			let pointer: number | null = null;
			button.addEventListener("pointerdown", (e) => {
				e.preventDefault();
				pointer = e.pointerId;
				button.setPointerCapture(e.pointerId);
				button.classList.add("held");
				this.sink?.press(action);
			});
			const end = (e: PointerEvent) => {
				if (e.pointerId !== pointer) return;
				pointer = null;
				button.classList.remove("held");
				this.sink?.release(action);
			};
			button.addEventListener("pointerup", end);
			button.addEventListener("pointercancel", end);
		}
	}
}
