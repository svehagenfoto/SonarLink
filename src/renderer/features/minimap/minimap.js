/**
 * SonarLink minimap feature module.
 * Rotating map with fixed cyan arrow. SonarLink logo when not in world.
 */

const SESSION_CHECK_MS = 3000;
const GAME_EXIT_IDLE_MS = 15000;
const SUSTAINED_INACTIVE_IDLE_MS = 2500;
const SUSTAINED_INACTIVE_SESSION_MS = 12000;
const POSITION_SMOOTH_MS = 480;
const ROTATION_SMOOTH_MS = 420;
const FOG_SAVE_DEBOUNCE_MS = 2500;
const FOG_SAVE_INTERVAL_MS = 20000;

let telemetryUnsubscribe = null;
let fogSaveUnsubscribe = null;
let sessionWatchTimer = null;
let fogSaveTimer = null;
let fogSaveInterval = null;
let smoothController = null;
let fogController = null;
let currentSaveFile = null;
let currentSaveId = null;
let fogDiskLoadedForSaveId = null;
let lastTelemetryForSave = null;

function loadImage(image, url) {
  return new Promise((resolve, reject) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', reject, { once: true });
    image.src = url;
  });
}

function hasLivePosition(telemetry) {
  return (
    telemetry &&
    telemetry.active === true &&
    Number.isFinite(telemetry.x) &&
    Number.isFinite(telemetry.y)
  );
}

function getInactiveIdleThresholdMs() {
  return currentSaveFile ? SUSTAINED_INACTIVE_SESSION_MS : SUSTAINED_INACTIVE_IDLE_MS;
}

function updateSavePendingState(root, telemetry = null) {
  if (!window.SonarMapSavePending) return;

  const live = root.dataset.state === 'live';
  let saveFile = currentSaveFile;

  if (telemetry !== null) {
    if (telemetry.saveFile) {
      currentSaveFile = telemetry.saveFile;
      saveFile = telemetry.saveFile;
    } else {
      saveFile = currentSaveFile;
    }
  }

  window.SonarMapSavePending.applySavePendingState(root, {
    live,
    saveFile,
  });
}

function shouldShowIdleAfterInactive(root) {
  const now = Date.now();
  if (!root.dataset.inactiveSince) {
    root.dataset.inactiveSince = String(now);
    return false;
  }

  return now - Number(root.dataset.inactiveSince) >= getInactiveIdleThresholdMs();
}

function clearInactiveTracking(root) {
  root.removeAttribute('data-inactive-since');
}

function pushFogSessionToMain() {
  if (!fogController || !window.sonarMinimapApi?.pushMapFogSession) return;

  window.sonarMinimapApi.pushMapFogSession({
    saveFile: currentSaveFile,
    fog: fogController.exportState(),
  });
}

function clearFogSessionOnMain() {
  window.sonarMinimapApi?.clearMapFogSession?.();
}

function clearFogSaveTimer() {
  if (fogSaveTimer) {
    clearTimeout(fogSaveTimer);
    fogSaveTimer = null;
  }
}

function stopFogSaveInterval() {
  if (fogSaveInterval) {
    clearInterval(fogSaveInterval);
    fogSaveInterval = null;
  }
}

function rememberTelemetryForSave(telemetry) {
  if (telemetry?.saveFile && hasLivePosition(telemetry)) {
    lastTelemetryForSave = telemetry;
  }
}

function maybeStartFogSaveInterval() {
  if (!currentSaveId || !currentSaveFile) {
    stopFogSaveInterval();
    return;
  }

  if (fogSaveInterval) return;

  fogSaveInterval = setInterval(() => {
    if (!currentSaveId || !fogController?.hasExploredArea()) return;
    if (!lastTelemetryForSave?.saveFile) return;
    flushFogSave(lastTelemetryForSave);
  }, FOG_SAVE_INTERVAL_MS);
}

function getTelemetryForFogFlush() {
  if (lastTelemetryForSave?.saveFile) {
    return lastTelemetryForSave;
  }

  if (!currentSaveFile) return null;

  return {
    saveFile: currentSaveFile,
    saveLabel: currentSaveFile,
  };
}

async function flushFogSaveIfNeeded() {
  if (!fogController || !currentSaveId || !fogController.hasExploredArea()) {
    return;
  }

  const telemetry = getTelemetryForFogFlush();
  if (!telemetry?.saveFile) return;

  clearFogSaveTimer();
  await flushFogSave(telemetry);
}

async function flushFogSave(telemetry) {
  if (!fogController || !currentSaveId || !telemetry?.saveFile) return;

  const state = fogController.exportState();
  await window.sonarMinimapApi.saveMapFogSave(currentSaveId, {
    saveLabel: telemetry.saveLabel || currentSaveFile,
    revealed: state.revealed,
    exploredPercent: state.exploredPercent,
    gridWidth: state.gridWidth,
    gridHeight: state.gridHeight,
  });
}

function scheduleFogSave(telemetry) {
  if (!currentSaveId || !telemetry?.saveFile) return;

  clearFogSaveTimer();
  fogSaveTimer = setTimeout(() => {
    fogSaveTimer = null;
    flushFogSave(telemetry);
  }, FOG_SAVE_DEBOUNCE_MS);
}

async function syncFogFromDisk(telemetry, view) {
  if (!fogController || !telemetry?.saveFile || !window.sonarMinimapApi?.resolveMapSaveId) {
    return;
  }

  const saveId = await window.sonarMinimapApi.resolveMapSaveId(telemetry);
  if (!saveId) return;

  const previousSaveFile = currentSaveFile;
  const saveFileChanged = Boolean(
    telemetry.saveFile && telemetry.saveFile !== previousSaveFile,
  );
  currentSaveId = saveId;

  const needsDiskSync = saveFileChanged || fogDiskLoadedForSaveId !== saveId;
  if (!needsDiskSync) return;

  const record = await window.sonarMinimapApi.getMapFogSave(saveId, {
    saveSlot: telemetry.saveSlot,
    saveLabel: telemetry.saveLabel,
  });

  const diskFog = record?.revealed
    ? {
        gridWidth: record.gridWidth,
        gridHeight: record.gridHeight,
        revealed: record.revealed,
      }
    : null;

  const isFirstSaveConfirm = !previousSaveFile;

  if (diskFog && isFirstSaveConfirm && fogController.hasExploredArea()) {
    fogController.mergeState(diskFog);
    void flushFogSave(telemetry);
  } else if (diskFog) {
    fogController.importState(diskFog);
  } else if (!(isFirstSaveConfirm && fogController.hasExploredArea())) {
    fogController.reset();
  }

  fogController.clearMovementHistory();
  fogDiskLoadedForSaveId = saveId;

  pushFogSessionToMain();
  scheduleFogSave(telemetry);
  maybeStartFogSaveInterval();
}

async function showIdleState(root) {
  await flushFogSaveIfNeeded();
  clearInactiveTracking(root);
  clearFogSaveTimer();
  stopFogSaveInterval();
  smoothController?.endLive();
  fogController?.reset();
  clearFogSessionOnMain();
  currentSaveFile = null;
  currentSaveId = null;
  fogDiskLoadedForSaveId = null;
  lastTelemetryForSave = null;
  root.dataset.state = 'idle';
  root.dataset.hasPlayer = 'false';
  updateSavePendingState(root);
}

async function applyLiveTelemetry(root, core, mapLayer, mapImage, telemetry) {
  const view = window.SonarMapView.buildViewFromTelemetry(telemetry);
  if (!view) return;

  rememberTelemetryForSave(telemetry);

  if (root.dataset.state !== 'live') {
    const effectiveSaveFile = telemetry.saveFile || currentSaveFile;
    if (!effectiveSaveFile) {
      fogController?.reset();
      fogController?.clearMovementHistory();
      clearFogSessionOnMain();
      currentSaveId = null;
      fogDiskLoadedForSaveId = null;
    }
    smoothController?.beginLive(view);
    root.dataset.state = 'live';
    root.dataset.hasPlayer = 'true';
  } else {
    smoothController?.updateTarget(view);
  }

  if (telemetry.saveFile) {
    await syncFogFromDisk(telemetry, view);
    currentSaveFile = telemetry.saveFile;
    maybeStartFogSaveInterval();
  }

  updateSavePendingState(root, telemetry);

  requestAnimationFrame(() => {
    if (fogController?.commitReveal(telemetry, view)) {
      pushFogSessionToMain();
      scheduleFogSave(telemetry);
    }
  });
}

async function handleTelemetry(root, core, mapLayer, mapImage, telemetry) {
  if (telemetry?.active === false) {
    // Vehicle / respawn blips: keep map and fog while save session is active.
    if (root.dataset.state === 'live' && currentSaveFile) {
      return;
    }

    if (shouldShowIdleAfterInactive(root)) {
      await showIdleState(root);
    }
    return;
  }

  clearInactiveTracking(root);

  if (!hasLivePosition(telemetry)) {
    return;
  }

  await applyLiveTelemetry(root, core, mapLayer, mapImage, telemetry);
}

async function syncSessionState(root, core, mapLayer, mapImage) {
  if (!window.sonarMinimapApi?.getMinimapSessionState) return;

  const session = await window.sonarMinimapApi.getMinimapSessionState();
  const { gameRunning, telemetry } = session;

  if (telemetry?.active === false) {
    if (shouldShowIdleAfterInactive(root)) {
      await showIdleState(root);
    }
    return;
  }

  clearInactiveTracking(root);

  if (!gameRunning) {
    if (root.dataset.state === 'live') {
      const lastLiveAt = Number(root.dataset.lastLiveAt || 0);
      if (!lastLiveAt || Date.now() - lastLiveAt > GAME_EXIT_IDLE_MS) {
        await showIdleState(root);
      }
    }
    return;
  }

  if (hasLivePosition(telemetry)) {
    await applyLiveTelemetry(root, core, mapLayer, mapImage, telemetry);
    root.dataset.lastLiveAt = String(Date.now());
  }
}

function startSessionWatch(root, core, mapLayer, mapImage) {
  if (sessionWatchTimer) {
    clearInterval(sessionWatchTimer);
  }

  sessionWatchTimer = setInterval(() => {
    syncSessionState(root, core, mapLayer, mapImage);
  }, SESSION_CHECK_MS);
}

function bindFogDeletedHandler() {
  if (!window.sonarMinimapApi?.onMapFogDeleted) return;

  if (fogSaveUnsubscribe) {
    fogSaveUnsubscribe();
    fogSaveUnsubscribe = null;
  }

  fogSaveUnsubscribe = window.sonarMinimapApi.onMapFogDeleted((saveId) => {
    if (!saveId || saveId !== currentSaveId || !fogController) return;
    fogController.reset();
    fogController.clearMovementHistory();
    pushFogSessionToMain();
  });
}

function bindTelemetry(root, core, mapLayer, mapImage) {
  if (!window.sonarMinimapApi?.onMapTelemetryUpdate) return;

  if (telemetryUnsubscribe) {
    telemetryUnsubscribe();
    telemetryUnsubscribe = null;
  }

  telemetryUnsubscribe = window.sonarMinimapApi.onMapTelemetryUpdate(async (telemetry) => {
    await handleTelemetry(root, core, mapLayer, mapImage, telemetry);
    if (hasLivePosition(telemetry)) {
      root.dataset.lastLiveAt = String(Date.now());
    }
  });
}

function applyMinimapVisualSize(size) {
  if (!Number.isFinite(size) || size <= 0) return;
  document.documentElement.style.setProperty('--minimap-size', `${Math.round(size)}px`);
}

async function initMinimap() {
  const root = document.getElementById('sonarMinimap');
  if (!root) return;

  const core = root.querySelector('.sonar-minimap-core');
  const mapLayer = root.querySelector('.sonar-minimap-map-layer');
  const mapImage = root.querySelector('.sonar-minimap-map-image');
  const idleImage = root.querySelector('.sonar-minimap-idle-image');

  if (!core || !mapLayer || !mapImage || !idleImage || !window.sonarMinimapApi) {
    root.dataset.state = 'empty';
    return;
  }

  await showIdleState(root);

  try {
    const idleUrl = await window.sonarMinimapApi.getIdleImageUrl();
    if (!idleUrl) {
      root.dataset.state = 'empty';
      return;
    }

    await loadImage(idleImage, idleUrl);

    const mapUrl = await window.sonarMinimapApi.getMapImageUrl();
    if (mapUrl) {
      await loadImage(mapImage, mapUrl);
    }

    fogController = window.SonarMapFog.createFogController({
      core,
      mapLayer,
    });

    smoothController = window.SonarMapSmooth.createMapSmoothController({
      core,
      mapLayer,
      mapImage,
      fogController,
      positionSmoothMs: POSITION_SMOOTH_MS,
      rotationSmoothMs: ROTATION_SMOOTH_MS,
    });

    bindTelemetry(root, core, mapLayer, mapImage);
    bindFogDeletedHandler();
    if (window.sonarMinimapApi?.onMinimapSizeUpdate) {
      window.sonarMinimapApi.onMinimapSizeUpdate(({ size }) => {
        applyMinimapVisualSize(size);
      });
    }
    startSessionWatch(root, core, mapLayer, mapImage);
    await syncSessionState(root, core, mapLayer, mapImage);
    if (fogController?.hasExploredArea?.()) {
      pushFogSessionToMain();
    }
  } catch {
    smoothController?.stop();
    smoothController = null;
    fogController?.destroy();
    fogController = null;
    mapImage.removeAttribute('src');
    idleImage.removeAttribute('src');
    root.dataset.state = 'empty';
  }
}

window.SonarMinimap = {
  init: initMinimap,
};
