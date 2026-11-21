# King of the Page (KOTP)

Real-time multiplayer web game. Players roam a procedurally generated countryside, chop trees for wood, build fences to enclose land, and compete on two leaderboards (land controlled, gold earned).

## Game rules

The full design lives in `docs/GAME_DESIGN.md`. Read it before working on any gameplay logic (fences, enclosures, nesting, alliances, gold mines, leaderboards). It is the source of truth. If code and the design doc disagree, or a task requires a rule the doc doesn't cover, ask before changing either. The doc's "Open questions" section lists undecided rules: don't silently pick an answer for them.

## Stack

TypeScript everywhere, in a pnpm monorepo.

| Part            | Choice                                              |
| --------------- | --------------------------------------------------- |
| Language        | TypeScript, `strict: true`                          |
| Package manager | pnpm workspaces                                     |
| Client          | Phaser 3, bundled with Vite                         |
| Server          | Node.js (LTS) with `ws` WebSockets, custom protocol |
| Database        | PostgreSQL via Drizzle ORM                          |
| Terrain noise   | `simplex-noise` with a seeded PRNG (`alea`)         |
| Tests           | Vitest                                              |
| Lint and format | Biome                                               |

## Repository layout

```
apps/
  client/     Phaser game: rendering, input, UI, client-side prediction
  server/     Authoritative game server: world state, networking, persistence
packages/
  shared/     Code used by both client and server
    rules/    Pure game rules: enclosure, nesting, chopping, costs, gold
    world/    Seeded terrain and mine generation, chunk math
    protocol/ Message types exchanged over WebSocket
docs/
  GAME_DESIGN.md
```

## Commands

Set these up as root scripts while scaffolding, and keep them working:

- `pnpm dev` runs client and server together with hot reload
- `pnpm test` runs all Vitest suites
- `pnpm typecheck` runs `tsc --noEmit` across all packages
- `pnpm lint` runs Biome check
- `pnpm build` builds the client (`apps/client/dist`) and bundles the server (`apps/server/dist/server.js`)
- `pnpm start` runs the bundled server (see `docs/DEPLOY.md` for production)

Before saying a task is done, run `pnpm typecheck` and `pnpm test` and make sure both pass.

## Architecture rules

### Server is authoritative

- The client sends **intents** only (move up, chop tile, build fence, upgrade, open gate). The server validates every intent against the rules and current state, then broadcasts the result.
- Never trust client values for wood, gold, ownership, positions or timestamps.
- The client may predict its own movement for responsiveness, but always reconciles to server state.

### Game rules are pure and shared

- All rule logic lives in `packages/shared/rules` as pure functions: no I/O, no networking, no Phaser, no database, no `Date.now()` (pass time in as an argument).
- The server calls these functions to decide outcomes. The client may call them for previews (e.g. showing whether a fence would close an area).
- Every rule gets unit tests. Enclosure, breach and nesting logic in particular need tests for edge cases: corner-touching fences, shared fences between players, nested rings, wrapping from outside, breaches of inner and outer rings.

### Deterministic world generation

- Terrain and gold mine placement are pure functions of `(worldSeed, chunkX, chunkY)`. They must give identical results on client and server, so they live in `packages/shared/world`.
- The base terrain is never stored or sent over the network. The client generates it locally from the seed. The server sends only the **diffs**: chopped trees, fences, gates, ownership.
- Pin the exact versions of noise and PRNG libraries; a version change would alter the world.

### Coordinates and chunks

- Tiles use integer world coordinates `(x, y)`; the world extends in all directions, including negatives.
- Chunks are 32×32 tiles. Convert with `Math.floor(x / 32)`, never `|0` or `Math.trunc`, which break on negative coordinates.
- Put all coordinate and chunk math in `packages/shared/world` and reuse it everywhere.

### Lazy time-based state (no timers)

- **Tree regrowth:** store the chop timestamp. A tree exists again once `now - choppedAt >= regrowDelay`. Evaluate when a chunk is loaded or the tile is touched.
- **Gold:** each mine stores `controllerId` and `controlledSince`. Settle earnings (`minutes × rate`) whenever control changes or a balance is read. Leaderboards project unsettled gold read-only instead of settling, so reading them doesn't write.
- Do not create per-tree or per-mine intervals or cron jobs.

### Enclosure detection

- Recompute only when a fence or gate is placed or removed: flood fill (4-directional) from each walkable neighbor of the changed tile.
- Walls for a fill are the changed fence's owner's fences, water and hills; other players' fences are open ground (design doc §5).
- Bound every flood fill by the maximum enclosure area from `config.ts`. If the fill grows past it, the area is open. This keeps fills finite in an infinite world.
- Each tile has at most one **controller**: the owner of the innermost enclosure containing it. Store it explicitly and update it on recompute.
- When a controller changes on a tile holding a gold mine, settle the mine's gold first.

### Networking

- Server tick rate 20 Hz. Movement is tile-based, so only send position changes, not continuous streams.
- Interest management: each client receives updates only for chunks within a radius of its player.
- Messages are typed in `packages/shared/protocol`. Validate every incoming message at the server boundary (with Zod) before it touches game logic.
- JSON for the MVP; keep serialization behind one module so it can switch to a binary format later.

### Persistence

- Live world state is held in server memory. Changes are written to PostgreSQL in small batches, and on chunk unload and shutdown.
- Store only what can't be derived: players, fences (owner, level, wood invested), gates, chopped trees with timestamps, enclosures and controllers, mine control and gold totals, alliances.
- Use Drizzle migrations for every schema change. Never edit an applied migration.

## Client and art

- Top-down tile view in GameBoy-era Pokémon style. 16×16 pixel tiles and sprites.
- Phaser config uses `pixelArt: true`. Scale only by integer factors so pixels stay crisp.
- Limited palette per biome (grass, forest, lake, hills). Keep assets simple and readable: fence levels, gates, ownership borders and allies must be distinguishable at a glance.
- Use placeholder colored tiles and sprites until real art exists; don't block gameplay work on assets.

## Code conventions

- No `any`. Prefer explicit types at module boundaries and discriminated unions for messages and game events.
- Keep functions small and named after game concepts from the design doc (`isEnclosed`, `breakFence`, `settleMineGold`).
- Tunable numbers (chop counts, costs, regrow delay, mine rarity and rates) live in one config file in `packages/shared/rules/config.ts`, never inline.
- Comments explain _why_, not _what_.

## Workflow

- Work in small, focused changes. Add or update tests with every rules change.
- When implementing a rule from the design doc, reference its section in the PR or commit message.
- If you notice an exploit or edge case the design doc doesn't cover, point it out instead of quietly deciding.

## Deployment

- A single Linux server runs the Node game server as a supervised long-running process, behind nginx.
- nginx must proxy WebSocket upgrades (`Upgrade` and `Connection` headers) and serve the built client as static files.
- Configuration (database URL, world seed, port) comes from environment variables; never commit secrets.
