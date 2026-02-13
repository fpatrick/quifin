# Deployment Guide

This app is containerized with a multi-stage `Dockerfile` and publishes to GHCR.

## Required Environment Variables

- `QUIFIN_DB_PATH`:
  - Optional.
  - Default in container/runtime: `/data/db/quifin.db`.
  - You can also use `DB_PATH` as an alternative.
- `PORT`:
  - Optional, default is `3000`.
- `HOSTNAME`:
  - Default is `0.0.0.0` in the container.
- `QUIFIN_UID` and `QUIFIN_GID`:
  - Optional overrides.
  - Only used when the container starts as root.
  - Recommended default is no override with rootless Podman + `UserNS=keep-id`.

Optional ntfy settings (only if reminders are used):

- `NTFY_URL`
- `NTFY_TOPIC`
- `NTFY_TOKEN` or `NTFY_BEARER_TOKEN`

Do not commit `.env` files. Use local secrets management.

## Persistent Data Volume

SQLite data must be stored outside the container filesystem.
By default, the DB file is created at `/data/db/quifin.db`.

Mount a host folder to `/data`:

```bash
podman run -d \
  --name quifin \
  -p 3000:3000 \
  -v /srv/quifin-data:/data:Z \
  ghcr.io/fpatrick/quifin:latest
```

Optional UID/GID override (only if you need explicit IDs):

```bash
podman run -d \
  --name quifin \
  -p 3000:3000 \
  -v /srv/quifin-data:/data:Z \
  -e QUIFIN_UID=1000 \
  -e QUIFIN_GID=1000 \
  ghcr.io/fpatrick/quifin:latest
```

## Podman + Quadlet (High Level)

1. Create a host data directory, for example `/srv/quifin-data`.
2. Create a Quadlet `.container` file that:
   - Uses image `ghcr.io/fpatrick/quifin:latest`
   - Sets `UserNS=keep-id` (recommended for rootless deployments)
   - Publishes `3000:3000`
   - Mounts `/srv/quifin-data:/data`
   - Optional: sets `QUIFIN_DB_PATH=/data/db/quifin.db` only if you want a non-default path
   - Optional: sets `QUIFIN_UID` / `QUIFIN_GID` if explicit IDs are required
3. Reload and start with systemd user services:
   - `systemctl --user daemon-reload`
   - `systemctl --user enable --now <name>.service`

Keep tokens and secrets in environment files managed by systemd/Podman, not in git.
