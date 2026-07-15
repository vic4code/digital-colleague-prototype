[CmdletBinding()]
param(
    [string]$Id = 'ada',
    [switch]$PurgeData,
    [switch]$SkipTaskRegistration
)

$ErrorActionPreference = 'Stop'
$InstallRoot = if ($env:DC_INSTALL_ROOT) { $env:DC_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA 'DigitalColleague' }
$DataRoot = if ($env:DC_DATA_ROOT) { $env:DC_DATA_ROOT } else { Join-Path $env:APPDATA 'DigitalColleague' }
$LogRoot = if ($env:DC_LOG_ROOT) { $env:DC_LOG_ROOT } else { Join-Path $InstallRoot 'logs' }

if (-not $SkipTaskRegistration) {
    Unregister-ScheduledTask -TaskName "DigitalColleague-$Id" -Confirm:$false -ErrorAction SilentlyContinue
}
Remove-Item -Recurse -Force -LiteralPath (Join-Path $InstallRoot 'app') -ErrorAction SilentlyContinue

if ($PurgeData) {
    Remove-Item -Recurse -Force -LiteralPath (Join-Path (Join-Path $DataRoot 'colleagues') $Id) -ErrorAction SilentlyContinue
    Remove-Item -Force -LiteralPath (Join-Path (Join-Path $InstallRoot 'env') "$Id.env") -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force -LiteralPath (Join-Path (Join-Path $InstallRoot 'state') $Id) -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force -LiteralPath (Join-Path $LogRoot $Id) -ErrorAction SilentlyContinue
    Write-Host "Uninstalled $Id and purged its data"
} else {
    Write-Host "Uninstalled $Id; colleague, environment, memory, and logs were preserved"
}
