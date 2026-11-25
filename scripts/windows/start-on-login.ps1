<#
  Start Aurora automatically when you sign in to Windows (minimised), or stop doing so.

  Right-click this file -> "Run with PowerShell", or from a terminal in the Aurora folder:
    powershell -ExecutionPolicy Bypass -File scripts\windows\start-on-login.ps1           # turn on
    powershell -ExecutionPolicy Bypass -File scripts\windows\start-on-login.ps1 -Remove   # turn off
#>
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$launcher = Join-Path $root 'Aurora.cmd'
$startup = [Environment]::GetFolderPath('Startup')
$link = Join-Path $startup 'Aurora.lnk'

if ($Remove) {
  if (Test-Path $link) { Remove-Item $link; Write-Host 'Aurora will no longer start when you sign in.' }
  else { Write-Host 'Aurora was not set to start at sign-in.' }
  exit 0
}

if (-not (Test-Path $launcher)) { throw "Aurora.cmd not found in $root" }

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($link)
$sc.TargetPath = $launcher
$sc.Arguments = '--quiet'
$sc.WorkingDirectory = $root
$sc.WindowStyle = 7   # minimised
$sc.Description = 'Aurora music server'
$sc.Save()
Write-Host "Done. Aurora will start (minimised) whenever you sign in to Windows."
Write-Host "To undo: run this script again with -Remove."
