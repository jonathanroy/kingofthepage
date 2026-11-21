import type { ClientMessage } from "@kotp/shared/protocol";
import { FENCE_LEVELS, PACE, type Tile } from "@kotp/shared/rules";
import {
	CHUNK_SIZE,
	chunkKey,
	chunkOfTile,
	chunkOrigin,
	type Direction,
	neighbors4,
	stepToward,
} from "@kotp/shared/world";
import Phaser from "phaser";
import type { ClientWorld } from "../state/clientWorld";
import { ownerColor } from "./palette";
import { createTextures, TILE, TILE_FRAME } from "./textures";

export type SceneDeps = {
	readonly world: ClientWorld;
	readonly send: (msg: ClientMessage) => void;
	readonly nextSeq: () => number;
	readonly onMeChanged: () => void;
	/** Shows the §4 warning before chopping an ally's fence. */
	readonly confirm: (text: string) => Promise<boolean>;
};

type Action = "chop" | "build" | "upgrade" | "makeGate";
type Input = Direction | Action;
const ACTIONS: readonly string[] = ["chop", "build", "upgrade", "makeGate"];

type FenceView = {
	readonly img: Phaser.GameObjects.Image;
	readonly cracks: Phaser.GameObjects.Image;
};

type ChunkView = {
	readonly layer: Phaser.Tilemaps.TilemapLayer;
	readonly overlay: Phaser.GameObjects.Graphics;
	readonly fences: Map<string, FenceView>;
};

type PlayerView = {
	readonly container: Phaser.GameObjects.Container;
	readonly body: Phaser.GameObjects.Image;
	readonly label: Phaser.GameObjects.Text;
};

const DEPTH = { terrain: 0, overlay: 1, fence: 2, player: 3 } as const;
const REGROW_CHECK_MS = 1000;
const MAX_QUEUED_INPUTS = 4;
const TURN_PAUSE_MS = 120;
const DIRECTIONS = ["up", "down", "left", "right"] as const;

function frameFor(tile: Tile): number {
	switch (tile.kind) {
		case "grass":
			return TILE_FRAME.grass;
		case "tree":
			return TILE_FRAME.tree;
		case "water":
			return TILE_FRAME.water;
		case "hill":
			return TILE_FRAME.hill;
		case "mine":
			return tile.size === "large" ? TILE_FRAME.mineLarge : TILE_FRAME.mineSmall;
		case "stump":
		case "fence":
			// Fences are drawn as images on top of the ground they stand on.
			return tile.kind === "fence" ? TILE_FRAME.grass : TILE_FRAME.stump;
	}
}

function parseKey(key: string): [number, number] {
	return key.split(",").map(Number) as [number, number];
}

export class WorldScene extends Phaser.Scene {
	private readonly chunkViews = new Map<string, ChunkView>();
	private readonly playerViews = new Map<string, PlayerView>();
	private me: PlayerView | null = null;
	private keys!: {
		up: Phaser.Input.Keyboard.Key[];
		down: Phaser.Input.Keyboard.Key[];
		left: Phaser.Input.Keyboard.Key[];
		right: Phaser.Input.Keyboard.Key[];
		chop: Phaser.Input.Keyboard.Key;
		build: Phaser.Input.Keyboard.Key;
		upgrade: Phaser.Input.Keyboard.Key;
		makeGate: Phaser.Input.Keyboard.Key;
	};
	private nextMoveAt = 0;
	private readonly inputQueue: Input[] = [];
	/** Ally fences the player already agreed to chop (§4: the warning comes before the first chop). */
	private readonly confirmedAllyFences = new Set<string>();
	private waitingForConfirm = false;
	private lastRegrowCheck = 0;

	constructor(private readonly deps: SceneDeps) {
		super("world");
	}

	create(): void {
		createTextures(this);
		const kb = this.input.keyboard;
		if (!kb) throw new Error("Keyboard input unavailable");
		const K = Phaser.Input.Keyboard.KeyCodes;
		this.keys = {
			up: [kb.addKey(K.UP), kb.addKey(K.W)],
			down: [kb.addKey(K.DOWN), kb.addKey(K.S)],
			left: [kb.addKey(K.LEFT), kb.addKey(K.A)],
			right: [kb.addKey(K.RIGHT), kb.addKey(K.D)],
			chop: kb.addKey(K.SPACE),
			build: kb.addKey(K.F),
			upgrade: kb.addKey(K.U),
			makeGate: kb.addKey(K.G),
		};
		// Key "down" events, not per-frame polling: Phaser clears a key's just-pressed
		// flag on release, so a tap shorter than a frame would otherwise be lost.
		const queue = (input: Input) => {
			if (this.inputQueue.length < MAX_QUEUED_INPUTS) this.inputQueue.push(input);
		};
		for (const dir of DIRECTIONS) {
			for (const key of this.keys[dir]) key.on("down", () => queue(dir));
		}
		for (const action of ["chop", "build", "upgrade", "makeGate"] as const) {
			this.keys[action].on("down", () => queue(action));
		}
		this.applyZoom();
		this.scale.on("resize", () => this.applyZoom());
	}

	override update(time: number): void {
		this.handleInput(time);
		if (time - this.lastRegrowCheck > REGROW_CHECK_MS) {
			this.lastRegrowCheck = time;
			this.deps.world.markRegrowableStumps();
		}
		this.render();
	}

	// ---------- Input ----------

	/**
	 * Taps are queued so a press shorter than a frame still counts, and so a chop or build
	 * after a quick turn reaches the server after that turn. Holding a key keeps walking.
	 */
	private handleInput(time: number): void {
		if (!this.deps.world.me) return;
		while (this.inputQueue.length > 0) {
			const next = this.inputQueue[0];
			if (this.waitingForConfirm) return;
			if (next === "chop") {
				if (!this.sendChop()) return;
			} else if (next !== undefined && ACTIONS.includes(next)) {
				this.deps.send({ type: next as Exclude<Action, "chop">, seq: this.deps.nextSeq() });
			} else if (next !== undefined) {
				const dir = next as Direction;
				if (time < this.nextMoveAt) return;
				// A tap in a new direction only turns, so players can face an empty tile to build.
				if (this.deps.world.me?.facing === dir) this.sendMove(dir, time);
				else this.sendTurn(dir, time);
			}
			this.inputQueue.shift();
		}
		const held = this.heldDirection();
		if (held && time >= this.nextMoveAt && this.deps.world.me?.facing === held) {
			this.sendMove(held, time);
		}
	}

	private sendTurn(dir: Direction, time: number): void {
		this.deps.world.predictTurn(dir);
		this.deps.send({ type: "turn", dir, seq: this.deps.nextSeq() });
		// Holding the key keeps going: walking starts after a short pause, like Pokémon.
		this.nextMoveAt = time + TURN_PAUSE_MS;
	}

	/**
	 * Sends a chop, first asking for confirmation when facing an ally's fence.
	 * Returns false while waiting for the answer, so the input stays queued.
	 */
	private sendChop(): boolean {
		const { world, send, nextSeq, confirm } = this.deps;
		const me = world.me;
		if (!me) return true;
		const target = stepToward(me.x, me.y, me.facing);
		const key = `${target.x},${target.y}`;
		const fence = world.fenceAt(target.x, target.y);
		const isAllyFence = fence !== null && fence.ownerId !== me.id && world.isAlly(fence.ownerId);
		if (!isAllyFence || this.confirmedAllyFences.has(key)) {
			send({ type: "chop", seq: nextSeq(), confirmAlly: isAllyFence });
			return true;
		}
		this.waitingForConfirm = true;
		const owner = world.handles.get(fence.ownerId) ?? "your ally";
		void confirm(`This fence belongs to your ally ${owner}. Removing it may open their land.`).then(
			(ok) => {
				this.waitingForConfirm = false;
				if (ok) this.confirmedAllyFences.add(key);
				else this.inputQueue.shift();
			},
		);
		return false;
	}

	/** Stops the game from capturing keys while the player types in a text field. */
	setKeyboardEnabled(enabled: boolean): void {
		const kb = this.input.keyboard;
		if (!kb) return;
		kb.enabled = enabled;
		if (enabled) kb.enableGlobalCapture();
		else {
			kb.disableGlobalCapture();
			kb.resetKeys();
		}
	}

	private sendMove(dir: Direction, time: number): void {
		const seq = this.deps.nextSeq();
		this.deps.world.predictMove(dir, seq);
		this.deps.send({ type: "move", dir, seq });
		this.nextMoveAt = time + PACE.moveIntervalMs;
	}

	private heldDirection(): Direction | null {
		return DIRECTIONS.find((dir) => this.keys[dir].some((k) => k.isDown)) ?? null;
	}

	// ---------- Rendering ----------

	private render(): void {
		const { world } = this.deps;
		const changes = world.takeChanges();
		for (const key of changes.chunksRemoved) this.destroyChunk(key);
		for (const key of changes.chunksAdded) this.createChunk(key);
		for (const key of changes.tiles) this.redrawTile(key);
		for (const key of changes.controlChunks) this.redrawOverlay(key);
		for (const id of changes.playersRemoved) this.destroyPlayer(id);
		for (const id of changes.players) this.updatePlayer(id);
		if (changes.meChanged) this.updateMe();
		if (changes.alliancesChanged) this.refreshLabels();
	}

	private createChunk(key: string): void {
		const { world } = this.deps;
		const chunk = world.chunks.get(key);
		if (!chunk) return;
		const origin = chunkOrigin(chunk.cx, chunk.cy);
		const map = this.make.tilemap({
			tileWidth: TILE,
			tileHeight: TILE,
			width: CHUNK_SIZE,
			height: CHUNK_SIZE,
		});
		const tileset = map.addTilesetImage("tiles", "tiles", TILE, TILE, 0, 0);
		if (!tileset) throw new Error("Tileset missing");
		const layer = map.createBlankLayer(key, tileset, origin.x * TILE, origin.y * TILE);
		if (!layer) throw new Error("Could not create chunk layer");
		layer.setDepth(DEPTH.terrain);
		for (let ly = 0; ly < CHUNK_SIZE; ly++) {
			for (let lx = 0; lx < CHUNK_SIZE; lx++) {
				layer.putTileAt(frameFor(world.tileAt(origin.x + lx, origin.y + ly)), lx, ly);
			}
		}
		const overlay = this.add.graphics({ x: origin.x * TILE, y: origin.y * TILE });
		overlay.setDepth(DEPTH.overlay);
		const view: ChunkView = { layer, overlay, fences: new Map() };
		this.chunkViews.set(key, view);
		for (const [tk, diff] of chunk.diffs) if (diff.fence) this.redrawTile(tk);
		this.redrawOverlay(key);
	}

	private destroyChunk(key: string): void {
		const view = this.chunkViews.get(key);
		if (!view) return;
		view.layer.tilemap.destroy();
		view.overlay.destroy();
		for (const f of view.fences.values()) {
			f.img.destroy();
			f.cracks.destroy();
		}
		this.chunkViews.delete(key);
	}

	private redrawTile(key: string): void {
		const { world } = this.deps;
		const [x, y] = parseKey(key);
		const { cx, cy } = chunkOfTile(x, y);
		const view = this.chunkViews.get(chunkKey(cx, cy));
		if (!view) return;
		const origin = chunkOrigin(cx, cy);
		const tile = world.tileAt(x, y);
		view.layer.putTileAt(frameFor(tile), x - origin.x, y - origin.y);

		const existing = view.fences.get(key);
		if (tile.kind !== "fence") {
			existing?.img.destroy();
			existing?.cracks.destroy();
			view.fences.delete(key);
			return;
		}
		const f = tile.fence;
		const fv = existing ?? {
			img: this.add
				.image(x * TILE, y * TILE, "fence-1")
				.setOrigin(0)
				.setDepth(DEPTH.fence),
			cracks: this.add
				.image(x * TILE, y * TILE, "cracks")
				.setOrigin(0)
				.setDepth(DEPTH.fence),
		};
		fv.img.setTexture(`${f.gate ? "gate" : "fence"}-${f.level}`);
		fv.img.setTint(ownerColor(f.ownerId, world.me?.id));
		// Damage shows as cracks that darken as the fence nears breaking (§3).
		const needed = FENCE_LEVELS[f.level - 1]?.chopsToBreak ?? 1;
		fv.cracks.setVisible(f.damage > 0).setAlpha(Math.min(1, 0.35 + (0.65 * f.damage) / needed));
		view.fences.set(key, fv);
	}

	/** Tinted fill for each controlled tile, with a solid edge where ownership changes. */
	private redrawOverlay(key: string): void {
		const { world } = this.deps;
		const view = this.chunkViews.get(key);
		const chunk = world.chunks.get(key);
		if (!view || !chunk) return;
		const g = view.overlay;
		g.clear();
		const origin = chunkOrigin(chunk.cx, chunk.cy);
		for (const [tk, owner] of chunk.control) {
			const [x, y] = parseKey(tk);
			const color = ownerColor(owner, world.me?.id);
			const lx = (x - origin.x) * TILE;
			const ly = (y - origin.y) * TILE;
			g.fillStyle(color, 0.28);
			g.fillRect(lx, ly, TILE, TILE);
			g.fillStyle(color, 0.9);
			const [up, right, down, left] = neighbors4(x, y).map((n) => world.controllerAt(n.x, n.y));
			if (up !== owner) g.fillRect(lx, ly, TILE, 2);
			if (down !== owner) g.fillRect(lx, ly + TILE - 2, TILE, 2);
			if (left !== owner) g.fillRect(lx, ly, 2, TILE);
			if (right !== owner) g.fillRect(lx + TILE - 2, ly, 2, TILE);
		}
	}

	private makePlayerView(id: string, handle: string, x: number, y: number): PlayerView {
		const body = this.add.image(0, 0, "player-down").setOrigin(0);
		body.setTint(ownerColor(id, this.deps.world.me?.id));
		const label = this.add
			.text(TILE / 2, -2, this.deps.world.isAlly(id) ? `♥ ${handle}` : handle, {
				fontFamily: "monospace",
				fontSize: "8px",
				color: this.labelColor(id),
				stroke: "#0f380f",
				strokeThickness: 2,
				resolution: 4,
			})
			.setOrigin(0.5, 1);
		const container = this.add.container(x * TILE, y * TILE, [body, label]);
		container.setDepth(DEPTH.player);
		return { container, body, label };
	}

	/** Gold for you, green for allies, white for everyone else: allies must stand out (CLAUDE.md). */
	private labelColor(id: string): string {
		const { world } = this.deps;
		if (id === world.me?.id) return "#ffd60a";
		return world.isAlly(id) ? "#7cff7c" : "#ffffff";
	}

	private refreshLabels(): void {
		for (const [id, view] of this.playerViews) {
			const p = this.deps.world.players.get(id);
			view.label.setText(p && this.deps.world.isAlly(id) ? `♥ ${p.handle}` : (p?.handle ?? ""));
			view.label.setColor(this.labelColor(id));
		}
	}

	private glide(view: PlayerView, x: number, y: number): void {
		this.tweens.killTweensOf(view.container);
		const dx = Math.abs(view.container.x - x * TILE);
		const dy = Math.abs(view.container.y - y * TILE);
		// Teleports (respawn, correction over several tiles) snap instead of sliding.
		if (dx + dy > TILE * 2) {
			view.container.setPosition(x * TILE, y * TILE);
			return;
		}
		this.tweens.add({
			targets: view.container,
			x: x * TILE,
			y: y * TILE,
			duration: PACE.moveIntervalMs,
		});
	}

	private updatePlayer(id: string): void {
		const p = this.deps.world.players.get(id);
		if (!p) return;
		let view = this.playerViews.get(id);
		if (!view) {
			view = this.makePlayerView(p.id, p.handle, p.x, p.y);
			this.playerViews.set(id, view);
		}
		view.body.setTexture(`player-${p.facing}`);
		this.glide(view, p.x, p.y);
	}

	private destroyPlayer(id: string): void {
		this.playerViews.get(id)?.container.destroy();
		this.playerViews.delete(id);
	}

	private updateMe(): void {
		const me = this.deps.world.me;
		if (!me) return;
		if (!this.me) {
			this.me = this.makePlayerView(me.id, me.handle, me.x, me.y);
			this.me.container.setDepth(DEPTH.player + 1);
			this.cameras.main.startFollow(this.me.container, true);
		}
		this.me.body.setTexture(`player-${me.facing}`);
		this.glide(this.me, me.x, me.y);
		this.deps.onMeChanged();
	}

	private applyZoom(): void {
		// Integer zoom keeps pixels crisp (CLAUDE.md Client and art).
		const { width, height } = this.scale.gameSize;
		const zoom = Math.max(2, Math.floor(Math.min(width, height) / (TILE * 14)));
		this.cameras.main.setZoom(zoom);
		this.cameras.main.setRoundPixels(true);
	}
}
