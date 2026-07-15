[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Colleague,
    [switch]$SkipTaskRegistration,
    [switch]$SkipBuild,
    [switch]$SkipDependencies,
    [switch]$SkipCodexPreflight
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path
$InstallRoot = if ($env:DC_INSTALL_ROOT) { $env:DC_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA 'DigitalColleague' }
$DataRoot = if ($env:DC_DATA_ROOT) { $env:DC_DATA_ROOT } else { Join-Path $env:APPDATA 'DigitalColleague' }
$LogRoot = if ($env:DC_LOG_ROOT) { $env:DC_LOG_ROOT } else { Join-Path $InstallRoot 'logs' }

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE"
    }
}

if (-not (Test-Path -LiteralPath $Colleague -PathType Container)) {
    throw "Colleague directory does not exist: $Colleague"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 20.19+ is required.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm is required.' }

$NodeParts = (& node -p "process.versions.node.split('.').slice(0,2).join('.')").Split('.')
if ([int]$NodeParts[0] -lt 20 -or ([int]$NodeParts[0] -eq 20 -and [int]$NodeParts[1] -lt 19)) {
    throw "Node.js 20.19+ is required; found $(& node --version)."
}
if (-not $SkipCodexPreflight) {
    if (-not (Get-Command codex -ErrorAction SilentlyContinue)) { throw 'Codex CLI is required.' }
    Invoke-Checked 'codex' @('login', 'status')
}

$PersonFile = Join-Path $Colleague 'person.yaml'
$Id = $null
foreach ($Line in Get-Content -LiteralPath $PersonFile) {
    if ($Line -match '^id:\s*["'']?([^\s"'']+)') { $Id = $Matches[1]; break }
}
if (-not $Id -or $Id -notmatch '^[a-z0-9][a-z0-9-]*$') { throw 'person.yaml has an invalid id.' }
$Version = (Get-Content -Raw -LiteralPath (Join-Path $RepoRoot 'package.json') | ConvertFrom-Json).version
$AppVersion = Join-Path (Join-Path $InstallRoot 'app') $Version
$ColleagueTarget = Join-Path (Join-Path $DataRoot 'colleagues') $Id
$EnvFile = Join-Path (Join-Path $InstallRoot 'env') "$Id.env"
$MemoryDir = Join-Path (Join-Path (Join-Path $InstallRoot 'state') $Id) 'memory'
$LogDir = Join-Path $LogRoot $Id
$TaskName = "DigitalColleague-$Id"

if (-not $SkipBuild) {
    Push-Location $RepoRoot
    try {
        Invoke-Checked 'npm' @('ci')
        Invoke-Checked 'npm' @('run', 'build')
        Invoke-Checked 'npm' @('run', 'build:web')
    } finally { Pop-Location }
}

if (Test-Path -LiteralPath $AppVersion) { Remove-Item -Recurse -Force -LiteralPath $AppVersion }
New-Item -ItemType Directory -Force -Path $AppVersion, (Join-Path $AppVersion 'deploy\windows'), (Split-Path $EnvFile), $MemoryDir, $LogDir | Out-Null
Copy-Item -Force -LiteralPath (Join-Path $RepoRoot 'package.json'), (Join-Path $RepoRoot 'package-lock.json') -Destination $AppVersion
Copy-Item -Recurse -Force -LiteralPath (Join-Path $RepoRoot 'dist'), (Join-Path $RepoRoot 'dist-web') -Destination $AppVersion
Copy-Item -Force -LiteralPath (Join-Path $ScriptDir 'run-colleague.ps1') -Destination (Join-Path $AppVersion 'deploy\windows\run-colleague.ps1')
if (-not $SkipDependencies) {
    Push-Location $AppVersion
    try { Invoke-Checked 'npm' @('ci', '--omit=dev') } finally { Pop-Location }
}
Set-Content -Encoding ASCII -LiteralPath (Join-Path $InstallRoot 'app\current.txt') -Value $Version

if (-not (Test-Path -LiteralPath $ColleagueTarget)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $ColleagueTarget) | Out-Null
    Copy-Item -Recurse -Force -LiteralPath $Colleague -Destination $ColleagueTarget
}
if (-not (Test-Path -LiteralPath $EnvFile)) {
    Set-Content -Encoding ASCII -LiteralPath $EnvFile -Value @('DC_AGENT_RUNTIME=codex', 'DC_HOST=127.0.0.1', 'DC_PORT=8787')
}
if (Get-Command icacls.exe -ErrorAction SilentlyContinue) {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $EnvFile '/inheritance:r' '/grant:r' "${Identity}:(R,W)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not protect the environment file ACL.' }
}

if (-not $SkipTaskRegistration) {
    $Runner = Join-Path $AppVersion 'deploy\windows\run-colleague.ps1'
    $Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`" -Root `"$InstallRoot`" -DataRoot `"$DataRoot`" -LogRoot `"$LogRoot`" -Id $Id"
    $Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $Arguments -WorkingDirectory $AppVersion
    $Trigger = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
    $Settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
    $Principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null
    Start-ScheduledTask -TaskName $TaskName
}

Write-Host "Installed $Id $Version"
Write-Host 'Open http://127.0.0.1:8787'
