const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const DATA_FOLDER_NAME = 'SonarLink';
const LOCATION_FILE_NAME = 'sonarlink.location';
const BACKUP_POINTER_FILE_NAME = 'data-root.path';
const LEGACY_CONFIG_DIR = path.join(os.homedir(), 'AppData', 'Local', 'SonarLink');
const LEGACY_DUPLICATE_FILES = ['config.json', 'paths.json', 'commands.jsonl', 'map-telemetry.json'];

function getExeDir() {
  if (app.isPackaged) {
    return path.dirname(process.execPath);
  }
  return path.join(__dirname, '..', '..');
}

function getLocationFilePath() {
  return path.join(getExeDir(), LOCATION_FILE_NAME);
}

function readLocationPointer() {
  const locationFile = getLocationFilePath();
  if (!fs.existsSync(locationFile)) return null;

  try {
    const raw = fs.readFileSync(locationFile, 'utf8').trim();
    return raw || null;
  } catch {
    return null;
  }
}

function getBackupPointerPath() {
  return path.join(LEGACY_CONFIG_DIR, BACKUP_POINTER_FILE_NAME);
}

function readBackupPointer() {
  const backupFile = getBackupPointerPath();
  if (!fs.existsSync(backupFile)) return null;

  try {
    const raw = fs.readFileSync(backupFile, 'utf8').trim();
    return raw || null;
  } catch {
    return null;
  }
}

function writeBackupPointer(dataRoot) {
  if (!dataRoot) return;
  fs.mkdirSync(LEGACY_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(getBackupPointerPath(), `${dataRoot}\n`, 'utf8');
}

function clearBackupPointer() {
  const backupFile = getBackupPointerPath();
  if (fs.existsSync(backupFile)) {
    fs.unlinkSync(backupFile);
  }
}

function clearAllLocationPointers() {
  clearLocationPointer();
  clearBackupPointer();
}

function isRecoverableDataRoot(dataRoot) {
  if (!isDataRootValid(dataRoot)) return false;

  const configFile = path.join(dataRoot, 'config.json');
  if (fs.existsSync(configFile)) return true;

  const cacheDir = path.join(dataRoot, 'cache');
  const logsDir = path.join(dataRoot, 'logs');
  return fs.existsSync(cacheDir) && fs.existsSync(logsDir);
}

function rememberDataRoot(dataRoot) {
  writeLocationPointer(dataRoot);
  writeBackupPointer(dataRoot);
}

function writeLocationPointer(dataRoot) {
  const locationFile = getLocationFilePath();
  fs.writeFileSync(locationFile, `${dataRoot}\n`, 'utf8');
}

function clearLocationPointer() {
  const locationFile = getLocationFilePath();
  if (fs.existsSync(locationFile)) {
    fs.unlinkSync(locationFile);
  }
}

function isDataRootValid(dataRoot) {
  if (!dataRoot || typeof dataRoot !== 'string') return false;
  try {
    return fs.existsSync(dataRoot) && fs.statSync(dataRoot).isDirectory();
  } catch {
    return false;
  }
}

function canCreateDataRoot(dataRoot) {
  if (!dataRoot || typeof dataRoot !== 'string') return false;
  try {
    if (fs.existsSync(dataRoot)) {
      return fs.statSync(dataRoot).isDirectory();
    }
    const parent = path.dirname(dataRoot);
    return fs.existsSync(parent) && fs.statSync(parent).isDirectory();
  } catch {
    return false;
  }
}

function ensureDataRootStructure(dataRoot) {
  const dirs = ['cache', 'staging', 'logs'];
  if (!fs.existsSync(dataRoot)) {
    fs.mkdirSync(dataRoot, { recursive: true });
  }
  for (const name of dirs) {
    const full = path.join(dataRoot, name);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
    }
  }
}

function migrateLegacyConfig(targetRoot) {
  const legacyConfig = path.join(LEGACY_CONFIG_DIR, 'config.json');
  if (!fs.existsSync(legacyConfig)) return false;

  try {
    ensureDataRootStructure(targetRoot);
    const configDest = path.join(targetRoot, 'config.json');
    if (!fs.existsSync(configDest)) {
      fs.copyFileSync(legacyConfig, configDest);
    }

    const legacyPaths = path.join(LEGACY_CONFIG_DIR, 'paths.json');
    const pathsDest = path.join(targetRoot, 'paths.json');
    if (fs.existsSync(legacyPaths) && !fs.existsSync(pathsDest)) {
      fs.copyFileSync(legacyPaths, pathsDest);
    }

    const legacyCommands = path.join(LEGACY_CONFIG_DIR, 'commands.jsonl');
    const commandsDest = path.join(targetRoot, 'commands.jsonl');
    if (fs.existsSync(legacyCommands) && !fs.existsSync(commandsDest)) {
      fs.copyFileSync(legacyCommands, commandsDest);
    }

    cleanupLegacyAppDataDuplicates(targetRoot);
    return true;
  } catch {
    return false;
  }
}

function readDataRootPathsFile(dataRoot) {
  const pathsFile = path.join(dataRoot, 'paths.json');
  if (!fs.existsSync(pathsFile)) return null;

  try {
    return JSON.parse(fs.readFileSync(pathsFile, 'utf8'));
  } catch {
    return null;
  }
}

function isPathUnderDataRoot(filePath, dataRoot) {
  if (!filePath || !dataRoot) return false;

  const normalizedFile = path.normalize(filePath).toLowerCase();
  const normalizedRoot = path.normalize(dataRoot).toLowerCase();
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}\\`);
}

function canRemoveLegacyDuplicate(name, dataRoot) {
  const dataRootPath = path.join(dataRoot, name);
  if (fs.existsSync(dataRootPath)) return true;

  const bridge = readDataRootPathsFile(dataRoot);
  if (!bridge) return false;

  if (name === 'commands.jsonl') {
    return isPathUnderDataRoot(bridge.commandsFile, dataRoot);
  }

  if (name === 'map-telemetry.json') {
    return isPathUnderDataRoot(bridge.mapTelemetryFile, dataRoot);
  }

  return false;
}

function cleanupLegacyAppDataDuplicates(dataRoot) {
  if (!dataRoot || !isRecoverableDataRoot(dataRoot)) {
    return { removed: [] };
  }

  if (!fs.existsSync(path.join(dataRoot, 'config.json'))) {
    return { removed: [] };
  }

  const removed = [];

  for (const name of LEGACY_DUPLICATE_FILES) {
    const legacyPath = path.join(LEGACY_CONFIG_DIR, name);
    if (!fs.existsSync(legacyPath)) continue;
    if (!canRemoveLegacyDuplicate(name, dataRoot)) continue;

    try {
      fs.unlinkSync(legacyPath);
      removed.push(name);
    } catch {
      // Ignore delete failures; legacy duplicates are harmless but confusing.
    }
  }

  return { removed };
}

function discoverKnownDataRoots() {
  const candidates = [
    path.join('C:\\', DATA_FOLDER_NAME),
    path.join('D:\\', DATA_FOLDER_NAME),
    path.join(os.homedir(), DATA_FOLDER_NAME),
    path.join(getExeDir(), DATA_FOLDER_NAME),
  ];

  const seen = new Set();
  const matches = [];

  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    if (seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());

    if (isRecoverableDataRoot(normalized)) {
      matches.push(normalized);
    }
  }

  return matches;
}

function resolveDataRoot() {
  const pointer = readLocationPointer();

  if (pointer && isRecoverableDataRoot(pointer)) {
    ensureDataRootStructure(pointer);
    writeBackupPointer(pointer);
    return pointer;
  }

  if (pointer && !isDataRootValid(pointer)) {
    clearLocationPointer();
  }

  const backup = readBackupPointer();
  if (backup && isRecoverableDataRoot(backup)) {
    writeLocationPointer(backup);
    ensureDataRootStructure(backup);
    return backup;
  }

  if (backup && !isDataRootValid(backup)) {
    clearBackupPointer();
  }

  const discovered = discoverKnownDataRoots();
  if (discovered.length === 1) {
    rememberDataRoot(discovered[0]);
    ensureDataRootStructure(discovered[0]);
    return discovered[0];
  }

  return null;
}

function assignDataRoot(chosenPath) {
  if (!chosenPath) return null;

  let dataRoot = chosenPath;
  const baseName = path.basename(chosenPath);
  if (baseName.toLowerCase() !== DATA_FOLDER_NAME.toLowerCase()) {
    dataRoot = path.join(chosenPath, DATA_FOLDER_NAME);
  }

  if (!canCreateDataRoot(dataRoot)) {
    return null;
  }

  migrateLegacyConfig(dataRoot);
  ensureDataRootStructure(dataRoot);
  rememberDataRoot(dataRoot);
  return dataRoot;
}

module.exports = {
  DATA_FOLDER_NAME,
  LEGACY_CONFIG_DIR,
  getExeDir,
  getLocationFilePath,
  resolveDataRoot,
  assignDataRoot,
  isDataRootValid,
  isRecoverableDataRoot,
  ensureDataRootStructure,
  writeLocationPointer,
  writeBackupPointer,
  clearLocationPointer,
  clearBackupPointer,
  clearAllLocationPointers,
  rememberDataRoot,
  cleanupLegacyAppDataDuplicates,
};
