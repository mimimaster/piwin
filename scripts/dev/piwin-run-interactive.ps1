# Run a PowerShell script as an interactive scheduled task in the logged-on session.
param(
    [Parameter(Mandatory=$true)][string]$Script,
    [string]$TaskName = "piwin-interactive-run",
    [int]$WaitSeconds = 30
)

$ErrorActionPreference = "Stop"

$argLine = "-NoProfile -ExecutionPolicy Bypass -File `"$Script`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argLine
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $state = (Get-ScheduledTask -TaskName $TaskName).State
    if ($state -ne "Running") { break }
}
Write-Output ("task=" + $TaskName + " state=" + (Get-ScheduledTask -TaskName $TaskName).State)
Get-ScheduledTaskInfo -TaskName $TaskName | Format-List LastRunTime, LastTaskResult
