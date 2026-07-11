const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const nextExe = `SonarLink-${pkg.version}.exe`;

try {
  execSync(
    'powershell -NoProfile -Command "Get-Process SonarLink* -ErrorAction SilentlyContinue | Stop-Process -Force"',
    { stdio: 'ignore', windowsHide: true },
  );
} catch {
  /* not running */
}

for (const name of fs.readdirSync(root)) {
  if (!/^SonarLink(-[\d.]+)?\.exe$/i.test(name)) continue;

  const full = path.join(root, name);
  try {
    fs.unlinkSync(full);
    console.log(`Removed old exe: ${name}`);
  } catch (err) {
    console.warn(`Could not remove ${name}: ${err.message}`);
  }
}

console.log(`Ready to build ${nextExe}`);
