[CmdletBinding()]
param(
    [string]$Id = 'ada',
    [switch]$SkipTaskRegistration
)

$ErrorActionPreference = 'Stop'
$InstallRoot = if ($env:DC_INSTALL_ROOT) { $env:DC_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA 'DigitalColleague' }
$DataRoot = if ($env:DC_DATA_ROOT) { $env:DC_DATA_ROOT } else { Join-Path $env:APPDATA 'DigitalColleague' }
$CurrentFile = Join-Path $InstallRoot 'app\current.txt'
$ColleagueDir = Join-Path (Join-Path $DataRoot 'colleagues') $Id
if (-not (Test-Path -LiteralPath $CurrentFile) -or -not (Test-Path -LiteralPath $ColleagueDir)) {
    Write-Host "$Id is not installed"
    exit 1
}

Write-Host "$Id installed at $InstallRoot"
Write-Host "version: $((Get-Content -Raw -LiteralPath $CurrentFile).Trim())"
if ($SkipTaskRegistration) {
    Write-Host 'Scheduled Task check skipped'
} else {
    $Task = Get-ScheduledTask -TaskName "DigitalColleague-$Id" -ErrorAction SilentlyContinue
    if (-not $Task) { Write-Host 'Scheduled Task: not registered'; exit 1 }
    Write-Host "Scheduled Task: $($Task.State)"
}
