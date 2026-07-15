const fs = require('fs');
const path = require('path');
const { getDataRoot } = require('./configStore');
const { resolveSaveId, hashSaveKey } = require('./mapFogStore');
const { SETTINGS_VERSION, mergeSettingsWithDefaults, deepMergePartialObjects } = require('./worldSettingsDefaults');

const SAVEGAME_PATTERN = /^savegame_(\d+)\.sav$/i;

function getSettingsDir() {
  const dataRoot = getDataRoot();
  if (!dataRoot) return null;
  return path.join(dataRoot, 'world-settings');
}

function ensureSettingsDir() {
  const dir = getSettingsDir();
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getSettingsPath(saveId) {
  const dir = getSettingsDir();
  if (!dir || !saveId) return null;
  return path.join(dir, `${saveId}.json`);
}

function readSettingsFile(saveId) {
  const filePath = getSettingsPath(saveId);
  if (!filePath || !fs.existsSync(filePath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || parsed.saveId !== saveId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSettingsFile(payload) {
  const filePath = getSettingsPath(payload.saveId);
  if (!filePath) return false;

  ensureSettingsDir();
  const tmpPath = `${filePath}.${process.pid}.tmp`;

  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // ignore cleanup failure
    }
    return false;
  }
}

function readSettings(saveId) {
  if (!saveId) return null;
  return readSettingsFile(saveId);
}

function getEffectiveSettings(saveId) {
  const record = readSettings(saveId);
  return mergeSettingsWithDefaults(record?.settings);
}

function saveSettings(saveId, partialSettings, meta = {}) {
  if (!saveId || !partialSettings) return null;

  const existing = readSettingsFile(saveId) || {
    version: SETTINGS_VERSION,
    saveId,
    saveFile: meta.saveFile || null,
    saveLabel: meta.saveLabel || saveId,
    createdAt: Date.now(),
  };

  const payload = {
    ...existing,
    version: SETTINGS_VERSION,
    saveId,
    saveFile: meta.saveFile || existing.saveFile || null,
    saveLabel: meta.saveLabel || existing.saveLabel || saveId,
    settings: mergeSettingsWithDefaults({
      ...existing.settings,
      ...partialSettings,
      thirdPerson: {
        ...(existing.settings?.thirdPerson || {}),
        ...(partialSettings.thirdPerson || {}),
      },
      minimap: {
        ...(existing.settings?.minimap || {}),
        ...(partialSettings.minimap || {}),
      },
    }),
    updatedAt: Date.now(),
  };

  if (!writeSettingsFile(payload)) return null;
  return payload;
}

function mergePartialSettings(saveId, partialSettings, meta = {}) {
  if (!saveId || !partialSettings) return null;

  const existing = readSettingsFile(saveId);
  const mergedSettings = deepMergePartialObjects(existing?.settings || {}, partialSettings);

  const payload = {
    version: SETTINGS_VERSION,
    saveId,
    saveFile: meta.saveFile || existing?.saveFile || null,
    saveLabel: meta.saveLabel || existing?.saveLabel || saveId,
    createdAt: existing?.createdAt || Date.now(),
    settings: mergedSettings,
    updatedAt: Date.now(),
  };

  if (!writeSettingsFile(payload)) return null;
  return payload;
}

function getSaveGamesDir() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  return path.join(localAppData, 'Subnautica2', 'Saved', 'SaveGames');
}

function scanExistingSaveIds() {
  const saveGamesDir = getSaveGamesDir();
  if (!saveGamesDir || !fs.existsSync(saveGamesDir)) {
    return { scanned: false, saveIds: null };
  }

  try {
    const saveIds = new Set();
    for (const name of fs.readdirSync(saveGamesDir)) {
      if (!SAVEGAME_PATTERN.test(name)) continue;
      saveIds.add(hashSaveKey(name));
    }
    return { scanned: true, saveIds };
  } catch {
    return { scanned: false, saveIds: null };
  }
}

function listSettingsSaves() {
  const dir = getSettingsDir();
  if (!dir || !fs.existsSync(dir)) return [];

  const saves = [];

  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;

      const saveId = name.slice(0, -5);
      const record = readSettingsFile(saveId);
      if (!record) continue;

      saves.push({
        saveId: record.saveId,
        saveLabel: record.saveLabel || saveId,
        saveFile: record.saveFile || null,
        updatedAt: record.updatedAt || 0,
        settings: record.settings || {},
      });
    }
  } catch {
    return [];
  }

  return saves.sort((a, b) => b.updatedAt - a.updatedAt);
}

function listSettingsSavesWithOrphanFlags(activeSaveId = null) {
  const { scanned, saveIds } = scanExistingSaveIds();
  const saves = listSettingsSaves();

  return saves.map((save) => ({
    ...save,
    orphan: Boolean(
      scanned
      && save.saveId !== activeSaveId
      && saveIds
      && !saveIds.has(save.saveId),
    ),
  }));
}

function deleteSettingsSave(saveId) {
  const filePath = getSettingsPath(saveId);
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, reason: 'NOT_FOUND' };
  }

  try {
    fs.unlinkSync(filePath);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'DELETE_FAILED' };
  }
}

function deleteOrphanSettingsSaves(activeSaveId = null) {
  const orphans = listSettingsSavesWithOrphanFlags(activeSaveId).filter((save) => save.orphan);
  const deletedIds = [];

  for (const orphan of orphans) {
    const result = deleteSettingsSave(orphan.saveId);
    if (result.ok) {
      deletedIds.push(orphan.saveId);
    }
  }

  return {
    ok: true,
    deleted: deletedIds.length,
    total: orphans.length,
    deletedIds,
  };
}

module.exports = {
  getSettingsDir,
  getSettingsPath,
  readSettings,
  getEffectiveSettings,
  saveSettings,
  mergePartialSettings,
  listSettingsSaves,
  listSettingsSavesWithOrphanFlags,
  deleteSettingsSave,
  deleteOrphanSettingsSaves,
  resolveSaveId,
};
