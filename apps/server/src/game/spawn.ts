import { isWalkable, SPAWN } from "@kotp/shared/rules";
import { neighbors4, type TileCoord, tileKey } from "@kotp/shared/world";
import type { World } from "./world";

/**
 * §1 Players and spawning: a random unenclosed tile near an existing fence,
 * or anywhere when no fence exists yet.
 */
export function findSpawnTile(world: World, random: () => number, now: number): TileCoord {
	const fences = world.fencePositions();
	for (let attempt = 0; attempt < SPAWN.attempts; attempt++) {
		const candidate =
			fences.length > 0 ? nearFence(fences, random) : inWilderness(random, SPAWN.wildernessRadius);
		if (isGoodSpawn(world, candidate, now)) return candidate;
	}
	// Every fence may be deep inside claimed land; fall back to wider wilderness.
	for (let attempt = 0; attempt < SPAWN.attempts; attempt++) {
		const candidate = inWilderness(random, SPAWN.wildernessRadius * 4);
		if (isGoodSpawn(world, candidate, now)) return candidate;
	}
	throw new Error("No spawn tile found");
}

function nearFence(fences: readonly TileCoord[], random: () => number): TileCoord {
	const fence = fences[Math.floor(random() * fences.length)] as TileCoord;
	const distance = SPAWN.nearFenceMin + random() * (SPAWN.nearFenceMax - SPAWN.nearFenceMin);
	const angle = random() * Math.PI * 2;
	return {
		x: fence.x + Math.round(Math.cos(angle) * distance),
		y: fence.y + Math.round(Math.sin(angle) * distance),
	};
}

function inWilderness(random: () => number, radius: number): TileCoord {
	return {
		x: Math.round((random() * 2 - 1) * radius),
		y: Math.round((random() * 2 - 1) * radius),
	};
}

function isOpenGround(world: World, t: TileCoord, now: number): boolean {
	return isWalkable(world.tileAt(t.x, t.y, now)) && world.land.enclosuresAt(t.x, t.y).length === 0;
}

function isGoodSpawn(world: World, t: TileCoord, now: number): boolean {
	return isOpenGround(world, t, now) && !world.isOccupied(t.x, t.y) && canEscape(world, t, now);
}

/** True when open ground connects the tile to somewhere far away, so a new player isn't boxed in. */
function canEscape(world: World, start: TileCoord, now: number): boolean {
	const seen = new Set([tileKey(start.x, start.y)]);
	const queue: TileCoord[] = [start];
	const limit = SPAWN.escapeDistance * SPAWN.escapeDistance * 4;
	for (let i = 0; i < queue.length && seen.size < limit; i++) {
		const c = queue[i] as TileCoord;
		if (Math.abs(c.x - start.x) + Math.abs(c.y - start.y) >= SPAWN.escapeDistance) return true;
		for (const n of neighbors4(c.x, c.y)) {
			const key = tileKey(n.x, n.y);
			if (seen.has(key) || !isOpenGround(world, n, now)) continue;
			seen.add(key);
			queue.push(n);
		}
	}
	return false;
}
