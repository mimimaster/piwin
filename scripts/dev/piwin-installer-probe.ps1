# Launch the piwin NSIS installer in the interactive session, dump its exact
# window/control geometry (with dialog control IDs), and capture a PNG.
#
# Runs as an interactive scheduled task: the GUI must land in the logged-on
# desktop session, which an SSH-launched process cannot reach.
param(
    [string]$Installer = "C:\Users\zhangjiale\Desktop\piwin-Setup-x64.exe",
    [string]$LogPath   = "D:\src\card-check.log",
    [string]$ShotPath  = "D:\src\card-check.png",
    [int]$WaitSeconds  = 15,
    [int]$SettleMs     = 2500,
    [switch]$LeaveRunning
)

$ErrorActionPreference = "Continue"
$out = New-Object System.Collections.Generic.List[string]
function W([string]$line) { $out.Add($line) }

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type -ErrorAction Stop @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class WinProbe {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out RECT lpRect);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint nFlags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

    public static string Describe(IntPtr h, bool withId) {
        StringBuilder title = new StringBuilder(512);
        GetWindowTextW(h, title, title.Capacity);
        StringBuilder cls = new StringBuilder(256);
        GetClassNameW(h, cls, cls.Capacity);
        RECT wr; GetWindowRect(h, out wr);
        RECT cr; GetClientRect(h, out cr);
        return "  ctrlId=" + GetDlgCtrlID(h).ToString().PadLeft(5)
             + " class=" + cls.ToString().PadRight(12)
             + " vis=" + (IsWindowVisible(h) ? 1 : 0)
             + " win=" + (wr.Right - wr.Left) + "x" + (wr.Bottom - wr.Top)
             + " @" + wr.Left + "," + wr.Top
             + " client=" + (cr.Right - cr.Left) + "x" + (cr.Bottom - cr.Top)
             + " text='" + title.ToString().Replace("\r", " ").Replace("\n", " | ") + "'";
    }

    public static IntPtr FindWindowForPid(uint targetPid) {
        IntPtr best = IntPtr.Zero;
        int bestArea = 0;
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pid != targetPid) return true;
            if (!IsWindowVisible(h)) return true;
            RECT r; GetWindowRect(h, out r);
            int area = (r.Right - r.Left) * (r.Bottom - r.Top);
            if (area > bestArea) { bestArea = area; best = h; }
            return true;
        }, IntPtr.Zero);
        return best;
    }

    public static string[] Children(IntPtr parent) {
        List<string> rows = new List<string>();
        EnumChildWindows(parent, delegate(IntPtr h, IntPtr l) { rows.Add(Describe(h, true)); return true; }, IntPtr.Zero);
        return rows.ToArray();
    }

    public static string TopWindowLine(IntPtr h) { return Describe(h, true); }

    public static bool Blit(IntPtr hwnd, IntPtr hdc) {
        // 2 = PW_RENDERFULLCONTENT (DWM-composited content)
        if (PrintWindow(hwnd, hdc, 2)) return true;
        return PrintWindow(hwnd, hdc, 0);
    }
}
"@

$exitCode = 0
try {
    W ("=== piwin installer card check " + (Get-Date) + " ===")
    $me = Get-Process -Id $PID
    W ("session=" + $me.SessionId + " interactive=" + [Environment]::UserInteractive + " installer=" + $Installer)

    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    W ("screen=" + $screen.Width + "x" + $screen.Height)

    $proc = Start-Process -FilePath $Installer -PassThru
    W ("launched pid=" + $proc.Id)

    $hwnd = [IntPtr]::Zero
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 300
        $proc.Refresh()
        if ($proc.HasExited) { W ("exited early code=" + $proc.ExitCode); break }
        $hwnd = [WinProbe]::FindWindowForPid([uint32]$proc.Id)
        if ($hwnd -ne [IntPtr]::Zero) { break }
    }

    if ($hwnd -eq [IntPtr]::Zero) {
        W "NO_WINDOW"
        $exitCode = 2
    } else {
        W ("dpi=" + [WinProbe]::GetDpiForWindow($hwnd) + " hwnd=" + $hwnd)
        Start-Sleep -Milliseconds $SettleMs
        $proc.Refresh()
        W ("after settle: hasExited=" + $proc.HasExited)
        if (-not $proc.HasExited) {
            [void][WinProbe]::SetForegroundWindow($hwnd)
            Start-Sleep -Milliseconds 400
            W "--- window ---"
            W ([WinProbe]::TopWindowLine($hwnd))
            W "--- children ---"
            foreach ($row in [WinProbe]::Children($hwnd)) { W $row }
            function Save-Shot([string]$path, [string]$label) {
                $wr = New-Object WinProbe+RECT
                [void][WinProbe]::GetWindowRect($hwnd, [ref]$wr)
                $shotW = $wr.Right - $wr.Left
                $shotH = $wr.Bottom - $wr.Top
                if ($shotW -le 0 -or $shotH -le 0) { W ("shot skipped for " + $label); return }
                $bmp = New-Object System.Drawing.Bitmap $shotW, $shotH
                $gfx = [System.Drawing.Graphics]::FromImage($bmp)
                $hdc = $gfx.GetHdc()
                $ok = [WinProbe]::Blit($hwnd, $hdc)
                $gfx.ReleaseHdc($hdc)
                $gfx.Dispose()
                if ($ok) {
                    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
                    W ("shot " + $label + " -> " + $path + " " + $shotW + "x" + $shotH)
                } else {
                    W ("shot " + $label + " FAILED (PrintWindow returned false)")
                }
                $bmp.Dispose()
            }

            Save-Shot $ShotPath "early"
            Start-Sleep -Milliseconds 4000
            $proc.Refresh()
            if (-not $proc.HasExited) {
                W "--- window (4s later) ---"
                W ([WinProbe]::TopWindowLine($hwnd))
                Save-Shot ($ShotPath -replace "\.png$", "-late.png") "late"
            } else {
                W ("installer finished before the late shot, code=" + $proc.ExitCode)
            }
        }
    }
}
catch {
    W ("EXCEPTION: " + $_.Exception.Message)
    W ($_.ScriptStackTrace)
    $exitCode = 3
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
exit $exitCode
