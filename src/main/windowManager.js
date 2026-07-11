const { BrowserWindow, screen, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { assetPath } = require('./paths');
const { getGameWindowBounds } = require('./gameWindow');
const {
  hideWindowFromTaskbar,
  unregisterAllHotkeys,
  isMouseLeftDown,
} = require('./win32');

let startupWindow = null;
let shellWindow = null;
let hotkeyWindow = null;
let clickPollTimer = null;
let clickOutsideArmed = false;
let wasMouseDown = false;
let onShellToggle = null;

const CLICK_OUTSIDE_ARM_DELAY_MS = 500;

function getPreloadPath() {
  return path.join(__dirname, '..', 'preload', 'preload.js');
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

function stopClickOutsidePoll() {
  if (clickPollTimer) {
    clearInterval(clickPollTimer);
    clickPollTimer = null;
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
        hideShell();
      }
    }
    wasMouseDown = down;
  }, 40);

  setTimeout(() => {
    clickOutsideArmed = true;
    wasMouseDown = isMouseLeftDown();
  }, CLICK_OUTSIDE_ARM_DELAY_MS);
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

async function showShell() {
  if (!shellWindow || shellWindow.isDestroyed()) return;

  await positionShellOverGame();
  applyShellTaskbarHidden();
  shellWindow.show();
  applyShellTaskbarHidden();
  shellWindow.focus();
  applyShellTaskbarHidden();
  setTimeout(() => applyShellTaskbarHidden(), 100);
  startClickOutsidePoll();
}

function hideShell() {
  if (!shellWindow || shellWindow.isDestroyed()) return;
  stopClickOutsidePoll();
  shellWindow.hide();
}

async function toggleShell() {
  if (!shellWindow || shellWindow.isDestroyed()) {
    createShellWindow({ showOnReady: true });
    return;
  }
  if (shellWindow.isVisible()) {
    hideShell();
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
  stopClickOutsidePoll();
  unregisterAllHotkeys();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.destroy();
  }
  startupWindow = null;
  shellWindow = null;
  hotkeyWindow = null;
}

function getStartupWindow() {
  return startupWindow;
}

function getShellWindow() {
  return shellWindow;
}

module.exports = {
  createStartupWindow,
  createHotkeyWindow,
  createShellWindow,
  closeStartupWindow,
  showShell,
  hideShell,
  toggleShell,
  isShellVisible,
  destroyAllWindows,
  setShellToggleHandler,
  getStartupWindow,
  getShellWindow,
  getHotkeyWindow,
};
