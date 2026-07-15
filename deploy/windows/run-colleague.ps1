[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$DataRoot,
    [Parameter(Mandatory = $true)][string]$LogRoot,
    [Parameter(Mandatory = $true)][string]$Id
)

$ErrorActionPreference = 'Stop'
$Version = (Get-Content -Raw -LiteralPath (Join-Path $Root 'app\current.txt')).Trim()
$AppCurrent = Join-Path (Join-Path $Root 'app') $Version
$ColleagueDir = Join-Path (Join-Path $DataRoot 'colleagues') $Id
$MemoryDir = Join-Path (Join-Path (Join-Path $Root 'state') $Id) 'memory'
$EnvFile = Join-Path (Join-Path $Root 'env') "$Id.env"
$LogDir = Join-Path $LogRoot $Id
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Start-Transcript -Append -LiteralPath (Join-Path $LogDir 'service.log') | Out-Null

if (Test-Path -LiteralPath $EnvFile) {
    foreach ($Line in Get-Content -LiteralPath $EnvFile) {
        $Trimmed = $Line.Trim()
        if (-not $Trimmed -or $Trimmed.StartsWith('#')) { continue }
        $Parts = $Trimmed.Split(@('='), 2)
        if ($Parts.Count -ne 2 -or $Parts[0] -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
            throw "Invalid environment line in $EnvFile"
        }
        [Environment]::SetEnvironmentVariable($Parts[0], $Parts[1], 'Process')
    }
}

$Runtime = if ($env:DC_AGENT_RUNTIME) { $env:DC_AGENT_RUNTIME } else { 'codex' }
$HostAddress = if ($env:DC_HOST) { $env:DC_HOST } else { '127.0.0.1' }
$Port = if ($env:DC_PORT) { $env:DC_PORT } else { '8787' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required.' }
if ($Runtime -eq 'codex') {
    if (-not (Get-Command codex -ErrorAction SilentlyContinue)) { throw 'Codex CLI is required.' }
    & codex login status | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Run 'codex login' for this Windows user." }
}
if (-not (Test-Path -LiteralPath (Join-Path $AppCurrent 'dist\cli.js'))) { throw 'Installed app is incomplete.' }
if (-not (Test-Path -LiteralPath $ColleagueDir -PathType Container)) { throw "Colleague '$Id' is not installed." }
New-Item -ItemType Directory -Force -Path $MemoryDir | Out-Null
$env:DC_MEMORY_DIR = $MemoryDir

& node (Join-Path $AppCurrent 'dist\cli.js') serve --colleague $ColleagueDir --runtime $Runtime --host $HostAddress --port $Port --web-root (Join-Path $AppCurrent 'dist-web')
exit $LASTEXITCODE
