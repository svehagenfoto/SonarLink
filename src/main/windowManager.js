const { BrowserWindow, screen, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { assetPath } = require('./paths');
const { getGameWindowBounds, getGameWindowHandle, getGameProcessId } = require('./gameWindow');
const {
  hideWindowFromTaskbar,
  forceWindowFocus,
  focusExternalWindowHandle,
  releaseGameInputCapture,
  showSystemCursor,
  unregisterAllHotkeys,
  isMouseLeftDown,
  getForegroundHwnd,
  getProcessIdFromHwnd,
} = require('./win32');

let startupWindow = null;
let shellWindow = null;
let minimapWindow = null;
let bigMapWindow = null;
let bigMapPreparePromise = null;
let bigMapContentReady = false;
let hotkeyWindow = null;
let versionOverlayWindow = null;
let clickPollTimer = null;
let clickOutsideArmTimer = null;
let clickOutsideArmed = false;
let wasMouseDown = false;
let bigMapClickPollTimer = null;
let bigMapClickOutsideArmTimer = null;
let bigMapClickOutsideArmed = false;
let bigMapWasMouseDown = false;
let onShellToggle = null;
let onBigMapHidden = null;

const CLICK_OUTSIDE_ARM_DELAY_MS = 500;
const MINIMAP_SIZE_MIN = 120;
const MINIMAP_SIZE_MAX = 220;
const MINIMAP_SIZE_DEFAULT_PERCENT = 50;
const MINIMAP_WINDOW_PAD = 8;
const MINIMAP_STATUS_BAND = 72;
const MINIMAP_STATUS_MIN_WIDTH = 220;
const MINIMAP_SCREEN_TOP = 28;
const MINIMAP_SCREEN_RIGHT = 28;
const VERSION_OVERLAY_WIDTH = 168;
const VERSION_OVERLAY_HEIGHT = 22;
const VERSION_OVERLAY_RIGHT = 16;
const VERSION_OVERLAY_BOTTOM = 20;
const OVERLAY_AWAY_POLL_MS = 400;
const OVERLAY_AWAY_HIDE_DELAY_MS = 350;
const GAME_PID_CACHE_MS = 2500;

let overlayAwayPollTimer = null;
let overlayAwayHideTimer = null;
let overlaysHiddenByAway = false;
let cachedGamePid = null;
let cachedGamePidAt = 0;
let getMinimapEnabledForOverlay = () => true;

let minimapVisualSize = 168;
let minimapMapSizePercent = MINIMAP_SIZE_DEFAULT_PERCENT;
let cachedMinimapAnchor = null;
let pendingPreviewPercent = null;
let previewThrottleTimer = null;
let fullMinimapSizeApplyChain = Promise.resolve();

function clampMinimapSizePercent(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) return MINIMAP_SIZE_DEFAULT_PERCENT;
  return Math.max(1, Math.min(99, Math.round(value)));
}

function percentToMinimapSize(percent) {
  const clamped = clampMinimapSizePercent(percent);
  return Math.round(
    MINIMAP_SIZE_MIN + ((clamped - 1) / 98) * (MINIMAP_SIZE_MAX - MINIMAP_SIZE_MIN),
  );
}

function getMinimapWindowMetrics() {
  const padded = minimapVisualSize + MINIMAP_WINDOW_PAD * 2;
  const width = Math.max(padded + 36, MINIMAP_STATUS_MIN_WIDTH);
  const height = padded + MINIMAP_STATUS_BAND;
  return { width, height };
}

function sendMinimapSizeToRenderer() {
  if (!minimapWindow || minimapWindow.isDestroyed()) return;
  minimapWindow.webContents.send('minimap-size-update', { size: minimapVisualSize });
}

async function syncMinimapRendererSize() {
  if (!minimapWindow || minimapWindow.isDestroyed()) return;
  const size = minimapVisualSize;
  sendMinimapSizeToRenderer();
  try {
    await minimapWindow.webContents.executeJavaScript(
      `document.documentElement.style.setProperty('--minimap-size', '${size}px');`,
      true,
    );
  } catch {
    // Page may not be ready yet.
  }
}

async function getMinimapAnchorArea() {
  const physical = await getGameWindowBounds();
  if (!physical) {
    return screen.getPrimaryDisplay().workArea;
  }

  const topLeft = screen.screenToDipPoint({ x: physical.x, y: physical.y });
  const bottomRight = screen.screenToDipPoint({
    x: physical.x + physical.width,
    y: physical.y + physical.height,
  });

  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

async function refreshMinimapAnchorCache() {
  cachedMinimapAnchor = await getMinimapAnchorArea();
  return cachedMinimapAnchor;
}

function getCachedMinimapAnchor() {
  return cachedMinimapAnchor || screen.getPrimaryDisplay().workArea;
}

function computeMinimapWindowBounds(anchor) {
  const { width, height } = getMinimapWindowMetrics();
  const targetRight = anchor.x + anchor.width - MINIMAP_SCREEN_RIGHT;
  const targetTop = anchor.y + MINIMAP_SCREEN_TOP;
  let x = Math.round(targetRight - width + MINIMAP_WINDOW_PAD);
  let y = Math.round(targetTop - MINIMAP_WINDOW_PAD);
  const maxX = anchor.x + anchor.width - width;
  const maxY = anchor.y + anchor.height - height;
  x = Math.min(Math.max(anchor.x, x), Math.max(anchor.x, maxX));
  y = Math.min(Math.max(anchor.y, y), Math.max(anchor.y, maxY));
  return { x, y, width, height };
}

function applyMinimapWindowBoundsSync(anchor) {
  if (!minimapWindow || minimapWindow.isDestroyed()) return null;
  const wasVisible = minimapWindow.isVisible();
  const bounds = computeMinimapWindowBounds(anchor);
  minimapWindow.setBounds(bounds);
  if (!wasVisible) {
    minimapWindow.hide();
  }
  return bounds;
}

async function applyMinimapWindowBounds() {
  if (!minimapWindow || minimapWindow.isDestroyed()) {
    await positionVersionOverlayOverGame();
    return null;
  }
  await refreshMinimapAnchorCache();
  const bounds = applyMinimapWindowBoundsSync(cachedMinimapAnchor);
  await positionVersionOverlayOverGame();
  return bounds;
}

function computeVersionOverlayBounds(anchor) {
  return {
    x: Math.round(anchor.x + anchor.width - VERSION_OVERLAY_WIDTH - VERSION_OVERLAY_RIGHT),
    y: Math.round(anchor.y + anchor.height - VERSION_OVERLAY_HEIGHT - VERSION_OVERLAY_BOTTOM),
    width: VERSION_OVERLAY_WIDTH,
    height: VERSION_OVERLAY_HEIGHT,
  };
}

async function positionVersionOverlayOverGame() {
  if (!versionOverlayWindow || versionOverlayWindow.isDestroyed()) return;
  const anchor = await getMinimapAnchorArea();
  const wasVisible = versionOverlayWindow.isVisible();
  versionOverlayWindow.setBounds(computeVersionOverlayBounds(anchor));
  if (!wasVisible) {
    versionOverlayWindow.hide();
  }
}

function createVersionOverlayWindow() {
  if (versionOverlayWindow && !versionOverlayWindow.isDestroyed()) {
    return versionOverlayWindow;
  }

  versionOverlayWindow = new BrowserWindow({
    width: VERSION_OVERLAY_WIDTH,
    height: VERSION_OVERLAY_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    thickFrame: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  versionOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
  versionOverlayWindow.setIgnoreMouseEvents(true);
  versionOverlayWindow.setSkipTaskbar(true);
  hideWindowFromTaskbar(versionOverlayWindow);

  versionOverlayWindow.loadFile(
    path.join(__dirname, '..', 'renderer', 'features', 'version-overlay', 'version-overlay.html'),
  );

  versionOverlayWindow.on('closed', () => {
    versionOverlayWindow = null;
  });

  return versionOverlayWindow;
}

function prepareVersionOverlay() {
  if (!versionOverlayWindow || versionOverlayWindow.isDestroyed()) {
    createVersionOverlayWindow();
  }
}

async function showVersionOverlay() {
  if (!versionOverlayWindow || versionOverlayWindow.isDestroyed()) {
    createVersionOverlayWindow();
  }

  await positionVersionOverlayOverGame();
  versionOverlayWindow.setSkipTaskbar(true);
  hideWindowFromTaskbar(versionOverlayWindow);
  versionOverlayWindow.showInactive();
  versionOverlayWindow.setSkipTaskbar(true);
  hideWindowFromTaskbar(versionOverlayWindow);

  setTimeout(() => {
    void positionVersionOverlayOverGame();
  }, 600);
  setTimeout(() => {
    void positionVersionOverlayOverGame();
  }, 2000);
}

function hideVersionOverlay() {
  if (!versionOverlayWindow || versionOverlayWindow.isDestroyed()) return;
  versionOverlayWindow.hide();
}

function isSonarLinkSurfaceActive() {
  if (isShellVisible() || isBigMapVisible()) return true;

  const focused = BrowserWindow.getFocusedWindow();
  if (!focused || focused.isDestroyed()) return false;
  if (focused === minimapWindow || focused === versionOverlayWindow) return false;
  if (focused === hotkeyWindow) return false;
  return true;
}

async function refreshCachedGamePid() {
  const now = Date.now();
  if (cachedGamePid && now - cachedGamePidAt < GAME_PID_CACHE_MS) {
    return cachedGamePid;
  }

  cachedGamePid = await getGameProcessId();
  cachedGamePidAt = now;
  return cachedGamePid;
}

async function isGameProcessForeground() {
  const gamePid = await refreshCachedGamePid();
  if (!gamePid) return false;

  const fgHwnd = getForegroundHwnd();
  const fgPid = getProcessIdFromHwnd(fgHwnd);
  if (fgPid && fgPid === gamePid) return true;

  // Fallback if PID out-param failed: compare main window hwnd.
  if (!fgPid) {
    const gameHwnd = await getGameWindowHandle();
    return Boolean(gameHwnd && fgHwnd && Number(gameHwnd) === Number(fgHwnd));
  }

  return false;
}

async function shouldKeepGameOverlaysVisible() {
  if (isSonarLinkSurfaceActive()) return true;
  return isGameProcessForeground();
}

function clearOverlayAwayHideTimer() {
  if (overlayAwayHideTimer) {
    clearTimeout(overlayAwayHideTimer);
    overlayAwayHideTimer = null;
  }
}

function hideOverlaysForAway() {
  if (overlaysHiddenByAway) return;
  overlaysHiddenByAway = true;
  hideMinimap();
  hideVersionOverlay();
}

async function restoreOverlaysAfterAway() {
  if (!overlaysHiddenByAway) return;
  overlaysHiddenByAway = false;

  if (typeof getMinimapEnabledForOverlay === 'function' && getMinimapEnabledForOverlay()) {
    await showMinimap();
  }
  await showVersionOverlay();
}

async function syncOverlayAwayVisibility() {
  const keepVisible = await shouldKeepGameOverlaysVisible();

  if (keepVisible) {
    clearOverlayAwayHideTimer();
    if (overlaysHiddenByAway) {
      await restoreOverlaysAfterAway();
    }
    return;
  }

  if (overlaysHiddenByAway || overlayAwayHideTimer) return;

  overlayAwayHideTimer = setTimeout(() => {
    overlayAwayHideTimer = null;
    void shouldKeepGameOverlaysVisible().then((keepVisible) => {
      // Re-check after delay so shell/world map focus handoff does not flicker.
      if (!keepVisible) {
        hideOverlaysForAway();
      }
    });
  }, OVERLAY_AWAY_HIDE_DELAY_MS);
}

function startOverlayAwayWatch(options = {}) {
  stopOverlayAwayWatch();
  if (typeof options.getMinimapEnabled === 'function') {
    getMinimapEnabledForOverlay = options.getMinimapEnabled;
  }

  overlayAwayPollTimer = setInterval(() => {
    void syncOverlayAwayVisibility();
  }, OVERLAY_AWAY_POLL_MS);

  void syncOverlayAwayVisibility();
}

function stopOverlayAwayWatch() {
  if (overlayAwayPollTimer) {
    clearInterval(overlayAwayPollTimer);
    overlayAwayPollTimer = null;
  }
  clearOverlayAwayHideTimer();
  overlaysHiddenByAway = false;
  cachedGamePid = null;
  cachedGamePidAt = 0;
}

function updateMinimapSizeState(percent) {
  minimapMapSizePercent = clampMinimapSizePercent(percent);
  minimapVisualSize = percentToMinimapSize(minimapMapSizePercent);
}

function applyMinimapSizePreviewNow(percent) {
  updateMinimapSizeState(percent);

  if (!minimapWindow || minimapWindow.isDestroyed()) {
    return { ok: true, size: minimapVisualSize, percent: minimapMapSizePercent };
  }

  sendMinimapSizeToRenderer();
  applyMinimapWindowBoundsSync(getCachedMinimapAnchor());
  return { ok: true, size: minimapVisualSize, percent: minimapMapSizePercent };
}

function applyMinimapSizePreview(percent) {
  pendingPreviewPercent = percent;

  if (!previewThrottleTimer) {
    applyMinimapSizePreviewNow(percent);
    previewThrottleTimer = setTimeout(() => {
      previewThrottleTimer = null;
      if (pendingPreviewPercent == null) return;
      const latest = pendingPreviewPercent;
      pendingPreviewPercent = null;
      applyMinimapSizePreviewNow(latest);
    }, 48);
  }
}

async function applyMinimapSizeFull(percent, options = {}) {
  updateMinimapSizeState(percent);

  if (!minimapWindow || minimapWindow.isDestroyed()) {
    return { ok: true, size: minimapVisualSize, percent: minimapMapSizePercent };
  }

  await syncMinimapRendererSize();

  if (options.reposition !== false) {
    await applyMinimapWindowBounds();
  } else {
    const wasVisible = minimapWindow.isVisible();
    const { width, height } = getMinimapWindowMetrics();
    minimapWindow.setSize(width, height);
    if (!wasVisible) {
      minimapWindow.hide();
    }
  }

  return { ok: true, size: minimapVisualSize, percent: minimapMapSizePercent };
}

function enqueueMinimapSizeFullApply(percent, options = {}) {
  pendingPreviewPercent = null;
  if (previewThrottleTimer) {
    clearTimeout(previewThrottleTimer);
    previewThrottleTimer = null;
  }

  const result = fullMinimapSizeApplyChain.then(() => applyMinimapSizeFull(percent, options));
  fullMinimapSizeApplyChain = result.catch(() => {});
  return result;
}

async function applyMinimapSize(percent, options = {}) {
  if (options.preview) {
    applyMinimapSizePreview(percent);
    return { ok: true, size: minimapVisualSize, percent: minimapMapSizePercent };
  }

  return enqueueMinimapSizeFullApply(percent, options);
}

function getMinimapSizeState() {
  return {
    percent: minimapMapSizePercent,
    size: minimapVisualSize,
  };
}

function getPreloadPath() {
  return path.join(__dirname, '..', 'preload', 'preload.js');
}

function getMinimapPreloadPath() {
  return path.join(__dirname, '..', 'preload', 'minimap-preload.js');
}

function getWindowIcon() {
  const ico = assetPath('icon.ico');
  if (fs.existsSync(ico)) return nativeImage.createFromPath(ico);
  const png = assetPath('tray-32.png');
  if (fs.existsSync(png)) return nativeImage.createFromPath(png);
  return undefined;
}

function applyShellTaskbarHidden() {
  if (!shellWindow || shellWindow.isDestroyed()) return;
  shellWindow.setSkipTaskbar(true);
  hideWindowFromTaskbar(shellWindow);
}

function applyMinimapTaskbarHidden() {
  if (!minimapWindow || minimapWindow.isDestroyed()) return;
  minimapWindow.setSkipTaskbar(true);
  hideWindowFromTaskbar(minimapWindow);
}

async function positionMinimapOverGame() {
  if (!minimapWindow || minimapWindow.isDestroyed()) return;
  await applyMinimapWindowBounds();
  await positionVersionOverlayOverGame();
}

async function positionShellOverGame() {
  if (!shellWindow || shellWindow.isDestroyed()) return;

  const bounds = await getGameWindowBounds();
  const [shellW, shellH] = shellWindow.getSize();

  if (bounds) {
    shellWindow.setPosition(
      bounds.x + Math.round((bounds.width - shellW) / 2),
      bounds.y + Math.round((bounds.height - shellH) / 2)
    );
    return;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  shellWindow.setPosition(
    Math.round((width - shellW) / 2),
    Math.round((height - shellH) / 2)
  );
}

function isPointInsideShell(x, y) {
  if (!shellWindow || shellWindow.isDestroyed() || !shellWindow.isVisible()) return false;
  const b = shellWindow.getBounds();
  return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
}

function isPointInsideBigMap(x, y) {
  if (!bigMapWindow || bigMapWindow.isDestroyed() || !bigMapWindow.isVisible()) return false;
  const b = bigMapWindow.getBounds();
  return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
}

function stopBigMapClickOutsidePoll() {
  if (bigMapClickPollTimer) {
    clearInterval(bigMapClickPollTimer);
    bigMapClickPollTimer = null;
  }
  if (bigMapClickOutsideArmTimer) {
    clearTimeout(bigMapClickOutsideArmTimer);
    bigMapClickOutsideArmTimer = null;
  }
  bigMapClickOutsideArmed = false;
  bigMapWasMouseDown = false;
}

function startBigMapClickOutsidePoll() {
  stopBigMapClickOutsidePoll();
  bigMapClickOutsideArmed = false;

  bigMapClickPollTimer = setInterval(() => {
    if (!bigMapWindow || bigMapWindow.isDestroyed() || !bigMapWindow.isVisible()) return;
    if (!bigMapClickOutsideArmed) return;

    const down = isMouseLeftDown();
    if (down && !bigMapWasMouseDown) {
      const pt = screen.getCursorScreenPoint();
      if (!isPointInsideBigMap(pt.x, pt.y)) {
        void hideBigMap();
      }
    }
    bigMapWasMouseDown = down;
  }, 40);

  bigMapClickOutsideArmTimer = setTimeout(() => {
    bigMapClickOutsideArmTimer = null;
    bigMapClickOutsideArmed = true;
    bigMapWasMouseDown = isMouseLeftDown();
  }, CLICK_OUTSIDE_ARM_DELAY_MS);
}

function stopClickOutsidePoll() {
  if (clickPollTimer) {
    clearInterval(clickPollTimer);
    clickPollTimer = null;
  }
  if (clickOutsideArmTimer) {
    clearTimeout(clickOutsideArmTimer);
    clickOutsideArmTimer = null;
  }
  clickOutsideArmed = false;
  wasMouseDown = false;
}

function startClickOutsidePoll() {
  stopClickOutsidePoll();
  clickOutsideArmed = false;

  clickPollTimer = setInterval(() => {
    if (!shellWindow || shellWindow.isDestroyed() || !shellWindow.isVisible()) return;
    if (!clickOutsideArmed) return;

    const down = isMouseLeftDown();
    if (down && !wasMouseDown) {
      const pt = screen.getCursorScreenPoint();
      if (!isPointInsideShell(pt.x, pt.y)) {
        void hideShell();
      }
    }
    wasMouseDown = down;
  }, 40);

  clickOutsideArmTimer = setTimeout(() => {
    clickOutsideArmTimer = null;
    clickOutsideArmed = true;
    wasMouseDown = isMouseLeftDown();
  }, CLICK_OUTSIDE_ARM_DELAY_MS);
}

function ensureHotkeyWindowReady() {
  if (!hotkeyWindow || hotkeyWindow.isDestroyed()) return;
  if (!hotkeyWindow.isVisible()) {
    hotkeyWindow.showInactive();
  }
}

function createHotkeyWindow() {
  if (hotkeyWindow && !hotkeyWindow.isDestroyed()) return hotkeyWindow;

  hotkeyWindow = new BrowserWindow({
    width: 1,
    height: 1,
    x: -32000,
    y: -32000,
    show: false,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  hotkeyWindow.setIgnoreMouseEvents(true);
  hotkeyWindow.loadURL('data:text/html,<!DOCTYPE html><html><body></body></html>');
  hotkeyWindow.once('ready-to-show', () => {
    if (hotkeyWindow && !hotkeyWindow.isDestroyed()) {
      hotkeyWindow.showInactive();
    }
  });

  hotkeyWindow.on('closed', () => {
    hotkeyWindow = null;
  });

  return hotkeyWindow;
}

function createStartupWindow() {
  if (startupWindow && !startupWindow.isDestroyed()) {
    startupWindow.focus();
    return startupWindow;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  startupWindow = new BrowserWindow({
    width: 520,
    height: 420,
    x: Math.round((width - 520) / 2),
    y: Math.round((height - 420) / 2),
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    backgroundColor: '#061820',
    roundedCorners: true,
    hasShadow: true,
    thickFrame: false,
    icon: getWindowIcon(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  startupWindow.loadFile(path.join(__dirname, '..', 'renderer', 'startup', 'startup.html'));
  startupWindow.once('ready-to-show', () => startupWindow.show());
  startupWindow.on('closed', () => {
    startupWindow = null;
  });

  return startupWindow;
}

function setShellToggleHandler(handler) {
  onShellToggle = handler;
}

function setBigMapHiddenHandler(handler) {
  onBigMapHidden = handler;
}

function createShellWindow(options = {}) {
  const { showOnReady = true } = options;

  if (shellWindow && !shellWindow.isDestroyed()) {
    if (showOnReady) {
      showShell();
    }
    return shellWindow;
  }

  shellWindow = new BrowserWindow({
    width: 960,
    height: 640,
    frame: false,
    transparent: false,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#061820',
    roundedCorners: true,
    hasShadow: true,
    thickFrame: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  shellWindow.setAlwaysOnTop(true, 'screen-saver');

  shellWindow.on('show', () => {
    applyShellTaskbarHidden();
  });

  shellWindow.loadFile(path.join(__dirname, '..', 'renderer', 'shell', 'shell.html'));
  shellWindow.once('ready-to-show', () => {
    if (showOnReady) {
      showShell();
    }
  });
  shellWindow.on('closed', () => {
    stopClickOutsidePoll();
    shellWindow = null;
  });

  return shellWindow;
}

function createMinimapWindow() {
  if (minimapWindow && !minimapWindow.isDestroyed()) {
    return minimapWindow;
  }

  const { width, height } = getMinimapWindowMetrics();

  minimapWindow = new BrowserWindow({
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    thickFrame: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: getMinimapPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  minimapWindow.setAlwaysOnTop(true, 'screen-saver');
  minimapWindow.setIgnoreMouseEvents(true);

  minimapWindow.loadFile(
    path.join(__dirname, '..', 'renderer', 'features', 'minimap', 'minimap.html')
  );

  minimapWindow.webContents.once('did-finish-load', () => {
    syncMinimapRendererSize();
    if (!minimapWindow.isDestroyed() && !minimapWindow.isVisible()) {
      minimapWindow.hide();
    }
  });

  minimapWindow.on('closed', () => {
    minimapWindow = null;
  });

  return minimapWindow;
}

async function showMinimap() {
  if (!minimapWindow || minimapWindow.isDestroyed()) {
    createMinimapWindow();
  }

  await positionMinimapOverGame();
  applyMinimapTaskbarHidden();
  minimapWindow.show();
  applyMinimapTaskbarHidden();

  // Game window bounds can be wrong on first query; re-anchor after settle.
  setTimeout(() => {
    void positionMinimapOverGame();
  }, 600);
  setTimeout(() => {
    void positionMinimapOverGame();
  }, 2000);
}

function hideMinimap() {
  if (!minimapWindow || minimapWindow.isDestroyed()) return;
  minimapWindow.hide();
}

function isMinimapVisible() {
  return Boolean(minimapWindow && !minimapWindow.isDestroyed() && minimapWindow.isVisible());
}

function prepareMinimap() {
  if (!minimapWindow || minimapWindow.isDestroyed()) {
    createMinimapWindow();
  }
}

function applyBigMapTaskbarHidden() {
  if (!bigMapWindow || bigMapWindow.isDestroyed()) return;
  bigMapWindow.setSkipTaskbar(true);
  hideWindowFromTaskbar(bigMapWindow);
}

function createBigMapWindow(initialBounds = null) {
  if (bigMapWindow && !bigMapWindow.isDestroyed()) {
    return bigMapWindow;
  }

  const width = initialBounds?.width || 960;
  const height = initialBounds?.height || 640;
  const x = Number.isFinite(initialBounds?.x) ? initialBounds.x : undefined;
  const y = Number.isFinite(initialBounds?.y) ? initialBounds.y : undefined;

  bigMapWindow = new BrowserWindow({
    width,
    height,
    ...(Number.isFinite(x) && Number.isFinite(y) ? { x, y } : {}),
    frame: false,
    transparent: false,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    backgroundColor: '#061820',
    roundedCorners: true,
    hasShadow: true,
    thickFrame: false,
    webPreferences: {
      preload: getMinimapPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  bigMapWindow.setAlwaysOnTop(true, 'screen-saver');

  bigMapWindow.on('show', () => {
    applyBigMapTaskbarHidden();
  });

  bigMapWindow.loadFile(
    path.join(__dirname, '..', 'renderer', 'features', 'big-map', 'big-map.html'),
  );

  bigMapWindow.on('closed', () => {
    bigMapWindow = null;
    bigMapPreparePromise = null;
    bigMapContentReady = false;
  });

  return bigMapWindow;
}

function waitForBigMapLoad() {
  return new Promise((resolve) => {
    if (!bigMapWindow || bigMapWindow.isDestroyed()) {
      resolve();
      return;
    }

    if (!bigMapWindow.webContents.isLoading()) {
      resolve();
      return;
    }

    bigMapWindow.webContents.once('did-finish-load', () => resolve());
  });
}

async function waitForBigMapContentReady() {
  if (!bigMapWindow || bigMapWindow.isDestroyed()) return;

  try {
    await bigMapWindow.webContents.executeJavaScript(`
      (async () => {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const img = document.getElementById('bigMapImage');
          if (!img) {
            await new Promise((r) => setTimeout(r, 40));
            continue;
          }
          if (img.complete && img.naturalWidth > 0) return true;
          if (img.complete && !img.getAttribute('src')) return true;
          await new Promise((r) => setTimeout(r, 40));
        }
        return false;
      })()
    `);
  } catch {
    // World map can still open if warm up timing fails.
  }
}

function computeBigMapBounds(anchor) {
  const width = Math.max(720, Math.round(anchor.width * 0.88));
  const height = Math.max(480, Math.round(anchor.height * 0.88));
  const x = Math.round(anchor.x + (anchor.width - width) / 2);
  const y = Math.round(anchor.y + (anchor.height - height) / 2);
  return { x, y, width, height };
}

async function positionBigMapOverGame() {
  if (!bigMapWindow || bigMapWindow.isDestroyed()) return;

  const anchor = await getMinimapAnchorArea();
  const bounds = computeBigMapBounds(anchor);
  const wasVisible = bigMapWindow.isVisible();
  bigMapWindow.setBounds(bounds);
  if (!wasVisible) {
    bigMapWindow.hide();
  }
}

async function showBigMap() {
  // First open may wait for warm up. Later opens only reposition and show.
  await prepareBigMap();

  if (isShellVisible()) {
    await hideShell();
  }

  await positionBigMapOverGame();
  applyBigMapTaskbarHidden();

  releaseGameInputCapture();
  showSystemCursor();
  bigMapWindow.show();
  forceWindowFocus(bigMapWindow);
  applyBigMapTaskbarHidden();
  startBigMapClickOutsidePoll();
  setTimeout(() => {
    if (!bigMapWindow || bigMapWindow.isDestroyed()) return;
    forceWindowFocus(bigMapWindow);
    applyBigMapTaskbarHidden();
  }, 80);
}

async function hideBigMap() {
  if (!bigMapWindow || bigMapWindow.isDestroyed()) return;
  stopBigMapClickOutsidePoll();
  bigMapWindow.hide();
  if (typeof onBigMapHidden === 'function') {
    try {
      onBigMapHidden();
    } catch {
      // ignore resume hook errors
    }
  }
  await returnFocusToGame();
}

async function toggleBigMap() {
  if (!bigMapWindow || bigMapWindow.isDestroyed()) {
    await showBigMap();
    return;
  }

  if (bigMapWindow.isVisible()) {
    await hideBigMap();
  } else {
    await showBigMap();
  }
}

function isBigMapVisible() {
  return Boolean(bigMapWindow && !bigMapWindow.isDestroyed() && bigMapWindow.isVisible());
}

async function prepareBigMap() {
  if (bigMapPreparePromise) {
    return bigMapPreparePromise;
  }

  if (bigMapContentReady && bigMapWindow && !bigMapWindow.isDestroyed()) {
    return;
  }

  bigMapPreparePromise = (async () => {
    const anchor = await getMinimapAnchorArea();
    const bounds = computeBigMapBounds(anchor);

    if (!bigMapWindow || bigMapWindow.isDestroyed()) {
      createBigMapWindow(bounds);
      bigMapContentReady = false;
    } else {
      const wasVisible = bigMapWindow.isVisible();
      bigMapWindow.setBounds(bounds);
      if (!wasVisible) {
        bigMapWindow.hide();
      }
    }

    await waitForBigMapLoad();
    await positionBigMapOverGame();
    await waitForBigMapContentReady();
    bigMapContentReady = true;
    applyBigMapTaskbarHidden();
  })();

  try {
    await bigMapPreparePromise;
  } finally {
    bigMapPreparePromise = null;
  }
}

async function returnFocusToGame() {
  const handle = await getGameWindowHandle();
  if (!handle) return false;
  return focusExternalWindowHandle(handle);
}

async function showShell() {
  if (!shellWindow || shellWindow.isDestroyed()) return;

  await positionShellOverGame();
  applyShellTaskbarHidden();

  releaseGameInputCapture();
  showSystemCursor();
  shellWindow.show();
  forceWindowFocus(shellWindow);
  applyShellTaskbarHidden();
  setTimeout(() => {
    forceWindowFocus(shellWindow);
    applyShellTaskbarHidden();
  }, 80);

  startClickOutsidePoll();
}

async function hideShell() {
  if (!shellWindow || shellWindow.isDestroyed()) return;
  stopClickOutsidePoll();
  shellWindow.hide();
  await returnFocusToGame();
}

async function toggleShell() {
  if (!shellWindow || shellWindow.isDestroyed()) {
    createShellWindow({ showOnReady: true });
    return;
  }
  if (shellWindow.isVisible()) {
    await hideShell();
  } else {
    await showShell();
  }
}

function isShellVisible() {
  return shellWindow && !shellWindow.isDestroyed() && shellWindow.isVisible();
}

function closeStartupWindow() {
  if (startupWindow && !startupWindow.isDestroyed()) {
    startupWindow.close();
  }
}

function getHotkeyWindow() {
  return hotkeyWindow && !hotkeyWindow.isDestroyed() ? hotkeyWindow : null;
}

function destroyAllWindows() {
  stopOverlayAwayWatch();
  stopClickOutsidePoll();
  stopBigMapClickOutsidePoll();
  unregisterAllHotkeys();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.destroy();
  }
  startupWindow = null;
  shellWindow = null;
  minimapWindow = null;
  bigMapWindow = null;
  bigMapPreparePromise = null;
  bigMapContentReady = false;
  hotkeyWindow = null;
  versionOverlayWindow = null;
}

function getStartupWindow() {
  return startupWindow;
}

function getShellWindow() {
  return shellWindow;
}

function getMinimapWindow() {
  return minimapWindow;
}

function getBigMapWindow() {
  return bigMapWindow;
}

module.exports = {
  createStartupWindow,
  createHotkeyWindow,
  createShellWindow,
  createMinimapWindow,
  createBigMapWindow,
  closeStartupWindow,
  showShell,
  hideShell,
  showMinimap,
  hideMinimap,
  positionMinimapOverGame,
  isMinimapVisible,
  prepareMinimap,
  prepareVersionOverlay,
  showVersionOverlay,
  hideVersionOverlay,
  positionVersionOverlayOverGame,
  startOverlayAwayWatch,
  stopOverlayAwayWatch,
  showBigMap,
  hideBigMap,
  toggleBigMap,
  isBigMapVisible,
  prepareBigMap,
  toggleShell,
  isShellVisible,
  destroyAllWindows,
  setShellToggleHandler,
  setBigMapHiddenHandler,
  getStartupWindow,
  getShellWindow,
  getMinimapWindow,
  getBigMapWindow,
  getHotkeyWindow,
  ensureHotkeyWindowReady,
  applyMinimapSize,
  getMinimapSizeState,
};
