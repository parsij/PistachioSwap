param([string]$Dir = '', [switch]$Help)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Tool {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE." }
}

function Test-Node24 {
    if (-not (Get-Command node -CommandType Application -ErrorAction SilentlyContinue)) { return $false }
    try { return ((& node -p 'process.versions.node.split(".")[0]' 2>$null) -eq '24' -and $LASTEXITCODE -eq 0) }
    catch { return $false }
}

function Install-FrontendTools {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $toolsRoot = Join-Path $env:LOCALAPPDATA 'PistachioSwap\tools'
    $nodeRoot = Join-Path $toolsRoot 'node'
    $pnpmRoot = Join-Path $toolsRoot 'pnpm'
    $env:PATH = "$nodeRoot;$pnpmRoot;$env:PATH"
    if (-not (Get-Command git -CommandType Application -ErrorAction SilentlyContinue)) {
        if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
            throw 'Install or update Microsoft App Installer (winget), then rerun this command.'
        }
        Write-Host 'Installing Git using winget; Windows may request approval.'
        Invoke-Tool winget @('install', '--id', 'Git.Git', '--exact', '--source', 'winget', '--scope', 'user', '--accept-source-agreements', '--accept-package-agreements')
        $env:PATH = "$env:PATH;$([Environment]::GetEnvironmentVariable('Path', 'User'));$([Environment]::GetEnvironmentVariable('Path', 'Machine'));$env:LOCALAPPDATA\Programs\Git\cmd"
        if (-not (Get-Command git -CommandType Application -ErrorAction SilentlyContinue)) { throw 'Git was installed but is not available. Reopen PowerShell and rerun.' }
    }
    if (-not (Test-Node24) -or (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue) -and -not (Get-Command npm.cmd -ErrorAction SilentlyContinue))) {
        $architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
        if ($architecture -notin @('x64', 'arm64')) { throw 'Automatic Node.js installation supports x64 and arm64 Windows.' }
        $temporary = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $temporary -Force | Out-Null
        try {
            $checksums = (Invoke-WebRequest -UseBasicParsing 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt').Content
            $entry = @($checksums -split "`n" | Where-Object { $_ -match "^([a-fA-F0-9]{64})\s+(node-v24\.\d+\.\d+-win-$architecture\.zip)\s*$" })
            if ($entry.Count -ne 1) { throw 'No unique official Node.js 24 archive is available for this system.' }
            $fields = $entry[0].Trim() -split '\s+'
            $expected = $fields[0]
            $archive = $fields[1]
            $version = ($archive -split '-')[1]
            $archivePath = Join-Path $temporary $archive
            Write-Host "Installing Node.js $version in the PistachioSwap tools folder; system Node.js is preserved."
            Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$version/$archive" -OutFile $archivePath
            if ((Get-FileHash -Algorithm SHA256 $archivePath).Hash -ne $expected) { throw 'Node.js checksum verification failed; nothing was installed.' }
            Expand-Archive -Path $archivePath -DestinationPath $temporary
            $unpacked = Join-Path $temporary ($archive -replace '\.zip$', '')
            Invoke-Tool (Join-Path $unpacked 'node.exe') @('--version')
            New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
            if (Test-Path $nodeRoot) { Move-Item -LiteralPath $nodeRoot -Destination (Join-Path $temporary 'previous-node') }
            Move-Item -LiteralPath $unpacked -Destination $nodeRoot
            if (-not (Test-Node24)) { throw 'Node.js 24 could not start.' }
        } finally { Remove-Item -LiteralPath $temporary -Recurse -Force }
    }
    if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) {
        Write-Host 'Installing pnpm 10.34.5 into the PistachioSwap tools folder...'
        Invoke-Tool npm.cmd @('install', '--global', '--prefix', $pnpmRoot, '--ignore-scripts', '--no-audit', '--no-fund', 'pnpm@10.34.5')
    }
    if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) { throw 'pnpm could not be installed.' }
}

function Update-FrontendCheckout {
    param([string]$Directory)
    $origins = @('https://github.com/parsij/PistachioSwap', 'https://github.com/parsij/PistachioSwap.git', 'git@github.com:parsij/PistachioSwap.git')
    if (-not $Directory) {
        $Directory = Join-Path (Get-Location) 'PistachioSwap'
        if (Test-Path -LiteralPath '.git') {
            $currentOrigin = & git remote get-url origin 2>$null
            if ($LASTEXITCODE -eq 0 -and $currentOrigin -in $origins) { $Directory = (Get-Location).Path }
        }
    }
    $Directory = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Directory)
    if (Test-Path -LiteralPath (Join-Path $Directory '.git')) {
        $origin = & git -C $Directory remote get-url origin
        if ($LASTEXITCODE -ne 0 -or $origin -notin $origins) { throw 'Unexpected origin; nothing was changed.' }
        $branch = & git -C $Directory symbolic-ref --short HEAD
        if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'Switch this checkout to main or choose another -Dir.' }
        $changes = & git -C $Directory status --porcelain
        if ($LASTEXITCODE -ne 0 -or $changes) { throw 'Local changes found. Commit/stash them or choose another -Dir.' }
        Invoke-Tool git @('-C', $Directory, 'fetch', 'origin', 'main')
        $ahead = & git -C $Directory rev-list --count 'origin/main..HEAD'
        if ($LASTEXITCODE -ne 0 -or $ahead -ne '0') { throw 'Local commits found. Reconcile them manually or choose another -Dir.' }
        Invoke-Tool git @('-C', $Directory, 'merge', '--ff-only', 'origin/main')
    } else {
        Invoke-Tool git @('clone', '--branch', 'main', '--single-branch', 'https://github.com/parsij/PistachioSwap.git', $Directory)
    }
    return $Directory
}

function Start-PistachioFrontend {
    param([string]$Directory)
    Install-FrontendTools
    # Native-command output is displayed, not mixed into the returned directory.
    $checkout = Update-FrontendCheckout -Directory $Directory
    Push-Location -LiteralPath $checkout
    try {
        Invoke-Tool pnpm.cmd @('install', '--frozen-lockfile')
        Invoke-Tool pnpm.cmd @('self-host')
    } finally { Pop-Location }
}

if ($Help) { Write-Host 'Usage: run-frontend.ps1 [-Dir PATH]. Installs missing tools and starts the local frontend.' }
elseif ($MyInvocation.InvocationName -ne '.') { Start-PistachioFrontend -Directory $Dir }
