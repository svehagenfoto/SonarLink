const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDataRoot } = require('./configStore');

const FOG_FILE_VERSION = 1;
const SAVEGAME_PATTERN = /^savegame_(\d+)\.sav$/i;

function hashSaveKey(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function getFogDir() {
  const dataRoot = getDataRoot();
  if (!dataRoot) return null;
  return path.join(dataRoot, 'fog');
}

function ensureFogDir() {
  const dir = getFogDir();
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getFogFilePath(saveId) {
  const dir = getFogDir();
  if (!dir || !saveId) return null;
  return path.join(dir, `${saveId}.json`);
}

function resolveSaveId(telemetry) {
  if (!telemetry) return null;

  if (telemetry.saveFile && SAVEGAME_PATTERN.test(telemetry.saveFile)) {
    return hashSaveKey(telemetry.saveFile);
  }

  if (Number.isFinite(telemetry.saveSlot)) {
    return hashSaveKey(`savegame_${telemetry.saveSlot}.sav`);
  }

  if (telemetry.saveLabel) {
    return hashSaveKey(telemetry.saveLabel);
  }

  return null;
}

function resolveLegacySaveId(slot) {
  if (!Number.isFinite(slot)) return null;
  return hashSaveKey(`Save slot ${slot + 1}`);
}

function readFogFile(saveId) {
  const filePath = getFogFilePath(saveId);
  if (!filePath || !fs.existsSync(filePath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || parsed.saveId !== saveId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function countExploredPercent(revealedBase64) {
  if (!revealedBase64) return 0;

  try {
    const binary = Buffer.from(revealedBase64, 'base64');
    if (!binary.length) return 0;

    let count = 0;
    for (let i = 0; i < binary.length; i += 1) {
      if (binary[i]) count += 1;
    }

    return Math.round((count / binary.length) * 1000) / 10;
  } catch {
    return 0;
  }
}

function writeFogFile(payload) {
  const filePath = getFogFilePath(payload.saveId);
  if (!filePath) return false;

  ensureFogDir();
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return true;
}

function migrateLegacyFogRecord(saveId, hints = {}) {
  if (!Number.isFinite(hints.saveSlot)) return null;

  const legacyId = resolveLegacySaveId(hints.saveSlot);
  if (!legacyId || legacyId === saveId) return null;

  const legacy = readFogFile(legacyId);
  if (!legacy) return null;

  const migrated = {
    ...legacy,
    saveId,
    saveLabel: hints.saveLabel || legacy.saveLabel,
    updatedAt: Date.now(),
  };

  writeFogFile(migrated);

  try {
    fs.unlinkSync(getFogFilePath(legacyId));
  } catch {
    // ignore missing legacy file
  }

  return migrated;
}

function getFogRecord(saveId, hints = {}) {
  if (!saveId) return null;

  const existing = readFogFile(saveId);
  if (existing) return existing;

  return migrateLegacyFogRecord(saveId, hints);
}

function ensureSaveRegistered(telemetry) {
  if (!telemetry?.saveFile || !SAVEGAME_PATTERN.test(telemetry.saveFile)) {
    return null;
  }

  const saveId = resolveSaveId(telemetry);
  if (!saveId) return null;

  const existing = readFogFile(saveId);
  if (existing) {
    let labelUpdated = false;

    if (telemetry.saveLabel && existing.saveLabel !== telemetry.saveLabel) {
      existing.saveLabel = telemetry.saveLabel;
      existing.updatedAt = Date.now();
      writeFogFile(existing);
      labelUpdated = true;
    }

    return {
      saveId,
      isNew: false,
      labelUpdated,
      record: existing,
    };
  }

  const now = Date.now();
  const payload = {
    version: FOG_FILE_VERSION,
    saveId,
    saveLabel: telemetry.saveLabel || telemetry.saveFile,
    gridWidth: 114,
    gridHeight: 48,
    revealed: null,
    exploredPercent: 0,
    createdAt: now,
    updatedAt: now,
  };

  writeFogFile(payload);

  return {
    saveId,
    isNew: true,
    labelUpdated: false,
    record: payload,
  };
}

function saveFogData(saveId, data) {
  if (!saveId || !data) return null;

  const existing = readFogFile(saveId) || {
    version: FOG_FILE_VERSION,
    saveId,
    saveLabel: data.saveLabel || saveId,
    gridWidth: 114,
    gridHeight: 48,
    createdAt: Date.now(),
  };

  const exploredPercent = Number.isFinite(data.exploredPercent)
    ? data.exploredPercent
    : countExploredPercent(data.revealed);

  const payload = {
    ...existing,
    saveLabel: data.saveLabel || existing.saveLabel,
    gridWidth: data.gridWidth || existing.gridWidth || 114,
    gridHeight: data.gridHeight || existing.gridHeight || 48,
    revealed: data.revealed ?? existing.revealed,
    exploredPercent,
    updatedAt: Date.now(),
  };

  if (!writeFogFile(payload)) return null;
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

function listFogSavesWithOrphanFlags(activeSaveId = null) {
  const { scanned, saveIds } = scanExistingSaveIds();
  const saves = listFogSaves();

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

function deleteOrphanFogSaves(activeSaveId = null) {
  const orphans = listFogSavesWithOrphanFlags(activeSaveId).filter((save) => save.orphan);
  const deletedIds = [];

  for (const orphan of orphans) {
    const result = deleteFogSave(orphan.saveId);
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

function listFogSaves() {
  const dir = getFogDir();
  if (!dir || !fs.existsSync(dir)) return [];

  const saves = [];

  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;

      const saveId = name.slice(0, -5);
      const record = readFogFile(saveId);
      if (!record) continue;

      saves.push({
        saveId: record.saveId,
        saveLabel: record.saveLabel || saveId,
        exploredPercent: Number.isFinite(record.exploredPercent)
          ? record.exploredPercent
          : countExploredPercent(record.revealed),
        updatedAt: record.updatedAt || 0,
      });
    }
  } catch {
    return [];
  }

  return saves.sort((a, b) => b.updatedAt - a.updatedAt);
}

function deleteFogSave(saveId) {
  const filePath = getFogFilePath(saveId);
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

function getActiveSaveFromTelemetry(telemetry) {
  if (!telemetry || telemetry.active !== true || !telemetry.saveFile) {
    return null;
  }

  const saveId = resolveSaveId(telemetry);
  if (!saveId) return null;

  return {
    saveId,
    saveLabel: telemetry.saveLabel || null,
    saveFile: telemetry.saveFile,
  };
}

module.exports = {
  hashSaveKey,
  resolveSaveId,
  getFogDir,
  listFogSaves,
  listFogSavesWithOrphanFlags,
  getFogRecord,
  saveFogData,
  deleteFogSave,
  deleteOrphanFogSaves,
  ensureSaveRegistered,
  getActiveSaveFromTelemetry,
};
