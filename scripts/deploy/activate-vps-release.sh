#!/usr/bin/env bash
set -euo pipefail

if (( $# != 5 )); then
    echo "Usage: $0 APP_DIR RELEASE_DIR SHA API_SERVICE PUBLIC_ORIGIN" >&2
    exit 64
fi

APP_DIR="$1"
RELEASE_DIR="$2"
SHA="$3"
API_SERVICE="$4"
PUBLIC_ORIGIN="${5%/}"

RELEASES_DIR="$APP_DIR/releases"
CURRENT_LINK="$APP_DIR/current"
FRONTEND_ENV="$APP_DIR/env/frontend-build.env"
PERSISTENT_API_ENV="$APP_DIR/env/api.env"
RUNTIME_DIR="$APP_DIR/.runtime"
REDUCED_API_ENV="$RUNTIME_DIR/api.env"
NODE_HOME="$HOME/.local/nodejs/current"
API_PID_FILE="$RUNTIME_DIR/api.pid"
API_PORT='3006'
COREPACK_BIN=''
PNPM_VERSION='10.30.3'
NODE_MAJOR='24'

if [[ -x "$NODE_HOME/bin/node" ]]; then
    export PATH="$NODE_HOME/bin:$PATH"
    hash -r
fi

for command in node npm corepack curl awk readlink ss; do
    command -v "$command" >/dev/null 2>&1 || {
        echo "Required VPS command is missing: $command" >&2
        exit 1
    }
done

COREPACK_BIN="$(command -v corepack)"
actual_node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$actual_node_major" != "$NODE_MAJOR" ]]; then
    echo "Wrong Node.js version on VPS. Expected 24, got $(node -v)." >&2
    exit 1
fi

[[ -s "$RELEASE_DIR/package.json" ]] || {
    echo "Release is missing package.json: $RELEASE_DIR" >&2
    exit 1
}

[[ -s "$RELEASE_DIR/apps/api/package.json" ]] || {
    echo "Release is missing the API package." >&2
    exit 1
}

[[ -f "$FRONTEND_ENV" ]] || {
    echo "Missing frontend environment file: $FRONTEND_ENV" >&2
    exit 1
}

if [[ -e "$CURRENT_LINK" && ! -L "$CURRENT_LINK" ]]; then
    echo "$CURRENT_LINK exists but is not a symbolic link." >&2
    exit 1
fi

install -m 700 -d "$RUNTIME_DIR"

if [[ -r "$PERSISTENT_API_ENV" ]]; then
    API_ENV="$PERSISTENT_API_ENV"
    echo "Using the persistent API environment."
else
    API_ENV="$REDUCED_API_ENV"
    temporary_env="$(mktemp "$RUNTIME_DIR/api.env.XXXXXX")"
    trap 'rm -f "${temporary_env:-}"' EXIT

    cat > "$temporary_env" <<'ENV'
NODE_ENV=production
PORT=3006
HOST=127.0.0.1
TRUST_PROXY_HOPS=1
CORS_ORIGINS=https://pistachioswap.com,https://www.pistachioswap.com

GAS_ASSIST_SERVICE_ENABLED=false
GAS_ASSIST_SERVICE_URL=http://127.0.0.1:3002
GAS_ASSIST_INTERNAL_TOKEN=

ALCHEMY_PORTFOLIO_ENABLED=false
MORALIS_ENABLED=false
GOPLUS_ENABLED=false
UNCHAINED_ENABLED=false
UNISWAP_VOLUME_ENABLED=false

BSC_RPC_URL=https://bsc-dataseed.bnbchain.org
UNISWAP_ENABLED=false
ZEROX_ENABLED=false
PANCAKESWAP_ENABLED=true
QUOTE_PROVIDER_MODE=pancakeswap
QUOTE_PROVIDERS=pancakeswap
QUOTE_TIMEOUT_MS=10000

DEXPAPRIKA_ENABLED=true
HONEYPOT_ENABLED=true
ACROSS_ENABLED=true
DEBRIDGE_ENABLED=true
RELAY_ENABLED=true
CHAINFLIP_ENABLED=false

TREASURY_ADDRESS=
PLATFORM_FEE_BPS=0
PLATFORM_FEE_MAX_BPS=500
FEE_COLLECTION_MODE=none
FEE_TOKEN_MODE=buyToken
DATABASE_URL=
ENV

    chmod 600 "$temporary_env"
    mv -f "$temporary_env" "$API_ENV"
    temporary_env=''
    trap - EXIT
    echo "Refreshed the reduced public API environment at $API_ENV."
fi

node --env-file="$API_ENV" -e '
    if (!process.env.CORS_ORIGINS?.trim()) {
        console.error("Missing required API setting: CORS_ORIGINS")
        process.exit(1)
    }
    if (
        process.env.GAS_ASSIST_SERVICE_ENABLED === "true" &&
        !process.env.GAS_ASSIST_INTERNAL_TOKEN?.trim()
    ) {
        console.error(
            "GAS_ASSIST_INTERNAL_TOKEN is required when Gas Assist is enabled.",
        )
        process.exit(1)
    }
'

cd "$RELEASE_DIR"

corepack prepare "pnpm@$PNPM_VERSION" --activate
corepack pnpm --version
corepack pnpm config set store-dir "$APP_DIR/.pnpm-store"
corepack pnpm install --frozen-lockfile --prefer-offline

rm -f apps/api/.env
ln -s "$API_ENV" apps/api/.env

corepack pnpm licenses:sync

(
    set -a
    # shellcheck disable=SC1090
    source "$FRONTEND_ENV"
    set +a

    VITE_API_BASE_URL="${VITE_API_BASE_URL:-$PUBLIC_ORIGIN/api}" \
        VITE_DEFAULT_CHAIN_ID="${VITE_DEFAULT_CHAIN_ID:-56}" \
        VITE_VERSION="$SHA" \
        NODE_OPTIONS=--max-old-space-size=8192 \
        corepack pnpm exec vite build --mode production
)

[[ -s dist/index.html ]] || {
    echo "Frontend build output is missing: $RELEASE_DIR/dist/index.html" >&2
    exit 1
}

if grep -RFl 'http://localhost:3001' dist >/dev/null 2>&1; then
    echo "Production frontend still contains the localhost API fallback." >&2
    exit 1
fi

rm -rf build
ln -s dist build

[[ -s build/index.html ]] || {
    echo "Nginx-compatible frontend path is missing: $RELEASE_DIR/build/index.html" >&2
    exit 1
}

if node --env-file="$API_ENV" -e \
    'process.exit(process.env.DATABASE_URL?.trim() ? 0 : 1)'
then
    PORT="$API_PORT" HOST=127.0.0.1 \
        corepack pnpm --filter @pistachio/api db:migrate
else
    echo "DATABASE_URL is unset; skipping database migration for the public API."
fi

previous_target=''
if [[ -L "$CURRENT_LINK" ]]; then
    previous_target="$(readlink -f "$CURRENT_LINK")"
fi

ensure_frontend_compatibility() {
    local target="$1"

    [[ -d "$target" ]] || return 0
    if [[ -s "$target/dist/index.html" && ! -e "$target/build" ]]; then
        ln -s dist "$target/build"
    fi
}

activate_release() {
    local target="$1"
    rm -f "$APP_DIR/current.next"
    ln -s "$target" "$APP_DIR/current.next"
    mv -Tf "$APP_DIR/current.next" "$CURRENT_LINK"
}

process_uid() {
    local pid="$1"
    awk '/^Uid:/ { print $2; exit }' "/proc/$pid/status" 2>/dev/null || true
}

stop_pid() {
    local pid="$1"
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 0
    [[ -d "/proc/$pid" ]] || return 0

    local current_uid
    current_uid="$(id -u)"
    if [[ "$(process_uid "$pid")" != "$current_uid" ]]; then
        echo "Refusing to stop PID $pid because it is not owned by the deploy user." >&2
        return 1
    fi

    kill "$pid" 2>/dev/null || true
    for _ in {1..20}; do
        kill -0 "$pid" 2>/dev/null || return 0
        sleep 0.25
    done

    kill -KILL "$pid" 2>/dev/null || true
    for _ in {1..20}; do
        kill -0 "$pid" 2>/dev/null || return 0
        sleep 0.1
    done

    echo "PID $pid did not stop." >&2
    return 1
}

pids_bound_to_port() {
    local port="$1"

    ss -H -ltnp 2>/dev/null \
        | awk -v suffix=":$port" '$4 ~ suffix "$" { print }' \
        | grep -oE 'pid=[0-9]+' \
        | cut -d= -f2 \
        | sort -u || true
}

stop_api() {
    if [[ -s "$API_PID_FILE" ]]; then
        stop_pid "$(cat "$API_PID_FILE" 2>/dev/null || true)"
        rm -f "$API_PID_FILE"
    fi

    local service_pid
    service_pid="$(
        systemctl show "$API_SERVICE" \
            --property=MainPID \
            --value 2>/dev/null || true
    )"
    if [[ "$service_pid" =~ ^[1-9][0-9]*$ ]] &&
        [[ "$(process_uid "$service_pid")" == "$(id -u)" ]]
    then
        stop_pid "$service_pid"
    fi

    local bound_pid
    while IFS= read -r bound_pid; do
        [[ -n "$bound_pid" ]] || continue
        stop_pid "$bound_pid"
    done < <(pids_bound_to_port "$API_PORT")

    local current_uid
    current_uid="$(id -u)"

    for proc_dir in /proc/[0-9]*; do
        [[ -r "$proc_dir/status" && -r "$proc_dir/cmdline" ]] || continue
        [[ "$(process_uid "${proc_dir##*/}")" == "$current_uid" ]] || continue

        local command_line
        command_line="$(
            tr '\0' ' ' < "$proc_dir/cmdline" 2>/dev/null || true
        )"
        if [[
            "$command_line" == *"src/server.ts"* ||
            "$command_line" == *"@pistachio/api"*
        ]]; then
            stop_pid "${proc_dir##*/}"
        fi
    done
}

ensure_pm2() {
    if ! command -v pm2 >/dev/null 2>&1; then
        npm install --global 'pm2@6'
        hash -r
    fi

    command -v pm2 >/dev/null 2>&1 || {
        echo "PM2 installation did not provide a pm2 executable." >&2
        exit 1
    }
}

wait_for_health() {
    local attempts="$1"

    for ((attempt = 1; attempt <= attempts; attempt += 1)); do
        if curl \
            --fail \
            --silent \
            --show-error \
            --max-time 4 \
            "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1
        then
            return 0
        fi
        sleep 1
    done

    return 1
}

reload_pm2_release() {
    local target="$1"

    # PM2 startOrReload preserves an existing app cwd. Releases are immutable
    # and old directories are pruned, so that stale cwd eventually points at a
    # deleted release. Recreate the app definition for every activation so PM2
    # always launches from the selected release, including during rollback.
    pm2 delete "$API_SERVICE" >/dev/null 2>&1 || true
    PISTACHIO_PUBLIC_ROOT="$target" \
        pm2 start "$target/ecosystem.config.cjs" \
            --only "$API_SERVICE" \
            --update-env
}

start_release() {
    local target="$1"

    ensure_pm2
    activate_release "$target"
    stop_api
    reload_pm2_release "$target"
    wait_for_health 30
}

rollback() {
    echo "Deployment failed; rolling back."

    if [[ -n "$previous_target" && -d "$previous_target" ]]; then
        ensure_frontend_compatibility "$previous_target"
        if ! start_release "$previous_target"; then
            echo "Rollback release did not become healthy." >&2
        fi
    else
        pm2 delete "$API_SERVICE" >/dev/null 2>&1 || true
        rm -f "$CURRENT_LINK"
    fi
}

ensure_frontend_compatibility "$previous_target"

if ! start_release "$RELEASE_DIR"; then
    pm2 logs "$API_SERVICE" --lines 120 --nostream 2>/dev/null || true
    rollback
    exit 1
fi

health_file="$(mktemp)"
catalog_file="$(mktemp)"
proxy_health_file="$(mktemp)"
proxy_catalog_file="$(mktemp)"
origin_headers="$(mktemp)"
origin_body="$(mktemp)"
public_headers="$(mktemp)"
public_body="$(mktemp)"
trap 'rm -f "$health_file" "$catalog_file" "$proxy_health_file" "$proxy_catalog_file" "$origin_headers" "$origin_body" "$public_headers" "$public_body"' EXIT

curl \
    --fail \
    --silent \
    --show-error \
    --max-time 10 \
    --output "$health_file" \
    "http://127.0.0.1:${API_PORT}/health"

curl \
    --fail \
    --silent \
    --show-error \
    --max-time 20 \
    --output "$catalog_file" \
    "http://127.0.0.1:${API_PORT}/api/v1/token-catalog?chainId=56&mode=all&limit=1"

node - "$health_file" "$catalog_file" <<'NODE'
const fs = require('node:fs')
const health = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const catalog = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
if (health.status !== 'ok' || health.chainId !== 56) process.exit(1)
if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.tokens)) {
    process.exit(1)
}
NODE

curl \
    --fail \
    --silent \
    --show-error \
    --insecure \
    --location \
    --connect-timeout 5 \
    --max-time 20 \
    --resolve pistachioswap.com:443:127.0.0.1 \
    --dump-header "$origin_headers" \
    --output "$origin_body" \
    "$PUBLIC_ORIGIN/"

test -s "$origin_body"
grep -Eiq '<!doctype html|<html' "$origin_body"

curl \
    --fail \
    --silent \
    --show-error \
    --insecure \
    --max-time 10 \
    --resolve pistachioswap.com:443:127.0.0.1 \
    --output "$proxy_health_file" \
    "$PUBLIC_ORIGIN/health"

curl \
    --fail \
    --silent \
    --show-error \
    --insecure \
    --max-time 20 \
    --resolve pistachioswap.com:443:127.0.0.1 \
    --output "$proxy_catalog_file" \
    "$PUBLIC_ORIGIN/api/v1/token-catalog?chainId=56&mode=all&limit=1"

node - "$proxy_health_file" "$proxy_catalog_file" <<'NODE'
const fs = require('node:fs')
const health = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const catalog = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
if (health.status !== 'ok' || health.chainId !== 56) process.exit(1)
if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.tokens)) {
    process.exit(1)
}
NODE

public_status="$(
    curl \
        --silent \
        --show-error \
        --location \
        --connect-timeout 10 \
        --max-time 30 \
        --retry 2 \
        --retry-delay 2 \
        --user-agent \
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150 Safari/537.36' \
        --dump-header "$public_headers" \
        --output "$public_body" \
        --write-out '%{http_code}' \
        "$PUBLIC_ORIGIN/" || true
)"

if [[ "$public_status" == '200' ]]; then
    test -s "$public_body"
    grep -Eiq '<!doctype html|<html' "$public_body"
    echo "Public DNS HTML check passed."
elif [[
    "$public_status" == '403' &&
    "$(tr '[:upper:]' '[:lower:]' < "$public_headers")" == *"server: cloudflare"*
]]; then
    echo \
        "Cloudflare returned 403 to the VPS curl check; origin verification passed." \
        >&2
else
    echo \
        "Public edge check returned HTTP ${public_status:-000}; origin verification passed." \
        >&2
fi

active_target="$(readlink -f "$CURRENT_LINK")"
if [[ "$active_target" != "$RELEASE_DIR" ]]; then
    echo "Current release link does not point to the activated release." >&2
    rollback
    exit 1
fi

echo "API health check passed on port $API_PORT."
echo "Prefixed token catalog smoke test passed."
echo "Origin TLS HTML check passed."
echo "Nginx API proxy checks passed."
echo "Active release source: $SHA"
echo "Release activation complete."

set +e

find "$RELEASES_DIR" \
    -mindepth 1 \
    -maxdepth 1 \
    -type d \
    -printf '%T@ %p\n' \
    | sort -rn \
    | tail -n +6 \
    | cut -d' ' -f2- \
    | while IFS= read -r old_release; do
        [[ -n "$old_release" ]] || continue
        [[ "$old_release" == "$RELEASE_DIR" ]] && continue
        [[ -n "$previous_target" && "$old_release" == "$previous_target" ]] &&
            continue

        rm -rf -- "$old_release" ||
            echo "Warning: could not remove old release $old_release"
    done

find "$RELEASES_DIR" \
    -mindepth 1 \
    -maxdepth 1 \
    -type f \
    \( -name '*.tar.gz' -o -name '*.tar.gz.sha256' \) \
    -printf '%T@ %p\n' \
    | sort -rn \
    | tail -n +11 \
    | cut -d' ' -f2- \
    | xargs -r rm -f --

set -e
echo "Deploy complete."
