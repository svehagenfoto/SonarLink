const { execFile } = require('child_process');

const PROCESS_NAMES = ['Subnautica2-Win64-Shipping', 'Subnautica2'];

const PS_GET_BOUNDS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SonarWin32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT {
    public int Left; public int Top; public int Right; public int Bottom;
  }
}
"@
$names = @(${PROCESS_NAMES.map((n) => `'${n}'`).join(',')})
foreach ($n in $names) {
  $p = Get-Process -Name $n -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Select-Object -First 1
  if ($p) {
    $r = New-Object SonarWin32+RECT
    [void][SonarWin32]::GetWindowRect($p.MainWindowHandle, [ref]$r)
    $w = $r.Right - $r.Left
    $h = $r.Bottom - $r.Top
    if ($w -gt 200 -and $h -gt 200) {
      Write-Output "$($r.Left)|$($r.Top)|$w|$h"
      exit 0
    }
  }
}
exit 1
`;

const PS_GET_HANDLE = `
$names = @(${PROCESS_NAMES.map((n) => `'${n}'`).join(',')})
foreach ($n in $names) {
  $p = Get-Process -Name $n -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Select-Object -First 1
  if ($p) {
    Write-Output $p.MainWindowHandle.ToInt64()
    exit 0
  }
}
exit 1
`;

const PS_GET_PID = `
$names = @(${PROCESS_NAMES.map((n) => `'${n}'`).join(',')})
foreach ($n in $names) {
  $p = Get-Process -Name $n -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Select-Object -First 1
  if ($p) {
    Write-Output $p.Id
    exit 0
  }
}
exit 1
`;

function getGameWindowBounds() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS_GET_BOUNDS],
      { windowsHide: true },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve(null);
          return;
        }
        const parts = stdout.trim().split('|').map(Number);
        if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
          resolve(null);
          return;
        }
        const [x, y, width, height] = parts;
        resolve({ x, y, width, height });
      }
    );
  });
}

function getGameWindowHandle() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS_GET_HANDLE],
      { windowsHide: true },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve(null);
          return;
        }

        const handle = Number(stdout.trim());
        if (!Number.isFinite(handle) || handle <= 0) {
          resolve(null);
          return;
        }

        resolve(handle);
      }
    );
  });
}

function getGameProcessId() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS_GET_PID],
      { windowsHide: true },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve(null);
          return;
        }

        const pid = Number(stdout.trim());
        if (!Number.isFinite(pid) || pid <= 0) {
          resolve(null);
          return;
        }

        resolve(pid);
      }
    );
  });
}

module.exports = {
  getGameWindowBounds,
  getGameWindowHandle,
  getGameProcessId,
};
