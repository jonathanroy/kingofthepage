import type {
	ActionRejectReason,
	FoodCounts,
	JoinRejectReason,
	LeaderboardEntry,
	Notice,
	PlayerRef,
} from "@kotp/shared/protocol";
import {
	COLLECTIBLES,
	collectible,
	FENCE,
	fenceBuildCost,
	HANDLE,
	SLOTS,
	type Slot,
	TOOLS,
} from "@kotp/shared/rules";
import { drawItemPreview } from "../art/cosmetics";
import {
	drawAppleIcon,
	drawBerriesIcon,
	drawCoinIcon,
	drawDropIcon,
	drawHeartIcon,
	drawIngotIcon,
	drawLogIcon,
	drawMeatIcon,
	drawPotatoIcon,
} from "../art/effects";
import { context, makeCanvas } from "../art/pixels";
import type { Me, Status } from "../state/clientWorld";

function iconUrl(
	width: number,
	height: number,
	draw: (ctx: CanvasRenderingContext2D) => void,
): string {
	const canvas = makeCanvas(width, height);
	draw(context(canvas));
	return canvas.toDataURL();
}

/** Thousands separators make large gold and land counts readable (21,600 vs 21600). */
function formatCount(n: number): string {
	return Math.floor(n).toLocaleString("en-US");
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
	nothingToInteract: "Nothing to pick, dig or drink there.",
	notReady: "Nothing ripe yet. Come back later.",
	bagFull: "Your food bag is full.",
	nothingToEat: "You have no food. Pick apples or berries, dig potatoes, or hunt.",
	noSpear: `You don't have a spear yet. Press C to craft one (${TOOLS.spearWood} wood, ${TOOLS.spearIron} iron).`,
	alreadyHaveSpear: "You already have a spear.",
	useAxe: "Switch to your axe (Q) to chop or mine.",
	useSpear: "Switch to your spear with Q to hunt.",
	nothingToHit: "Nothing to hit there.",
	notForSale: "The shop doesn't sell that today.",
	alreadyOwned: "You already own that.",
	notEnoughGold: "Not enough gold.",
	notAtShop: "Stand next to the shop and face it.",
	notOwned: "You don't own that item.",
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

const FOOD_NAMES: Record<keyof FoodCounts, string> = {
	apple: "an apple",
	berries: "berries",
	potato: "a potato",
	meat: "meat",
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
		case "bought":
			return `You bought the ${collectible(n.itemId)?.name ?? "item"}! Press V to wear it.`;
		case "bearComing":
			return "A zombie bear is coming! Get behind strong walls or ready your spear.";
		case "died":
			return n.cause === "bear"
				? "A zombie bear got you. You lost what you carried, but your land is safe."
				: "You starved. You lost what you carried, but your land is safe.";
		case "ate":
			return `You ate ${FOOD_NAMES[n.food]}.`;
		case "spoiled":
			return `Some of your ${FOOD_NAMES[n.food]} went bad.`;
		case "allianceRequestFailed":
			return {
				unknownHandle: "No player with that name.",
				self: "You can't ally with yourself.",
				alreadyAllies: "You're already allies.",
				alreadyRequested: "You already sent a request.",
			}[n.reason];
	}
}

export type ShopActions = {
	buy(itemId: string): void;
	equip(slot: Slot, itemId: string | null): void;
};

const TIER_LABEL = {
	common: "Common",
	rare: "Rare",
	epic: "Epic",
	legendary: "Legendary",
} as const;

function itemIcon(id: string, slot: string): string {
	return iconUrl(16, 16, (ctx) => drawItemPreview(ctx, id, slot));
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
		el<HTMLImageElement>("icon-health").src = iconUrl(7, 6, drawHeartIcon);
		el<HTMLImageElement>("icon-food").src = iconUrl(7, 6, drawMeatIcon);
		el<HTMLImageElement>("icon-water").src = iconUrl(7, 6, drawDropIcon);
		el<HTMLImageElement>("icon-apple").src = iconUrl(7, 6, drawAppleIcon);
		el<HTMLImageElement>("icon-berries").src = iconUrl(7, 6, drawBerriesIcon);
		el<HTMLImageElement>("icon-potato").src = iconUrl(7, 6, drawPotatoIcon);
		el<HTMLImageElement>("icon-meat").src = iconUrl(7, 6, drawMeatIcon);
		el<HTMLImageElement>("icon-compass").src = iconUrl(16, 16, (ctx) =>
			drawItemPreview(ctx, "royal-banner", "banner"),
		);
		// Keys as keycaps in a plain font: the pixel font's small "C" is easily read as "0".
		const k = (key: string) => `<kbd>${key}</kbd>`;
		el("help").innerHTML = [
			`${k("WASD")} move`,
			`${k("Space")} use tool`,
			`${k("Q")} switch tool`,
			`${k("C")} craft spear (${TOOLS.spearWood} wood, ${TOOLS.spearIron} iron)`,
			`${k("E")} pick / drink / shop`,
			`${k("X")} eat`,
			`${k("F")} fence (${fenceBuildCost()})`,
			`${k("U")} repair / upgrade`,
			`${k("G")} gate (+${FENCE.gateConversionCost})`,
			`${k("V")} wardrobe`,
			`${k("B")} next base`,
		]
			.map((item) => `<span>${item}</span>`)
			.join("");
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
		el("status").hidden = false;
		this.input.blur();
	}

	update(me: Me): void {
		el("hud-handle").textContent = me.handle;
		el("hud-wood").textContent = formatCount(me.wood);
		el("hud-iron").textContent = formatCount(me.iron);
		el("hud-pos").textContent = `${me.x}, ${me.y}`;
		el("hud-rate").textContent = me.goldPerMinute > 0 ? `+${me.goldPerMinute}/min` : "";
	}

	// ---------- Compass and magic shop (§10) ----------

	private compassIndex = 0;

	/** The flag compass: arrow and distance to the selected base. */
	updateCompass(me: { x: number; y: number }, bases: readonly { x: number; y: number }[]): void {
		const label = el("compass-label");
		const arrow = el("compass-arrow");
		if (bases.length === 0) {
			label.textContent = "No base yet: close a fence ring";
			arrow.hidden = true;
			return;
		}
		this.compassIndex %= bases.length;
		const base = bases[this.compassIndex];
		if (!base) return;
		const dx = base.x - me.x;
		const dy = base.y - me.y;
		const distance = Math.round(Math.hypot(dx, dy));
		arrow.hidden = distance === 0;
		arrow.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
		const which = bases.length > 1 ? ` · base ${this.compassIndex + 1}/${bases.length} (B)` : "";
		label.textContent = distance === 0 ? `Home${which}` : `${distance} tiles${which}`;
	}

	cycleBase(): void {
		this.compassIndex += 1;
	}

	private shopActions: ShopActions | null = null;
	private modalHandler: ((open: boolean) => void) | null = null;

	onShop(actions: ShopActions, onModalChange: (open: boolean) => void): void {
		this.shopActions = actions;
		this.modalHandler = onModalChange;
		el("shop-close").addEventListener("click", () => this.closeModals());
		el("wardrobe-close").addEventListener("click", () => this.closeModals());
		window.addEventListener("keydown", (e) => {
			if (e.key === "Escape") this.closeModals();
		});
		el("shop-items").addEventListener("click", (e) => {
			const id = (e.target as HTMLElement).closest("button")?.dataset.buy;
			if (id) this.shopActions?.buy(id);
		});
		el("wardrobe-items").addEventListener("click", (e) => {
			const button = (e.target as HTMLElement).closest("button");
			const slot = button?.dataset.slot as Slot | undefined;
			if (!button || !slot) return;
			this.shopActions?.equip(slot, button.dataset.item ?? null);
		});
	}

	get modalOpen(): boolean {
		return !el("shop").hidden || !el("wardrobe").hidden;
	}

	openShop(
		shop: { offer: readonly { id: string; price: number }[]; movesAt: number },
		owned: readonly string[],
		balance: number,
		serverNow: number,
	): void {
		const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
		el("shop-items").innerHTML = shop.offer
			.map(({ id, price }) => {
				const item = collectible(id);
				if (!item) return "";
				const have = owned.includes(id);
				const afford = balance >= price;
				const action = have ? "Owned" : afford ? "Buy" : "Too expensive";
				return `<li class="tier-${item.tier}">
					<img class="preview" src="${itemIcon(id, item.slot)}" alt="" />
					<div class="info"><b>${esc(item.name)}</b> <span class="tier">${TIER_LABEL[item.tier]}</span><br /><span class="muted">${esc(item.description)}</span></div>
					<div class="buy"><span class="price">${price.toLocaleString()} gold</span><button type="button" data-buy="${id}" ${have || !afford ? "disabled" : ""}>${action}</button></div>
				</li>`;
			})
			.join("");
		const hours = Math.max(0, Math.ceil((shop.movesAt - serverNow) / 3_600_000));
		el("shop-meta").textContent =
			`You have ${Math.floor(balance).toLocaleString()} gold · The shop moves on in about ${hours} h`;
		this.showModal("shop");
	}

	openWardrobe(owned: readonly string[], equipped: Partial<Record<Slot, string>>): void {
		const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
		const items = COLLECTIBLES.filter((c) => owned.includes(c.id));
		el("wardrobe-items").innerHTML =
			items.length === 0
				? `<li class="muted">Nothing yet. Somewhere out there, a wandering shop sells wonders.</li>`
				: SLOTS.flatMap((slot) =>
						items
							.filter((c) => c.slot === slot)
							.map((c) => {
								const worn = equipped[slot] === c.id;
								return `<li class="tier-${c.tier}"><img class="preview" src="${itemIcon(c.id, c.slot)}" alt="" /><div class="info"><b>${esc(c.name)}</b> <span class="tier">${TIER_LABEL[c.tier]}</span></div><button type="button" data-slot="${slot}" ${worn ? "" : `data-item="${c.id}"`}>${worn ? "Take off" : "Wear"}</button></li>`;
							}),
					).join("");
		this.showModal("wardrobe");
	}

	private showModal(id: "shop" | "wardrobe"): void {
		el("shop").hidden = id !== "shop";
		el("wardrobe").hidden = id !== "wardrobe";
		this.modalHandler?.(true);
	}

	closeModals(): void {
		if (!this.modalOpen) return;
		el("shop").hidden = true;
		el("wardrobe").hidden = true;
		this.modalHandler?.(false);
	}

	/** §8 meters, carried food and the selected tool. */
	updateStatus(s: Status): void {
		el("status").hidden = false;
		for (const meter of ["health", "food", "water"] as const) {
			const value = Math.round(s[meter]);
			el(`bar-${meter}`).style.width = `${value}%`;
			el(`bar-${meter}`).classList.toggle("low", value <= 25);
			el(`num-${meter}`).textContent = String(value);
		}
		for (const food of ["apple", "berries", "potato", "meat"] as const) {
			el(`food-${food}`).textContent = String(s.pantry[food]);
		}
		el("tool").textContent = s.tool === "spear" ? "Spear" : "Axe";
		el("tool-hint").innerHTML = s.hasSpear
			? "<kbd>Q</kbd> to switch"
			: `<kbd>C</kbd> craft a spear (${TOOLS.spearWood} wood, ${TOOLS.spearIron} iron)`;
	}

	updateGold(gold: number): void {
		el("hud-gold").textContent = formatCount(Math.floor(gold));
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
								`<li${e.id === myId ? ' class="me"' : ""}><span>${i + 1}. ${esc(e.handle)}</span><b class="num">${formatCount(e.value)}</b></li>`,
						)
						.join("");
		el("board-land").innerHTML = list(board.land);
		el("board-gold").innerHTML = list(board.gold);
		el("board-you").textContent =
			`You: ${formatCount(board.you.land)} tiles · ${formatCount(board.you.gold)} gold`;
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
