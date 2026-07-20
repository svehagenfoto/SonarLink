const { app, ipcMain, BrowserWindow, globalShortcut, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const { spawn } = require('child_process');
const { isSubnauticaRunning, watchSubnautica } = require('./processWatch');
const windows = require('./windowManager');
const { createTray, destroyTray } = require('./tray');
const {
  unregisterAllHotkeys,
  registerThirdPersonMouseBind,
  unregisterThirdPersonHotkey,
  unregisterHomeHotkey,
  registerHomeKeyPoll,
  unregisterHomeKeyPoll,
  registerBigMapMouseBind,
  unregisterBigMapBind,
} = require('./win32');
const {
  runStartupFlow,
  resolveDataFolder,
  openDataFolderDialog,
} = require('./startupFlow');
const { resetAllForTesting } = require('./resetManager');
const { pruneElectronChromiumCache } = require('./electronCacheCleanup');
const { registerCrashDiagnostics } = require('./crashLog');
const { setThirdPersonEnabled, setThirdPersonDistance, compactCommandsFile } = require('./gameBridge');
const { parseKeyLabel, keyLabelToAccelerator, sanitizeFeatureBindKey } = require('./keybindParse');
const { mapImagePath, sonarLinkImagePath } = require('./paths');
const mapTelemetry = require('./mapTelemetry');
const mapFogStore = require('./mapFogStore');
const mapFogSession = require('./mapFogSession');
const mapWaypointSession = require('./mapWaypointSession');
const saveDiscovery = require('./saveDiscovery');
const worldSettingsSession = require('./worldSettingsSession');
const worldSettingsStore = require('./worldSettingsStore');

registerCrashDiagnostics(app);

let stopWatch = null;
let quitOnGameCloseWatch = null;
let launched = false;
let isQuitting = false;
let isRestarting = false;
let startupComplete = false;
let shellHomeHotkeyRegistered = false;
let thirdPersonFeatureEnabled = false;
let thirdPersonCameraActive = true;
let thirdPersonCameraDistance = 50;
let thirdPersonSyncTimers = [];
let thirdPersonShortcutKey = null;
let thirdPersonBindKey = null;
let thirdPersonDistancePreviewTimer = null;
let minimapEnabled = true;
let minimapMapBindKey = null;
let bigMapShortcutKey = null;
let bigMapToggleLocked = false;
let featureBindsSuspended = false;
let mainUiReady = false;
const THIRD_PERSON_DISTANCE_PREVIEW_MS = 125;
const SHELL_OPEN_DELAY_MS = 10000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForShellVisible(shell) {
  if (shell.isVisible()) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    shell.once('ready-to-show', finish);
    shell.once('show', finish);
    setTimeout(finish, 5000);
  });
}

function clampCameraDistance(percent) {
  return Math.max(1, Math.min(99, Math.round(Number(percent) || 50)));
}

function shouldApplyCameraDistance() {
  return thirdPersonFeatureEnabled && thirdPersonCameraActive;
}

function pushCameraDistanceToGame(options = {}) {
  setThirdPersonDistance(thirdPersonCameraDistance, options);
}

function pushCameraDistancePreviewDebounced() {
  if (thirdPersonDistancePreviewTimer) {
    clearTimeout(thirdPersonDistancePreviewTimer);
  }
  thirdPersonDistancePreviewTimer = setTimeout(() => {
    thirdPersonDistancePreviewTimer = null;
    pushCameraDistanceToGame({ smooth: false });
  }, THIRD_PERSON_DISTANCE_PREVIEW_MS);
}

function pushCameraDistanceCommit() {
  if (thirdPersonDistancePreviewTimer) {
    clearTimeout(thirdPersonDistancePreviewTimer);
    thirdPersonDistancePreviewTimer = null;
  }
  pushCameraDistanceToGame({ smooth: true });
}

function getThirdPersonDesiredState() {
  if (!thirdPersonFeatureEnabled) return false;
  return thirdPersonCameraActive;
}

function stopThirdPersonSync() {
  for (const timer of thirdPersonSyncTimers) {
    clearTimeout(timer);
  }
  thirdPersonSyncTimers = [];
}

function pushThirdPersonStateToGame(force = false) {
  setThirdPersonEnabled(getThirdPersonDesiredState(), { force });
  if (shouldApplyCameraDistance()) {
    pushCameraDistanceToGame();
  }
}

function scheduleThirdPersonSync() {
  stopThirdPersonSync();
  compactCommandsFile();
  pushThirdPersonStateToGame(true);

  for (const delay of [2000, 5000, 10000, 12000]) {
    const timer = setTimeout(async () => {
      if (await isSubnauticaRunning()) {
        pushThirdPersonStateToGame(true);
      }
    }, delay);
    thirdPersonSyncTimers.push(timer);
  }
}

let homeToggleLocked = false;

function onHomePressed() {
  if (homeToggleLocked) return;
  homeToggleLocked = true;
  setTimeout(() => {
    homeToggleLocked = false;
  }, 250);
  toggleShellHotkey();
}

function registerShellHomeHotkey() {
  unregisterShellHomeHotkey();
  const ok = registerHomeKeyPoll(onHomePressed);
  shellHomeHotkeyRegistered = ok;
  return ok;
}

function unregisterShellHomeHotkey() {
  unregisterHomeHotkey();
  unregisterHomeKeyPoll();
  shellHomeHotkeyRegistered = false;
}

/** Shell Home poll — Home is menu only; features cannot bind it. */
function syncShellHomeOwnership() {
  if (!startupComplete) return;
  registerShellHomeHotkey();
}

function toggleShellHotkey() {
  if (!startupComplete || !launched) return;
  void windows.toggleShell().then(async () => {
    if (windows.isShellVisible()) {
      await worldSettingsSession.onShellOpened();
    }
  });
}

function prepareShell() {
  if (!windows.getShellWindow()) {
    windows.createShellWindow({ showOnReady: false });
  }
}

function restartApp() {
  if (isRestarting) return;
  isRestarting = true;
  isQuitting = true;

  const exe = process.execPath;

  destroyTray();
  unregisterThirdPersonKeyboardShortcut();
  unregisterShellHomeHotkey();
  globalShortcut.unregisterAll();
  unregisterAllHotkeys();
  if (stopWatch) {
    stopWatch();
    stopWatch = null;
  }
  stopGameCloseWatch();
  windows.destroyAllWindows();

  spawn(exe, [], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
    windowsHide: true,
  }).unref();

  app.exit(0);
}

function stopGameCloseWatch() {
  if (quitOnGameCloseWatch) {
    quitOnGameCloseWatch();
    quitOnGameCloseWatch = null;
  }
}

function startGameCloseWatch() {
  stopGameCloseWatch();

  quitOnGameCloseWatch = watchSubnautica((isRunning) => {
    if (!isRunning && launched && !isQuitting && !isRestarting) {
      quitApp();
    }
  });
}

function quitApp() {
  isQuitting = true;
  destroyTray();
  unregisterThirdPersonKeyboardShortcut();
  unregisterShellHomeHotkey();
  globalShortcut.unregisterAll();
  unregisterAllHotkeys();
  if (stopWatch) stopWatch();
  stopGameCloseWatch();
  windows.stopOverlayAwayWatch();
  windows.destroyAllWindows();
  app.exit(0);
}

function notifyThirdPersonCameraState() {
  const shell = windows.getShellWindow();
  if (shell && !shell.isDestroyed()) {
    shell.webContents.send('third-person-camera-state', { active: thirdPersonCameraActive });
  }
}

function onThirdPersonHotkeyPressed() {
  if (featureBindsSuspended) return;
  if (!thirdPersonFeatureEnabled) return;
  thirdPersonCameraActive = !thirdPersonCameraActive;
  pushThirdPersonStateToGame(true);
  notifyThirdPersonCameraState();
  worldSettingsSession.onUserSettingsChanged({
    thirdPerson: { cameraActive: thirdPersonCameraActive },
  });
}

function unregisterThirdPersonKeyboardShortcut() {
  if (thirdPersonShortcutKey) {
    if (thirdPersonShortcutKey === 'Home') {
      unregisterThirdPersonHotkey();
    } else {
      globalShortcut.unregister(thirdPersonShortcutKey);
    }
    thirdPersonShortcutKey = null;
  }
  if (startupComplete) {
    syncShellHomeOwnership();
  }
}

function onBigMapHotkeyPressed() {
  if (featureBindsSuspended) return;
  if (bigMapToggleLocked) return;
  bigMapToggleLocked = true;
  setTimeout(() => {
    bigMapToggleLocked = false;
  }, 250);
  if (!minimapEnabled || !startupComplete || !launched) return;
  void windows.toggleBigMap().then(() => {
    if (windows.isBigMapVisible()) {
      mapTelemetry.forceRepublish();
      broadcastMapFogSessionUpdate();
    }
  });
}

function suspendFeatureKeyboardShortcuts() {
  if (thirdPersonShortcutKey) {
    if (thirdPersonShortcutKey === 'Home') {
      unregisterThirdPersonHotkey();
    } else {
      globalShortcut.unregister(thirdPersonShortcutKey);
    }
    thirdPersonShortcutKey = null;
  }

  if (bigMapShortcutKey) {
    if (bigMapShortcutKey === 'Home') {
      unregisterBigMapBind();
    } else {
      globalShortcut.unregister(bigMapShortcutKey);
    }
    bigMapShortcutKey = null;
  } else {
    // Mouse big map bind can stay; letter typing does not use it.
  }

  if (startupComplete) {
    syncShellHomeOwnership();
  }
}

function setFeatureBindsSuspended(suspended) {
  const next = Boolean(suspended);
  if (featureBindsSuspended === next) {
    return { ok: true, suspended: next };
  }

  featureBindsSuspended = next;

  if (next) {
    suspendFeatureKeyboardShortcuts();
  } else {
    applyThirdPersonBind(thirdPersonBindKey);
    applyBigMapBind(minimapMapBindKey);
  }

  return { ok: true, suspended: next };
}

function unregisterBigMapKeyboardShortcut() {
  if (bigMapShortcutKey) {
    if (bigMapShortcutKey === 'Home') {
      unregisterBigMapBind();
    } else {
      globalShortcut.unregister(bigMapShortcutKey);
    }
    bigMapShortcutKey = null;
  } else {
    unregisterBigMapBind();
  }
  if (startupComplete) {
    syncShellHomeOwnership();
  }
}

function applyBigMapBind(keyLabel) {
  unregisterBigMapKeyboardShortcut();
  const sanitized = sanitizeFeatureBindKey(keyLabel);
  minimapMapBindKey = sanitized;

  if (!sanitized) {
    syncShellHomeOwnership();
    return { ok: true, key: null };
  }

  if (!minimapEnabled) {
    return { ok: true, key: minimapMapBindKey };
  }

  const parsed = parseKeyLabel(sanitized);
  if (!parsed) {
    minimapMapBindKey = null;
    syncShellHomeOwnership();
    return { ok: false, reason: 'INVALID_KEY', key: null };
  }

  if (parsed.type === 'mouse') {
    syncShellHomeOwnership();
    registerBigMapMouseBind(parsed.vk, onBigMapHotkeyPressed);
    return { ok: true, key: minimapMapBindKey };
  }

  const accelerator = keyLabelToAccelerator(sanitized);
  if (!accelerator) {
    minimapMapBindKey = null;
    syncShellHomeOwnership();
    return { ok: false, reason: 'INVALID_KEY', key: null };
  }

  syncShellHomeOwnership();

  if (featureBindsSuspended) {
    return { ok: true, key: minimapMapBindKey };
  }

  const ok = globalShortcut.register(accelerator, onBigMapHotkeyPressed);
  if (!ok) {
    minimapMapBindKey = null;
    return { ok: false, reason: 'REGISTER_FAILED', key: null };
  }

  bigMapShortcutKey = accelerator;
  return { ok: true, key: minimapMapBindKey };
}

function applyThirdPersonBind(keyLabel) {
  unregisterThirdPersonKeyboardShortcut();
  unregisterThirdPersonHotkey();
  const sanitized = sanitizeFeatureBindKey(keyLabel);
  thirdPersonBindKey = sanitized;

  if (!sanitized) {
    syncShellHomeOwnership();
    if (thirdPersonFeatureEnabled) {
      thirdPersonCameraActive = true;
      pushThirdPersonStateToGame(true);
      notifyThirdPersonCameraState();
    }
    return { ok: true, key: null };
  }

  const parsed = parseKeyLabel(sanitized);
  if (!parsed) {
    thirdPersonBindKey = null;
    syncShellHomeOwnership();
    return { ok: false, reason: 'INVALID_KEY', key: null };
  }

  if (parsed.type === 'mouse') {
    syncShellHomeOwnership();
    registerThirdPersonMouseBind(parsed.vk, onThirdPersonHotkeyPressed);
    return { ok: true, key: sanitized };
  }

  const accelerator = keyLabelToAccelerator(sanitized);
  if (!accelerator) {
    thirdPersonBindKey = null;
    syncShellHomeOwnership();
    return { ok: false, reason: 'INVALID_KEY', key: null };
  }

  syncShellHomeOwnership();

  if (featureBindsSuspended) {
    return { ok: true, key: sanitized };
  }

  const ok = globalShortcut.register(accelerator, onThirdPersonHotkeyPressed);
  if (!ok) {
    thirdPersonBindKey = null;
    syncShellHomeOwnership();
    return { ok: false, reason: 'REGISTER_FAILED', key: null };
  }

  thirdPersonShortcutKey = accelerator;
  return { ok: true, key: sanitized };
}

async function applyCustomizeSettings(settings) {
  if (!settings) return;

  const thirdPerson = settings.thirdPerson || {};
  const minimap = settings.minimap || {};

  thirdPersonFeatureEnabled = Boolean(thirdPerson.featureEnabled);
  thirdPersonCameraActive = thirdPerson.cameraActive !== false;
  thirdPersonCameraDistance = clampCameraDistance(thirdPerson.cameraDistance);

  applyThirdPersonBind(sanitizeFeatureBindKey(thirdPerson.bindKey) || null);
  pushThirdPersonStateToGame(true);
  notifyThirdPersonCameraState();

  minimapEnabled = minimap.enabled !== false;

  if (mainUiReady) {
    if (minimapEnabled) {
      await windows.showMinimap();
    } else {
      windows.hideMinimap();
      await windows.hideBigMap();
      unregisterBigMapKeyboardShortcut();
    }
  }

  await windows.applyMinimapSize(
    minimap.mapSizePercent ?? windows.getMinimapSizeState().percent,
    { reposition: true },
  );
  applyBigMapBind(sanitizeFeatureBindKey(minimap.mapBindKey) || null);
}

function broadcastCustomizeProfileChanged(profile) {
  const shell = windows.getShellWindow();
  if (shell && !shell.isDestroyed()) {
    shell.webContents.send('customize-profile-changed', profile);
  }
}

function broadcastWorldSettingsSavesChanged() {
  const shell = windows.getShellWindow();
  if (shell && !shell.isDestroyed()) {
    shell.webContents.send('world-settings-saves-changed');
  }
}

function formatWorldSettingsListMeta(settings = {}) {
  const parts = [];
  parts.push(settings.thirdPerson?.featureEnabled ? '3rd person on' : '3rd person off');
  parts.push(settings.minimap?.enabled !== false ? 'minimap on' : 'minimap off');
  return parts.join(' · ');
}

function configureWorldSettingsSession() {
  worldSettingsSession.configure({
    applySettings: applyCustomizeSettings,
    notifyShell: broadcastCustomizeProfileChanged,
    notifyWorldSettingsListChanged: broadcastWorldSettingsSavesChanged,
    isSaveConfirmed: () => saveDiscovery.isSaveConfirmed(),
    getConfirmedSaveFile: () => saveDiscovery.getConfirmedSaveFile(),
    readTelemetry: () => mapTelemetry.readTelemetry(),
  });
}

function getMapTelemetryTargets() {
  const targets = [];
  const minimap = windows.getMinimapWindow();
  if (minimap && !minimap.isDestroyed()) {
    targets.push(minimap);
  }

  if (windows.isBigMapVisible()) {
    const bigMap = windows.getBigMapWindow();
    if (bigMap && !bigMap.isDestroyed()) {
      targets.push(bigMap);
    }
  }

  return targets;
}

async function launchMainApp() {
  if (launched || !startupComplete) return;
  launched = true;

  if (stopWatch) {
    stopWatch();
    stopWatch = null;
  }

  const startup = windows.getStartupWindow();
  if (startup && !startup.isDestroyed()) {
    startup.webContents.send('game-detected');
  }

  mainUiReady = false;
  configureWorldSettingsSession();
  scheduleThirdPersonSync();
  registerShellHomeHotkey();
  notifyThirdPersonCameraState();

  await sleep(SHELL_OPEN_DELAY_MS);

  if (!(await isSubnauticaRunning())) {
    windows.closeStartupWindow();
    quitApp();
    return;
  }

  windows.closeStartupWindow();

  prepareShell();

  const shell = windows.getShellWindow();
  if (!shell || shell.isDestroyed()) {
    return;
  }

  windows.prepareMinimap();
  windows.prepareVersionOverlay();
  void windows.prepareBigMap();
  await windows.applyMinimapSize(windows.getMinimapSizeState().percent, { reposition: true });

  await windows.showShell();
  if (minimapEnabled) {
    await windows.showMinimap();
  }
  await windows.showVersionOverlay();
  await waitForShellVisible(shell);
  await worldSettingsSession.onShellOpened();
  mainUiReady = true;
  windows.startOverlayAwayWatch({
    getMinimapEnabled: () => minimapEnabled,
  });
  mapTelemetry.startMapTelemetryWatcher(getMapTelemetryTargets);
  configureMapTelemetrySideEffects();
  void worldSettingsSession.syncIfConfirmed();
  startGameCloseWatch();
}

function beginGameWatch(gameReady = false) {
  if (gameReady) {
    launchMainApp();
    return;
  }

  isSubnauticaRunning().then((running) => {
    if (running) {
      launchMainApp();
      return;
    }

    stopWatch = watchSubnautica((isRunning) => {
      if (isRunning) {
        launchMainApp();
      }
    });
  });
}

async function waitForStartupWindowReady() {
  const startup = windows.getStartupWindow();
  if (!startup || startup.isDestroyed()) return;

  if (startup.webContents.isLoading()) {
    await new Promise((resolve) => {
      startup.webContents.once('did-finish-load', resolve);
    });
  }
}

async function beginStartupFlow() {
  windows.setShellToggleHandler(toggleShellHotkey);
  windows.setBigMapHiddenHandler(() => {
    setFeatureBindsSuspended(false);
  });
  windows.createHotkeyWindow();
  windows.createStartupWindow();
  createTray({ onRestart: restartApp, onQuit: quitApp });

  await waitForStartupWindowReady();
  await runStartupSequence();
}

async function runStartupSequence() {
  const startup = windows.getStartupWindow();
  try {
    const { gameReady } = await runStartupFlow(startup);
    startupComplete = true;
    registerShellHomeHotkey();
    beginGameWatch(gameReady);
  } catch (err) {
    const code = err?.message || 'STARTUP_FAILED';
    if (startup && !startup.isDestroyed()) {
      startup.webContents.send('startup-error', { code });
    }
    if (
      code === 'DATA_FOLDER_INVALID' ||
      code === 'GAME_NOT_FOUND' ||
      code === 'GAME_FILES_LOCKED' ||
      code.startsWith('INSTALL_FAILED')
    ) {
      return;
    }
    throw err;
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.hermannsvehagen.sonarlink');
  }
  pruneElectronChromiumCache();
  beginStartupFlow();
});

app.on('window-all-closed', () => {
  if (!isQuitting) return;
});

app.on('before-quit', () => {
  isQuitting = true;
  worldSettingsSession.flushPendingSave();
  stopThirdPersonSync();
  mapTelemetry.stopMapTelemetryWatcher();
  if (stopWatch) stopWatch();
  stopGameCloseWatch();
  globalShortcut.unregisterAll();
  unregisterAllHotkeys();
  destroyTray();
});

ipcMain.handle('get-app-info', () => {
  const pkg = require(path.join(__dirname, '..', '..', 'package.json'));
  return {
    version: pkg.version,
    developer: 'StypX2K',
  };
});

ipcMain.handle('get-minimap-map-url', () => {
  const mapPath = mapImagePath();
  if (!fs.existsSync(mapPath)) {
    return null;
  }
  return pathToFileURL(mapPath).href;
});

ipcMain.handle('get-minimap-idle-url', () => {
  const logoPath = sonarLinkImagePath();
  if (!fs.existsSync(logoPath)) {
    return null;
  }
  return pathToFileURL(logoPath).href;
});

ipcMain.handle('get-minimap-session-state', async () => {
  const gameRunning = await isSubnauticaRunning();
  const telemetry = mapTelemetry.readTelemetry();
  return { gameRunning, telemetry };
});

ipcMain.handle('get-map-telemetry', () => mapTelemetry.readTelemetry());

ipcMain.handle('get-map-fog-session', () => mapFogSession.getSession());

ipcMain.handle('get-map-waypoint', () => mapWaypointSession.getWaypoint());

ipcMain.handle('set-map-waypoint', (_event, payload) => {
  const next = mapWaypointSession.setWaypoint(payload);
  broadcastMapWaypointUpdate();
  return next;
});

ipcMain.handle('clear-map-waypoint', () => {
  mapWaypointSession.clearWaypoint();
  broadcastMapWaypointUpdate();
  return null;
});

ipcMain.handle('push-map-fog-session', (_event, payload) => {
  if (payload === null) {
    mapFogSession.clearSession();
    broadcastMapFogSessionUpdate();
    return { ok: true };
  }

  if (mapFogSession.setSession(payload)) {
    broadcastMapFogSessionUpdate();
    return { ok: true };
  }

  return { ok: false };
});

ipcMain.handle('clear-map-fog-session', () => {
  mapFogSession.clearSession();
  broadcastMapFogSessionUpdate();
  return { ok: true };
});

function broadcastMapFogSavesChanged() {
  const shell = windows.getShellWindow();
  if (shell && !shell.isDestroyed()) {
    shell.webContents.send('map-fog-saves-changed');
  }
}

function sessionMatchesFogSaveId(saveId) {
  if (!saveId) return false;
  const session = mapFogSession.getSession();
  if (!session?.saveFile) return false;
  const sessionSaveId = mapFogStore.resolveSaveId({ saveFile: session.saveFile });
  return sessionSaveId === saveId;
}

function clearFogSessionIfSaveDeleted(saveId) {
  if (sessionMatchesFogSaveId(saveId)) {
    mapFogSession.clearSession();
  }
}

function broadcastMapFogDeleted(saveId) {
  const minimap = windows.getMinimapWindow();
  if (minimap && !minimap.isDestroyed()) {
    minimap.webContents.send('map-fog-deleted', saveId);
  }
}

function broadcastMapFogSessionUpdate() {
  const payload = mapFogSession.getSession();

  const bigMap = windows.getBigMapWindow();
  // Keep hidden world map warm so first open does not rebuild fog/layout on screen.
  if (bigMap && !bigMap.isDestroyed()) {
    bigMap.webContents.send('map-fog-session-update', payload);
  }
}

function broadcastMapWaypointUpdate() {
  const payload = mapWaypointSession.getWaypoint();

  const bigMap = windows.getBigMapWindow();
  if (bigMap && !bigMap.isDestroyed()) {
    bigMap.webContents.send('map-waypoint-update', payload);
  }

  const minimap = windows.getMinimapWindow();
  if (minimap && !minimap.isDestroyed()) {
    minimap.webContents.send('map-waypoint-update', payload);
  }
}

function broadcastMapMarkersUpdate(markers, saveId = null) {
  const payload = {
    saveId: saveId || null,
    markers: Array.isArray(markers) ? markers : [],
  };

  const bigMap = windows.getBigMapWindow();
  if (bigMap && !bigMap.isDestroyed()) {
    bigMap.webContents.send('map-markers-update', payload);
  }

  const minimap = windows.getMinimapWindow();
  if (minimap && !minimap.isDestroyed()) {
    minimap.webContents.send('map-markers-update', payload);
  }
}

function sortFogSavesForDisplay(saves, activeSaveId) {
  const sorted = [...saves];

  sorted.sort((a, b) => {
    if (activeSaveId) {
      if (a.saveId === activeSaveId) return -1;
      if (b.saveId === activeSaveId) return 1;
    }

    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  return sorted;
}

function configureMapTelemetrySideEffects() {
  let minimapLiveAnchored = false;

  mapTelemetry.setTelemetryPublishedHandler((data) => {
    void worldSettingsSession.onTelemetryUpdate(data);

    const live = data?.active === true
      && Number.isFinite(data?.x)
      && Number.isFinite(data?.y);

    if (live && !minimapLiveAnchored && windows.isMinimapVisible()) {
      void windows.positionMinimapOverGame();
    }

    minimapLiveAnchored = live;

    if (!data || data.active !== true || !data.saveFile || !saveDiscovery.isSaveConfirmed()) {
      return;
    }

    const registration = mapFogStore.ensureSaveRegistered(data);
    if (registration?.isNew || registration?.labelUpdated) {
      broadcastMapFogSavesChanged();
    }
  });

  mapTelemetry.setSaveChangeHandler((fileName, isConfirmed) => {
    broadcastMapFogSavesChanged();
    broadcastWorldSettingsSavesChanged();
    void worldSettingsSession.handleSaveWrite(fileName, isConfirmed);
  });
}

ipcMain.handle('list-map-fog-saves', () => {
  const telemetry = mapTelemetry.readTelemetry();
  const active = saveDiscovery.isSaveConfirmed()
    ? mapFogStore.getActiveSaveFromTelemetry(telemetry)
    : null;
  const worldLabel = saveDiscovery.resolveWorldLabelForDisplay(telemetry);
  const activeSaveId = active?.saveId || null;
  const saves = sortFogSavesForDisplay(
    mapFogStore.listFogSavesWithOrphanFlags(activeSaveId),
    activeSaveId,
  );

  return {
    saves,
    orphanCount: saves.filter((save) => save.orphan).length,
    active: active
      ? {
          saveId: active.saveId,
          saveLabel: worldLabel || active.saveLabel,
          saveFile: active.saveFile,
        }
      : null,
  };
});

ipcMain.handle('list-world-settings-saves', () => {
  const telemetry = mapTelemetry.readTelemetry();
  const active = saveDiscovery.isSaveConfirmed()
    ? mapFogStore.getActiveSaveFromTelemetry(telemetry)
    : null;
  const worldLabel = saveDiscovery.resolveWorldLabelForDisplay(telemetry);
  const activeSaveId = active?.saveId || null;
  const saves = sortFogSavesForDisplay(
    worldSettingsStore.listSettingsSavesWithOrphanFlags(activeSaveId).map((save) => ({
      ...save,
      meta: formatWorldSettingsListMeta(save.settings),
    })),
    activeSaveId,
  );

  return {
    saves,
    orphanCount: saves.filter((save) => save.orphan).length,
    active: active
      ? {
          saveId: active.saveId,
          saveLabel: worldLabel || active.saveLabel,
          saveFile: active.saveFile,
        }
      : null,
  };
});

ipcMain.handle('get-map-fog-save', (_event, saveId, hints) => mapFogStore.getFogRecord(saveId, hints));

ipcMain.handle('save-map-fog-save', (_event, saveId, data) => {
  const saved = mapFogStore.saveFogData(saveId, data);
  if (saved) {
    if (Object.prototype.hasOwnProperty.call(data || {}, 'markers')) {
      mapFogSession.setMarkers(saved.markers);
      broadcastMapMarkersUpdate(saved.markers, saveId);
    }
    broadcastMapFogSavesChanged();
  }
  return saved;
});

ipcMain.handle('save-map-markers', (_event, saveId, markers) => {
  if (!saveId) return null;

  const saved = mapFogStore.saveMapMarkers(saveId, markers);
  if (!saved) return null;

  const session = mapFogSession.getSession();
  const sessionSaveId = session?.saveFile
    ? mapFogStore.resolveSaveId({ saveFile: session.saveFile })
    : null;

  // Only update live session when it belongs to this save.
  if (!sessionSaveId || sessionSaveId === saveId) {
    mapFogSession.setMarkers(saved.markers);
  }

  broadcastMapMarkersUpdate(saved.markers, saveId);
  broadcastMapFogSavesChanged();
  return saved.markers;
});

ipcMain.handle('delete-map-fog-save', (_event, saveId) => {
  const result = mapFogStore.deleteFogSave(saveId);
  if (result?.ok) {
    clearFogSessionIfSaveDeleted(saveId);
    broadcastMapFogSavesChanged();
    broadcastMapFogDeleted(saveId);
    broadcastMapFogSessionUpdate();
  }
  return result;
});

ipcMain.handle('delete-orphan-map-fog-saves', () => {
  const telemetry = mapTelemetry.readTelemetry();
  const active = saveDiscovery.isSaveConfirmed()
    ? mapFogStore.getActiveSaveFromTelemetry(telemetry)
    : null;
  const result = mapFogStore.deleteOrphanFogSaves(active?.saveId || null);

  if (result.deleted > 0) {
    for (const saveId of result.deletedIds) {
      clearFogSessionIfSaveDeleted(saveId);
    }
    broadcastMapFogSavesChanged();
    for (const saveId of result.deletedIds) {
      broadcastMapFogDeleted(saveId);
    }
    broadcastMapFogSessionUpdate();
  }

  return result;
});

ipcMain.handle('resolve-map-save-id', (_event, telemetry) => mapFogStore.resolveSaveId(telemetry));

ipcMain.handle('delete-world-settings-save', (_event, saveId) => {
  const result = worldSettingsStore.deleteSettingsSave(saveId);
  if (result?.ok) {
    broadcastWorldSettingsSavesChanged();
  }
  return result;
});

ipcMain.handle('delete-orphan-world-settings-saves', () => {
  const telemetry = mapTelemetry.readTelemetry();
  const active = saveDiscovery.isSaveConfirmed()
    ? mapFogStore.getActiveSaveFromTelemetry(telemetry)
    : null;
  const result = worldSettingsStore.deleteOrphanSettingsSaves(active?.saveId || null);

  if (result.deleted > 0) {
    broadcastWorldSettingsSavesChanged();
  }

  return result;
});

ipcMain.handle('get-customize-profile', () => worldSettingsSession.getShellProfile());

ipcMain.handle('open-external-url', (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { ok: false };
  }

  shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('get-initial-state', async () => {
  const running = await isSubnauticaRunning();
  return { gameRunning: running, startupComplete };
});

ipcMain.handle('startup-pick-data-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const folderPath = await openDataFolderDialog(win);
  if (!folderPath) {
    return { ok: false };
  }
  resolveDataFolder(folderPath);
  return { ok: true, path: folderPath };
});

ipcMain.handle('startup-uninstall-sonarlink', async () => {
  if (await isSubnauticaRunning()) {
    return { ok: false, reason: 'GAME_RUNNING' };
  }

  resetAllForTesting();

  if (stopWatch) {
    stopWatch();
    stopWatch = null;
  }
  stopGameCloseWatch();
  stopThirdPersonSync();
  mapTelemetry.stopMapTelemetryWatcher();
  launched = false;
  startupComplete = false;
  windows.hideShell();
  windows.hideMinimap();

  return { ok: true };
});

ipcMain.handle('set-third-person-enabled', (_event, enabled) => {
  thirdPersonFeatureEnabled = Boolean(enabled);
  pushThirdPersonStateToGame(true);
  notifyThirdPersonCameraState();
  worldSettingsSession.onUserSettingsChanged({
    thirdPerson: { featureEnabled: thirdPersonFeatureEnabled },
  });
  return { ok: true };
});

ipcMain.handle('get-third-person-state', () => ({
  featureEnabled: thirdPersonFeatureEnabled,
  cameraActive: thirdPersonCameraActive,
  cameraDistance: thirdPersonCameraDistance,
  bindKey: thirdPersonBindKey,
}));

ipcMain.handle('set-third-person-distance', (_event, percent, options = {}) => {
  thirdPersonCameraDistance = clampCameraDistance(percent);
  if (shouldApplyCameraDistance()) {
    if (options.smooth) {
      pushCameraDistanceCommit();
    } else {
      pushCameraDistancePreviewDebounced();
    }
  }
  if (options.smooth) {
    worldSettingsSession.onUserSettingsChanged({
      thirdPerson: { cameraDistance: thirdPersonCameraDistance },
    });
  }
  return { ok: true };
});

ipcMain.handle('set-third-person-bind', (_event, keyLabel) => {
  const label = typeof keyLabel === 'string' && keyLabel.trim() ? keyLabel.trim() : null;
  const result = applyThirdPersonBind(label);
  if (result?.ok !== false) {
    worldSettingsSession.onUserSettingsChanged({
      thirdPerson: { bindKey: result.key ?? null },
    });
  }
  return result;
});

ipcMain.handle('set-minimap-enabled', async (_event, enabled) => {
  minimapEnabled = Boolean(enabled);
  if (!mainUiReady) {
    return { ok: true, enabled: minimapEnabled };
  }

  if (minimapEnabled) {
    await windows.showMinimap();
    if (minimapMapBindKey) {
      applyBigMapBind(minimapMapBindKey);
    }
  } else {
    windows.hideMinimap();
    await windows.hideBigMap();
    unregisterBigMapKeyboardShortcut();
  }
  worldSettingsSession.onUserSettingsChanged({
    minimap: { enabled: minimapEnabled },
  });
  return { ok: true, enabled: minimapEnabled };
});

ipcMain.handle('get-minimap-settings', () => ({
  enabled: minimapEnabled,
  mapSizePercent: windows.getMinimapSizeState().percent,
  mapBindKey: minimapMapBindKey,
}));

ipcMain.handle('set-minimap-size', async (_event, percent, options = {}) => {
  const result = await windows.applyMinimapSize(percent, options);
  if (options?.preview === false) {
    worldSettingsSession.onUserSettingsChanged({
      minimap: { mapSizePercent: windows.getMinimapSizeState().percent },
    });
  }
  return result;
});

ipcMain.handle('set-minimap-map-bind', (_event, keyLabel) => {
  const label = typeof keyLabel === 'string' && keyLabel.trim() ? keyLabel.trim() : null;
  const result = applyBigMapBind(label);
  if (result?.ok !== false) {
    worldSettingsSession.onUserSettingsChanged({
      minimap: { mapBindKey: result.key ?? null },
    });
  }
  return result;
});

ipcMain.handle('hide-big-map', async () => {
  setFeatureBindsSuspended(false);
  await windows.hideBigMap();
  return { ok: true };
});

ipcMain.handle('set-feature-binds-suspended', (_event, suspended) => (
  setFeatureBindsSuspended(suspended)
));

ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win === windows.getShellWindow()) {
    windows.hideShell();
  } else {
    win.hide();
  }
});
