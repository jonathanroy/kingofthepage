#!/usr/bin/env bash
# Pulls, rebuilds and restarts King of the Page. Run as the kotp user from /opt/kotp,
# with sudo rights for the restart. Players are disconnected for a few seconds; the
# server saves the world on shutdown and runs new migrations on start.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart kotp
sleep 2
curl -fsS http://127.0.0.1:8080/healthz && echo
