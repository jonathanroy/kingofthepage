# Deploying King of the Page

One Linux server runs everything: PostgreSQL, the Node game server (supervised by systemd)
and nginx in front. These steps assume Ubuntu 24.04 and a domain pointing at the server.
Replace `kotp.example.com` with your domain.

## 1. Packages

```bash
sudo apt update
sudo apt install -y nginx postgresql git curl certbot python3-certbot-nginx
# Node 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable   # provides pnpm at the version pinned in package.json
```

## 2. Database

```bash
sudo -u postgres createuser kotp --pwprompt   # choose a strong password
sudo -u postgres createdb kotp --owner kotp
```

The server runs its Drizzle migrations automatically on start.

## 3. App user and code

```bash
sudo useradd --system --create-home --home-dir /opt/kotp --shell /usr/sbin/nologin kotp
sudo -u kotp git clone <your-repo-url> /opt/kotp
cd /opt/kotp
sudo -u kotp pnpm install --frozen-lockfile
sudo -u kotp pnpm build
```

`pnpm build` produces the static client in `apps/client/dist` and the bundled server in
`apps/server/dist/server.js`.

## 4. Configuration

```bash
sudo mkdir -p /etc/kotp
sudo cp deploy/kotp.env.example /etc/kotp/kotp.env
sudo chown root:kotp /etc/kotp/kotp.env
sudo chmod 640 /etc/kotp/kotp.env
sudo nano /etc/kotp/kotp.env   # set DATABASE_URL and a random WORLD_SEED
```

Pick the world seed once (for example `openssl rand -hex 16`) and never change it: terrain and
gold mines are generated from it, so a new seed means a different world under existing fences.

## 5. Game server service

```bash
sudo cp deploy/systemd/kotp.service /etc/systemd/system/kotp.service
sudo systemctl daemon-reload
sudo systemctl enable --now kotp
curl http://127.0.0.1:8080/healthz          # {"ok":true,"online":0}
journalctl -u kotp -f                       # logs
```

## 6. nginx and HTTPS

```bash
sudo cp deploy/nginx/kotp.conf /etc/nginx/sites-available/kotp
sudo sed -i 's/kotp.example.com/your.domain/' /etc/nginx/sites-available/kotp
sudo ln -s /etc/nginx/sites-available/kotp /etc/nginx/sites-enabled/kotp
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your.domain
```

nginx serves the client and upgrades `/ws` to the game server's WebSocket. The client
connects to `wss://your.domain/ws` automatically when the page is served over HTTPS.

## Updating

```bash
cd /opt/kotp && sudo -u kotp ./deploy/update.sh
```

This pulls, rebuilds and restarts. Players are disconnected for a few seconds; the server
writes all pending changes to Postgres when it stops, and their clients can reload to resume.
Give the `kotp` user permission to run `systemctl restart kotp` (via `visudo`), or run the
restart yourself.

## Backups

The world state lives in Postgres (players, fences, chopped trees, enclosures, alliances,
mines). Terrain is regenerated from the seed, so back up the database and the env file:

```bash
sudo -u postgres pg_dump -Fc kotp > /var/backups/kotp-$(date +%F).dump
```

## Notes

- The game server listens on `127.0.0.1:8080` only; nginx is the public entry point.
- All live state is in memory and flushed to Postgres every 2 seconds and on shutdown. A crash
  (not a normal stop) can lose up to 2 seconds of changes.
- `GET /healthz` reports `{"ok": true, "online": <players>}` for uptime monitoring.
