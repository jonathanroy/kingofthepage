import type { ClientMessage, LookInfo } from "@kotp/shared/protocol";
import { FENCE_LEVELS, type Fence, isSwimmable, moveIntervalFor, PACE } from "@kotp/shared/rules";
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
import { playerFrame } from "../art/characters";
import { HAT_OVERHANG } from "../art/cosmetics";
import { groundKey } from "../art/ground";
import { shade } from "../art/pixels";
import { joinsMask, WALL_OVERHANG, type WallJoins, wantsPennant } from "../art/walls";
import type { ClientWorld } from "../state/clientWorld";
import { ownerColor, ownerColorHex } from "./palette";
import {
	createStaticTextures,
	GroundTiles,
	gateTexture,
	playerSheet,
	TILE,
	wallTexture,
} from "./textures";

export type SceneDeps = {
	readonly world: ClientWorld;
	readonly send: (msg: ClientMessage) => void;
	readonly nextSeq: () => number;
	readonly onMeChanged: () => void;
	/** Meters, food or tools changed (§8, §9). */
	readonly onStatusChanged: () => void;
	/** §10: the shop window, the wardrobe, the compass. */
	readonly openShop: () => void;
	readonly openWardrobe: () => void;
	readonly cycleBase: () => void;
	readonly onCompassChanged: () => void;
	/** Shows the §4 warning before chopping an ally's fence. */
	readonly confirm: (text: string) => Promise<boolean>;
};

type Action =
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
/** A fence laid on the tile just left while walking with F held. */
type TrailBuild = `trail-${Direction}`;
type Input = Direction | Action | TrailBuild;
const ACTIONS: readonly Action[] = [
	"chop",
	"build",
	"upgrade",
	"makeGate",
	"interact",
	"eat",
	"craftSpear",
	"switchTool",
	"wardrobe",
	"cycleBase",
];

type CreatureView = {
	readonly kind: "rabbit" | "deer" | "bear";
	readonly sprite: Phaser.GameObjects.Image;
	readonly hpBar: Phaser.GameObjects.Graphics;
	hp: number;
	moving: boolean;
};

type FenceView = {
	readonly img: Phaser.GameObjects.Image;
	readonly cracks: Phaser.GameObjects.Image;
	pennant: Phaser.GameObjects.Sprite | null;
	fence: Fence;
	open: boolean;
};

type ChunkView = {
	readonly texKey: string;
	readonly tex: Phaser.Textures.CanvasTexture;
	readonly ground: Phaser.GameObjects.Image;
	readonly overlay: Phaser.GameObjects.Graphics;
	readonly groundKeys: Map<string, string>;
	readonly fences: Map<string, FenceView>;
	readonly sparkles: Phaser.GameObjects.Sprite[];
	dirty: boolean;
};

type PlayerView = {
	readonly container: Phaser.GameObjects.Container;
	readonly body: Phaser.GameObjects.Image;
	readonly label: Phaser.GameObjects.Text;
	/** §10 collectibles worn. */
	readonly cape: Phaser.GameObjects.Image;
	readonly hat: Phaser.GameObjects.Image;
	/** §1 Swimming: shown around the chest while the player is in water. */
	readonly ripple: Phaser.GameObjects.Image;
	swimming: boolean;
	pet: Phaser.GameObjects.Image | null;
	look: LookInfo;
	dir: Direction;
	moving: boolean;
};

const DEPTH = { ground: 0, overlay: 1, sparkle: 2, fence: 3, player: 4, fx: 6 } as const;
const REGROW_CHECK_MS = 1000;
const MAX_QUEUED_INPUTS = 4;
const TURN_PAUSE_MS = 120;
const DIRECTIONS = ["up", "down", "left", "right"] as const;
const GLINT_EVERY_MS = 220;
const MAX_GLINTS = 40;
const LABEL_FONT = '"Jersey 10", ui-monospace, monospace';
/** Swimmers sink this many pixels and show only the top rows of their sprite (head and shoulders). */
const SWIM_SINK = 4;
const SWIM_SHOWN = 10;

function around8(x: number, y: number): { x: number; y: number }[] {
	const out: { x: number; y: number }[] = [];
	for (let dy = -1; dy <= 1; dy++) {
		for (let dx = -1; dx <= 1; dx++) if (dx || dy) out.push({ x: x + dx, y: y + dy });
	}
	return out;
}

const OPPOSITE: Record<Direction, Direction> = {
	up: "down",
	down: "up",
	left: "right",
	right: "left",
};

function parseKey(key: string): [number, number] {
	return key.split(",").map(Number) as [number, number];
}

export class WorldScene extends Phaser.Scene {
	private readonly chunkViews = new Map<string, ChunkView>();
	private readonly playerViews = new Map<string, PlayerView>();
	private readonly groundTiles = new GroundTiles();
	/** Gates in loaded chunks, re-checked each frame to swing open for nearby allowed players. */
	private readonly gateKeys = new Set<string>();
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
		interact: Phaser.Input.Keyboard.Key;
		eat: Phaser.Input.Keyboard.Key;
		craftSpear: Phaser.Input.Keyboard.Key;
		switchTool: Phaser.Input.Keyboard.Key;
		wardrobe: Phaser.Input.Keyboard.Key;
		cycleBase: Phaser.Input.Keyboard.Key;
	};
	private shopView: { tent: Phaser.GameObjects.Image; sparkle: Phaser.GameObjects.Sprite } | null =
		null;
	private lastAuraAt = 0;
	/** Whether the player walked while holding F, which makes it a trail rather than a tap. */
	private trailWalked = false;
	private readonly creatureViews = new Map<string, CreatureView>();
	private lastPantry: Record<string, number> | null = null;
	private nextMoveAt = 0;
	/** Holding Space keeps chopping at the server's action pace: walls take hundreds of chops. */
	private nextHeldChopAt = 0;
	private readonly inputQueue: Input[] = [];
	/** Ally fences the player already agreed to chop (§4: the warning comes before the first chop). */
	private readonly confirmedAllyFences = new Set<string>();
	private waitingForConfirm = false;
	private lastRegrowCheck = 0;
	private lastGlintAt = 0;
	private glints = 0;
	private lastWood: number | null = null;
	private lastIron: number | null = null;
	private lastGold: number | null = null;
	private lastGoldCheck = 0;
	/** Players who asked their OS for less motion get no ambient effects. */
	private readonly calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	constructor(private readonly deps: SceneDeps) {
		super("world");
	}

	create(): void {
		createStaticTextures(this);
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
			interact: kb.addKey(K.E),
			eat: kb.addKey(K.X),
			craftSpear: kb.addKey(K.C),
			switchTool: kb.addKey(K.Q),
			wardrobe: kb.addKey(K.V),
			cycleBase: kb.addKey(K.B),
		};
		// Key "down" events, not per-frame polling: Phaser clears a key's just-pressed
		// flag on release, so a tap shorter than a frame would otherwise be lost.
		const queue = (input: Input) => {
			if (this.inputQueue.length < MAX_QUEUED_INPUTS) this.inputQueue.push(input);
		};
		for (const dir of DIRECTIONS) {
			for (const key of this.keys[dir]) key.on("down", () => queue(dir));
		}
		for (const action of ACTIONS) {
			if (action === "build") continue;
			this.keys[action].on("down", () => {
				queue(action);
				if (action === "chop") this.nextHeldChopAt = this.time.now + PACE.actionIntervalMs;
			});
		}
		// F: a tap builds in front; holding it while walking lays a fence on each tile you leave,
		// which makes lines and corners easy. The tap is decided on release.
		this.keys.build.on("down", () => {
			this.trailWalked = false;
		});
		this.keys.build.on("up", () => {
			if (!this.trailWalked) queue("build");
		});
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
		this.animatePlayers(time);
		this.updateGates();
		this.flushChunkTextures();
		if (!this.calm && time - this.lastGlintAt > GLINT_EVERY_MS) {
			this.lastGlintAt = time;
			this.spawnGlint();
		}
		if (time - this.lastGoldCheck > 500) {
			this.lastGoldCheck = time;
			this.checkGoldGain();
		}
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
			if (next?.startsWith("trail-")) {
				const dir = next.slice("trail-".length) as Direction;
				this.deps.send({ type: "build", dir, seq: this.deps.nextSeq() });
			} else if (next === "chop") {
				if (!this.sendChop()) return;
			} else if (next === "wardrobe") {
				this.deps.openWardrobe();
			} else if (next === "cycleBase") {
				this.deps.cycleBase();
				this.deps.onCompassChanged();
			} else if (next === "interact" && this.facingShop()) {
				// §10: interacting with the shop opens its window; buying is a separate intent.
				this.deps.openShop();
			} else if (next === "switchTool") {
				const tool = this.deps.world.status?.tool === "spear" ? "axe" : "spear";
				this.deps.send({ type: "selectTool", tool, seq: this.deps.nextSeq() });
			} else if (next !== undefined && (ACTIONS as readonly string[]).includes(next)) {
				const type = next as Exclude<Action, "chop" | "switchTool" | "wardrobe" | "cycleBase">;
				this.deps.send({ type, seq: this.deps.nextSeq() });
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
		if (this.keys.chop.isDown && time >= this.nextHeldChopAt && this.inputQueue.length === 0) {
			this.inputQueue.push("chop");
			this.nextHeldChopAt = time + PACE.actionIntervalMs;
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
			this.swingAxe();
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
		const me = this.deps.world.me;
		const from = me ? { x: me.x, y: me.y } : null;
		const seq = this.deps.nextSeq();
		this.deps.world.predictMove(dir, seq);
		this.deps.send({ type: "move", dir, seq });
		this.nextMoveAt = time + (me ? moveIntervalFor(this.deps.world.tileAt(me.x, me.y)) : 0);
		const moved = from && me && (me.x !== from.x || me.y !== from.y);
		if (moved && this.keys.build.isDown) {
			// Lay a fence on the tile just left; the server builds it after the move.
			this.trailWalked = true;
			this.inputQueue.push(`trail-${OPPOSITE[dir]}`);
		}
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
		for (const id of changes.creaturesRemoved) this.destroyCreature(id);
		for (const id of changes.creatures) this.updateCreature(id);
		if (changes.statusChanged) this.onStatus();
		if (changes.shopChanged) this.updateShop();
		if (changes.royalChanged) this.refreshPennants();
		if (changes.collectionChanged && this.me && this.deps.world.me) {
			this.applyLook(this.me, this.deps.world.collection.equipped);
		}
		if (changes.basesChanged || changes.meChanged) this.deps.onCompassChanged();
	}

	// ---------- Ground ----------

	private createChunk(key: string): void {
		const { world } = this.deps;
		const chunk = world.chunks.get(key);
		const terrain = world.terrain;
		if (!chunk || !terrain) return;
		const origin = chunkOrigin(chunk.cx, chunk.cy);
		const texKey = `ground-${key}`;
		if (this.textures.exists(texKey)) this.textures.remove(texKey);
		const size = CHUNK_SIZE * TILE;
		const tex = this.textures.createCanvas(texKey, size, size);
		if (!tex) throw new Error("Could not create chunk texture");
		tex.context.imageSmoothingEnabled = false;
		const ground = this.add
			.image(origin.x * TILE, origin.y * TILE, texKey)
			.setOrigin(0)
			.setDepth(DEPTH.ground);
		const overlay = this.add
			.graphics({ x: origin.x * TILE, y: origin.y * TILE })
			.setDepth(DEPTH.overlay);
		const view: ChunkView = {
			texKey,
			tex,
			ground,
			overlay,
			groundKeys: new Map(),
			fences: new Map(),
			sparkles: [],
			dirty: true,
		};
		this.chunkViews.set(key, view);
		for (let ly = 0; ly < CHUNK_SIZE; ly++) {
			for (let lx = 0; lx < CHUNK_SIZE; lx++) {
				const x = origin.x + lx;
				const y = origin.y + ly;
				const tile = world.tileAt(x, y);
				this.paintGround(view, x, y, groundKey(tile, x, y, terrain));
				if (tile.kind === "mine") this.addSparkles(view, x, y, tile.size === "large");
			}
		}
		for (const [tk, diff] of chunk.diffs) {
			if (!diff.fence) continue;
			this.updateFence(tk);
			// Walls in the neighboring chunk may now join across the chunk edge.
			const [fx, fy] = parseKey(tk);
			for (const n of around8(fx, fy)) {
				if (this.viewOf(n.x, n.y) !== view && world.fenceAt(n.x, n.y))
					this.updateFence(`${n.x},${n.y}`);
			}
		}
		this.redrawOverlay(key);
	}

	private paintGround(view: ChunkView, x: number, y: number, gk: string): void {
		const { cx, cy } = chunkOfTile(x, y);
		const origin = chunkOrigin(cx, cy);
		view.tex.context.drawImage(
			this.groundTiles.get(gk),
			(x - origin.x) * TILE,
			(y - origin.y) * TILE,
		);
		view.groundKeys.set(`${x},${y}`, gk);
		view.dirty = true;
	}

	/** Uploads each changed chunk canvas once per frame, however many tiles changed. */
	private flushChunkTextures(): void {
		for (const view of this.chunkViews.values()) {
			if (!view.dirty) continue;
			view.tex.refresh();
			view.dirty = false;
		}
	}

	private addSparkles(view: ChunkView, x: number, y: number, large: boolean): void {
		if (this.calm) return;
		const spots = large
			? [
					[5, 5],
					[13, 12],
					[9, 4],
				]
			: [[4, 6]];
		for (const [sx, sy] of spots as [number, number][]) {
			const sprite = this.add
				.sprite(x * TILE + sx, y * TILE + sy, "sparkle")
				.setDepth(DEPTH.sparkle)
				.setVisible(false);
			// Stagger so mines don't all twinkle in sync.
			this.time.delayedCall(Math.random() * 1500, () => {
				if (!sprite.active) return;
				sprite.setVisible(true).play("sparkle");
			});
			view.sparkles.push(sprite);
		}
	}

	private destroyChunk(key: string): void {
		const view = this.chunkViews.get(key);
		if (!view) return;
		view.ground.destroy();
		view.overlay.destroy();
		for (const s of view.sparkles) s.destroy();
		for (const [tk, f] of view.fences) {
			this.destroyFenceView(f);
			this.gateKeys.delete(tk);
		}
		this.textures.remove(view.texKey);
		this.chunkViews.delete(key);
	}

	private viewOf(x: number, y: number): ChunkView | undefined {
		const { cx, cy } = chunkOfTile(x, y);
		return this.chunkViews.get(chunkKey(cx, cy));
	}

	private redrawTile(key: string): void {
		const { world } = this.deps;
		const terrain = world.terrain;
		const [x, y] = parseKey(key);
		const view = this.viewOf(x, y);
		if (!view || !terrain) return;
		const gk = groundKey(world.tileAt(x, y), x, y, terrain);
		const before = view.groundKeys.get(key);
		if (gk !== before) {
			this.paintGround(view, x, y, gk);
			// A tree just fell: wood chips fly.
			if ((before?.[0] === "t" || before?.[0] === "p") && gk[0] === "s") this.burstChips(x, y, 6);
			// A rock shrank or crumbled: stone chips.
			if (before?.[0] === "o") this.burstChips(x, y, 3);
		}
		this.updateFence(key);
		// Neighbors, diagonal ones included, may need to join or unjoin this tile's wall.
		for (const n of around8(x, y)) {
			const nk = `${n.x},${n.y}`;
			if (this.viewOf(n.x, n.y)?.fences.has(nk) || world.fenceAt(n.x, n.y)) this.updateFence(nk);
		}
	}

	// ---------- Walls and gates ----------

	private joinsAt(x: number, y: number, ownerId: string): WallJoins {
		const same = (dx: number, dy: number) =>
			this.deps.world.fenceAt(x + dx, y + dy)?.ownerId === ownerId;
		const n = same(0, -1);
		const s = same(0, 1);
		const w = same(-1, 0);
		const e = same(1, 0);
		// A corner touch only needs drawing when no straight neighbor already turns that corner.
		return {
			n,
			s,
			w,
			e,
			ne: same(1, -1) && !n && !e,
			nw: same(-1, -1) && !n && !w,
			se: same(1, 1) && !s && !e,
			sw: same(-1, 1) && !s && !w,
		};
	}

	private updateFence(key: string): void {
		const { world } = this.deps;
		const [x, y] = parseKey(key);
		const view = this.viewOf(x, y);
		if (!view) return;
		const existing = view.fences.get(key);
		const fence = world.fenceAt(x, y);
		if (!fence) {
			if (existing) this.destroyFenceView(existing);
			view.fences.delete(key);
			this.gateKeys.delete(key);
			return;
		}
		const joins = this.joinsAt(x, y, fence.ownerId);
		const open = fence.gate && this.gateShouldOpen(x, y, fence);
		const texture = fence.gate
			? gateTexture(this, fence.level, open)
			: wallTexture(this, fence.level, joinsMask(joins));
		const top = y * TILE - WALL_OVERHANG;
		const fv: FenceView = existing ?? {
			img: this.add
				.image(x * TILE, top, texture)
				.setOrigin(0)
				.setDepth(DEPTH.fence),
			cracks: this.add
				.image(x * TILE, top, "cracks")
				.setOrigin(0)
				.setDepth(DEPTH.fence),
			pennant: null,
			fence,
			open,
		};
		fv.img.setTexture(texture);
		// Damage: cracks deepen as the fence nears breaking (§3), and a fresh hit shakes it.
		const needed = FENCE_LEVELS[fence.level - 1]?.chopsToBreak ?? 1;
		fv.cracks
			.setVisible(fence.damage > 0)
			.setAlpha(Math.min(1, 0.3 + (0.7 * fence.damage) / needed));
		if (existing && fence.damage > existing.fence.damage) this.hitWall(fv, x, y);
		this.setPennant(fv, x, y, fence, fence.gate || wantsPennant(joins));
		fv.fence = fence;
		fv.open = open;
		view.fences.set(key, fv);
		if (fence.gate) this.gateKeys.add(key);
		else this.gateKeys.delete(key);
	}

	/** Pennants show who owns a wall: on corners, ends and gates, in the owner's color. */
	private setPennant(fv: FenceView, x: number, y: number, fence: Fence, wanted: boolean): void {
		if (!wanted) {
			fv.pennant?.destroy();
			fv.pennant = null;
			return;
		}
		const postTop = fence.gate ? (fence.level >= 3 ? 2 : 4) : fence.level <= 2 ? 4 : 2;
		const px = fence.gate ? x * TILE + 2 : x * TILE + 8;
		if (!fv.pennant) {
			fv.pennant = this.add
				.sprite(px, y * TILE + postTop, "pennant")
				.setOrigin(0, 1)
				.setDepth(DEPTH.fence);
			if (!this.calm)
				fv.pennant.play({ key: "pennant", startFrame: Math.floor(Math.random() * 2) });
		}
		fv.pennant.setPosition(px, y * TILE + postTop);
		// §10: owners with the royal banner fly gold crowned pennants instead of their color.
		const royal = this.deps.world.royal.has(fence.ownerId);
		const key = royal ? "pennant-royal" : "pennant";
		if (fv.pennant.texture.key !== key) {
			fv.pennant.setTexture(key, 0);
			if (!this.calm) fv.pennant.play(key);
		}
		if (royal) fv.pennant.clearTint();
		else fv.pennant.setTint(ownerColor(fence.ownerId, this.deps.world.me?.id));
	}

	private destroyFenceView(fv: FenceView): void {
		fv.img.destroy();
		fv.cracks.destroy();
		fv.pennant?.destroy();
	}

	/** A gate swings open while someone stands in it, or when you or an ally of its owner is next to it. */
	private gateShouldOpen(x: number, y: number, fence: Fence): boolean {
		const { world } = this.deps;
		const me = world.me;
		const standing = (px: number, py: number) =>
			(me && me.x === px && me.y === py) ||
			[...world.players.values()].some((p) => p.x === px && p.y === py);
		if (standing(x, y)) return true;
		if (!me || (fence.ownerId !== me.id && !world.isAlly(fence.ownerId))) return false;
		return Math.abs(me.x - x) + Math.abs(me.y - y) === 1;
	}

	private updateGates(): void {
		for (const key of this.gateKeys) {
			const [x, y] = parseKey(key);
			const fv = this.viewOf(x, y)?.fences.get(key);
			if (!fv) continue;
			const open = this.gateShouldOpen(x, y, fv.fence);
			if (open === fv.open) continue;
			fv.open = open;
			fv.img.setTexture(gateTexture(this, fv.fence.level, open));
		}
	}

	// ---------- Land ----------

	/** A light tint over owned land and a dashed border in the owner's color. */
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
			const hex = ownerColorHex(owner, world.me?.id);
			const border = Number.parseInt(shade(hex, 0.7).slice(1), 16);
			const lx = (x - origin.x) * TILE;
			const ly = (y - origin.y) * TILE;
			g.fillStyle(Number.parseInt(hex.slice(1), 16), 0.16);
			g.fillRect(lx, ly, TILE, TILE);
			g.fillStyle(border, 0.95);
			const [up, right, down, left] = neighbors4(x, y).map((n) => world.controllerAt(n.x, n.y));
			for (let i = 0; i < TILE; i += 4) {
				if (up !== owner) g.fillRect(lx + i, ly + 1, 2, 1);
				if (down !== owner) g.fillRect(lx + i, ly + TILE - 2, 2, 1);
				if (left !== owner) g.fillRect(lx + 1, ly + i, 1, 2);
				if (right !== owner) g.fillRect(lx + TILE - 2, ly + i, 1, 2);
			}
		}
	}

	// ---------- Players ----------

	private makePlayerView(
		id: string,
		handle: string,
		x: number,
		y: number,
		dir: Direction,
	): PlayerView {
		const sheet = playerSheet(this, ownerColorHex(id, this.deps.world.me?.id));
		const body = this.add.image(0, 0, sheet, playerFrame(dir, 0)).setOrigin(0);
		const label = this.add
			.text(TILE / 2, -2, this.deps.world.isAlly(id) ? `♥ ${handle}` : handle, {
				fontFamily: LABEL_FONT,
				fontSize: "10px",
				color: this.labelColor(id),
				stroke: "#2b2233",
				strokeThickness: 2,
				resolution: 4,
			})
			.setOrigin(0.5, 1);
		const cape = this.add.image(0, 0, "chip").setOrigin(0).setVisible(false);
		const hat = this.add.image(0, -HAT_OVERHANG, "chip").setOrigin(0).setVisible(false);
		const ripple = this.add
			.image(0, SWIM_SINK + SWIM_SHOWN - 2, "ripple")
			.setOrigin(0)
			.setVisible(false);
		const container = this.add.container(x * TILE, y * TILE, [cape, body, ripple, hat, label]);
		container.setDepth(DEPTH.player);
		const view: PlayerView = {
			container,
			body,
			label,
			cape,
			hat,
			ripple,
			swimming: false,
			pet: null,
			look: {},
			dir,
			moving: false,
		};
		return view;
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
		const fromX = view.container.x;
		const fromY = view.container.y;
		const dx = Math.abs(fromX - x * TILE);
		const dy = Math.abs(fromY - y * TILE);
		if (dx + dy === 0) return;
		this.tweens.killTweensOf(view.container);
		// Teleports (respawn, correction over several tiles) snap instead of sliding.
		if (dx + dy > TILE * 2) {
			view.container.setPosition(x * TILE, y * TILE);
			view.moving = false;
			return;
		}
		view.moving = true;
		const duration = moveIntervalFor(this.deps.world.tileAt(x, y));
		if (!view.swimming) this.puffDust(fromX, fromY);
		if (view.pet) {
			// The pet trots one step behind, into the tile its owner just left.
			view.pet.setFlipX(x * TILE > fromX);
			this.tweens.killTweensOf(view.pet);
			this.tweens.add({
				targets: view.pet,
				x: fromX,
				y: fromY,
				duration: duration + 60,
			});
		}
		this.tweens.add({
			targets: view.container,
			x: x * TILE,
			y: y * TILE,
			duration,
			onComplete: () => {
				view.moving = false;
			},
		});
	}

	/** Walk cycle while gliding, standing frame otherwise. Two steps per tile. */
	private animatePlayers(time: number): void {
		const step = Math.floor(time / (PACE.moveIntervalMs / 2));
		const all = this.me ? [...this.playerViews.values(), this.me] : [...this.playerViews.values()];
		for (const view of all) {
			view.body.setFrame(playerFrame(view.dir, view.moving ? step : 0));
		}
		for (const view of all) {
			this.updateSwimming(view, time);
			this.orderCape(view);
			if (view.pet) view.pet.setFrame(view.moving ? Math.floor(time / 150) % 2 : 0);
		}
		if (!this.calm && time - this.lastAuraAt > 350) {
			this.lastAuraAt = time;
			for (const view of all) if (view.look.aura) this.auraStar(view);
		}
		const creatureStep = Math.floor(time / 180) % 2;
		for (const v of this.creatureViews.values()) v.sprite.setFrame(v.moving ? creatureStep : 0);
	}

	private updatePlayer(id: string): void {
		const p = this.deps.world.players.get(id);
		if (!p) return;
		let view = this.playerViews.get(id);
		if (!view) {
			view = this.makePlayerView(p.id, p.handle, p.x, p.y, p.facing);
			this.playerViews.set(id, view);
		}
		view.dir = p.facing;
		this.applyLook(view, p.look);
		this.glide(view, p.x, p.y);
	}

	private destroyPlayer(id: string): void {
		const view = this.playerViews.get(id);
		view?.pet?.destroy();
		view?.container.destroy();
		this.playerViews.delete(id);
	}

	// ---------- Collectibles (§10) ----------

	/** Hat, cape, pet and glowing name; auras are drawn each frame in `animatePlayers`. */
	private applyLook(view: PlayerView, look: LookInfo): void {
		view.look = look;
		view.hat.setVisible(!!look.hat);
		if (look.hat) view.hat.setTexture(`hat-${look.hat}`);
		view.cape.setVisible(!!look.cape);
		if (look.cape) view.cape.setTexture(`cape-${look.cape}`);
		if (look.pet && !view.pet) {
			view.pet = this.add
				.image(view.container.x - TILE, view.container.y, `pet-${look.pet}`, 0)
				.setOrigin(0)
				.setDepth(DEPTH.player - 0.2);
		}
		if (view.pet && !look.pet) {
			view.pet.destroy();
			view.pet = null;
		}
		if (view.pet && look.pet) view.pet.setTexture(`pet-${look.pet}`, 0);
		const glowing = look.name === "glowing-name";
		view.label.setShadow(0, 0, "#ffd23f", glowing ? 4 : 0, true, true);
		if (glowing) view.label.setColor("#fff3b0");
		this.orderCape(view);
	}

	/** Seen from behind, the cape covers the back; otherwise it hangs behind the body. */
	/** §1 Swimming: switches to head-and-shoulders with a ripple once the player is mostly in water. */
	private updateSwimming(view: PlayerView, time: number): void {
		const tx = Math.round(view.container.x / TILE);
		const ty = Math.round(view.container.y / TILE);
		const swimming = isSwimmable(this.deps.world.tileAt(tx, ty));
		if (swimming) view.ripple.setFlipX(Math.floor(time / 400) % 2 === 1);
		if (swimming === view.swimming) return;
		view.swimming = swimming;
		const sink = swimming ? SWIM_SINK : 0;
		if (swimming) view.body.setCrop(0, 0, TILE, SWIM_SHOWN);
		else view.body.setCrop();
		view.body.setY(sink);
		view.hat.setY(-HAT_OVERHANG + sink);
		view.ripple.setVisible(swimming);
		view.cape.setAlpha(swimming ? 0 : 1);
	}

	private orderCape(view: PlayerView): void {
		if (view.dir === "up") view.container.moveAbove(view.cape, view.body);
		else view.container.moveBelow(view.cape, view.body);
		view.hat.setFlipX(view.dir === "right");
	}

	private facingShop(): boolean {
		const { me, shop } = this.deps.world;
		if (!me || !shop) return false;
		const at = stepToward(me.x, me.y, me.facing);
		return at.x === shop.x && at.y === shop.y;
	}

	private updateShop(): void {
		const shop = this.deps.world.shop;
		this.shopView?.tent.destroy();
		this.shopView?.sparkle.destroy();
		this.shopView = null;
		if (!shop) return;
		const tent = this.add
			.image(shop.x * TILE, shop.y * TILE, "shop-tent")
			.setOrigin(0)
			.setDepth(DEPTH.fence);
		const sparkle = this.add
			.sprite(shop.x * TILE + 7, shop.y * TILE + 2, "sparkle")
			.setDepth(DEPTH.sparkle + 2);
		if (!this.calm) sparkle.play("sparkle");
		this.shopView = { tent, sparkle };
	}

	private refreshPennants(): void {
		for (const view of this.chunkViews.values()) {
			for (const [key, fv] of view.fences) {
				const [x, y] = parseKey(key);
				if (fv.pennant) this.setPennant(fv, x, y, fv.fence, true);
			}
		}
	}

	private updateMe(): void {
		const me = this.deps.world.me;
		if (!me) return;
		if (!this.me) {
			this.me = this.makePlayerView(me.id, me.handle, me.x, me.y, me.facing);
			this.me.container.setDepth(DEPTH.player + 1);
			this.cameras.main.startFollow(this.me.container, true);
		}
		this.me.dir = me.facing;
		this.glide(this.me, me.x, me.y);
		if (this.lastWood !== null && me.wood > this.lastWood)
			this.floatGain(`+${me.wood - this.lastWood}`, "log");
		if (this.lastIron !== null && me.iron > this.lastIron) {
			this.floatGain(`+${me.iron - this.lastIron}`, "ingot");
		}
		this.lastWood = me.wood;
		this.lastIron = me.iron;
		this.deps.onMeChanged();
	}

	// ---------- Creatures (§9) ----------

	private updateCreature(id: string): void {
		const c = this.deps.world.creatures.get(id);
		if (!c) return;
		let view = this.creatureViews.get(id);
		if (!view) {
			const sprite = this.add
				.image(c.x * TILE, c.y * TILE, `creature-${c.kind}`, 0)
				.setOrigin(0)
				.setDepth(DEPTH.player);
			const hpBar = this.add.graphics().setDepth(DEPTH.fx);
			view = { kind: c.kind, sprite, hpBar, hp: c.hp, moving: false };
			this.creatureViews.set(id, view);
		}
		const v = view;
		// Sprites face left; mirror them when walking right.
		if (c.facing === "right") v.sprite.setFlipX(true);
		if (c.facing === "left") v.sprite.setFlipX(false);
		if (c.hp < v.hp) {
			v.sprite.setTint(0xff6060);
			this.time.delayedCall(120, () => {
				if (v.sprite.active) v.sprite.clearTint();
			});
		}
		v.hp = c.hp;
		const tx = c.x * TILE;
		const ty = c.y * TILE;
		if (v.sprite.x !== tx || v.sprite.y !== ty) {
			this.tweens.killTweensOf(v.sprite);
			v.moving = true;
			const duration = c.kind === "bear" ? 600 : c.kind === "deer" ? 360 : 420;
			this.tweens.add({
				targets: v.sprite,
				x: tx,
				y: ty,
				duration,
				onUpdate: () => this.drawHpBar(v, v.hp, c.maxHp),
				onComplete: () => {
					v.moving = false;
				},
			});
		}
		this.drawHpBar(v, c.hp, c.maxHp);
	}

	/** Bears always show their health; animals only once hurt. */
	private drawHpBar(v: CreatureView, hp: number, max: number): void {
		const g = v.hpBar;
		g.clear();
		if (v.kind !== "bear" && hp >= max) return;
		const x = v.sprite.x;
		const y = v.sprite.y;
		g.fillStyle(0x2b2233, 1).fillRect(x + 1, y - 3, 14, 3);
		g.fillStyle(0xe8423f, 1).fillRect(x + 2, y - 2, Math.max(1, Math.round((12 * hp) / max)), 1);
	}

	private destroyCreature(id: string): void {
		const v = this.creatureViews.get(id);
		if (!v) return;
		v.sprite.destroy();
		v.hpBar.destroy();
		this.creatureViews.delete(id);
	}

	/** HUD refresh, plus "+N" pop-ups when food lands in the bag. */
	private onStatus(): void {
		const status = this.deps.world.status;
		if (!status) return;
		const pantry = { ...status.pantry };
		if (this.lastPantry) {
			for (const food of ["apple", "berries", "potato", "meat"] as const) {
				const gained = pantry[food] - (this.lastPantry[food] ?? 0);
				if (gained > 0) this.floatGain(`+${gained}`, `food-${food}`);
			}
		}
		this.lastPantry = pantry;
		this.deps.onStatusChanged();
	}

	// ---------- Effects ----------

	private swingAxe(): void {
		const view = this.me;
		const me = this.deps.world.me;
		if (!view || !me) return;
		const offsets: Record<Direction, [number, number, boolean]> = {
			right: [12, 6, false],
			left: [-4, 6, true],
			down: [10, 10, false],
			up: [10, -2, false],
		};
		const [ox, oy, flip] = offsets[me.facing];
		if (this.deps.world.status?.tool === "spear") {
			// Spear: a quick thrust toward the faced tile.
			const angle = { right: 0, left: 180, down: 90, up: -90 }[me.facing];
			const spear = this.add
				.image(view.container.x + 8, view.container.y + 9, "spear")
				.setOrigin(0, 0.5)
				.setAngle(angle)
				.setDepth(DEPTH.fx);
			const reach = 6;
			const dx = me.facing === "right" ? reach : me.facing === "left" ? -reach : 0;
			const dy = me.facing === "down" ? reach : me.facing === "up" ? -reach : 0;
			this.tweens.add({
				targets: spear,
				x: spear.x + dx,
				y: spear.y + dy,
				yoyo: true,
				duration: 90,
				onComplete: () => spear.destroy(),
			});
			return;
		}
		const axe = this.add
			.image(view.container.x + ox, view.container.y + oy, "axe")
			.setOrigin(0)
			.setFlipX(flip)
			.setDepth(DEPTH.fx);
		this.tweens.add({
			targets: axe,
			angle: flip ? -35 : 35,
			yoyo: true,
			duration: 80,
			onComplete: () => axe.destroy(),
		});
	}

	private burstChips(x: number, y: number, count: number): void {
		if (this.calm) return;
		for (let i = 0; i < count; i++) {
			const chip = this.add.image(x * TILE + 8, y * TILE + 8, "chip").setDepth(DEPTH.fx);
			const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
			this.tweens.add({
				targets: chip,
				x: chip.x + Math.cos(angle) * (6 + Math.random() * 6),
				y: chip.y + Math.sin(angle) * 6 - 4,
				alpha: 0,
				duration: 350 + Math.random() * 150,
				ease: "Quad.easeOut",
				onComplete: () => chip.destroy(),
			});
		}
	}

	private hitWall(fv: FenceView, x: number, y: number): void {
		this.burstChips(x, y, 3);
		if (this.calm) return;
		this.tweens.add({
			targets: [fv.img, fv.cracks],
			x: x * TILE + 1,
			yoyo: true,
			duration: 40,
			repeat: 1,
			onComplete: () => {
				fv.img.setX(x * TILE);
				fv.cracks.setX(x * TILE);
			},
		});
	}

	/** §10 Starlight Aura: a star drifts up around the wearer. */
	private auraStar(view: PlayerView): void {
		const star = this.add
			.sprite(
				view.container.x + 2 + Math.random() * 12,
				view.container.y + 4 + Math.random() * 10,
				"sparkle",
			)
			.setDepth(DEPTH.fx)
			.play("sparkle");
		this.tweens.add({
			targets: star,
			y: star.y - 8,
			alpha: 0,
			duration: 700,
			onComplete: () => star.destroy(),
		});
	}

	private puffDust(x: number, y: number): void {
		if (this.calm) return;
		const dust = this.add
			.image(x + 6, y + 13, "dust")
			.setOrigin(0)
			.setDepth(DEPTH.player - 0.5)
			.setAlpha(0.7);
		this.tweens.add({
			targets: dust,
			alpha: 0,
			y: dust.y - 2,
			duration: 300,
			onComplete: () => dust.destroy(),
		});
	}

	/** "+2" with an icon rising above your head: wood from a chop, gold from your mines. */
	private floatGain(text: string, icon: string): void {
		const view = this.me;
		if (!view) return;
		const x = view.container.x + 2;
		const y = view.container.y - 12;
		const img = this.add.image(x, y, icon).setOrigin(0, 0.5).setDepth(DEPTH.fx);
		const label = this.add
			.text(x + 9, y, text, {
				fontFamily: LABEL_FONT,
				fontSize: "10px",
				color: icon === "coin" ? "#fff3b0" : "#ffffff",
				stroke: "#2b2233",
				strokeThickness: 2,
				resolution: 4,
			})
			.setOrigin(0, 0.5)
			.setDepth(DEPTH.fx);
		this.tweens.add({
			targets: [img, label],
			y: y - (this.calm ? 0 : 10),
			alpha: { from: 1, to: 0 },
			delay: 250,
			duration: 700,
			onComplete: () => {
				img.destroy();
				label.destroy();
			},
		});
	}

	private checkGoldGain(): void {
		const gold = Math.floor(this.deps.world.liveGold());
		if (this.lastGold !== null && gold > this.lastGold)
			this.floatGain(`+${gold - this.lastGold}`, "coin");
		this.lastGold = gold;
	}

	/** Brief sparkles on water in view; cheaper than redrawing the water itself. */
	private spawnGlint(): void {
		if (this.glints >= MAX_GLINTS) return;
		const view = this.cameras.main.worldView;
		const x = Math.floor((view.x + Math.random() * view.width) / TILE);
		const y = Math.floor((view.y + Math.random() * view.height) / TILE);
		if (this.deps.world.tileAt(x, y).kind !== "water") return;
		const glint = this.add
			.image(
				x * TILE + 3 + Math.floor(Math.random() * 9),
				y * TILE + 4 + Math.floor(Math.random() * 9),
				"glint",
			)
			.setOrigin(0)
			.setDepth(DEPTH.sparkle)
			.setAlpha(0);
		this.glints++;
		this.tweens.add({
			targets: glint,
			alpha: 0.9,
			yoyo: true,
			duration: 450,
			onComplete: () => {
				glint.destroy();
				this.glints--;
			},
		});
	}

	private applyZoom(): void {
		// Integer zoom keeps pixels crisp (CLAUDE.md Client and art).
		const { width, height } = this.scale.gameSize;
		const zoom = Math.max(2, Math.floor(Math.min(width, height) / (TILE * 14)));
		this.cameras.main.setZoom(zoom);
		this.cameras.main.setRoundPixels(true);
	}
}
