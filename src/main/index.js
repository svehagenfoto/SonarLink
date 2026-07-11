const { app, ipcMain, BrowserWindow, globalShortcut, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { isSubnauticaRunning, watchSubnautica } = require('./processWatch');
const windows = require('./windowManager');
const { createTray, destroyTray } = require('./tray');
const {
  unregisterAllHotkeys,
  registerThirdPersonMouseBind,
  unregisterThirdPersonHotkey,
  registerHomeKeyPoll,
  unregisterHomeKeyPoll,
  registerThirdPersonHotkey,
} = require('./win32');
const {
  runStartupFlow,
  resolveDataFolder,
  openDataFolderDialog,
} = require('./startupFlow');
const { resetAllForTesting } = require('./resetManager');
const { setThirdPersonEnabled, setThirdPersonDistance } = require('./gameBridge');
const { parseKeyLabel, keyLabelToAccelerator } = require('./keybindParse');
const devTemp = require('./devTempShortcuts');

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
let thirdPersonDistancePreviewTimer = null;
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

const MOD_NOREPEAT = 0x4000;
const VK_HOME = 0x24;
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
  unregisterHomeKeyPoll();
  shellHomeHotkeyRegistered = false;
}

function toggleShellHotkey() {
  if (!startupComplete || !launched) return;
  windows.toggleShell();
}

function prepareShell() {
  if (!windows.getShellWindow()) {
    windows.createShellWindow({ showOnReady: false });
  }
}

devTemp.init({
  windows,
  waitForShellVisible,
  getStopWatch: () => stopWatch,
  setStopWatch: (value) => {
    stopWatch = value;
  },
  setStartupComplete: (value) => {
    startupComplete = value;
  },
  setLaunched: (value) => {
    launched = value;
  },
  prepareShell,
  registerShellHomeHotkey,
  notifyThirdPersonCameraState,
});

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
  if (!thirdPersonFeatureEnabled) return;
  thirdPersonCameraActive = !thirdPersonCameraActive;
  pushThirdPersonStateToGame(true);
  notifyThirdPersonCameraState();
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
    registerShellHomeHotkey();
  }
}

function applyThirdPersonBind(keyLabel) {
  unregisterThirdPersonKeyboardShortcut();
  unregisterThirdPersonHotkey();

  if (!keyLabel) {
    registerShellHomeHotkey();
    if (thirdPersonFeatureEnabled) {
      thirdPersonCameraActive = true;
      pushThirdPersonStateToGame(true);
      notifyThirdPersonCameraState();
    }
    return { ok: true };
  }

  const parsed = parseKeyLabel(keyLabel);
  if (!parsed) {
    return { ok: false, reason: 'INVALID_KEY' };
  }

  if (parsed.type === 'mouse') {
    registerShellHomeHotkey();
    registerThirdPersonMouseBind(parsed.vk, onThirdPersonHotkeyPressed);
    return { ok: true };
  }

  const accelerator = keyLabelToAccelerator(keyLabel);
  if (!accelerator) {
    return { ok: false, reason: 'INVALID_KEY' };
  }

  if (accelerator === 'Home') {
    unregisterShellHomeHotkey();
    const hotkeyWin = windows.getHotkeyWindow();
    if (!hotkeyWin || hotkeyWin.isDestroyed()) {
      registerShellHomeHotkey();
      return { ok: false, reason: 'REGISTER_FAILED' };
    }

    const ok = registerThirdPersonHotkey(
      hotkeyWin,
      MOD_NOREPEAT,
      VK_HOME,
      onThirdPersonHotkeyPressed,
    );
    if (!ok) {
      registerShellHomeHotkey();
      return { ok: false, reason: 'REGISTER_FAILED' };
    }

    thirdPersonShortcutKey = 'Home';
    return { ok: true };
  }

  registerShellHomeHotkey();

  const ok = globalShortcut.register(accelerator, onThirdPersonHotkeyPressed);
  if (!ok) {
    registerShellHomeHotkey();
    return { ok: false, reason: 'REGISTER_FAILED' };
  }

  thirdPersonShortcutKey = accelerator;
  return { ok: true };
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

  prepareShell();
  scheduleThirdPersonSync();
  registerShellHomeHotkey();
  notifyThirdPersonCameraState();

  await sleep(SHELL_OPEN_DELAY_MS);

  if (!(await isSubnauticaRunning())) {
    windows.closeStartupWindow();
    quitApp();
    return;
  }

  const shell = windows.getShellWindow();
  if (!shell || shell.isDestroyed()) {
    windows.closeStartupWindow();
    return;
  }

  await windows.showShell();
  await waitForShellVisible(shell);
  windows.closeStartupWindow();
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
    prepareShell();
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
  beginStartupFlow();
});

app.on('window-all-closed', () => {
  if (!isQuitting) return;
});

app.on('before-quit', () => {
  isQuitting = true;
  stopThirdPersonSync();
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

// TEMP DEV
ipcMain.handle('startup-skip-to-menu', async () => devTemp.skipToMenu());

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
  launched = false;
  startupComplete = false;
  windows.hideShell();

  return { ok: true };
});

ipcMain.handle('set-third-person-enabled', (_event, enabled) => {
  thirdPersonFeatureEnabled = Boolean(enabled);
  pushThirdPersonStateToGame(true);
  notifyThirdPersonCameraState();
  return { ok: true };
});

ipcMain.handle('get-third-person-state', () => ({
  featureEnabled: thirdPersonFeatureEnabled,
  cameraActive: thirdPersonCameraActive,
  cameraDistance: thirdPersonCameraDistance,
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
  return { ok: true };
});

ipcMain.handle('set-third-person-bind', (_event, keyLabel) => {
  const label = typeof keyLabel === 'string' && keyLabel.trim() ? keyLabel.trim() : null;
  return applyThirdPersonBind(label);
});

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
