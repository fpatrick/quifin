# QuiFin

QuiFin is a local-first finance helper for households.  
It helps you track subscription costs and split shared bills fairly.

## Why This Exists

Many people pay for subscriptions they forget.  
Many couples also need a simple way to split shared bills without conflict.

QuiFin focuses on clear monthly cost visibility, reminder support, manual FX conversion, and a partners fairness calculator.

## Features

- Subscription list with next charge date
- Effective monthly and annualized cost in EUR
- Manual FX rates (no auto-fetch)
- Archive and restore subscriptions
- Reminder workflow for upcoming charges (ntfy)
- Partners calculator with proportional bill split
- Local SQLite persistence

## Tech Stack

- Next.js (App Router)
- TypeScript
- SQLite
- Podman / Quadlet
- ntfy for notifications

## Local Development

```bash
cd app
npm install
npm run dev
```

Open `http://localhost:3000`.

## Deployment (Podman + Quadlet)

### Podman run

Use a host folder mounted to `/data` with `:Z,U`:

```bash
podman run -d \
  --name quifin \
  -p 9173:3000 \
  -v /var/opt/containers/quifin:/data:Z,U \
  ghcr.io/fpatrick/quifin:latest
```

Why `:U` matters:

- Container runs as `uid=100`, `gid=101`.
- `:U` makes bind mount ownership writable for that container user in rootless Podman.
- Without `:U`, SQLite may fail with `unable to open database file`.

### Quadlet example

Use this as a starting point:

```ini
[Container]
ContainerName=quifin
Image=ghcr.io/fpatrick/quifin:latest
AutoUpdate=registry
Volume=/var/opt/containers/quifin:/data:Z,U
PublishPort=9173:3000

[Service]
Restart=on-failure
TimeoutStartSec=90

[Install]
WantedBy=default.target
```

## Environment Variables

- `QUIFIN_DB_PATH` (optional): default `/data/db/quifin.db`
- `DB_PATH` (optional alternative to `QUIFIN_DB_PATH`)
- `PORT` (optional): default `3000`
- `HOSTNAME` (optional): default `0.0.0.0`
- `NTFY_URL` (optional)
- `NTFY_TOPIC` (optional)
- `NTFY_TOKEN` or `NTFY_BEARER_TOKEN` (optional)

## Data Persistence and Privacy

- SQLite is the source of truth.
- Data is stored on the host through the mounted folder.
- Default DB file path in container: `/data/db/quifin.db`.
- With the example mount, host DB path is `/var/opt/containers/quifin/db/quifin.db`.
- DB files and `.env` files are excluded from git and Docker build context.

## Troubleshooting

### unable to open database file

1. Confirm the volume uses `:Z,U`.
2. Confirm the host folder exists.
3. Confirm container user can write to the mount.

Check container user:

```bash
podman exec -it quifin id
```

Expected runtime user is `uid=100`, `gid=101`.
