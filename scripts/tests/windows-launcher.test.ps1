$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot '../run-frontend.ps1'
$parseErrors = $null
$tokens = $null
[Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors) | Out-Null
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
. $scriptPath

$realGit = (Get-Command git -CommandType Application | Select-Object -First 1).Source
$temporary = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString('N'))
$script:testRemote = Join-Path $temporary 'upstream'
$destination = Join-Path $temporary 'custom folder/frontend'
$script:clones = 0
New-Item -ItemType Directory $temporary | Out-Null
function Assert-True($Value, $Message) { if (-not $Value) { throw $Message } }
function git {
    if ($args[0] -eq 'clone') {
        $script:clones++
        & $realGit clone --branch main --single-branch $script:testRemote $args[-1]
        if ($LASTEXITCODE -ne 0) { throw 'Fixture clone failed.' }
        & $realGit -C $args[-1] remote set-url origin 'https://github.com/parsij/PistachioSwap.git'
    } elseif ($args.Count -ge 3 -and $args[0] -eq '-C' -and $args[2] -eq 'fetch') {
        & $realGit -C $args[1] fetch $script:testRemote 'main:refs/remotes/origin/main'
    } else { & $realGit @args }
}
try {
    & $realGit init --initial-branch=main $script:testRemote
    & $realGit -C $script:testRemote config user.name Test
    & $realGit -C $script:testRemote config user.email test@example.invalid
    Set-Content (Join-Path $script:testRemote 'version') first
    & $realGit -C $script:testRemote add .
    & $realGit -C $script:testRemote -c commit.gpgsign=false commit -m first
    $checkout = Update-FrontendCheckout -Directory $destination
    Assert-True ($checkout -eq [IO.Path]::GetFullPath($destination)) 'Custom path was not returned correctly.'
    Set-Content (Join-Path $script:testRemote 'version') second
    & $realGit -C $script:testRemote add .
    & $realGit -C $script:testRemote -c commit.gpgsign=false commit -m second
    Update-FrontendCheckout -Directory $destination | Out-Null
    Assert-True ((Get-Content (Join-Path $destination 'version')) -eq 'second') 'Update did not fast-forward.'
    Assert-True ($script:clones -eq 1) 'Checkout was cloned more than once.'
    Set-Content (Join-Path $destination 'version') 'local work'
    $rejected = $false
    try { Update-FrontendCheckout -Directory $destination | Out-Null } catch { $rejected = $_.Exception.Message -match 'Local changes' }
    Assert-True $rejected 'Dirty checkout was not rejected.'
    Assert-True ((Get-Content (Join-Path $destination 'version')) -eq 'local work') 'Local work changed.'
    & $realGit -C $destination remote set-url origin 'https://github.com/other/unrelated.git'
    $rejected = $false
    try { Update-FrontendCheckout -Directory $destination | Out-Null } catch { $rejected = $_.Exception.Message -match 'Unexpected origin' }
    Assert-True $rejected 'Unexpected origin was not rejected.'
    Write-Host 'Windows launcher syntax, clone/update, and local-work preservation passed. No installers were run.'
} finally { Remove-Item -LiteralPath $temporary -Recurse -Force }
