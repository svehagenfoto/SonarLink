const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const AdmZip = require('adm-zip');
const { DEPENDENCIES, REQUIRED_UE4SS_MODS, getBundledModPath } = require('./dependencyManifest');

const DOWNLOAD_TIMEOUT_MS = 120000;
const DOWNLOAD_MAX_ATTEMPTS = 3;
const MIN_ZIP_BYTES = 1024;
const DOWNLOAD_USER_AGENT = 'SonarLink/2.0.0';
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function removeDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      ensureDir(path.dirname(destPath));
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function isValidZipFile(zipPath) {
  try {
    const stat = fs.statSync(zipPath);
    if (!stat.isFile() || stat.size < MIN_ZIP_BYTES) return false;
    const zip = new AdmZip(zipPath);
    return zip.getEntries().length > 0;
  } catch {
    return false;
  }
}

function downloadFileOnce(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;

    const request = client.get(
      url,
      {
        headers: {
          'User-Agent': DOWNLOAD_USER_AGENT,
          Accept: '*/*',
        },
      },
      (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlink(destPath, () => {});
          downloadFileOnce(response.headers.location, destPath, onProgress).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {});
          reject(new Error(`Download failed (${response.statusCode})`));
          return;
        }

        const total = Number(response.headers['content-length'] || 0);
        let received = 0;

        response.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress && total > 0) {
            onProgress(Math.min(1, received / total));
          }
        });

        response.pipe(file);
        file.on('finish', () => {
          file.close(() => resolve(destPath));
        });
      },
    );

    request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(new Error('Download timed out'));
    });

    request.on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function downloadFile(url, destPath, onProgress) {
  let lastError = null;

  for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      await downloadFileOnce(url, destPath, onProgress);
      if (!isValidZipFile(destPath)) {
        throw new Error('Downloaded file is not a valid zip');
      }
      return destPath;
    } catch (err) {
      lastError = err;
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
      if (attempt < DOWNLOAD_MAX_ATTEMPTS) {
        await sleep(1000 * attempt);
      }
    }
  }

  throw lastError || new Error('Download failed');
}
function verifyDependency(dep, gameWin64Dir) {
  if (!dep.verify || !gameWin64Dir) return false;

  return dep.verify.every((item) => {
    const fullPath = path.join(gameWin64Dir, item.relativePath);
    if (!fs.existsSync(fullPath)) return false;
    if (item.relativePath.toLowerCase().endsWith('.dll')) {
      try {
        return fs.statSync(fullPath).size > 1024;
      } catch {
        return false;
      }
    }
    return true;
  });
}

function checkAllDependencies(config, gameWin64Dir) {
  const missing = [];
  const outdated = [];

  for (const dep of DEPENDENCIES) {
    const installedVersion = config.installed?.[dep.id];
    const valid = verifyDependency(dep, gameWin64Dir);

    if (!valid) {
      missing.push(dep);
      continue;
    }

    if (installedVersion && installedVersion !== dep.version) {
      outdated.push(dep);
    }
  }

  return { missing, outdated, needsWork: missing.length > 0 || outdated.length > 0 };
}

function withInstalledVersions(config, depsToInstall) {
  const installed = { ...(config.installed || {}) };
  for (const dep of depsToInstall) {
    installed[dep.id] = dep.version;
  }
  return { ...config, installed };
}

function syncVerifiedInstallations(config, gameWin64Dir) {
  const installed = { ...(config.installed || {}) };
  let changed = false;

  for (const dep of DEPENDENCIES) {
    if (!verifyDependency(dep, gameWin64Dir)) continue;
    if (installed[dep.id]) continue;

    installed[dep.id] = dep.version;
    changed = true;
  }

  if (!changed) return config;
  return { ...config, installed };
}

function extractZipToDir(zipPath, destDir) {
  ensureDir(destDir);
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, true);
}

function copyZipRootToGameWin64(stagingDir, gameWin64Dir) {
  const entries = fs.readdirSync(stagingDir, { withFileTypes: true });

  if (entries.length === 1 && entries[0].isDirectory()) {
    copyDir(path.join(stagingDir, entries[0].name), gameWin64Dir);
    return;
  }

  for (const entry of entries) {
    const src = path.join(stagingDir, entry.name);
    const dest = path.join(gameWin64Dir, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else {
      ensureDir(gameWin64Dir);
      fs.copyFileSync(src, dest);
    }
  }

  const ue4ssDll = path.join(gameWin64Dir, 'ue4ss', 'UE4SS.dll');
  const dwmapiDll = path.join(gameWin64Dir, 'dwmapi.dll');
  if (fs.existsSync(ue4ssDll) && fs.existsSync(dwmapiDll)) {
    return;
  }

  const found = { dwmapi: null, ue4ss: null };
  walkStagingForDlls(stagingDir, found);

  if (found.dwmapi && !fs.existsSync(dwmapiDll)) {
    ensureDir(gameWin64Dir);
    fs.copyFileSync(found.dwmapi, dwmapiDll);
  }

  if (found.ue4ss && !fs.existsSync(ue4ssDll)) {
    ensureDir(path.dirname(ue4ssDll));
    fs.copyFileSync(found.ue4ss, ue4ssDll);
  }
}

function walkStagingForDlls(dir, found) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkStagingForDlls(fullPath, found);
      continue;
    }

    const lower = entry.name.toLowerCase();
    if (lower === 'dwmapi.dll' && !found.dwmapi) {
      found.dwmapi = fullPath;
    }
    if (lower === 'ue4ss.dll' && !found.ue4ss) {
      found.ue4ss = fullPath;
    }
  }
}

function ensureModsTxt(gameWin64Dir) {
  const modsTxtPath = path.join(gameWin64Dir, 'ue4ss', 'mods.txt');
  ensureDir(path.dirname(modsTxtPath));

  let lines = [];
  if (fs.existsSync(modsTxtPath)) {
    lines = fs.readFileSync(modsTxtPath, 'utf8').split(/\r?\n/);
  }

  const map = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([^:]+)\s*:\s*(\d+)/);
    if (match) {
      map.set(match[1].trim(), match[2].trim());
    }
  }

  for (const modName of REQUIRED_UE4SS_MODS) {
    map.set(modName, '1');
  }

  const output = [...map.entries()].map(([name, enabled]) => `${name} : ${enabled}`);
  fs.writeFileSync(modsTxtPath, `${output.join('\n')}\n`, 'utf8');
}

async function installDependency(dep, { dataRoot, gameWin64Dir, onProgress }) {
  const cacheDir = path.join(dataRoot, 'cache');
  const stagingDir = path.join(dataRoot, 'staging', dep.id);
  ensureDir(cacheDir);
  removeDir(stagingDir);
  ensureDir(stagingDir);

  if (dep.installType === 'extract-zip-to-game-win64') {
    const zipPath = path.join(cacheDir, `${dep.id}-${dep.version}.zip`);
    const cacheValid = fs.existsSync(zipPath) && isValidZipFile(zipPath);

    if (cacheValid) {
      if (onProgress) onProgress(1);
    } else {
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }
      await downloadFile(dep.downloadUrl, zipPath, onProgress);
    }

    extractZipToDir(zipPath, stagingDir);
    ensureDir(gameWin64Dir);
    copyZipRootToGameWin64(stagingDir, gameWin64Dir);
    ensureModsTxt(gameWin64Dir);
    removeDir(stagingDir);

    if (!verifyDependency(dep, gameWin64Dir)) {
      throw new Error(`Install verification failed: ${dep.id}`);
    }
    return;
  }
  if (dep.installType === 'copy-bundled-mod') {
    const bundledPath = getBundledModPath(dep);
    if (!fs.existsSync(bundledPath)) {
      throw new Error(`Bundled mod missing: ${dep.id} (${bundledPath})`);
    }
    const target = path.join(gameWin64Dir, dep.gameRelativePath);
    removeDir(target);
    copyDir(bundledPath, target);
    ensureModsTxt(gameWin64Dir);
    if (onProgress) onProgress(1);

    if (!verifyDependency(dep, gameWin64Dir)) {
      throw new Error(`Install verification failed: ${dep.id}`);
    }
    return;
  }
  throw new Error(`Unknown install type: ${dep.installType}`);
}

function dependencyLabel(dep) {
  if (dep.id === 'ue4ss') return 'INSTALLING UE4SS';
  if (dep.id === 'sonarlink-bridge') return 'INSTALLING SONARLINK MOD';
  return `INSTALLING ${dep.id.toUpperCase()}`;
}

async function repairDependencies(deps, context) {
  const results = [];
  let requiresRestart = false;

  for (let i = 0; i < deps.length; i += 1) {
    const dep = deps[i];
    const base = i / deps.length;
    const span = 1 / deps.length;

    if (context.onStatus) {
      context.onStatus(dependencyLabel(dep));
    }

    await installDependency(dep, {
      ...context,
      onProgress: (fraction) => {
        if (context.onProgress) {
          context.onProgress(base + fraction * span);
        }
      },
    });
    if (dep.requiresGameRestart) {
      requiresRestart = true;
    }

    results.push(dep.id);
  }

  return { installed: results, requiresRestart };
}

module.exports = {
  checkAllDependencies,
  repairDependencies,
  verifyDependency,
  syncVerifiedInstallations,
  withInstalledVersions,
  sleep,
};
