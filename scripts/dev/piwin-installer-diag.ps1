# Diagnose whether a GUI installer can actually appear in the interactive session.
param(
    [string]$Installer = "C:\Users\zhangjiale\Desktop\piwin-Setup-x64.exe",
    [string]$Log = "D:\src\diag.log",
    [int]$WaitSeconds = 12
)

$ErrorActionPreference = "Continue"

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class DiagWin {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT lpRect);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

    private static string Describe(IntPtr h) {
        StringBuilder title = new StringBuilder(512);
        GetWindowTextW(h, title, title.Capacity);
        StringBuilder cls = new StringBuilder(256);
        GetClassNameW(h, cls, cls.Capacity);
        RECT r;
        GetWindowRect(h, out r);
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        int w = r.Right - r.Left;
        int ht = r.Bottom - r.Top;
        return "pid=" + pid + " hwnd=" + h.ToInt64() + " class=" + cls.ToString()
             + " vis=" + (IsWindowVisible(h) ? 1 : 0)
             + " rect=" + r.Left + "," + r.Top + " " + w + "x" + ht
             + " title='" + title.ToString() + "'";
    }

    public static string[] TopLevelAll() {
        List<string> rows = new List<string>();
        EnumWindows(delegate(IntPtr h, IntPtr l) { rows.Add("TOP " + Describe(h)); return true; }, IntPtr.Zero);
        return rows.ToArray();
    }

    public static string[] ChildrenOf(IntPtr parent) {
        List<string> rows = new List<string>();
        EnumChildWindows(parent, delegate(IntPtr h, IntPtr l) { rows.Add("CHILD " + Describe(h)); return true; }, IntPtr.Zero);
        return rows.ToArray();
    }
}
"@

function Log-Line([string]$text) {
    $stamp = (Get-Date).ToString("HH:mm:ss.fff")
    Add-Content -Path $Log -Value ("[$stamp] " + $text) -Encoding UTF8
}

Set-Content -Path $Log -Value ("=== piwin installer diag " + (Get-Date)) -Encoding UTF8
Log-Line ("user=" + $env:USERNAME + " pid=" + $PID + " session=" + (Get-Process -Id $PID).SessionId + " interactive=" + [Environment]::UserInteractive)

Log-Line "--- sessions (quser) ---"
$q = & quser 2>&1
foreach ($line in $q) { Log-Line ("  " + $line) }

Log-Line "--- launching installer ---"
$proc = Start-Process -FilePath $Installer -PassThru
Log-Line ("  started pid=" + $proc.Id)

$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $proc.Refresh()
    if ($proc.HasExited) { Log-Line ("  exited early code=" + $proc.ExitCode); break }
}
$proc.Refresh()
Log-Line ("  hasExited=" + $proc.HasExited + " mainWindowHandle=" + $proc.MainWindowHandle)

Log-Line "--- top-level windows ---"
foreach ($row in [DiagWin]::TopLevelAll()) { Log-Line ("  " + $row) }

Log-Line "--- piwin processes ---"
Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match "piwin|setup|nsis" } |
    ForEach-Object { Log-Line ("  " + $_.Id + " " + $_.ProcessName + " session=" + $_.SessionId + " main=" + $_.MainWindowHandle + " ws=" + $_.WorkingSet64) }

Log-Line "--- children of installer window ---"
if (-not $proc.HasExited -and $proc.MainWindowHandle -ne 0) {
    foreach ($row in [DiagWin]::ChildrenOf([IntPtr]$proc.MainWindowHandle)) { Log-Line ("  " + $row) }
} else {
    Log-Line "  (no installer main window handle)"
}

if (-not $proc.HasExited) { $proc.Kill(); Log-Line "  installer killed" }
Log-Line "DONE"
