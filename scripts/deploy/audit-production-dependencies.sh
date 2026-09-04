#!/usr/bin/env bash
set -euo pipefail

MAX_ATTEMPTS="${PNPM_AUDIT_MAX_ATTEMPTS:-3}"

if [[ ! "$MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || (( MAX_ATTEMPTS > 10 )); then
    echo "PNPM_AUDIT_MAX_ATTEMPTS must be an integer from 1 through 10." >&2
    exit 64
fi

for (( attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1 )); do
    set +e
    output="$(pnpm audit --prod --audit-level=high 2>&1)"
    status=$?
    set -e

    printf '%s\n' "$output"

    if (( status == 0 )); then
        exit 0
    fi

    if ! grep -Eiq \
        'ERR_SOCKET_TIMEOUT|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|HTTP[^0-9]*(429|500|502|503|504)|status[^0-9]*(429|500|502|503|504)' \
        <<<"$output"
    then
        # A real audit finding is not a transient infrastructure error. Preserve
        # pnpm's failure so high/critical vulnerabilities continue to block deploys.
        exit "$status"
    fi

    if (( attempt == MAX_ATTEMPTS )); then
        echo "Dependency audit could not complete reliably after $MAX_ATTEMPTS attempts." >&2
        exit "$status"
    fi

    delay=$(( attempt * 10 ))
    echo "Transient npm registry error during dependency audit; retrying in ${delay}s (${attempt}/${MAX_ATTEMPTS})." >&2
    sleep "$delay"
done
