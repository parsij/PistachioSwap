#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SYNC="$ROOT/scripts/deploy/sync-shared-api-env.mjs"

node "$SYNC" --required
node "$SYNC" --required --watch &
sync_pid=$!
app_pid=''

cleanup() {
    local status=$?
    trap - EXIT INT TERM
    if [[ -n "${app_pid:-}" ]]; then
        kill "$app_pid" 2>/dev/null || true
    fi
    kill "$sync_pid" 2>/dev/null || true
    wait "$sync_pid" 2>/dev/null || true
    if [[ -n "${app_pid:-}" ]]; then
        wait "$app_pid" 2>/dev/null || true
    fi
    exit "$status"
}
trap cleanup EXIT INT TERM

cd "$ROOT"
pnpm --filter @pistachio/api start &
app_pid=$!

set +e
wait -n "$sync_pid" "$app_pid"
status=$?
set -e

if ! kill -0 "$sync_pid" 2>/dev/null; then
    echo "Shared environment synchronizer stopped; refusing to keep PistachioSwap API running." >&2
fi

exit "$status"
