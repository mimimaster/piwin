# Compile an NSIS script and dump every makensis warning/error to a log.
# A silent `warning 6000: unknown variable` is what turns a layout into 0x0.
param(
    [Parameter(Mandatory=$true)][string]$Script,
    [string]$LogPath = "D:\src\nsis-lint.txt",
    [string]$Makensis = "C:\Users\zhangjiale\AppData\Local\tauri\NSIS\makensis.exe"
)

$ErrorActionPreference = "Continue"
$workDir = Split-Path -Parent $Script
Push-Location $workDir
$raw = & $Makensis /V2 $Script 2>&1
Pop-Location

Set-Content -Path $LogPath -Value $raw -Encoding UTF8
Write-Output ("makensis exit=" + $LASTEXITCODE)

$interesting = $raw | Where-Object {
    $_ -match "warning 60(00|10)|unknown variable|^Error|failed"
}
if ($interesting) {
    Write-Output "--- interesting ---"
    $interesting | ForEach-Object { Write-Output ("  " + $_) }
} else {
    Write-Output "no unknown-variable / unreferenced-function warnings"
}
