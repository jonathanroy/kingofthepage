# Deploying King of the Page on Railway

Railway builds the repo's `Dockerfile` (one image with the game server and the built client),
runs it, and gives it an HTTPS domain. You add a managed Postgres next to it. For the
self-hosted alternative (Linux server + nginx), see `DEPLOY.md`.

Railway's `railway.json` config-as-code is being retired (it stops working on 2026-12-01),
so everything below is set in the Railway dashboard.

## What the game needs from any host

- **Exactly one instance, always on.** The world lives in the server's memory; two instances
  would each hold a different copy. No autoscaling, no "sleep when idle".
- **Time to save on shutdown.** The server writes its last changes when it receives SIGTERM.
- **WebSockets** on the public domain.

The server also protects itself during deploys: a new version waits on a Postgres lock until
the old one has saved and stopped, then loads the world. Players see a few seconds of
disconnection and resume by reloading the page.

## 1. Push the code to GitHub

A private repository is fine. Never commit `.env`.

## 2. Create the project

1. In Railway: **New Project → Deploy from GitHub repo**, and pick the repository.
   Railway finds the `Dockerfile` and builds with it.
2. In the same project: **+ New → Database → PostgreSQL**.

## 3. Set the game service's variables

In the game service, open **Variables** and add:

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Reference to the Postgres service (adjust the name if yours differs) |
| `WORLD_SEED` | a random string, e.g. from `openssl rand -hex 16` | Generates terrain and mines. **Never change it** once people play |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `15` | Time between SIGTERM and SIGKILL. Railway's default is 0, which would kill the server before it saves |

`NODE_ENV=production`, `HOST=::` and `PORT=8080` are set in the image. If Railway provides its
own `PORT`, the server uses that instead.

## 4. Service settings

In the game service's **Settings**:

- **Replicas:** 1.
- **Serverless / app sleeping:** off.
- **Healthcheck path:** leave empty. During a deploy the new server only starts answering once
  the old one has stopped, so a healthcheck would block the switch and fail the deploy.
  `/healthz` is still there for external uptime monitoring.
- **Restart policy:** On failure.

## 5. Public domain

In **Settings → Networking**, click **Generate Domain**. If Railway asks for a port, use 8080
(or the `PORT` value if you set one). Open the domain: the join screen should appear, and
`https://<your-domain>/healthz` should return `{"ok":true,"online":0}`.

The client connects to `wss://<your-domain>/ws` on its own; nothing else to configure.

## Updating

Push to the deployed branch. Railway builds the new image and starts it; it waits for the old
server to save and stop, then takes over. Migrations run automatically on start.

## Backups

The whole world is in Postgres (terrain comes from the seed). Use Railway's database backups
if your plan includes them, or dump it yourself with the database's public connection URL:

```bash
pg_dump -Fc "<public DATABASE_URL>" > kotp-$(date +%F).dump
```

Keep a copy of `WORLD_SEED` with your backups: a restored database needs the same seed.

## Troubleshooting

- **Join screen never appears / "Disconnected" right away:** check the deploy logs for
  `KOTP server on ...`. If the log says it's waiting for another game server, an old deployment
  is still running; it hands over once it stops.
- **Server crashes at start with a config error:** `DATABASE_URL` and `WORLD_SEED` are required
  in production.
