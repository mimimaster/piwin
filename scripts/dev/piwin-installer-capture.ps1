# Capture the piwin NSIS installer window headlessly.
# Runs as an interactive scheduled task so the GUI lands in the logged-on session.
param(
    [string]$Installer = "C:\Users\zhangjiale\Desktop\piwin-Setup-x64.exe",
    [string]$OutDir = "D:\src\shots",
    [int]$WaitSeconds = 10,
    [int]$Shots = 3,
    [int]$BetweenMs = 1500,
    [switch]$LeaveRunning
)

$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class WinCap {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", SetLastError=true)] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint nFlags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int count);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

    public static List<IntPtr> TopLevel(uint targetPid) {
        List<IntPtr> found = new List<IntPtr>();
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (pid == targetPid) { found.Add(h); }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static string TitleOf(IntPtr h) {
        StringBuilder sb = new StringBuilder(512);
        GetWindowTextW(h, sb, sb.Capacity);
        return sb.ToString();
    }

    public static string ClassOf(IntPtr h) {
        StringBuilder sb = new StringBuilder(256);
        GetClassNameW(h, sb, sb.Capacity);
        return sb.ToString();
    }
}
"@

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Get-ChildItem -Path $OutDir -Filter *.png -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

$proc = Start-Process -FilePath $Installer -PassThru
Write-Output ("launched pid=" + $proc.Id)

# Resolve the top-level wizard window (NSIS: class #32770, non-zero size, visible).
$hwnd = [IntPtr]::Zero
$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
    if ($proc.HasExited) { break }
    $cands = [WinCap]::TopLevel([uint32]$proc.Id)
    foreach ($h in $cands) {
        $r = New-Object WinCap+RECT
        [void][WinCap]::GetWindowRect($h, [ref]$r)
        $w = $r.Right - $r.Left
        $ht = $r.Bottom - $r.Top
        if ($w -gt 200 -and $ht -gt 150 -and [WinCap]::IsWindowVisible($h)) {
            $hwnd = $h
            break
        }
    }
    if ($hwnd -ne [IntPtr]::Zero) { break }
}

if ($hwnd -eq [IntPtr]::Zero) {
    Write-Output "NO_WINDOW_FOUND"
    if (-not $LeaveRunning -and -not $proc.HasExited) { $proc.Kill() }
    exit 2
}

for ($i = 0; $i -lt $Shots; $i++) {
    Start-Sleep -Milliseconds $BetweenMs
    if ($proc.HasExited) {
        Write-Output ("installer exited before shot " + $i + " code=" + $proc.ExitCode)
        break
    }
    $rect = New-Object WinCap+RECT
    [void][WinCap]::GetWindowRect($hwnd, [ref]$rect)
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    $title = [WinCap]::TitleOf($hwnd)
    Write-Output ("shot " + $i + " hwnd=" + $hwnd + " size=" + $width + "x" + $height + " pos=" + $rect.Left + "," + $rect.Top + " title='" + $title + "'")

    $bmp = New-Object System.Drawing.Bitmap $width, $height
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $gfx.GetHdc()
    # 2 = PW_RENDERFULLCONTENT (DWM composited content, Win 8.1+)
    $ok = [WinCap]::PrintWindow($hwnd, $hdc, 2)
    if (-not $ok) { $ok = [WinCap]::PrintWindow($hwnd, $hdc, 0) }
    $gfx.ReleaseHdc($hdc)
    $gfx.Dispose()
    $path = Join-Path $OutDir ("shot-" + $i + ".png")
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output ("  saved " + $path + " printwindow=" + $ok)
}

if (-not $LeaveRunning) {
    if (-not $proc.HasExited) {
        $proc.Kill()
        Start-Sleep -Milliseconds 500
        Write-Output "installer killed"
    }
}
Write-Output "DONE"
