// Jersey 10: a pixel font with clear, distinct digits (Pixelify's 3/5/6/8/9 and C were hard to read).
import "@fontsource/jersey-10/400.css";
import Phaser from "phaser";
import { Connection, tokenStorage } from "./net/connection";
import { WorldScene } from "./render/worldScene";
import { ClientWorld } from "./state/clientWorld";
import { TOUCH } from "./ui/device";
import { Hud } from "./ui/hud";
import { TouchControls } from "./ui/touch";

const world = new ClientWorld();
const hud = new Hud();
const touch = TOUCH ? new TouchControls() : null;
if (TOUCH) document.body.classList.add("touch");
let game: Phaser.Game | null = null;
let starting = false;
let scene: WorldScene | null = null;
let suggestedHandle = "";

async function startGame(): Promise<void> {
	if (game || starting) return;
	starting = true;
	// Name tags are drawn into the canvas, so the pixel font must be ready before the first one.
	await Promise.race([
		document.fonts.load('10px "Jersey 10"'),
		new Promise((resolve) => setTimeout(resolve, 1500)),
	]).catch(() => undefined);
	if (game) return;
	scene = new WorldScene({
		world,
		send: (msg) => connection.send(msg),
		nextSeq: () => connection.nextSeq(),
		onMeChanged: () => {
			if (world.me) hud.update(world.me);
		},
		confirm: (text) => hud.confirm(text),
		onStatusChanged: () => {
			if (world.status) hud.updateStatus(world.status);
		},
		openShop: () => {
			if (world.shop) {
				hud.openShop(world.shop, world.collection.owned, world.liveGold(), world.serverNow());
			}
		},
		openWardrobe: () => hud.openWardrobe(world.collection.owned, world.collection.equipped),
		cycleBase: () => hud.cycleBase(),
		onCompassChanged: () => {
			if (world.me) hud.updateCompass(world.me, world.bases);
		},
	});
	game = new Phaser.Game({
		type: Phaser.AUTO,
		parent: "game",
		pixelArt: true,
		roundPixels: true,
		backgroundColor: "#0f380f",
		scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
		scene: [scene],
	});
	if (touch) {
		const target = scene;
		touch.attach({
			press: (input) => target.pressInput(input, true),
			release: (input) => target.releaseInput(input, true),
		});
		touch.show();
	}
}

const connection = new Connection({
	onMessage(msg) {
		world.apply(msg);
		switch (msg.type) {
			case "hello": {
				suggestedHandle = msg.suggestedHandle;
				const token = tokenStorage.get();
				if (token) connection.send({ type: "resume", token });
				else hud.showJoin(suggestedHandle);
				break;
			}
			case "joined":
				tokenStorage.set(msg.token);
				hud.hideJoin();
				hud.setProfile(msg.you.handle, msg.hasPassword);
				if (world.me) hud.update(world.me);
				void startGame();
				startTimers();
				break;
			case "joinRejected":
				if (msg.reason === "badToken") tokenStorage.clear();
				hud.showJoin(suggestedHandle, msg.reason);
				break;
			case "rejected":
				hud.rejected(msg.reason);
				break;
			case "profileSaved":
				hud.profileSaved();
				break;
			case "profileRejected":
				hud.profileRejected(msg.reason);
				break;
			case "notice":
				hud.notice(msg.notice);
				break;
			case "collection":
				// Refresh an open shop or wardrobe so Buy/Wear buttons match what's owned now.
				if (hud.modalOpen && world.shop && !document.getElementById("shop")?.hidden) {
					hud.openShop(world.shop, world.collection.owned, world.liveGold(), world.serverNow());
				} else if (!document.getElementById("wardrobe")?.hidden) {
					hud.openWardrobe(world.collection.owned, world.collection.equipped);
				}
				break;
			case "alliances":
				hud.renderAlliances(world.alliances);
				break;
			case "leaderboard":
				hud.renderLeaderboard(msg, world.me?.id);
				break;
			default:
				break;
		}
	},
	onClose(reason) {
		hud.toast(`Disconnected: ${reason}. Reload the page to play again.`, true);
	},
});

const LEADERBOARD_REFRESH_MS = 10_000;
let timersStarted = false;

function startTimers(): void {
	if (timersStarted) return;
	timersStarted = true;
	// The gold counter ticks locally between server updates.
	window.setInterval(() => hud.updateGold(world.liveGold()), 500);
	const refresh = () => connection.send({ type: "leaderboard" });
	refresh();
	window.setInterval(refresh, LEADERBOARD_REFRESH_MS);
}

hud.onJoin(
	(handle) => connection.send({ type: "join", handle }),
	(handle, password) => connection.send({ type: "login", handle, password }),
);
hud.onProfile((password, current) => connection.send({ type: "setPassword", password, current }));
hud.onAlliance({
	request: (handle) => connection.send({ type: "allyRequest", handle }),
	accept: (playerId) => connection.send({ type: "allyAccept", playerId }),
	decline: (playerId) => connection.send({ type: "allyDecline", playerId }),
	end: (playerId) => connection.send({ type: "allyEnd", playerId }),
});
hud.onTypingChange((typing) => scene?.setKeyboardEnabled(!typing));
hud.onShop(
	{
		buy: (itemId) => connection.send({ type: "buy", itemId, seq: connection.nextSeq() }),
		equip: (slot, itemId) =>
			connection.send({ type: "equip", slot, itemId, seq: connection.nextSeq() }),
	},
	(open) => scene?.setKeyboardEnabled(!open),
);
connection.open();
