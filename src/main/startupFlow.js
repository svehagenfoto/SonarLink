const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const {
  readConfig,
  updateConfig,
  initDataRootIfNeeded,
  initDataRootFromPicker,
  getDataRoot,
  setDataRoot,
} = require('./configStore');
const { detectSubnauticaWin64Dir } = require('./steamDetect');
const { DEPENDENCIES } = require('./dependencyManifest');
const {
  checkAllDependencies,
  repairDependencies,
  syncVerifiedInstallations,
  withInstalledVersions,
  sleep,
} = require('./dependencyManager');
const { isSubnauticaRunning } = require('./processWatch');
const { getCommandsFile } = require('./gameBridge');
const { isDataRootValid } = require('./dataRoot');

const INSTALL_RETRY_LIMIT = 3;
const INSTALL_RETRY_DELAY_MS = 3000;

let folderResolver = null;
let skipGameRestartRequested = false;
let activeDataRootPath = null;

function requestSkipGameRestart() {
  skipGameRestartRequested = true;
}

function isSkipGameRestartRequested() {
  return skipGameRestartRequested;
}

function resetSkipGameRestart() {
  skipGameRestartRequested = false;
}

function folderDetail(dataRoot) {
  if (!dataRoot) return null;
  return `Using: ${dataRoot}`;
}

function sendUpdate(startupWindow, payload) {
  if (!startupWindow || startupWindow.isDestroyed()) return;
  startupWindow.webContents.send('startup-update', {
    dataRootPath: activeDataRootPath,
    ...payload,
  });
}

function writeStartupLog(message) {
  try {
    const dataRoot = getDataRoot();
    if (!dataRoot) return;
    const logPath = path.join(dataRoot, 'logs', 'startup.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch {
    /* ignore */
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function waitForDataFolder() {
  return new Promise((resolve) => {
    folderResolver = resolve;
  });
}

function resolveDataFolder(folderPath) {
  if (folderResolver) {
    folderResolver(folderPath || null);
    folderResolver = null;
  }
}

async function openDataFolderDialog(startupWindow) {
  const result = await dialog.showOpenDialog(startupWindow, {
    title: 'Select SonarLink folder location',
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return null;
  }

  return result.filePaths[0];
}

async function waitForGameClose(startupWindow) {
  if (skipGameRestartRequested) return;
  if (!(await isSubnauticaRunning())) return;

  sendUpdate(startupWindow, {
    status: 'CLOSE SUBNAUTICA 2',
    detail: 'Close the game completely so SonarLink can install mod files into the game folder.',
    progress: null,
    showFolderPicker: false,
    showReset: false,
  });

  while (await isSubnauticaRunning()) {
    if (skipGameRestartRequested) return;
    await sleep(800);
  }

  await sleep(1200);
}

async function waitForGameStart(startupWindow) {
  if (skipGameRestartRequested) return;

  sendUpdate(startupWindow, {
    status: 'WAITING FOR SUBNAUTICA 2',
    detail: 'Start Subnautica 2 from Steam. SonarLink connects when the game is running.',
    progress: null,
    showFolderPicker: false,
    showReset: false,
  });

  while (!(await isSubnauticaRunning())) {
    if (skipGameRestartRequested) return;
    await sleep(800);
  }

  await sleep(1200);
}

function formatInstallError(err) {
  const message = err?.message || 'Unknown install error';

  if (message.includes('timed out')) {
    return 'UE4SS download timed out. Check your internet connection and close SonarLink, then open it again.';
  }
  if (message.includes('Download failed')) {
    return 'UE4SS download failed. Check your internet connection and close SonarLink, then open it again.';
  }
  if (message.includes('not a valid zip')) {
    return 'The UE4SS download was corrupted. Close SonarLink and open it again to download fresh files.';
  }
  if (message.includes('Bundled mod missing')) {
    return 'SonarLink mod files are missing from this install. Download SonarLink again from the official source.';
  }
  if (message.includes('GAME_FILES_LOCKED') || message.includes('EBUSY') || message.includes('EPERM')) {
    return 'Game files are locked. Close Subnautica 2 completely, then close SonarLink and open it again.';
  }
  if (message.includes('verification failed') || message.includes('still missing')) {
    return 'Install did not complete. Close Subnautica 2, then close SonarLink and open it again.';
  }

  return message
    .replace(/^INSTALL_FAILED:/, '')
    .replace(/^Install verification failed:\s*/i, 'Install verification failed. ');
}

async function installDependenciesOnce(startupWindow, config, gameWin64Dir, depsToInstall) {
  await waitForGameClose(startupWindow);

  sendUpdate(startupWindow, {
    status: 'DOWNLOADING UE4SS',
    detail: 'Downloading UE4SS. Do not close SonarLink. This may take a minute.',
    progress: 0,
    showFolderPicker: false,
    showReset: false,
  });

  const wasRunning = await isSubnauticaRunning();

  const repairResult = await repairDependencies(depsToInstall, {
    dataRoot: getDataRoot(),
    gameWin64Dir,
    onStatus: (status) => {
      const detailByStatus = {
        'INSTALLING UE4SS': 'Installing UE4SS into your Subnautica 2 folder.',
        'INSTALLING SONARLINK MOD': 'Installing the SonarLink mod.',
      };
      sendUpdate(startupWindow, {
        status,
        detail: detailByStatus[status] || 'Installing required game components.',
        progress: null,
        showFolderPicker: false,
        showReset: false,
      });
    },
    onProgress: (value) => {
      const progress = Math.max(0, Math.min(1, value));
      sendUpdate(startupWindow, {
        status: progress >= 0.99 ? 'INSTALLING FILES' : 'DOWNLOADING UE4SS',
        detail: 'Installing required game components.',
        progress,
        showFolderPicker: false,
        showReset: false,
      });
    },
  });

  writePathsBridge(gameWin64Dir);

  const postCheck = checkAllDependencies(withInstalledVersions(config, depsToInstall), gameWin64Dir);
  if (postCheck.needsWork) {
    const details = [
      ...postCheck.missing.map((dep) => `missing:${dep.id}`),
      ...postCheck.outdated.map((dep) => `outdated:${dep.id}`),
    ].join(', ');
    throw new Error(`INSTALL_FAILED:Required files are still missing after install (${details})`);
  }

  sendUpdate(startupWindow, {
    status: 'INSTALL COMPLETE',
    detail: 'All required files are installed.',
    progress: 1,
    showFolderPicker: false,
    showReset: false,
  });

  let nextConfig = updateConfig({
    installed: withInstalledVersions(config, depsToInstall).installed,
    gameWin64Dir,
    downloadConsent: true,
  });

  if (repairResult.requiresRestart && wasRunning) {
    await waitForGameClose(startupWindow);
    await waitForGameStart(startupWindow);
  }

  return nextConfig;
}

async function installDependenciesWithRetry(startupWindow, config, gameWin64Dir, depsToInstall) {
  let lastError = null;

  for (let attempt = 1; attempt <= INSTALL_RETRY_LIMIT; attempt += 1) {
    try {
      return await installDependenciesOnce(startupWindow, config, gameWin64Dir, depsToInstall);
    } catch (err) {
      lastError = err;
      writeStartupLog(`Install attempt ${attempt} failed: ${err?.message || err}`);

      if (err?.code === 'EBUSY' || err?.code === 'EPERM') {
        throw new Error('GAME_FILES_LOCKED');
      }

      if (attempt < INSTALL_RETRY_LIMIT) {
        sendUpdate(startupWindow, {
          status: 'RETRYING INSTALL',
          detail: `Install attempt ${attempt} failed. Retrying automatically...`,
          progress: null,
          showFolderPicker: false,
          showReset: false,
        });
        await sleep(INSTALL_RETRY_DELAY_MS);
      }
    }
  }

  throw lastError || new Error('INSTALL_FAILED:Install failed');
}

async function ensureDataRoot(startupWindow) {
  let dataRoot = initDataRootIfNeeded();
  if (dataRoot) {
    activeDataRootPath = dataRoot;
    return dataRoot;
  }

  sendUpdate(startupWindow, {
    status: 'SELECT SONARLINK FOLDER',
    detail: 'Choose where SonarLink should store all files. A SonarLink folder will be created inside the location you pick.',
    progress: null,
    showFolderPicker: true,
    showReset: false,
  });

  let picked = await waitForDataFolder();
  while (!picked) {
    picked = await waitForDataFolder();
  }

  dataRoot = initDataRootFromPicker(picked);
  if (!dataRoot) {
    throw new Error('DATA_FOLDER_INVALID');
  }

  activeDataRootPath = dataRoot;
  return dataRoot;
}

async function runStartupFlow(startupWindow) {
  resetSkipGameRestart();
  activeDataRootPath = null;

  sendUpdate(startupWindow, {
    status: 'CHECKING',
    detail: 'Starting SonarLink...',
    progress: null,
    showFolderPicker: false,
    showReset: true,
  });

  await ensureDataRoot(startupWindow);

  sendUpdate(startupWindow, {
    status: 'CHECKING',
    detail: folderDetail(activeDataRootPath),
    progress: null,
    showFolderPicker: false,
    showReset: true,
  });

  let config = readConfig();

  sendUpdate(startupWindow, {
    status: 'CHECKING',
    detail: 'Searching for Subnautica 2 on this PC...',
    progress: null,
    showFolderPicker: false,
    showReset: true,
  });

  let gameWin64Dir = config.gameWin64Dir;
  if (!gameWin64Dir || !fs.existsSync(path.join(gameWin64Dir, 'Subnautica2-Win64-Shipping.exe'))) {
    gameWin64Dir = await detectSubnauticaWin64Dir();
    if (!gameWin64Dir) {
      throw new Error('GAME_NOT_FOUND');
    }
    config = updateConfig({ gameWin64Dir });
  }

  writePathsBridge(gameWin64Dir);

  const synced = syncVerifiedInstallations(config, gameWin64Dir);
  if (synced !== config) {
    config = updateConfig({ installed: synced.installed });
  }

  sendUpdate(startupWindow, {
    status: 'CHECKING',
    detail: 'Checking if required mod files are installed...',
    progress: null,
    showFolderPicker: false,
    showReset: true,
  });

  const check = checkAllDependencies(config, gameWin64Dir);
  const depOrder = DEPENDENCIES.map((dep) => dep.id);
  const depsToInstall = [...check.missing, ...check.outdated].sort(
    (a, b) => depOrder.indexOf(a.id) - depOrder.indexOf(b.id),
  );

  if (depsToInstall.length > 0) {
    try {
      config = await installDependenciesWithRetry(startupWindow, config, gameWin64Dir, depsToInstall);
    } catch (err) {
      const code = err?.message || 'INSTALL_FAILED';
      if (code === 'GAME_FILES_LOCKED') {
        throw new Error('GAME_FILES_LOCKED');
      }
      throw new Error(`INSTALL_FAILED:${formatInstallError(err)}`);
    }
  }

  const finalCheck = checkAllDependencies(config, gameWin64Dir);
  if (finalCheck.needsWork) {
    throw new Error('INSTALL_FAILED:Required files are still missing after install');
  }

  writePathsBridge(gameWin64Dir);

  const gameReady = await isSubnauticaRunning();

  if (!gameReady) {
    await waitForGameStart(startupWindow);
  } else {
    sendUpdate(startupWindow, {
      status: 'SUBNAUTICA 2 DETECTED',
      detail: 'SonarLink is ready.',
      progress: null,
      showFolderPicker: false,
      showReset: true,
    });
  }

  writePathsBridge(gameWin64Dir);
  return { config, gameReady: true, dataRoot: activeDataRootPath };
}

function writePathsBridge(gameWin64Dir) {
  const dataRoot = getDataRoot();
  const bridge = {
    dataRoot,
    gameWin64Dir,
    commandsFile: getCommandsFile(),
  };

  fs.writeFileSync(path.join(dataRoot, 'paths.json'), JSON.stringify(bridge, null, 2), 'utf8');

  const modBridgePath = path.join(
    gameWin64Dir,
    'ue4ss',
    'Mods',
    'SonarLinkBridge',
    'sonarlink.paths.json',
  );
  const modBridgeScriptsPath = path.join(
    gameWin64Dir,
    'ue4ss',
    'Mods',
    'SonarLinkBridge',
    'Scripts',
    'sonarlink.paths.json',
  );
  const payload = JSON.stringify(bridge, null, 2);
  ensureDir(path.dirname(modBridgePath));
  fs.writeFileSync(modBridgePath, payload, 'utf8');
  ensureDir(path.dirname(modBridgeScriptsPath));
  fs.writeFileSync(modBridgeScriptsPath, payload, 'utf8');
}

function prepareForRerun() {
  activeDataRootPath = getDataRoot();
  if (activeDataRootPath && isDataRootValid(activeDataRootPath)) {
    setDataRoot(activeDataRootPath);
    return;
  }
  activeDataRootPath = null;
  setDataRoot(null);
}

module.exports = {
  runStartupFlow,
  resolveDataFolder,
  openDataFolderDialog,
  requestSkipGameRestart,
  isSkipGameRestartRequested,
  prepareForRerun,
  DEPENDENCIES,
};
