#!/usr/bin/env bash
set -euo pipefail

install_dir="./PistachioSwap"
custom_dir=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dir)
            [[ $# -ge 2 && -n "$2" ]] || { echo 'Usage: bash run-frontend.sh [--dir PATH]' >&2; exit 1; }
            install_dir="$2"
            custom_dir=true
            shift 2
            ;;
        --help|-h)
            echo 'Usage: bash run-frontend.sh [--dir PATH]'
            echo 'Installs missing tools, then runs the frontend. Defaults to ./PistachioSwap.'
            exit 0
            ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

as_admin() {
    if [[ "$(id -u)" == 0 ]]; then "$@"; else
        command -v sudo >/dev/null 2>&1 || { echo 'Installing system tools requires sudo or an administrator.' >&2; exit 1; }
        sudo "$@" </dev/tty
    fi
}

install_system_tools() {
    echo 'Installing Git and download/archive utilities using your package manager...'
    if command -v apt-get >/dev/null 2>&1; then
        as_admin apt-get update
        as_admin apt-get install -y git curl ca-certificates tar gzip
    elif command -v dnf >/dev/null 2>&1; then
        as_admin dnf install -y git curl ca-certificates tar gzip
    elif command -v pacman >/dev/null 2>&1; then
        as_admin pacman -S --needed --noconfirm git curl ca-certificates tar gzip
    elif command -v zypper >/dev/null 2>&1; then
        as_admin zypper --non-interactive install git curl ca-certificates tar gzip
    elif command -v apk >/dev/null 2>&1; then
        as_admin apk add git curl ca-certificates tar gzip libstdc++
    elif command -v brew >/dev/null 2>&1; then
        brew install git curl
    else
        echo 'No supported package manager found. Install Git, curl, and tar, then rerun.' >&2
        exit 1
    fi
    hash -r
}

tools_root="${XDG_DATA_HOME:-$HOME/.local/share}/pistachioswap/tools"
export PATH="$tools_root/node/bin:$tools_root/pnpm/bin:$PATH"
if ! command -v git >/dev/null 2>&1 || ! git --version >/dev/null 2>&1 ||
    ! command -v curl >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
    install_system_tools
fi

node_24() { command -v node >/dev/null 2>&1 && [[ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" == 24 ]]; }
if ! node_24 || { ! command -v pnpm >/dev/null 2>&1 && ! command -v npm >/dev/null 2>&1; }; then
    case "$(uname -s)" in
        Linux) platform=linux; [[ ! -f /etc/alpine-release ]] || platform=linux-musl ;;
        Darwin) platform=darwin ;;
        *) echo 'Use the PowerShell launcher on native Windows.' >&2; exit 1 ;;
    esac
    case "$(uname -m)" in
        x86_64|amd64) arch=x64 ;;
        aarch64|arm64) arch=arm64 ;;
        *) echo 'Automatic Node.js installation supports x64 and arm64.' >&2; exit 1 ;;
    esac
    suffix="$platform-$arch"
    [[ "$platform" != linux-musl ]] || suffix="linux-$arch-musl"
    temp_dir="$(mktemp -d)"
    trap 'rm -rf -- "$temp_dir"' EXIT
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
        https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$temp_dir/checksums"
    archive="$(awk -v suffix="$suffix" '$2 ~ ("^node-v24\\.[0-9]+\\.[0-9]+-" suffix "\\.tar\\.gz$") { print $2; exit }' "$temp_dir/checksums")"
    [[ -n "$archive" ]] || { echo 'No official Node.js 24 archive is available for this system.' >&2; exit 1; }
    version="${archive#node-}"; version="${version%%-*}"
    echo "Installing Node.js $version in the PistachioSwap tools folder (existing system Node.js is preserved)..."
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
        "https://nodejs.org/dist/$version/$archive" -o "$temp_dir/$archive"
    expected="$(awk -v file="$archive" '$2 == file {print $1; exit}' "$temp_dir/checksums")"
    if command -v sha256sum >/dev/null 2>&1; then
        actual="$(sha256sum "$temp_dir/$archive")"
    elif command -v shasum >/dev/null 2>&1; then
        actual="$(shasum -a 256 "$temp_dir/$archive")"
    else
        echo 'Install sha256sum or shasum to verify the Node.js download.' >&2; exit 1
    fi
    [[ "${actual%% *}" == "$expected" ]] || { echo 'Node.js checksum verification failed; nothing was installed.' >&2; exit 1; }
    mkdir -p "$temp_dir/unpacked" "$tools_root"
    tar -xzf "$temp_dir/$archive" -C "$temp_dir/unpacked" --strip-components=1
    "$temp_dir/unpacked/bin/node" --version
    [[ ! -e "$tools_root/node" ]] || mv "$tools_root/node" "$temp_dir/previous-node"
    mv "$temp_dir/unpacked" "$tools_root/node"
    hash -r
    node_24 || { echo 'Node.js 24 could not be started on this system.' >&2; exit 1; }
    rm -rf -- "$temp_dir"
    trap - EXIT
fi
if ! command -v pnpm >/dev/null 2>&1; then
    echo 'Installing pnpm 10.34.5 into the PistachioSwap tools folder...'
    npm install --global --prefix "$tools_root/pnpm" --ignore-scripts --no-audit --no-fund pnpm@10.34.5
    hash -r
fi
for tool in git node pnpm; do command -v "$tool" >/dev/null 2>&1 || { echo "$tool could not be installed." >&2; exit 1; }; done

if [[ "$custom_dir" == false && ( -d .git || -f .git ) ]]; then
    current_remote="$(git remote get-url origin 2>/dev/null || true)"
    case "$current_remote" in
        https://github.com/parsij/PistachioSwap|https://github.com/parsij/PistachioSwap.git|git@github.com:parsij/PistachioSwap.git) install_dir=. ;;
    esac
fi

if [[ -d "$install_dir/.git" || -f "$install_dir/.git" ]]; then
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
