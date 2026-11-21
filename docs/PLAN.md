# Build plan

Milestones follow the stages in `GAME_DESIGN.md` §9. Rules come first in each stage: they live in `packages/shared/rules` as pure functions and are tested before any server or client code uses them.

Status: ☐ not started · ◐ in progress · ☑ done

## M0. Scaffold ☑

- pnpm workspace: `apps/client`, `apps/server`, `packages/shared`.
- Strict TypeScript, Vitest, Biome, root scripts `dev`, `test`, `typecheck`, `lint`.
- `simplex-noise` and `alea` pinned to exact versions.
- `docker-compose.yml` with Postgres for local dev; `.env.example`.
- Requires Node ≥ 22.12 (Vite 8 / rolldown); `.nvmrc` pins 24 LTS.

## M1. Shared foundations ☑

- `world/coords.ts`: tile ↔ chunk ↔ local conversion with `Math.floor`; tests on negatives and chunk edges.
- `world/terrain.ts`: `generateChunk(seed, cx, cy)` → grass, forest (tree), water, hill. Determinism tests.
- `rules/config.ts`: every tunable number.
- `rules/`: `isWalkable`, `isWall` (fence, gate, water, hill), `isTreePresent(choppedAt, now)`, `canChopTree`, `chopTree` (randomness passed in), `canPlaceFence`, `fenceCost`, `fenceRefund` (50% of invested, rounded down, any owner).

## M2. Enclosure engine ☑

- Pure world view interface (`getTile(x, y)`), so rules never touch storage.
- `findEnclosedRegions(owner, changedTile, view)`: 4-directional flood fill from each neighbor of the changed fence. Walls are that owner's fences, water and hills; other players' fences count as open. The fill must stay inside the bounding box of the owner's fences, otherwise the area is open (§5 "You must surround the area").
- A fence change only recomputes its owner's enclosures.
- Per tile: the set of enclosures containing it (access and chop rights) and its controller (smallest enclosure; older wins ties).
- `breakFence` + breach: the owner loses an area that is no longer closed off; a removed divider merges two of the owner's areas.
- Tests: corner-touching fences, other players' fences not closing anything, splitting attempts, closing against water/hills, terrain-only areas, valley mouths, nested rings, wrapping from outside, partly overlapping enclosures, inner and outer breaches, merging, enclosures crossing chunk borders.

## M3. Protocol and authoritative server ☐

- `protocol/`: discriminated unions for intents (`join`, `move`, `chopTile`, `buildFence`) and events (`welcome`, `chunkSnapshot`, `chunkDiff`, `playerJoined/Moved/Left`, `inventory`, `enclosureChanged`, `error`). Zod schemas; JSON behind one `codec.ts`.
- Join by unique handle; server suggests a random fun name. A session token is stored in `localStorage` so the same handle can reconnect.
- In-memory `World`, lazy chunk loading, 20 Hz tick draining an intent queue.
- Movement validation: walkability, fences, access to claimed land.
- Spawn: random unenclosed tile near an existing fence, or anywhere if no fence exists. The spawn tile must not be inside a terrain-closed pocket (its fill must escape a radius).
- Interest management by chunk radius. Offline players are removed from view.
- Drizzle schema + first migration: players, fences, chopped trees, enclosures, tile controllers. Batched writes, flush on chunk unload and shutdown.

## M4. Client (placeholder art) ☐

- Phaser, `pixelArt: true`, integer zoom, 16×16 tiles.
- Terrain generated locally from the seed per 32×32 chunk; server diffs applied on top.
- Predicted movement with reconciliation.
- Controls: arrows/WASD to move; chop and build act on the faced tile.
- UI: handle picker with suggested name, wood counter, colored ownership overlay, other players with name tags.
- Own-fence removal (1 chop, 50% refund) is pulled forward from "Next" so breach detection is playable in the MVP.
- **End of M4 = MVP.**

## M5. "Next" ☐

Fence upgrades (levels 1–4), chopping others' fences per level with 50% refund, gates, alliances (ally-fence confirmation and owner notification).

## M6. "After that" ☐

Full nesting and controller rules, seeded gold mines with lazy `settleMineGold`, Land and Gold leaderboards (settle before read).

## M7. Deployment ☐

Production build, systemd unit for the server, nginx config (static client + WebSocket upgrade proxy). Optional bot load test.

## Assumptions

- Build and chop act on the tile the player faces (range 1).

## Design decisions

Splitting, merging and terrain-only areas are settled in `GAME_DESIGN.md` §5. The remaining questions in §10 don't block M2.
