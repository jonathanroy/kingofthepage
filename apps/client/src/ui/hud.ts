import type { ActionRejectReason, JoinRejectReason } from "@kotp/shared/protocol";
import { fenceBuildCost, HANDLE } from "@kotp/shared/rules";
import type { Me } from "../state/clientWorld";

function el<T extends HTMLElement>(id: string): T {
	const found = document.getElementById(id);
	if (!found) throw new Error(`Missing #${id}`);
	return found as T;
}

const REJECT_TEXT: Partial<Record<ActionRejectReason, string>> = {
	noAccess: "That land belongs to someone else.",
	nothingToChop: "Nothing to chop there.",
	notYourTree: "Only the owners of this land can chop its trees.",
	notYourFence: "Breaking other players' fences isn't available yet.",
	notEmptyGround: "Fences go on empty ground.",
	occupied: "Someone is standing there.",
	notEnoughWood: `Not enough wood: a fence costs ${fenceBuildCost()}.`,
};

const JOIN_TEXT: Record<JoinRejectReason, string> = {
	handleInvalid: `Use ${HANDLE.minLength}–${HANDLE.maxLength} letters, digits or underscores.`,
	handleTaken: "That name is taken. Try another.",
	badToken: "Your saved session expired. Pick a name to start again.",
	alreadyOnline: "You're already playing in another tab.",
};

/** DOM overlay for joining, inventory and messages. Kept outside Phaser so text stays sharp. */
export class Hud {
	private readonly join = el<HTMLDivElement>("join");
	private readonly form = el<HTMLFormElement>("join-form");
	private readonly input = el<HTMLInputElement>("join-handle");
	private readonly error = el<HTMLParagraphElement>("join-error");
	private readonly hud = el<HTMLDivElement>("hud");
	private readonly toastEl = el<HTMLDivElement>("toast");
	private toastTimer: number | undefined;

	onJoin(handler: (handle: string) => void): void {
		this.form.addEventListener("submit", (e) => {
			e.preventDefault();
			const handle = this.input.value.trim();
			if (handle) handler(handle);
		});
	}

	showJoin(suggested: string, reason?: JoinRejectReason): void {
		this.join.hidden = false;
		if (!this.input.value) this.input.value = suggested;
		this.error.textContent = reason ? JOIN_TEXT[reason] : "";
		this.input.focus();
		this.input.select();
	}

	hideJoin(): void {
		this.join.hidden = true;
		this.hud.hidden = false;
		this.input.blur();
	}

	update(me: Me): void {
		el("hud-handle").textContent = me.handle;
		el("hud-wood").textContent = String(me.wood);
		el("hud-pos").textContent = `${me.x}, ${me.y}`;
	}

	rejected(reason: ActionRejectReason): void {
		const text = REJECT_TEXT[reason];
		if (text) this.toast(text);
	}

	toast(text: string, sticky = false): void {
		this.toastEl.textContent = text;
		this.toastEl.hidden = false;
		window.clearTimeout(this.toastTimer);
		if (!sticky) this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), 2500);
	}
}
