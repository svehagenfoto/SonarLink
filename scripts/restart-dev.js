const { execFileSync, spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

function runQuiet(file, args) {
  try {
    execFileSync(file, args, { stdio: 'ignore', windowsHide: true });
  } catch {
    /* not running */
  }
}

function killSonarLink() {
  runQuiet('taskkill', ['/F', '/IM', 'SonarLink.exe', '/T']);
}

function killDevElectron() {
  const rootEscaped = ROOT.replace(/'/g, "''");
  const ps = `
$root = '${rootEscaped}'
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ForEach-Object {
  if ($_.CommandLine -and $_.CommandLine.Contains($root)) {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}
`;
  runQuiet('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps]);
}

function startDev() {
  spawn(ELECTRON, ['.'], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

killSonarLink();
killDevElectron();

setTimeout(() => {
  startDev();
  console.log('SonarLink restarted in dev mode');
}, 400);
