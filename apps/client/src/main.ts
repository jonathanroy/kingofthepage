import "@fontsource/pixelify-sans/500.css";
import "@fontsource/pixelify-sans/700.css";
import Phaser from "phaser";
import { Connection, tokenStorage } from "./net/connection";
import { WorldScene } from "./render/worldScene";
import { ClientWorld } from "./state/clientWorld";
import { Hud } from "./ui/hud";

const world = new ClientWorld();
const hud = new Hud();
let game: Phaser.Game | null = null;
let starting = false;
let scene: WorldScene | null = null;
let suggestedHandle = "";

async function startGame(): Promise<void> {
	if (game || starting) return;
	starting = true;
	// Name tags are drawn into the canvas, so the pixel font must be ready before the first one.
	await Promise.race([
		document.fonts.load('8px "Pixelify Sans"'),
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
			case "notice":
				hud.notice(msg.notice);
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

hud.onJoin((handle) => connection.send({ type: "join", handle }));
hud.onAlliance({
	request: (handle) => connection.send({ type: "allyRequest", handle }),
	accept: (playerId) => connection.send({ type: "allyAccept", playerId }),
	decline: (playerId) => connection.send({ type: "allyDecline", playerId }),
	end: (playerId) => connection.send({ type: "allyEnd", playerId }),
});
hud.onTypingChange((typing) => scene?.setKeyboardEnabled(!typing));
connection.open();
