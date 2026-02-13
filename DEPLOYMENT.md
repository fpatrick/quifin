# Deployment Guide

This app is containerized with a multi-stage `Dockerfile` and publishes to GHCR.

## Environment Variables

- `QUIFIN_DB_PATH`:
  - Optional.
  - Default path: `/data/db/quifin.db`.
  - You can also use `DB_PATH` as an alternative.
- `PORT`:
  - Optional, default is `3000`.
- `HOSTNAME`:
  - Optional, default is `0.0.0.0`.

Optional ntfy settings:

- `NTFY_URL`
- `NTFY_TOPIC`
- `NTFY_TOKEN` or `NTFY_BEARER_TOKEN`

## Data Path and Permissions

- The container runs as non-root user `uid=100`, `gid=101`.
- SQLite file lives at `/data/db/quifin.db` by default.
- The app creates `/data/db` automatically on startup.

For rootless Podman bind mounts, use `:Z,U`:

- `:Z` sets SELinux label for container access.
- `:U` remaps ownership so `uid=100` in the container can write to the mounted folder.

Without `:U`, you can get `unable to open database file`.

## Podman Run Example

```bash
podman run -d \
  --name quifin \
  -p 3000:3000 \
  -v /srv/quifin-data:/data:Z,U \
  ghcr.io/fpatrick/quifin:latest
```

`QUIFIN_DB_PATH` is optional in this setup.  
DB file is created at `/srv/quifin-data/db/quifin.db` on the host.

## Quadlet (High Level)

1. Create host folder, for example `/srv/quifin-data`.
2. Create a Quadlet `.container` file that includes:
   - `Image=ghcr.io/fpatrick/quifin:latest`
   - `Volume=/srv/quifin-data:/data:Z,U`
   - `PublishPort=3000:3000`
3. Reload and start:
   - `systemctl --user daemon-reload`
   - `systemctl --user enable --now <name>.service`

If you need a custom DB location, set `QUIFIN_DB_PATH`.
