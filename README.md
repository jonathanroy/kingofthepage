# King of the Page

![A player beside a claimed base: steel walls with pennants, wooden gates, a gold mine and forest inside the shaded land, with the HUD showing resources, survival meters and controls](docs/images/preview.png)

A real-time multiplayer web game. Players roam a procedurally generated countryside, chop trees for wood, build fences to enclose land, and compete on two leaderboards: land controlled and gold earned.

Along the way they mine iron to reinforce their walls, forage and hunt to stay fed, fend off zombie bears with a spear, swim across lakes, and hunt for a wandering magic shop that sells rare cosmetics.

The full rules live in [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md), the source of truth for gameplay.

## Stack

- **Language:** TypeScript (strict) in a pnpm monorepo
- **Client:** Phaser 3, bundled with Vite. Pixel art is drawn in code.
- **Server:** Node.js with `ws` WebSockets and a custom JSON protocol validated with Zod. It's authoritative: clients send intents only.
- **Database:** PostgreSQL through Drizzle ORM. The live world is held in memory and saved in batches.
- **World:** deterministic terrain from a seed (`simplex-noise` + `alea`). The base terrain is never stored or sent; only changes are.
- **Tooling:** Vitest for tests, Biome for lint and format

```
apps/
  client/       Phaser game: rendering, input, HUD, client-side prediction
  server/       Game server: world state, networking, persistence
packages/
  shared/
    rules/      Pure game rules and the tunables in config.ts
    world/      Seeded terrain, mines, ore, forage, chunk math
    protocol/   WebSocket message types and schemas
docs/           Game design, plan and deployment guides
deploy/         nginx, systemd and env files for a single Linux server
```

## Getting started

Requirements: Node.js 22.12 or newer, pnpm 10 (`corepack enable` sets it up), and Docker for the local database.

```sh
pnpm install
pnpm db:up            # starts Postgres 17 in Docker on port 5432
cp deploy/kotp.env.example .env
```

Then edit `.env` for local development:

```sh
DATABASE_URL=postgres://kotp:kotp@localhost:5432/kotp
WORLD_SEED=any-string-you-like
PORT=8080
```

Without `DATABASE_URL`, the server keeps everything in memory, and the world is lost when it restarts. That's handy for quick experiments.

```sh
pnpm dev
```

Open <http://localhost:5173>. The Vite client proxies `/ws` to the game server on port 8080. Database migrations run automatically when the server starts.

Open a second browser window, or a private window, to play against yourself.

## How to play

| Key            | Action                                                         |
| -------------- | -------------------------------------------------------------- |
| WASD / arrows  | Move (walk into water to swim)                                 |
| Space          | Use tool: chop trees and fences, mine ore, hit with the spear  |
| Q              | Switch between axe and spear                                   |
| C              | Craft a spear                                                  |
| E              | Pick food, drink from a lake, open the shop                    |
| X              | Eat                                                            |
| F              | Build a fence (hold F while walking to lay a line)             |
| U              | Repair or upgrade a fence                                      |
| G              | Turn a fence into a gate                                       |
| V              | Wardrobe                                                       |
| B              | Point the compass at your next base                            |

On phones and tablets, the game shows touch controls instead: a D-pad (slide your thumb to change direction, hold to keep walking), big **Use** and **Fence** buttons (hold Fence while walking to lay a line), and buttons for the other actions. Add `?touch=1` to the URL to try them on a desktop.

Your browser remembers your player. To play from another browser, select **Save profile** and set a password, then use **Log in** on the start screen.

## Scripts

| Command          | What it does                                                          |
| ---------------- | --------------------------------------------------------------------- |
| `pnpm dev`       | Client and server together, with hot reload                           |
| `pnpm test`      | All Vitest suites                                                     |
| `pnpm typecheck` | `tsc --noEmit` across all packages                                    |
| `pnpm lint`      | Biome check                                                           |
| `pnpm build`     | Builds the client (`apps/client/dist`) and server (`apps/server/dist/server.js`) |
| `pnpm start`     | Runs the built server, which also serves the built client             |

The Postgres persistence tests run only when `TEST_DATABASE_URL` is set. Point it at a separate database, not the one your dev server uses: the dev server holds the world lock.

```sh
docker compose exec db createdb -U kotp kotp_test
TEST_DATABASE_URL=postgres://kotp:kotp@localhost:5432/kotp_test pnpm test
```

To change the database schema, edit `apps/server/src/persistence/schema.ts`, then run `pnpm --filter @kotp/server db:generate`. Never edit a migration that has already been applied.

## Configuration

| Variable       | Default                 | Notes                                                      |
| -------------- | ----------------------- | ---------------------------------------------------------- |
| `DATABASE_URL` | none (in memory)        | Required in production                                     |
| `WORLD_SEED`   | `kotp-dev-seed`         | Required in production. Never change it once players exist: it generates the terrain. |
| `PORT`         | `8080`                  |                                                            |
| `HOST`         | `0.0.0.0`               | Use `127.0.0.1` behind nginx                               |
| `CLIENT_DIR`   | `apps/client/dist`      | Built client served in production                          |

Game balance, such as chop counts, fence costs, regrow times, food, bear timing and shop prices, lives in [`packages/shared/rules/config.ts`](packages/shared/rules/config.ts).

## Deployment

Run exactly one game server per world: the world lives in its memory. A Postgres advisory lock makes a second server wait until the first has saved and stopped, so rolling deploys are safe.

- **Railway (recommended):** builds the root `Dockerfile`. See [`docs/DEPLOY_RAILWAY.md`](docs/DEPLOY_RAILWAY.md).
- **Your own Linux server:** systemd with nginx in front. See [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Contributing

See [`CLAUDE.md`](CLAUDE.md) for the architecture rules and code conventions. The short version:

- Game rules are pure functions in `packages/shared/rules`, and every rule gets tests.
- The server validates every intent and never trusts client values.
- Tunable numbers go in `config.ts`.
- Run `pnpm typecheck` and `pnpm test` before calling a change done.
