const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CACHE_DIR_NAMES = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'ShaderCache',
  'GrShaderCache',
  'GraphiteDawnCache',
];

const PRUNE_THRESHOLD_BYTES = 32 * 1024 * 1024;

function getDirectorySize(dirPath) {
  let total = 0;

  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirectorySize(fullPath);
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(fullPath).size;
        } catch {
          // ignore unreadable files
        }
      }
    }
  } catch {
    return 0;
  }

  return total;
}

function removeDirectorySafe(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return 0;
  }

  const size = getDirectorySize(dirPath);

  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    return size;
  } catch {
    return 0;
  }
}

function pruneElectronChromiumCache() {
  let userData = null;

  try {
    userData = app.getPath('userData');
  } catch {
    return { pruned: false, reason: 'NO_USER_DATA' };
  }

  if (!userData || !fs.existsSync(userData)) {
    return { pruned: false, reason: 'NO_USER_DATA' };
  }

  let totalBytes = 0;
  const cacheDirs = [];

  for (const name of CACHE_DIR_NAMES) {
    const dirPath = path.join(userData, name);
    if (!fs.existsSync(dirPath)) continue;

    const size = getDirectorySize(dirPath);
    totalBytes += size;
    cacheDirs.push(dirPath);
  }

  if (totalBytes < PRUNE_THRESHOLD_BYTES) {
    return {
      pruned: false,
      totalBytes,
      removedBytes: 0,
      thresholdBytes: PRUNE_THRESHOLD_BYTES,
    };
  }

  let removedBytes = 0;
  for (const dirPath of cacheDirs) {
    removedBytes += removeDirectorySafe(dirPath);
  }

  return {
    pruned: true,
    totalBytes,
    removedBytes,
    thresholdBytes: PRUNE_THRESHOLD_BYTES,
  };
}

module.exports = {
  pruneElectronChromiumCache,
  PRUNE_THRESHOLD_BYTES,
};
