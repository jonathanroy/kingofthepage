import type { ActionRejectReason, CreatureInfo } from "@kotp/shared/protocol";
import {
	bearCanClaw,
	CREATURES,
	type CreatureKind,
	creatureMaxHp,
	drawBearDelay,
	meatFrom,
	PACE,
} from "@kotp/shared/rules";
import {
	type Direction,
	neighbors4,
	stepToward,
	type TileCoord,
	tileKey,
} from "@kotp/shared/world";
import type { PlayerState, World, WorldEvent } from "./world";

type Creature = {
	readonly id: string;
	readonly kind: CreatureKind;
	x: number;
	y: number;
	facing: Direction;
	hp: number;
	nextMoveAt: number;
	nextActionAt: number;
	/** Bears give up and leave after a while (§9). */
	expiresAt: number;
};

export type WildlifeDeps = {
	readonly random: () => number;
	readonly newId: () => string;
	/** Off in most tests, which place creatures by hand. */
	readonly autoSpawn?: boolean;
};

export type WildlifeUpdate = {
	readonly events: WorldEvent[];
	/** Players a bear bit to death this update. */
	readonly killed: string[];
};

const ANIMAL_CHECK_MS = 1000;
const BEAR_CHECK_MS = 5_000;
const ANIMAL_RANGE = 20;

const distance = (a: TileCoord, b: TileCoord) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function directionOf(from: TileCoord, to: TileCoord): Direction {
	if (to.x > from.x) return "right";
	if (to.x < from.x) return "left";
	return to.y > from.y ? "down" : "up";
}

/**
 * Rabbits, deer and zombie bears (§9). They live only in memory around online players:
 * animals come and go as players move, and bears are a rare event aimed at one player.
 */
export class Wildlife {
	private readonly creatures = new Map<string, Creature>();
	private readonly byTile = new Map<string, string>();
	private lastAnimalCheck = 0;
	private lastBearCheck = 0;

	constructor(
		private readonly world: World,
		private readonly deps: WildlifeDeps,
	) {
		world.setCreatureLookup((x, y) => this.byTile.has(tileKey(x, y)));
	}

	info(id: string): CreatureInfo | null {
		const c = this.creatures.get(id);
		if (!c) return null;
		return {
			id: c.id,
			kind: c.kind,
			x: c.x,
			y: c.y,
			facing: c.facing,
			hp: c.hp,
			maxHp: creatureMaxHp(c.kind),
		};
	}

	all(): CreatureInfo[] {
		return [...this.creatures.keys()]
			.map((id) => this.info(id))
			.filter((c): c is CreatureInfo => c !== null);
	}

	hasCreatureAt(x: number, y: number): boolean {
		return this.byTile.has(tileKey(x, y));
	}

	/** Places a creature directly; for tests and admin tools. */
	spawn(kind: CreatureKind, x: number, y: number, now: number): string {
		const id = this.deps.newId();
		const c: Creature = {
			id,
			kind,
			x,
			y,
			facing: "down",
			hp: creatureMaxHp(kind),
			nextMoveAt: now + CREATURES[kind].moveMs,
			nextActionAt: now,
			expiresAt: kind === "bear" ? now + CREATURES.bear.lifetimeMs : Number.POSITIVE_INFINITY,
		};
		this.creatures.set(id, c);
		this.byTile.set(tileKey(x, y), id);
		return id;
	}

	/** One game tick: spawning, despawning, and every creature's next step. */
	update(now: number): WildlifeUpdate {
		const events: WorldEvent[] = [];
		const killed: string[] = [];
		const players = this.world.onlinePlayers();
		const autoSpawn = this.deps.autoSpawn ?? true;
		if (autoSpawn && now - this.lastAnimalCheck >= ANIMAL_CHECK_MS) {
			this.lastAnimalCheck = now;
			this.balanceAnimals(players, now, events);
		}
		if (autoSpawn && now - this.lastBearCheck >= BEAR_CHECK_MS) {
			// A long gap (first check after start, a stalled loop) counts as one check, not a burst.
			const elapsed =
				this.lastBearCheck === 0
					? BEAR_CHECK_MS
					: Math.min(now - this.lastBearCheck, 2 * BEAR_CHECK_MS);
			this.lastBearCheck = now;
			this.maybeSendBears(players, elapsed, now, events);
		}
		for (const c of [...this.creatures.values()]) {
			if (c.kind === "bear") this.updateBear(c, players, now, events, killed);
			else this.updateAnimal(c, players, now, events);
		}
		return { events, killed };
	}

	/** §9: the spear hits whatever creature stands in front of the player. */
	spearHit(
		p: PlayerState,
		now: number,
	):
		| { ok: true; events: WorldEvent[] }
		| { ok: false; reason: ActionRejectReason; events: WorldEvent[] } {
		p.nextActionAt = now + PACE.actionIntervalMs;
		const at = stepToward(p.x, p.y, p.facing);
		const id = this.byTile.get(tileKey(at.x, at.y));
		const c = id ? this.creatures.get(id) : undefined;
		if (!c) {
			const tile = this.world.tileAt(at.x, at.y, now);
			const axeWork = tile.kind === "tree" || tile.kind === "ore" || tile.kind === "fence";
			return { ok: false, reason: axeWork ? "useAxe" : "nothingToHit", events: [] };
		}
		this.world.spendWork(p.id);
		c.hp -= 1;
		const events: WorldEvent[] = [{ kind: "status", id: p.id }];
		if (c.hp > 0) {
			// Hurt animals bolt right away.
			if (c.kind !== "bear") c.nextMoveAt = now;
			events.push({ kind: "creature", id: c.id, fromX: c.x, fromY: c.y });
			return { ok: true, events };
		}
		this.remove(c, events);
		const meat = meatFrom(c.kind);
		if (meat > 0) this.world.addFood(p.id, "meat", meat);
		return { ok: true, events };
	}

	// ---------- Animals ----------

	private balanceAnimals(players: PlayerState[], now: number, events: WorldEvent[]): void {
		for (const c of [...this.creatures.values()]) {
			if (c.kind === "bear") continue;
			const near = players.some((p) => distance(p, c) <= CREATURES.despawnRange);
			if (!near) this.remove(c, events);
		}
		for (const p of players) {
			const around = [...this.creatures.values()].filter(
				(c) => c.kind !== "bear" && distance(p, c) <= ANIMAL_RANGE,
			).length;
			if (around >= CREATURES.animalsPerPlayer) continue;
			const spot = this.findSpot(p, CREATURES.animalSpawnMin, CREATURES.animalSpawnMax, now);
			if (!spot) continue;
			const kind: CreatureKind = this.deps.random() < 0.7 ? "rabbit" : "deer";
			const id = this.spawn(kind, spot.x, spot.y, now);
			events.push({ kind: "creature", id, fromX: spot.x, fromY: spot.y });
		}
	}

	private updateAnimal(
		c: Creature,
		players: PlayerState[],
		now: number,
		events: WorldEvent[],
	): void {
		if (now < c.nextMoveAt) return;
		const stats = CREATURES[c.kind as "rabbit" | "deer"];
		c.nextMoveAt = now + stats.moveMs;
		const threat = players.find((p) => distance(p, c) <= stats.fleeRange);
		const options = neighbors4(c.x, c.y).filter((n) => this.isOpen(n, now));
		if (options.length === 0) return;
		let to: TileCoord | undefined;
		if (threat) {
			// Flee: the step that gets farthest from the closest player.
			to = options.sort((a, b) => distance(b, threat) - distance(a, threat))[0];
		} else if (this.deps.random() < 0.35) {
			to = options[Math.floor(this.deps.random() * options.length)];
		}
		if (to) this.moveTo(c, to, events);
	}

	// ---------- Zombie bears ----------

	/** Counts down each online player's bear timer; at zero, a bear comes for them. */
	private maybeSendBears(
		players: PlayerState[],
		elapsed: number,
		now: number,
		events: WorldEvent[],
	): void {
		for (const p of players) {
			const dueIn = (p.bearDueIn ?? drawBearDelay(this.deps.random)) - elapsed;
			if (dueIn > 0) {
				this.world.setBearDueIn(p.id, dueIn);
				continue;
			}
			// Waits at zero while a bear is already around or there's no room for one.
			this.world.setBearDueIn(p.id, 0);
			if (this.bearNear(p)) continue;
			const spot = this.findSpot(p, CREATURES.bearSpawnMin, CREATURES.bearSpawnMax, now);
			if (!spot) continue;
			this.world.setBearDueIn(p.id, drawBearDelay(this.deps.random));
			const id = this.spawn("bear", spot.x, spot.y, now);
			events.push({ kind: "creature", id, fromX: spot.x, fromY: spot.y });
			events.push({ kind: "notice", id: p.id, notice: { kind: "bearComing" } });
		}
	}

	private bearNear(p: PlayerState): boolean {
		for (const c of this.creatures.values()) {
			if (c.kind === "bear" && distance(p, c) <= CREATURES.despawnRange) return true;
		}
		return false;
	}

	private updateBear(
		c: Creature,
		players: PlayerState[],
		now: number,
		events: WorldEvent[],
		killed: string[],
	): void {
		if (now >= c.expiresAt) {
			this.remove(c, events);
			return;
		}
		const target = players.reduce<PlayerState | null>(
			(best, p) => (best === null || distance(p, c) < distance(best, c) ? p : best),
			null,
		);
		if (!target) return;
		const stats = CREATURES.bear;
		if (distance(target, c) === 1) {
			if (now < c.nextActionAt) return;
			c.nextActionAt = now + stats.biteMs;
			c.facing = directionOf(c, target);
			events.push({ kind: "creature", id: c.id, fromX: c.x, fromY: c.y });
			if (this.world.hurtPlayer(target.id, stats.biteDamage)) killed.push(target.id);
			events.push({ kind: "status", id: target.id });
			return;
		}
		if (now < c.nextMoveAt) return;
		c.nextMoveAt = now + stats.moveMs;
		// Try the steps that close the distance first, clawing through weak fences in the way.
		const steps = neighbors4(c.x, c.y).sort((a, b) => distance(a, target) - distance(b, target));
		for (const step of steps.slice(0, 2)) {
			if (this.isOpen(step, now)) {
				this.moveTo(c, step, events);
				return;
			}
			const tile = this.world.tileAt(step.x, step.y, now);
			if (tile.kind === "fence" && bearCanClaw(tile.fence) && now >= c.nextActionAt) {
				c.nextActionAt = now + stats.clawMs;
				c.facing = directionOf(c, step);
				events.push({ kind: "creature", id: c.id, fromX: c.x, fromY: c.y });
				events.push(...this.world.clawFence(step.x, step.y, stats.clawDamage, now));
				return;
			}
		}
		// Blocked by a strong wall or terrain: shuffle sideways and keep looking for a way.
		const sideways = steps.filter((s) => this.isOpen(s, now));
		const pick = sideways[Math.floor(this.deps.random() * sideways.length)];
		if (pick) this.moveTo(c, pick, events);
	}

	// ---------- Helpers ----------

	private isOpen(t: TileCoord, now: number): boolean {
		return !this.byTile.has(tileKey(t.x, t.y)) && this.world.isOpenForCreature(t.x, t.y, now);
	}

	/** Open, unclaimed ground at a distance from `from`, so creatures never appear inside land. */
	private findSpot(from: TileCoord, min: number, max: number, now: number): TileCoord | null {
		for (let attempt = 0; attempt < 12; attempt++) {
			const d = min + this.deps.random() * (max - min);
			const angle = this.deps.random() * Math.PI * 2;
			const spot = {
				x: from.x + Math.round(Math.cos(angle) * d),
				y: from.y + Math.round(Math.sin(angle) * d),
			};
			if (this.isOpen(spot, now) && this.world.land.enclosuresAt(spot.x, spot.y).length === 0)
				return spot;
		}
		return null;
	}

	private moveTo(c: Creature, to: TileCoord, events: WorldEvent[]): void {
		const from = { x: c.x, y: c.y };
		this.byTile.delete(tileKey(c.x, c.y));
		c.facing = directionOf(from, to);
		c.x = to.x;
		c.y = to.y;
		this.byTile.set(tileKey(c.x, c.y), c.id);
		events.push({ kind: "creature", id: c.id, fromX: from.x, fromY: from.y });
	}

	private remove(c: Creature, events: WorldEvent[]): void {
		this.creatures.delete(c.id);
		this.byTile.delete(tileKey(c.x, c.y));
		events.push({ kind: "creatureGone", id: c.id, x: c.x, y: c.y });
	}
}
