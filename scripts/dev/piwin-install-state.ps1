# Report the installed state of piwinwin on this machine.
param(
    [string]$LogPath = "D:\src\install-state.log"
)

$ErrorActionPreference = "Continue"
$out = New-Object System.Collections.Generic.List[string]
function W([string]$line) { $out.Add($line) }

W ("=== piwin install state " + (Get-Date) + " ===")

W "--- processes ---"
Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match "piwin|uninstall|Un_A|Au_" } |
    ForEach-Object { W ("  " + $_.Id + " " + $_.ProcessName + " session=" + $_.SessionId) }

$root = Join-Path $env:LOCALAPPDATA "piwinwin"
W "--- install dir ---"
W ("  " + $root + " exists=" + (Test-Path $root))
if (Test-Path $root) {
    $items = Get-ChildItem $root -ErrorAction SilentlyContinue
    W ("  entries=" + $items.Count)
    foreach ($item in $items) { W ("    " + $item.Name + " " + ($item.Length)) }
    $hostDir = Join-Path $root "host"
    if (Test-Path $hostDir) {
        $files = Get-ChildItem $hostDir -Recurse -File -ErrorAction SilentlyContinue
        W ("  host files=" + $files.Count + " bytes=" + ($files | Measure-Object -Property Length -Sum).Sum)
    }
}

W "--- uninstall registry ---"
foreach ($hive in @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\piwinwin",
                    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\piwinwin")) {
    $key = Get-ItemProperty $hive -ErrorAction SilentlyContinue
    if ($null -ne $key) {
        W ("  " + $hive)
        W ("    DisplayName=" + $key.DisplayName + " DisplayVersion=" + $key.DisplayVersion)
        W ("    InstallLocation=" + $key.InstallLocation)
        W ("    UninstallString=" + $key.UninstallString)
    } else {
        W ("  " + $hive + " -> absent")
    }
}

W "--- shortcuts ---"
foreach ($path in @(
        (Join-Path ([Environment]::GetFolderPath("Desktop")) "piwinwin.lnk"),
        (Join-Path ([Environment]::GetFolderPath("Desktop")) "piwin.lnk"),
        (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\piwinwin.lnk"))) {
    W ("  " + $path + " exists=" + (Test-Path $path))
}

W "--- desktop contents ---"
Get-ChildItem ([Environment]::GetFolderPath("Desktop")) -Filter "piwin*" -ErrorAction SilentlyContinue |
    ForEach-Object { W ("  " + $_.Name + " " + $_.Length) }

Set-Content -Path $LogPath -Value $out -Encoding UTF8
Write-Output ("state written to " + $LogPath)
