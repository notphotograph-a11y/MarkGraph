#!/bin/sh
set -e
VAULT_DIR="${VAULT_DIR:-/data/vault}"
mkdir -p "$VAULT_DIR"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$VAULT_DIR" || true
  exec gosu node node server/dist/index.js
fi
exec node server/dist/index.js
