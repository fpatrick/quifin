# Deployment Guide

This app is containerized with a multi-stage `Dockerfile` and publishes to GHCR.

## Required Environment Variables

- `QUIFIN_DB_PATH`:
  - Default in container: `/data/quifin.db`
  - You can also use `DB_PATH` as an alternative.
- `PORT`:
  - Optional, default is `3000`.
- `HOSTNAME`:
  - Default is `0.0.0.0` in the container.

Optional ntfy settings (only if reminders are used):

- `NTFY_URL`
- `NTFY_TOPIC`
- `NTFY_TOKEN` or `NTFY_BEARER_TOKEN`

Do not commit `.env` files. Use local secrets management.

## Persistent Data Volume

SQLite data must be stored outside the container filesystem.

Mount a host folder to `/data`:

```bash
podman run -d \
  --name quifin \
  -p 3000:3000 \
  -v /srv/quifin-data:/data:Z \
  -e QUIFIN_DB_PATH=/data/quifin.db \
  ghcr.io/fpatrick/quifin:latest
```

## Podman + Quadlet (High Level)

1. Create a host data directory, for example `/srv/quifin-data`.
2. Create a Quadlet `.container` file that:
   - Uses image `ghcr.io/fpatrick/quifin:latest`
   - Publishes `3000:3000`
   - Mounts `/srv/quifin-data:/data`
   - Sets `QUIFIN_DB_PATH=/data/quifin.db`
3. Reload and start with systemd user services:
   - `systemctl --user daemon-reload`
   - `systemctl --user enable --now <name>.service`

Keep tokens and secrets in environment files managed by systemd/Podman, not in git.
