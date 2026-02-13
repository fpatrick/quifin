#!/bin/sh
set -eu

: "${QUIFIN_DB_PATH:=/data/db/quifin.db}"

db_dir="$(dirname "$QUIFIN_DB_PATH")"
mkdir -p "$db_dir"

if [ -n "${QUIFIN_UID:-}" ] || [ -n "${QUIFIN_GID:-}" ]; then
  target_uid="${QUIFIN_UID:-}"
  target_gid="${QUIFIN_GID:-}"

  if [ -z "$target_uid" ] && [ -n "$target_gid" ]; then
    target_uid="$target_gid"
  fi
  if [ -z "$target_gid" ] && [ -n "$target_uid" ]; then
    target_gid="$target_uid"
  fi

  if [ "$(id -u)" -eq 0 ]; then
    chown -R "$target_uid:$target_gid" /data || true
    exec su-exec "$target_uid:$target_gid" "$@"
  fi

  echo "QUIFIN_UID/QUIFIN_GID ignored because container is not running as root." >&2
fi

exec "$@"
