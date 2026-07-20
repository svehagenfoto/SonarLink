const fs = require('fs');
const path = require('path');
const { readDisplayNameFromSav } = require('./saveDisplayName');

const SAVEGAME_PATTERN = /^savegame_(\d+)\.sav$/i;
const CACHE_MS_LIVE = 400;
const CACHE_MS_LIVE_CONFIRMED = 2000;
const CACHE_MS_IDLE = 1500;
const AWAIT_SAVE_BUFFER_MS = 2000;
// Class change (2 s) + ClientRestart suspend (4 s) can leave telemetry inactive ~6 to 8 s.
const SESSION_BLIP_MS = 12000;

let cached = null;
let cachedAt = 0;
let telemetryLive = false;
let awaitingSaveSince = 0;
let confirmedThisSession = false;
let confirmedSaveFile = null;
let lastSeenRestartId = null;
let lastTelemetryLiveAt = 0;
let inactiveSince = 0;
let saveWatcher = null;
let onSaveChange = null;
const displayNameCache = new Map();

function getDiscoverCacheMs() {
  if (!telemetryLive) return CACHE_MS_IDLE;
  if (confirmedThisSession && confirmedSaveFile) return CACHE_MS_LIVE_CONFIRMED;
  return CACHE_MS_LIVE;
}

function defaultSaveLabel(slot) {
  return `Save slot ${slot + 1}`;
}

function readSaveLabel(filePath, fileName, mtimeMs, slot) {
  const cachedName = displayNameCache.get(fileName);
  if (cachedName && cachedName.mtimeMs === mtimeMs) {
    return cachedName.saveLabel;
  }

  const displayName = readDisplayNameFromSav(filePath);
  const saveLabel = displayName || defaultSaveLabel(slot);
  displayNameCache.set(fileName, { mtimeMs, saveLabel });
  return saveLabel;
}

function buildSaveEntry(fileName, stat) {
  const match = fileName.match(SAVEGAME_PATTERN);
  if (!match) return null;

  const slot = Number(match[1]);
  const filePath = path.join(getSaveGamesDir(), fileName);

  return {
    slot,
    saveLabel: readSaveLabel(filePath, fileName, stat.mtimeMs, slot),
    fileName,
    mtimeMs: stat.mtimeMs,
  };
}

function loadSaveEntry(fileName) {
  const dir = getSaveGamesDir();
  if (!dir || !SAVEGAME_PATTERN.test(fileName || '')) return null;

  const filePath = path.join(dir, fileName);
  if (!fs.existsSync(filePath)) return null;

  try {
    const stat = fs.statSync(filePath);
    return buildSaveEntry(fileName, stat);
  } catch {
    return null;
  }
}

function getSaveGamesDir() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  return path.join(localAppData, 'Subnautica2', 'Saved', 'SaveGames');
}

function invalidateCache() {
  cached = null;
  cachedAt = 0;
}

function noteRestartId(restartId) {
  if (!Number.isFinite(restartId)) return;

  if (lastSeenRestartId === null) {
    lastSeenRestartId = restartId;
    return;
  }

  if (restartId !== lastSeenRestartId) {
    lastSeenRestartId = restartId;

    // Vehicle enter/exit and respawn fire ClientRestart and bump restartId.
    // Hold confirm for the same world during that blip window.
    // A real world switch is handled when a *different* .sav is written (tryConfirmSaveWrite).
    const recentlyLive = Date.now() - lastTelemetryLiveAt < SESSION_BLIP_MS;
    if (confirmedThisSession && recentlyLive) {
      invalidateCache();
      return;
    }

    clearConfirmedSave({ awaitNewWrite: true });
    invalidateCache();
  }
}

function clearConfirmedSave({ awaitNewWrite = false } = {}) {
  confirmedThisSession = false;
  confirmedSaveFile = null;
  awaitingSaveSince = awaitNewWrite ? Date.now() : 0;
}

function setTelemetryLive(isLive) {
  const wasLive = telemetryLive;

  if (isLive) {
    lastTelemetryLiveAt = Date.now();
    // Retry watcher if SaveGames did not exist at first startSaveWatcher call.
    startSaveWatcher();
  }

  if (isLive && !wasLive) {
    const inactiveMs = inactiveSince ? Date.now() - inactiveSince : 0;
    inactiveSince = 0;

    // Sustained leave (menu / other world) past blip window: drop old confirm.
    // Shorter gaps keep confirm (vehicle enter/exit).
    if (confirmedThisSession && inactiveMs >= SESSION_BLIP_MS) {
      clearConfirmedSave({ awaitNewWrite: true });
    } else if (!confirmedThisSession) {
      awaitingSaveSince = Date.now();
    }
    invalidateCache();
  }

  if (!isLive && wasLive) {
    inactiveSince = Date.now();
    invalidateCache();
  }

  telemetryLive = isLive;
}

function scanSaveFiles() {
  const dir = getSaveGamesDir();
  if (!dir || !fs.existsSync(dir)) {
    return [];
  }

  const saves = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const match = entry.name.match(SAVEGAME_PATTERN);
      if (!match) continue;

      const filePath = path.join(dir, entry.name);
      const stat = fs.statSync(filePath);
      const entryData = buildSaveEntry(entry.name, stat);
      if (!entryData) continue;

      saves.push(entryData);
    }
  } catch {
    return [];
  }

  return saves;
}

function pickNewestSave(saves) {
  if (!saves.length) return null;

  let best = saves[0];
  for (const save of saves) {
    if (save.mtimeMs > best.mtimeMs) {
      best = save;
    }
  }
  return best;
}

function pickActiveSave(saves) {
  if (!saves.length) return null;

  if (confirmedThisSession && confirmedSaveFile) {
    const match = saves.find((save) => save.fileName === confirmedSaveFile);
    if (match) return match;

    // B23: confirmed file missing — do not fall back to newest save.
    clearConfirmedSave({ awaitNewWrite: telemetryLive });
    return null;
  }

  return null;
}

function discoverActiveSave(force = false) {
  const now = Date.now();
  const cacheMs = getDiscoverCacheMs();

  if (!force && cached && now - cachedAt < cacheMs) {
    return cached;
  }

  if (confirmedThisSession && confirmedSaveFile) {
    const confirmed = loadSaveEntry(confirmedSaveFile);
    if (confirmed) {
      cached = confirmed;
      cachedAt = now;
      return confirmed;
    }

    // B23: confirmed path unreadable — clear, never pick newest silently.
    clearConfirmedSave({ awaitNewWrite: telemetryLive });
  }

  const saves = scanSaveFiles();
  const best = pickActiveSave(saves);

  cached = best;
  cachedAt = now;
  return best;
}

function tryConfirmSaveWrite(fileName) {
  if (!telemetryLive || !SAVEGAME_PATTERN.test(fileName || '')) {
    return false;
  }

  if (confirmedThisSession && confirmedSaveFile === fileName) {
    return true;
  }

  const dir = getSaveGamesDir();
  if (!dir) return false;

  const filePath = path.join(dir, fileName);
  if (!fs.existsSync(filePath)) return false;

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    return false;
  }

  // B11: A different .sav write while already confirmed is a world switch, not a vehicle blip.
  // Vehicle blips keep writing the same confirmed file.
  if (confirmedThisSession && confirmedSaveFile && confirmedSaveFile !== fileName) {
    const switchCutoff = Date.now() - SESSION_BLIP_MS;
    if (mtimeMs < switchCutoff) {
      return false;
    }

    confirmedThisSession = true;
    confirmedSaveFile = fileName;
    awaitingSaveSince = 0;
    invalidateCache();
    return true;
  }

  if (!awaitingSaveSince) {
    return false;
  }

  const cutoff = awaitingSaveSince - AWAIT_SAVE_BUFFER_MS;
  if (mtimeMs < cutoff) {
    return false;
  }

  confirmedThisSession = true;
  confirmedSaveFile = fileName;
  awaitingSaveSince = 0;
  invalidateCache();
  return true;
}

function discoverNewestSave() {
  return pickNewestSave(scanSaveFiles());
}

function resolveWorldLabel() {
  if (!confirmedThisSession) {
    return null;
  }

  const save = discoverActiveSave(false);
  return save?.saveLabel || null;
}

function resolveWorldLabelForDisplay(telemetry) {
  if (telemetry?.saveLabel) {
    return telemetry.saveLabel;
  }

  const confirmedLabel = resolveWorldLabel();
  if (confirmedLabel) {
    return confirmedLabel;
  }

  if (telemetry?.active === true) {
    return discoverNewestSave()?.saveLabel || null;
  }

  return null;
}

function attachSaveToTelemetry(telemetry) {
  if (!telemetry || telemetry.active !== true) {
    return telemetry;
  }

  if (!confirmedThisSession) {
    return telemetry;
  }

  let save = discoverActiveSave(false);
  if (!save && confirmedSaveFile) {
    save = loadSaveEntry(confirmedSaveFile);
  }
  if (!save) {
    return telemetry;
  }

  return {
    ...telemetry,
    saveLabel: save.saveLabel,
    saveSlot: save.slot,
    saveFile: save.fileName,
  };
}

function isSaveConfirmed() {
  return confirmedThisSession;
}

function getConfirmedSaveFile() {
  return confirmedSaveFile;
}

function startSaveWatcher(callback) {
  if (typeof callback === 'function') {
    onSaveChange = callback;
  }
  if (saveWatcher) return;

  const dir = getSaveGamesDir();
  if (!dir || !fs.existsSync(dir)) return;

  try {
    saveWatcher = fs.watch(dir, (_eventType, filename) => {
      const name = typeof filename === 'string' ? filename : '';
      if (!name || !SAVEGAME_PATTERN.test(name)) return;

      tryConfirmSaveWrite(name);
      invalidateCache();
      if (onSaveChange) {
        onSaveChange(name);
      }
    });
  } catch {
    saveWatcher = null;
  }
}

function stopSaveWatcher() {
  if (saveWatcher) {
    saveWatcher.close();
    saveWatcher = null;
  }
  onSaveChange = null;
}

module.exports = {
  getSaveGamesDir,
  discoverActiveSave,
  attachSaveToTelemetry,
  invalidateCache,
  setTelemetryLive,
  noteRestartId,
  tryConfirmSaveWrite,
  isSaveConfirmed,
  getConfirmedSaveFile,
  startSaveWatcher,
  stopSaveWatcher,
  resolveWorldLabelForDisplay,
};
