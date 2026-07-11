// TEMP DEV SHORTCUTS
// Remove this file and every "TEMP DEV" block when UI dev is done.

let deps = null;
let sessionActive = false;

function init(dependencies) {
  deps = dependencies;
}

function beginSession() {
  sessionActive = true;
  if (deps?.windows?.setDevTempDisableClickOutside) {
    deps.windows.setDevTempDisableClickOutside(true);
  }
}

function isSessionActive() {
  return sessionActive;
}

async function skipToMenu() {
  if (!deps) {
    return { ok: false };
  }

  beginSession();

  const {
    windows,
    waitForShellVisible,
    getStopWatch,
    setStopWatch,
    setStartupComplete,
    setLaunched,
    prepareShell,
    registerShellHomeHotkey,
    notifyThirdPersonCameraState,
  } = deps;

  setStartupComplete(true);
  setLaunched(true);

  const stopWatch = getStopWatch();
  if (stopWatch) {
    stopWatch();
    setStopWatch(null);
  }

  prepareShell();
  registerShellHomeHotkey();
  notifyThirdPersonCameraState();

  let shell = windows.getShellWindow();
  if (!shell || shell.isDestroyed()) {
    windows.createShellWindow({ showOnReady: false });
    shell = windows.getShellWindow();
  }

  if (!shell || shell.isDestroyed()) {
    return { ok: false };
  }

  await windows.showShell();
  await waitForShellVisible(shell);
  windows.closeStartupWindow();
  return { ok: true };
}

module.exports = {
  init,
  skipToMenu,
  isSessionActive,
};
