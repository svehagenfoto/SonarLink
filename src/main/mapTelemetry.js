const fs = require('fs');
const path = require('path');
const { getDataRoot } = require('./configStore');
const saveDiscovery = require('./saveDiscovery');

let pollTimer = null;
let lastSignature = '';
let lastPublishedSaveFile = null;
let lastRawActive = null;
let getTargetWindow = null;
let onTelemetryPublished = null;
let onSaveChange = null;

function getTelemetryFile() {
  const dataRoot = getDataRoot();
  if (!dataRoot) return null;
  return path.join(dataRoot, 'map-telemetry.json');
}

function readRawTelemetry() {
  const filePath = getTelemetryFile();
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.active !== true) {
      const reason = typeof parsed.reason === 'string' ? parsed.reason : undefined;
      return {
        active: false,
        ts: parsed.ts,
        restartId: parsed.restartId,
        ...(reason ? { reason } : {}),
      };
    }
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
      const reason = typeof parsed.reason === 'string' ? parsed.reason : undefined;
      return {
        active: false,
        ts: parsed.ts,
        restartId: parsed.restartId,
        ...(reason ? { reason } : {}),
      };
    }
    return parsed;
  } catch {
    return null;
  }
}

function attachSaveToTelemetry(raw) {
  if (!raw) return null;
  return saveDiscovery.attachSaveToTelemetry(raw);
}

function readTelemetry() {
  return attachSaveToTelemetry(readRawTelemetry());
}

function buildSignature(data) {
  if (!data || data.active === false) {
    return `inactive|${data?.reason || ''}`;
  }
  return [
    data.x,
    data.y,
    data.forwardX,
    data.forwardY,
    data.saveLabel || '',
    data.saveFile || '',
  ].join('|');
}

function forceRepublish() {
  lastSignature = '';
  tick();
}

function publishTelemetry(data) {
  if (onTelemetryPublished) {
    onTelemetryPublished(data);
  }

  if (!getTargetWindow) return;
  const targets = getTargetWindow();
  const windows = Array.isArray(targets) ? targets : [targets];

  for (const win of windows) {
    if (!win || win.isDestroyed()) continue;
    win.webContents.send('map-telemetry-update', data);
  }
}

function setTelemetryPublishedHandler(handler) {
  onTelemetryPublished = handler;
}

function setSaveChangeHandler(handler) {
  onSaveChange = handler;
}

function tick() {
  const raw = readRawTelemetry();
  const rawActive = raw?.active === true;

  saveDiscovery.noteRestartId(raw?.restartId);

  if (lastRawActive === false && rawActive) {
    saveDiscovery.setTelemetryLive(true);
    saveDiscovery.invalidateCache();
  } else if (lastRawActive === true && !rawActive) {
    saveDiscovery.setTelemetryLive(false);
  } else {
    saveDiscovery.setTelemetryLive(rawActive);
  }

  lastRawActive = rawActive;

  const data = attachSaveToTelemetry(raw);
  const signature = data ? buildSignature(data) : 'none';

  if (data?.saveFile && data.saveFile !== lastPublishedSaveFile) {
    lastPublishedSaveFile = data.saveFile;
    lastSignature = '';
  }

  if (signature === lastSignature) return;
  lastSignature = signature;
  publishTelemetry(data || { active: false });
}

function startMapTelemetryWatcher(targetWindowGetter) {
  stopMapTelemetryWatcher();
  getTargetWindow = targetWindowGetter;
  saveDiscovery.startSaveWatcher((fileName) => {
    forceRepublish();
    if (onSaveChange) {
      onSaveChange(fileName, saveDiscovery.isSaveConfirmed());
    }
  });
  tick();
  pollTimer = setInterval(tick, 300);
}

function stopMapTelemetryWatcher() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  saveDiscovery.stopSaveWatcher();
  lastSignature = '';
  lastPublishedSaveFile = null;
  lastRawActive = null;
  getTargetWindow = null;
  onTelemetryPublished = null;
  onSaveChange = null;
}

module.exports = {
  getTelemetryFile,
  readTelemetry,
  startMapTelemetryWatcher,
  stopMapTelemetryWatcher,
  setTelemetryPublishedHandler,
  setSaveChangeHandler,
  forceRepublish,
};
