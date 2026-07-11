const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const GAME_EXE = 'Subnautica2-Win64-Shipping.exe';

function execRegQuery(key) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', 'InstallPath'], { windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const match = stdout.match(/InstallPath\s+REG_SZ\s+(.+)/i);
      resolve(match ? match[1].trim() : null);
    });
  });
}

async function getSteamInstallPath() {
  const keys = [
    'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam',
    'HKLM\\SOFTWARE\\Valve\\Steam',
    'HKCU\\Software\\Valve\\Steam',
  ];

  for (const key of keys) {
    const installPath = await execRegQuery(key);
    if (installPath && fs.existsSync(installPath)) {
      return installPath;
    }
  }

  return null;
}

function parseLibraryFolders(steamPath) {
  const libraries = [steamPath];
  const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  if (!fs.existsSync(vdfPath)) return libraries;

  try {
    const text = fs.readFileSync(vdfPath, 'utf8');
    const matches = text.matchAll(/"path"\s+"([^"]+)"/gi);
    for (const match of matches) {
      const lib = match[1].replace(/\\\\/g, '\\');
      if (fs.existsSync(lib)) libraries.push(lib);
    }
  } catch {
    // ignore parse errors
  }

  return [...new Set(libraries)];
}

function findWin64InTree(root, depth = 0) {
  if (depth > 6 || !fs.existsSync(root)) return null;

  const directExe = path.join(root, GAME_EXE);
  if (fs.existsSync(directExe)) {
    return root;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name.toLowerCase();
    if (name === 'engine' || name === 'node_modules' || name.startsWith('.')) continue;
    const found = findWin64InTree(path.join(root, entry.name), depth + 1);
    if (found) return found;
  }

  return null;
}

async function detectSubnauticaWin64Dir() {
  const steamPath = await getSteamInstallPath();
  if (!steamPath) return null;

  const libraries = parseLibraryFolders(steamPath);
  const commonNames = ['Subnautica 2', 'Subnautica2'];

  for (const library of libraries) {
    const commonRoot = path.join(library, 'steamapps', 'common');
    if (!fs.existsSync(commonRoot)) continue;

    for (const folderName of commonNames) {
      const gameRoot = path.join(commonRoot, folderName);
      const win64 = findWin64InTree(gameRoot);
      if (win64) return win64;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(commonRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.toLowerCase().includes('subnautica')) continue;
      const win64 = findWin64InTree(path.join(commonRoot, entry.name));
      if (win64) return win64;
    }
  }

  return null;
}

module.exports = {
  GAME_EXE,
  detectSubnauticaWin64Dir,
};
