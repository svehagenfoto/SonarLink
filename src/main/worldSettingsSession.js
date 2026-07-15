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

function configure(deps) {
  runtimeApi = deps;
  currentSettings = getFactoryDefaults();
  activeProfile = buildShellProfile('factory', currentSettings);
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

async function applySettingsToRuntime(settings, meta = {}, mode = sessionMode) {
  if (!runtimeApi?.applySettings) return false;

  programmaticApply = true;
  currentSettings = mergeSettingsWithDefaults(settings);
  await runtimeApi.applySettings(currentSettings);
  activeProfile = buildShellProfile(mode, currentSettings, meta);
  runtimeApi.notifyShell?.(activeProfile);
  programmaticApply = false;
  return true;
}

async function applyFactoryDefaults({ reason } = {}) {
  await flushPendingSave();
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

  await flushPendingSave();
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

function executeSave() {
  if (!canPersistSettings()) return;

  worldSettingsStore.saveSettings(appliedSaveId, currentSettings, {
    saveFile: activeProfile?.saveFile || null,
    saveLabel: activeProfile?.saveLabel || null,
  });
  runtimeApi?.notifyWorldSettingsListChanged?.();
}

async function flushPendingSave() {
  if (!saveDebounceTimer) return;

  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = null;
  executeSave();
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

  await flushPendingSave();

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

async function handleSaveWrite(fileName, isConfirmed) {
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

async function onShellOpened() {
  runtimeApi.notifyShell?.(getShellProfile());
}

async function onTelemetryUpdate(telemetry) {
  const live = hasLiveTelemetry(telemetry);

  if (!live) {
    return;
  }

  const confirmed = runtimeApi?.isSaveConfirmed?.() === true;

  if (!confirmed) {
    if (sessionMode === 'world') {
      await flushPendingSave();
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

  await handleSaveWrite(saveFile, true);
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
