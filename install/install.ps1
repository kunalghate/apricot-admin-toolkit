# Apricot Admin Toolkit installer for Windows.
# Installs into your own user folder. No administrator rights needed.
#
#   irm https://raw.githubusercontent.com/kunalghate/apricot-admin-toolkit/main/install/install.ps1 | iex

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # makes downloads much faster in Windows PowerShell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo    = 'kunalghate/apricot-admin-toolkit'
$AppName = 'Apricot Admin Toolkit'
$Dir     = Join-Path $env:LOCALAPPDATA 'Programs\ApricotAdminToolkit'
$Exe     = Join-Path $Dir 'ApricotAdminToolkit.exe'
$Url     = "https://github.com/$Repo/releases/latest/download/apricot-toolkit-windows-x64.zip"

Write-Host ''
Write-Host "  Installing $AppName..." -ForegroundColor DarkYellow

# Close a running copy so it can be updated.
Get-Process -Name 'ApricotAdminToolkit' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$Zip = Join-Path $env:TEMP 'apricot-admin-toolkit.zip'
try {
  Write-Host '  Downloading (about 55 MB)...'
  Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing
  Expand-Archive -Path $Zip -DestinationPath $Dir -Force
} catch {
  Write-Host ''
  Write-Host "  The download didn't work. Check your internet connection and try again." -ForegroundColor Red
  Write-Host "  ($($_.Exception.Message))" -ForegroundColor DarkGray
  return
} finally {
  Remove-Item $Zip -ErrorAction SilentlyContinue
}

# Start menu and desktop shortcuts (per-user locations, no admin needed).
$Shell = New-Object -ComObject WScript.Shell
$Places = @(
  (Join-Path ([Environment]::GetFolderPath('Programs')) "$AppName.lnk"),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk")
)
foreach ($Path in $Places) {
  $Link = $Shell.CreateShortcut($Path)
  $Link.TargetPath = $Exe
  $Link.WorkingDirectory = $Dir
  $Link.Description = $AppName
  $Link.Save()
}

Write-Host ''
Write-Host "  Done! $AppName is installed." -ForegroundColor Green
Write-Host "  To start it later, click '$AppName' on your desktop or in the Start menu."
Write-Host ''
Write-Host '  Starting it now...'
Start-Process -FilePath $Exe -WorkingDirectory $Dir
