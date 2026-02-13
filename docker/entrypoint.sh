#!/bin/sh
set -eu

: "${QUIFIN_DB_PATH:=/data/db/quifin.db}"

db_dir="$(dirname "$QUIFIN_DB_PATH")"
mkdir -p "$db_dir"

exec "$@"
