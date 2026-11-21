import Phaser from "phaser";

class BootScene extends Phaser.Scene {
	create(): void {
		this.add.text(8, 8, "King of the Page", { color: "#9bbc0f", fontFamily: "monospace" });
	}
}

new Phaser.Game({
	type: Phaser.AUTO,
	pixelArt: true,
	backgroundColor: "#306230",
	scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
	scene: [BootScene],
});
