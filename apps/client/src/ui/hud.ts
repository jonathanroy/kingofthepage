import type {
	ActionRejectReason,
	JoinRejectReason,
	LeaderboardEntry,
	Notice,
	PlayerRef,
} from "@kotp/shared/protocol";
import { FENCE, fenceBuildCost, HANDLE } from "@kotp/shared/rules";
import { drawCoinIcon, drawIngotIcon, drawLogIcon } from "../art/effects";
import { context, makeCanvas } from "../art/pixels";
import type { Me } from "../state/clientWorld";

function iconUrl(
	width: number,
	height: number,
	draw: (ctx: CanvasRenderingContext2D) => void,
): string {
	const canvas = makeCanvas(width, height);
	draw(context(canvas));
	return canvas.toDataURL();
}

function el<T extends HTMLElement>(id: string): T {
	const found = document.getElementById(id);
	if (!found) throw new Error(`Missing #${id}`);
	return found as T;
}

const REJECT_TEXT: Partial<Record<ActionRejectReason, string>> = {
	noAccess: "That land belongs to someone else.",
	nothingToChop: "Nothing to chop there.",
	notYourFence: "That's not your fence.",
	notEmptyGround: "Fences go on empty ground.",
	occupied: "Someone is standing there.",
	notEnoughWood: "Not enough wood.",
	notEnoughIron: "Not enough iron. Mine the rusty rocks beside hills.",
	maxLevel: "This fence is already at the highest level.",
	alreadyGate: "That's already a gate.",
	nothingToUpgrade: "Face one of your fences first.",
};

const JOIN_TEXT: Record<JoinRejectReason, string> = {
	handleInvalid: `Use ${HANDLE.minLength}–${HANDLE.maxLength} letters, digits or underscores.`,
	handleTaken: "That name is taken. Try another.",
	badToken: "Your saved session expired. Pick a name to start again.",
	alreadyOnline: "You're already playing in another tab.",
};

function noticeText(n: Notice): string {
	switch (n.kind) {
		case "allyChoppingFence":
			return `${n.by.handle} is chopping your fence at (${n.x}, ${n.y}).`;
		case "allianceRequest":
			return `${n.from.handle} wants to be your ally.`;
		case "allianceRequestSent":
			return `Ally request sent to ${n.to.handle}.`;
		case "allianceFormed":
			return `You and ${n.with.handle} are now allies.`;
		case "allianceEnded":
			return `Your alliance with ${n.with.handle} has ended.`;
		case "allianceRequestFailed":
			return {
				unknownHandle: "No player with that name.",
				self: "You can't ally with yourself.",
				alreadyAllies: "You're already allies.",
				alreadyRequested: "You already sent a request.",
			}[n.reason];
	}
}

export type AllianceActions = {
	request(handle: string): void;
	accept(playerId: string): void;
	decline(playerId: string): void;
	end(playerId: string): void;
};

/** DOM overlay for joining, inventory, alliances and messages. Kept outside Phaser so text stays sharp. */
export class Hud {
	private readonly join = el<HTMLDivElement>("join");
	private readonly form = el<HTMLFormElement>("join-form");
	private readonly input = el<HTMLInputElement>("join-handle");
	private readonly error = el<HTMLParagraphElement>("join-error");
	private readonly hud = el<HTMLDivElement>("hud");
	private readonly toastEl = el<HTMLDivElement>("toast");
	private readonly allyPanel = el<HTMLDivElement>("allies");
	private readonly allyForm = el<HTMLFormElement>("ally-form");
	private readonly allyInput = el<HTMLInputElement>("ally-handle");
	private readonly allyList = el<HTMLUListElement>("ally-list");
	private readonly confirmEl = el<HTMLDivElement>("confirm");
	private toastTimer: number | undefined;
	private pendingConfirm: ((ok: boolean) => void) | null = null;

	constructor() {
		// The HUD icons are the same pixel art as the in-game "+2" and "+1" pop-ups.
		el<HTMLImageElement>("icon-wood").src = iconUrl(7, 5, drawLogIcon);
		el<HTMLImageElement>("icon-gold").src = iconUrl(5, 5, drawCoinIcon);
		el<HTMLImageElement>("icon-iron").src = iconUrl(7, 4, drawIngotIcon);
		el("help").textContent =
			`Arrows/WASD move · Space chop/mine (hold) · F fence (${fenceBuildCost()}) · U repair/upgrade · G gate (+${FENCE.gateConversionCost})`;
		el("confirm-yes").addEventListener("click", () => this.closeConfirm(true));
		el("confirm-no").addEventListener("click", () => this.closeConfirm(false));
	}

	onJoin(handler: (handle: string) => void): void {
		this.form.addEventListener("submit", (e) => {
			e.preventDefault();
			const handle = this.input.value.trim();
			if (handle) handler(handle);
		});
	}

	onAlliance(actions: AllianceActions): void {
		this.allyForm.addEventListener("submit", (e) => {
			e.preventDefault();
			const handle = this.allyInput.value.trim();
			if (handle) actions.request(handle);
			this.allyInput.value = "";
			this.allyInput.blur();
		});
		this.allyList.addEventListener("click", (e) => {
			const button = (e.target as HTMLElement).closest("button");
			const id = button?.dataset.id;
			const action = button?.dataset.action as keyof AllianceActions | undefined;
			if (id && action && action !== "request") actions[action](id);
		});
	}

	/** Lets the game pause keyboard capture while the player types in a text field. */
	onTypingChange(handler: (typing: boolean) => void): void {
		for (const input of [this.allyInput]) {
			input.addEventListener("focus", () => handler(true));
			input.addEventListener("blur", () => handler(false));
		}
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
		this.allyPanel.hidden = false;
		el("board").hidden = false;
		this.input.blur();
	}

	update(me: Me): void {
		el("hud-handle").textContent = me.handle;
		el("hud-wood").textContent = String(me.wood);
		el("hud-iron").textContent = String(me.iron);
		el("hud-pos").textContent = `${me.x}, ${me.y}`;
		el("hud-rate").textContent = me.goldPerMinute > 0 ? ` +${me.goldPerMinute}/min` : "";
	}

	updateGold(gold: number): void {
		el("hud-gold").textContent = String(Math.floor(gold));
	}

	renderLeaderboard(
		board: {
			land: readonly LeaderboardEntry[];
			gold: readonly LeaderboardEntry[];
			you: { land: number; gold: number };
		},
		myId: string | undefined,
	): void {
		const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
		const list = (entries: readonly LeaderboardEntry[]) =>
			entries.length === 0
				? `<li class="muted">Nobody yet</li>`
				: entries
						.map(
							(e, i) =>
								`<li${e.id === myId ? ' class="me"' : ""}><span>${i + 1}. ${esc(e.handle)}</span><b>${e.value}</b></li>`,
						)
						.join("");
		el("board-land").innerHTML = list(board.land);
		el("board-gold").innerHTML = list(board.gold);
		el("board-you").textContent = `You: ${board.you.land} tiles · ${board.you.gold} gold`;
	}

	renderAlliances(state: {
		allies: PlayerRef[];
		incoming: PlayerRef[];
		outgoing: PlayerRef[];
	}): void {
		const rows: string[] = [];
		const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
		for (const r of state.incoming) {
			rows.push(
				`<li><span>${esc(r.handle)} asks</span><button type="button" data-action="accept" data-id="${esc(r.id)}">Accept</button><button type="button" data-action="decline" data-id="${esc(r.id)}">No</button></li>`,
			);
		}
		for (const r of state.allies) {
			rows.push(
				`<li><span class="ally">♥ ${esc(r.handle)}</span><button type="button" data-action="end" data-id="${esc(r.id)}">End</button></li>`,
			);
		}
		for (const r of state.outgoing)
			rows.push(`<li><span class="muted">${esc(r.handle)} (asked)</span></li>`);
		this.allyList.innerHTML = rows.join("") || `<li class="muted">No allies yet</li>`;
	}

	rejected(reason: ActionRejectReason): void {
		const text = REJECT_TEXT[reason];
		if (text) this.toast(text);
	}

	notice(n: Notice): void {
		this.toast(noticeText(n));
	}

	/** §4: the warning before chopping an ally's fence. Resolves true when the player confirms. */
	confirm(text: string): Promise<boolean> {
		this.closeConfirm(false);
		el("confirm-text").textContent = text;
		this.confirmEl.hidden = false;
		el<HTMLButtonElement>("confirm-no").focus();
		return new Promise((resolve) => {
			this.pendingConfirm = resolve;
		});
	}

	toast(text: string, sticky = false): void {
		this.toastEl.textContent = text;
		this.toastEl.hidden = false;
		window.clearTimeout(this.toastTimer);
		if (!sticky) this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), 3000);
	}

	private closeConfirm(ok: boolean): void {
		this.confirmEl.hidden = true;
		const resolve = this.pendingConfirm;
		this.pendingConfirm = null;
		resolve?.(ok);
	}
}
