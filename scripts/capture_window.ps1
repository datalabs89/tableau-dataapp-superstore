# Captures a specific window by handle, not the screen.
#
# CopyFromScreen grabs whatever is physically on top, which is how an earlier
# attempt produced a screenshot of the terminal instead of Tableau. PrintWindow
# asks the window to render itself into a bitmap, so the capture is of that
# window whether or not it is in the foreground.

param(
    [int]$ProcessId = 0,
    [string]$Out = "C:\Users\User\Documents\Tableau-DataApp-Superstore\build\shots\desktop-opened.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Text;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public class Cap {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  public static IntPtr FindMain(uint wantPid, out string title) {
    IntPtr found = IntPtr.Zero; string t = "";
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != wantPid) return true;
      var sb = new StringBuilder(512);
      GetWindowTextW(h, sb, 512);
      if (sb.Length == 0) return true;
      RECT r; GetWindowRect(h, out r);
      // Prefer the largest window owned by the process: the main frame.
      if (found == IntPtr.Zero) { found = h; t = sb.ToString(); }
      else {
        RECT old; GetWindowRect(found, out old);
        if ((r.R - r.L) * (r.B - r.T) > (old.R - old.L) * (old.B - old.T)) { found = h; t = sb.ToString(); }
      }
      return true;
    }, IntPtr.Zero);
    title = t; return found;
  }
}
"@

if ($ProcessId -eq 0) {
    $p = Get-Process -Name tableau -ErrorAction SilentlyContinue |
         Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -First 1
    if (-not $p) { Write-Output "FATAL: no tableau window"; exit 1 }
    $ProcessId = $p.Id
}

$title = ""
$hwnd = [Cap]::FindMain([uint32]$ProcessId, [ref]$title)
if ($hwnd -eq [IntPtr]::Zero) { Write-Output "FATAL: no visible window for pid $ProcessId"; exit 1 }
Write-Output "pid=$ProcessId hwnd=$hwnd title='$title'"

# Bring it forward as well, so any composited child surfaces are current.
[Cap]::ShowWindow($hwnd, 3) | Out-Null
[Cap]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Seconds 3

$r = New-Object Cap+RECT
[Cap]::GetWindowRect($hwnd, [ref]$r) | Out-Null
$w = $r.R - $r.L; $h = $r.B - $r.T
Write-Output "rect: ${w}x${h} at ($($r.L),$($r.T))"

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# flag 2 = PW_RENDERFULLCONTENT, needed for GPU-composited / DWM content.
$ok = [Cap]::PrintWindow($hwnd, $hdc, 2)
if (-not $ok) { $ok = [Cap]::PrintWindow($hwnd, $hdc, 0) }
$g.ReleaseHdc($hdc)
$g.Dispose()

# Wipe any residue outside the window's own pixels.
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Output "printwindow: $ok"
Write-Output "saved: $Out"
Write-Output ("bytes: {0:N0}" -f (Get-Item $Out).Length)
