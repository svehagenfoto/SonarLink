const {
  getFactoryDefaults,
  mergeSettingsWithDefaults,
  deepMergeSettings,
  deepMergePartialObjects,
} = require('./worldSettingsDefaults');
const worldSettingsStore = require('./worldSettingsStore');

const SAVE_DEBOUNCE_MS = 1000;

let runtimeApi = null;
let sessionMode = 'factory';
let appliedSaveId = null;
let lastHandledSaveFile = null;
let currentSettings = getFactoryDefaults();
let activeProfile = null;
let pendingBuffer = null;
let saveDebounceTimer = null;
let programmaticApply = false;
let saveSyncInFlight = false;
let lastTelemetryLive = false;
let sessionTaskChain = Promise.resolve();

function configure(deps) {
  runtimeApi = deps;
  currentSettings = getFactoryDefaults();
  activeProfile = buildShellProfile('factory', currentSettings);
  lastTelemetryLive = false;
}

function enqueueSessionTask(task) {
  sessionTaskChain = sessionTaskChain
    .then(() => task())
    .catch(() => false);
  return sessionTaskChain;
}

function buildShellProfile(mode, settings, meta = {}) {
  return {
    mode,
    settings,
    saveId: meta.saveId || null,
    saveFile: meta.saveFile || null,
    saveLabel: meta.saveLabel || null,
  };
}

function hasLiveTelemetry(telemetry) {
  return telemetry?.active === true
    && Number.isFinite(telemetry?.x)
    && Number.isFinite(telemetry?.y);
}

function hasPendingBuffer() {
  if (!pendingBuffer || typeof pendingBuffer !== 'object') return false;
  return Boolean(pendingBuffer.thirdPerson || pendingBuffer.minimap);
}

function resolveSaveLabel(saveFile, telemetry) {
  if (telemetry?.saveFile === saveFile && telemetry.saveLabel) {
    return telemetry.saveLabel;
  }
  return null;
}

function getActiveProfile() {
  return activeProfile;
}

function getShellProfile() {
  if (activeProfile) {
    return activeProfile;
  }

  return buildShellProfile('factory', getFactoryDefaults());
}

function isInActiveWorld() {
  const telemetry = runtimeApi?.readTelemetry?.() || null;
  return hasLiveTelemetry(telemetry);
}

function canPersistSettings() {
  return sessionMode === 'world' && appliedSaveId && isInActiveWorld();
}

function canForcePersistSettings() {
  return sessionMode === 'world' && Boolean(appliedSaveId);
}

async function applySettingsToRuntime(settings, meta = {}, mode = sessionMode) {
  if (!runtimeApi?.applySettings) return false;

  programmaticApply = true;
  try {
    currentSettings = mergeSettingsWithDefaults(settings);
    await runtimeApi.applySettings(currentSettings);
    activeProfile = buildShellProfile(mode, currentSettings, meta);
    runtimeApi.notifyShell?.(activeProfile);
    return true;
  } finally {
    programmaticApply = false;
  }
}

async function applyFactoryDefaults({ reason } = {}) {
  await flushPendingSave({ force: true });
  pendingBuffer = null;
  appliedSaveId = null;
  lastHandledSaveFile = null;
  sessionMode = 'factory';
  await applySettingsToRuntime(getFactoryDefaults(), { reason }, 'factory');
}

async function applyWorldProfile(saveId, meta = {}) {
  if (!saveId) return false;

  const record = worldSettingsStore.readSettings(saveId);
  const settings = worldSettingsStore.getEffectiveSettings(saveId);

  await applySettingsToRuntime(settings, {
    saveId,
    saveFile: meta.saveFile || record?.saveFile || null,
    saveLabel: meta.saveLabel || record?.saveLabel || null,
  }, 'world');

  appliedSaveId = saveId;
  sessionMode = 'world';
  return true;
}

async function enterPendingMode() {
  if (sessionMode === 'pending') return;

  await flushPendingSave({ force: true });
  pendingBuffer = null;
  appliedSaveId = null;
  sessionMode = 'pending';
  await applySettingsToRuntime(getFactoryDefaults(), {}, 'pending');
}

function scheduleDebouncedSave() {
  if (!canPersistSettings()) return;

  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }

  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    executeSave();
  }, SAVE_DEBOUNCE_MS);
}

function executeSave({ force = false } = {}) {
  if (force) {
    if (!canForcePersistSettings()) return;
  } else if (!canPersistSettings()) {
    return;
  }

  worldSettingsStore.saveSettings(appliedSaveId, currentSettings, {
    saveFile: activeProfile?.saveFile || null,
    saveLabel: activeProfile?.saveLabel || null,
  });
  runtimeApi?.notifyWorldSettingsListChanged?.();
}

async function flushPendingSave({ force = false } = {}) {
  if (!saveDebounceTimer) return;

  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = null;
  executeSave({ force });
}

function onUserSettingsChanged(partial) {
  if (programmaticApply || !partial || typeof partial !== 'object') return;
  if (!isInActiveWorld()) return;

  currentSettings = deepMergeSettings(currentSettings, partial);

  if (sessionMode === 'world' && appliedSaveId) {
    activeProfile = buildShellProfile('world', currentSettings, {
      saveId: appliedSaveId,
      saveFile: activeProfile?.saveFile || null,
      saveLabel: activeProfile?.saveLabel || null,
    });
    scheduleDebouncedSave();
    return;
  }

  if (sessionMode === 'pending') {
    pendingBuffer = deepMergePartialObjects(pendingBuffer || {}, partial);
    activeProfile = buildShellProfile('pending', currentSettings, {});
  }
}

async function onSaveConfirmed({ saveFile, saveId, saveLabel }) {
  if (!saveFile || !saveId) return false;

  await flushPendingSave({ force: true });

  const hadBuffer = hasPendingBuffer();
  if (hadBuffer) {
    worldSettingsStore.mergePartialSettings(saveId, pendingBuffer, { saveFile, saveLabel });
    pendingBuffer = null;
    runtimeApi?.notifyWorldSettingsListChanged?.();
  }

  const saveChanged = saveId !== appliedSaveId;
  if (saveChanged || hadBuffer) {
    await applyWorldProfile(saveId, { saveFile, saveLabel });
  }

  lastHandledSaveFile = saveFile;
  return true;
}

async function runHandleSaveWrite(fileName, isConfirmed) {
  if (!isConfirmed || !fileName || saveSyncInFlight) return false;

  const saveId = worldSettingsStore.resolveSaveId({ saveFile: fileName });
  if (!saveId) return false;

  if (saveId === appliedSaveId && !hasPendingBuffer() && fileName === lastHandledSaveFile) {
    return false;
  }

  saveSyncInFlight = true;
  try {
    const telemetry = runtimeApi?.readTelemetry?.() || null;
    return await onSaveConfirmed({
      saveFile: fileName,
      saveId,
      saveLabel: resolveSaveLabel(fileName, telemetry),
    });
  } finally {
    saveSyncInFlight = false;
  }
}

function handleSaveWrite(fileName, isConfirmed) {
  return enqueueSessionTask(() => runHandleSaveWrite(fileName, isConfirmed));
}

async function onShellOpened() {
  runtimeApi.notifyShell?.(getShellProfile());
}

async function runTelemetryUpdate(telemetry) {
  const live = hasLiveTelemetry(telemetry);

  if (!live) {
    if (lastTelemetryLive) {
      // Leaving an active world: flush debounced world save, drop pending buffer.
      // Do not factory-reset Customize UI (intentional product rule).
      if (sessionMode === 'world' && appliedSaveId) {
        await flushPendingSave({ force: true });
      }
      pendingBuffer = null;
    }
    lastTelemetryLive = false;
    return;
  }

  lastTelemetryLive = true;

  const confirmed = runtimeApi?.isSaveConfirmed?.() === true;

  if (!confirmed) {
    if (sessionMode === 'world') {
      await flushPendingSave({ force: true });
      appliedSaveId = null;
      lastHandledSaveFile = null;
    }
    await enterPendingMode();
    return;
  }

  const saveFile = telemetry?.saveFile || runtimeApi?.getConfirmedSaveFile?.() || null;
  if (!saveFile) return;

  const saveId = worldSettingsStore.resolveSaveId({ saveFile });
  if (!saveId) return;

  if (saveId === appliedSaveId && saveFile === lastHandledSaveFile && !hasPendingBuffer()) {
    if (sessionMode !== 'world') {
      sessionMode = 'world';
      activeProfile = buildShellProfile('world', currentSettings, {
        saveId,
        saveFile,
        saveLabel: resolveSaveLabel(saveFile, telemetry),
      });
    }
    return;
  }

  await runHandleSaveWrite(saveFile, true);
}

function onTelemetryUpdate(telemetry) {
  return enqueueSessionTask(() => runTelemetryUpdate(telemetry));
}

async function syncIfConfirmed() {
  if (!runtimeApi?.isSaveConfirmed?.()) return false;

  const fileName = runtimeApi.getConfirmedSaveFile?.();
  if (!fileName) return false;

  return handleSaveWrite(fileName, true);
}

function resetAppliedSaveId() {
  appliedSaveId = null;
}

function getAppliedSaveId() {
  return appliedSaveId;
}

function getSessionMode() {
  return sessionMode;
}

module.exports = {
  configure,
  getFactoryDefaults,
  getShellProfile,
  getActiveProfile,
  getSessionMode,
  applyFactoryDefaults,
  applyWorldProfile,
  onSaveConfirmed,
  onUserSettingsChanged,
  onTelemetryUpdate,
  onShellOpened,
  handleSaveWrite,
  syncIfConfirmed,
  flushPendingSave,
  resetAppliedSaveId,
  getAppliedSaveId,
};
