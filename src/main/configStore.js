const fs = require('fs');
const path = require('path');
const {
  resolveDataRoot,
  assignDataRoot,
  isDataRootValid,
  ensureDataRootStructure,
} = require('./dataRoot');

const CONFIG_VERSION = 2;

const DEFAULT_CONFIG = {
  configVersion: CONFIG_VERSION,
  gameWin64Dir: null,
  downloadConsent: false,
  installed: {},
};

let activeDataRoot = null;

function getDataRoot() {
  if (activeDataRoot && isDataRootValid(activeDataRoot)) {
    return activeDataRoot;
  }
  activeDataRoot = resolveDataRoot();
  return activeDataRoot;
}

function setDataRoot(dataRoot) {
  activeDataRoot = dataRoot;
}

function getConfigFile() {
  const dataRoot = getDataRoot();
  if (!dataRoot) return null;
  return path.join(dataRoot, 'config.json');
}

function readConfig() {
  const configFile = getConfigFile();
  if (!configFile || !fs.existsSync(configFile)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(configFile, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed, installed: { ...(parsed.installed || {}) } };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(config) {
  const dataRoot = getDataRoot();
  if (!dataRoot) {
    throw new Error('DATA_ROOT_MISSING');
  }

  ensureDataRootStructure(dataRoot);
  const configFile = path.join(dataRoot, 'config.json');
  const payload = {
    ...config,
    configVersion: CONFIG_VERSION,
    installed: config.installed || {},
  };
  fs.writeFileSync(configFile, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function updateConfig(patch) {
  const current = readConfig();
  const next = {
    ...current,
    ...patch,
    installed: {
      ...current.installed,
      ...(patch.installed || {}),
    },
  };
  return writeConfig(next);
}

function initDataRootFromPicker(folderPath) {
  const assigned = assignDataRoot(folderPath);
  if (!assigned) return null;
  setDataRoot(assigned);
  return assigned;
}

function initDataRootIfNeeded() {
  const existing = resolveDataRoot();
  if (existing) {
    setDataRoot(existing);
    ensureDataRootStructure(existing);
    return existing;
  }
  return null;
}

module.exports = {
  CONFIG_VERSION,
  readConfig,
  writeConfig,
  updateConfig,
  getDataRoot,
  setDataRoot,
  initDataRootIfNeeded,
  initDataRootFromPicker,
  isDataRootValid,
};
