#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-/home/arch/WebstormProjects/pistachioswap_lite}"
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKUP="/tmp/pistachioswap-crosschain-backup-$(date +%Y%m%d-%H%M%S)"

if [[ ! -f "$ROOT/package.json" || ! -d "$ROOT/apps/api" ]]; then
  printf 'Not a PistachioSwap repository: %s\n' "$ROOT" >&2
  exit 1
fi

mkdir -p "$BACKUP"
files=(
  "apps/api/src/cross-chain/validation.ts"
  "apps/api/src/cross-chain/adapters/relay/index.ts"
  "apps/api/test/cross-chain.test.ts"
  "src/features/cross-chain/hooks/useCrossChainRoutes.js"
  "src/features/cross-chain/hooks/useCrossChainController.js"
  "src/features/cross-chain/components/CrossChainReviewDialog.jsx"
  "src/features/cross-chain/components/crossChain.css"
)

for rel in "${files[@]}"; do
  if [[ -f "$ROOT/$rel" ]]; then
    mkdir -p "$BACKUP/$(dirname "$rel")"
    cp -p "$ROOT/$rel" "$BACKUP/$rel"
  fi
  mkdir -p "$ROOT/$(dirname "$rel")"
  cp -p "$HERE/$rel" "$ROOT/$rel"
done

printf 'Applied %s files. Backup: %s\n' "${#files[@]}" "$BACKUP"
