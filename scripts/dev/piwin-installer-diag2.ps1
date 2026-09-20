# Watch a freshly launched installer for ~20s and report, every second: whether
# the process is alive, its CPU time, and every top-level window it owns (no
# visibility or area filter, unlike the screenshot probe).
#
# Distinguishes the two failure modes that both look like "no window":
#   * window exists but is 0x0            -> layout/maths bug
#   * no window at all, CPU spinning       -> blocked in .onInit
#   * no window, no CPU                    -> blocked on I/O or waiting on a child
param(
    [string]$Installer = "C:\Users\zhangjiale\Desktop\piwin-Setup-x64.exe",
    [string]$LogPath   = "D:\src\diag2.log",
    [string]$ShotPath  = "D:\src\diag2-screen.png",
    [int]$Seconds      = 20,
    [switch]$LeaveRunning
)

$ErrorActionPreference = "Continue"
$out = New-Object System.Collections.Generic.List[string]
function W([string]$line) { $out.Add($line) }

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class Diag2 {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr hwnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

    public static string[] WindowsOf(uint targetPid) {
        List<string> rows = new List<string>();
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (pid != targetPid) return true;
            StringBuilder title = new StringBuilder(512);
            GetWindowTextW(h, title, title.Capacity);
            StringBuilder cls = new StringBuilder(256);
            GetClassNameW(h, cls, cls.Capacity);
            RECT r;
            GetWindowRect(h, out r);
            rows.Add("hwnd=" + h.ToInt64()
                   + " class=" + cls.ToString()
                   + " vis=" + (IsWindowVisible(h) ? 1 : 0)
                   + " hung=" + (IsHungAppWindow(h) ? 1 : 0)
                   + " rect=" + r.Left + "," + r.Top + " "
                   + (r.Right - r.Left) + "x" + (r.Bottom - r.Top)
                   + " title='" + title.ToString() + "'");
            return true;
        }, IntPtr.Zero);
        return rows.ToArray();
    }

    public static string DescribeWindow(IntPtr h) {
        StringBuilder title = new StringBuilder(512);
        GetWindowTextW(h, title, title.Capacity);
        StringBuilder cls = new StringBuilder(256);
        GetClassNameW(h, cls, cls.Capacity);
        RECT r;
        GetWindowRect(h, out r);
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        return "hwnd=" + h.ToInt64() + " pid=" + pid + " class=" + cls.ToString()
             + " vis=" + (IsWindowVisible(h) ? 1 : 0)
             + " rect=" + r.Left + "," + r.Top + " " + (r.Right - r.Left) + "x" + (r.Bottom - r.Top)
             + " title='" + title.ToString() + "'";
    }

    public static string Foreground() { return DescribeWindow(GetForegroundWindow()); }
}
"@

try {
    W ("=== installer diag2 " + (Get-Date) + " ===")
    W ("session=" + (Get-Process -Id $PID).SessionId + " screen=" + [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width + "x" + [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height)

    # any other installer process still around would block a fresh one
    Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -match "piwin|uninstall|Un_A|Au_" } |
        ForEach-Object { W ("  preexisting " + $_.Id + " " + $_.ProcessName) }

    $proc = Start-Process -FilePath $Installer -PassThru
    W ("launched pid=" + $proc.Id)
    $first = $true
    $startCpu = 0.0
    for ($i = 0; $i -lt $Seconds; $i++) {
        Start-Sleep -Seconds 1
        $proc.Refresh()
        if ($proc.HasExited) {
            W ("[" + $i + "] exited code=" + $proc.ExitCode)
            break
        }
        if ($first) { $startCpu = $proc.CPU; $first = $false }
        $cpu = [math]::Round($proc.CPU - $startCpu, 2)
        $windows = [Diag2]::WindowsOf([uint32]$proc.Id)
        W ("[" + $i + "] alive cpuDelta=" + $cpu + "s threads=" + $proc.Threads.Count + " windows=" + $windows.Count + " fg=" + [Diag2]::Foreground())
        foreach ($row in $windows) { W ("      " + $row) }
    }

    $proc.Refresh()
    if (-not $proc.HasExited) {
        W "process still running - capturing full screen"
        $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
        $gfx = [System.Drawing.Graphics]::FromImage($bmp)
        $gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        $gfx.Dispose()
        $bmp.Save($ShotPath, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        W ("  screen shot -> " + $ShotPath)
    }
}
catch {
    W ("EXCEPTION: " + $_.Exception.Message)
    W $_.ScriptStackTrace
}
finally {
    if (-not $LeaveRunning) {
        Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $_.ProcessName -like "piwin-Setup*" } |
            ForEach-Object { try { $_.Kill(); W ("killed " + $_.Id) } catch { } }
    }
    W "DONE"
    Set-Content -Path $LogPath -Value $out -Encoding UTF8
}
