import Phaser from "phaser";
import { Connection, tokenStorage } from "./net/connection";
import { WorldScene } from "./render/worldScene";
import { ClientWorld } from "./state/clientWorld";
import { Hud } from "./ui/hud";

const world = new ClientWorld();
const hud = new Hud();
let game: Phaser.Game | null = null;
let suggestedHandle = "";

function startGame(): void {
	if (game) return;
	const scene = new WorldScene({
		world,
		send: (msg) => connection.send(msg),
		nextSeq: () => connection.nextSeq(),
		onMeChanged: () => {
			if (world.me) hud.update(world.me);
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
				hud.update({ ...msg.you, wood: msg.wood });
				startGame();
				break;
			case "joinRejected":
				if (msg.reason === "badToken") tokenStorage.clear();
				hud.showJoin(suggestedHandle, msg.reason);
				break;
			case "rejected":
				hud.rejected(msg.reason);
				break;
			default:
				break;
		}
	},
	onClose(reason) {
		hud.toast(`Disconnected: ${reason}. Reload the page to play again.`, true);
	},
});

hud.onJoin((handle) => connection.send({ type: "join", handle }));
connection.open();
