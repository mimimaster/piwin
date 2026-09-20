$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"
$env:Path = "D:\tools\node-v22.19.0-win-x64;$env:USERPROFILE\.cargo\bin;$env:Path"
Set-Location D:\src\piwin

$override = '{"build":{"beforeBuildCommand":""}}'
$overridePath = "D:\src\piwin\apps\desktop\src-tauri\tauri.override.json"
Set-Content -Path $overridePath -Value $override -Encoding ASCII

Set-Location D:\src\piwin\apps\desktop
Write-Output "Building NSIS installer..."
pnpm package -- -c src-tauri/tauri.override.json -b nsis
Write-Output "Build finished with code $LASTEXITCODE"

$nsisDir = "D:\src\piwin\apps\desktop\src-tauri\target\release\bundle\nsis"
if (Test-Path $nsisDir) {
  Get-ChildItem $nsisDir | Format-Table Name, Length, LastWriteTime
}
