#!/usr/bin/env bash
set -euo pipefail

install_dir="./PistachioSwap"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dir)
            [[ $# -ge 2 && -n "$2" ]] || { echo 'Usage: bash run-frontend.sh [--dir PATH]' >&2; exit 1; }
            install_dir="$2"
            shift 2
            ;;
        --help|-h)
            echo 'Usage: bash run-frontend.sh [--dir PATH]'
            echo 'Requires Git, Node.js 24, and pnpm. Defaults to ./PistachioSwap.'
            exit 0
            ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

for tool in git node pnpm; do
    command -v "$tool" >/dev/null 2>&1 || { echo "Install $tool before running this command." >&2; exit 1; }
done
[[ "$(node -p 'process.versions.node.split(".")[0]')" == 24 ]] || { echo 'Use Node.js 24.' >&2; exit 1; }

if [[ -e "$install_dir" ]]; then
    [[ -d "$install_dir/.git" || -f "$install_dir/.git" ]] || { echo 'The destination exists but is not a PistachioSwap checkout. Choose another --dir.' >&2; exit 1; }
    remote="$(git -C "$install_dir" remote get-url origin)"
    case "$remote" in
        https://github.com/parsij/PistachioSwap|https://github.com/parsij/PistachioSwap.git|git@github.com:parsij/PistachioSwap.git) ;;
        *) echo 'The existing checkout has an unexpected origin; nothing was changed.' >&2; exit 1 ;;
    esac
    [[ "$(git -C "$install_dir" symbolic-ref --short HEAD)" == main ]] || { echo 'Switch this checkout to main before updating, or choose another --dir.' >&2; exit 1; }
    [[ -z "$(git -C "$install_dir" status --porcelain)" ]] || { echo 'Local changes found. Commit or stash them before updating, or choose another --dir.' >&2; exit 1; }
    echo 'Checking for updates...'
    git -C "$install_dir" fetch origin main
    [[ "$(git -C "$install_dir" rev-list --count origin/main..HEAD)" == 0 ]] || { echo 'Local commits found; reconcile them manually or choose another --dir.' >&2; exit 1; }
    git -C "$install_dir" merge --ff-only origin/main
else
    git clone --branch main --single-branch https://github.com/parsij/PistachioSwap.git "$install_dir"
fi

cd -- "$install_dir"
pnpm install --frozen-lockfile
exec pnpm self-host
