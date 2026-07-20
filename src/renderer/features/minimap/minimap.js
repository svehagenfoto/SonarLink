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
let markerLayer = null;
let currentMarkers = [];
let currentSaveFile = null;
let currentSaveId = null;
let fogDiskLoadedForSaveId = null;
let lastTelemetryForSave = null;
let fogOpGeneration = 0;
let minimapTaskChain = Promise.resolve();
let markersUnsubscribe = null;
let waypointUnsubscribe = null;
let markersAppliedAt = 0;

function bumpFogGeneration() {
  fogOpGeneration += 1;
  return fogOpGeneration;
}

function enqueueMinimapTask(task) {
  minimapTaskChain = minimapTaskChain
    .then(() => task())
    .catch(() => {});
  return minimapTaskChain;
}

function isFogGenerationCurrent(generation) {
  return generation === fogOpGeneration;
}

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

function shouldIdleInstantly(telemetry) {
  return telemetry?.active === false && telemetry?.reason === 'menu';
}

function clearInactiveTracking(root) {
  root.removeAttribute('data-inactive-since');
}

function pushFogSessionToMain(options = {}) {
  if (!fogController || !window.sonarMinimapApi?.pushMapFogSession) return;

  const payload = {
    saveFile: currentSaveFile,
    fog: fogController.exportState(),
  };

  // Only push markers on explicit sync. Fog reveal must not wipe session markers.
  if (options.includeMarkers) {
    payload.markers = currentMarkers;
  }

  window.sonarMinimapApi.pushMapFogSession(payload);
}

function setCurrentMarkers(markers, options = {}) {
  currentMarkers = Array.isArray(markers) ? markers.slice() : [];
  markerLayer?.setMarkers(currentMarkers);
  if (options.touchAppliedAt !== false) {
    markersAppliedAt = Date.now();
  }
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
    void enqueueMinimapTask(async () => {
      if (!currentSaveId || !fogController?.hasExploredArea()) return;
      if (!lastTelemetryForSave?.saveFile) return;
      await flushFogSave(lastTelemetryForSave);
    });
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
  const generation = fogOpGeneration;
  const saveId = currentSaveId;
  if (!fogController || !saveId || !telemetry?.saveFile) return;
  if (!fogController.hasExploredArea()) return;

  const state = fogController.exportState();
  if (!isFogGenerationCurrent(generation) || currentSaveId !== saveId) return;

  await window.sonarMinimapApi.saveMapFogSave(saveId, {
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
  const generation = fogOpGeneration;
  const saveId = currentSaveId;
  fogSaveTimer = setTimeout(() => {
    fogSaveTimer = null;
    void enqueueMinimapTask(async () => {
      if (!isFogGenerationCurrent(generation) || currentSaveId !== saveId) return;
      await flushFogSave(telemetry);
    });
  }, FOG_SAVE_DEBOUNCE_MS);
}

async function syncFogFromDisk(telemetry, view) {
  if (!fogController || !telemetry?.saveFile || !window.sonarMinimapApi?.resolveMapSaveId) {
    return;
  }

  const generation = fogOpGeneration;
  const syncStartedAt = Date.now();
  const saveId = await window.sonarMinimapApi.resolveMapSaveId(telemetry);
  if (!saveId || !isFogGenerationCurrent(generation)) return;

  const previousSaveFile = currentSaveFile;
  const saveFileChanged = Boolean(
    telemetry.saveFile && telemetry.saveFile !== previousSaveFile,
  );
  currentSaveId = saveId;

  const needsDiskSync = saveFileChanged || fogDiskLoadedForSaveId !== saveId;
  if (!needsDiskSync) return;

  if (saveFileChanged) {
    markersAppliedAt = 0;
  }

  const record = await window.sonarMinimapApi.getMapFogSave(saveId, {
    saveSlot: telemetry.saveSlot,
    saveLabel: telemetry.saveLabel,
  });
  if (!isFogGenerationCurrent(generation) || currentSaveId !== saveId) return;

  const diskFog = record?.revealed
    ? {
        gridWidth: record.gridWidth,
        gridHeight: record.gridHeight,
        revealed: record.revealed,
      }
    : null;

  const isFirstSaveConfirm = !previousSaveFile;

  // Temporary waypoints are not tied to save confirm — do not clear them here.

  if (diskFog && isFirstSaveConfirm && fogController.hasExploredArea()) {
    fogController.mergeState(diskFog);
    void flushFogSave(telemetry);
  } else if (diskFog) {
    fogController.importState(diskFog);
  } else if (!(isFirstSaveConfirm && fogController.hasExploredArea())) {
    fogController.reset();
  }

  if (!isFogGenerationCurrent(generation) || currentSaveId !== saveId) return;

  if (view) {
    fogController.onViewUpdate(view);
  }

  fogController.clearMovementHistory();
  fogDiskLoadedForSaveId = saveId;

  // Do not overwrite markers that were saved/broadcast while we awaited disk.
  if (markersAppliedAt <= syncStartedAt) {
    setCurrentMarkers(record?.markers || []);
  }

  pushFogSessionToMain({ includeMarkers: true });
  scheduleFogSave(telemetry);
  maybeStartFogSaveInterval();
}

async function showIdleState(root, options = {}) {
  const preserveWaypoint = options.preserveWaypoint === true;

  await flushFogSaveIfNeeded();
  bumpFogGeneration();
  clearInactiveTracking(root);
  clearFogSaveTimer();
  stopFogSaveInterval();
  smoothController?.endLive();
  fogController?.reset();
  setCurrentMarkers([]);
  markersAppliedAt = 0;
  clearFogSessionOnMain();
  // Do not clear the shared waypoint during minimap init — only when leaving world.
  if (!preserveWaypoint) {
    void clearWaypointOnMain();
    minimapWaypointData = null;
    minimapWaypointPlacedAt = 0;
  }
  hideMinimapWaypointVisual();
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

  const enteringLive = root.dataset.state !== 'live';
  if (enteringLive) {
    const effectiveSaveFile = telemetry.saveFile || currentSaveFile;
    if (!effectiveSaveFile) {
      fogController?.reset();
      fogController?.clearMovementHistory();
      setCurrentMarkers([]);
      markersAppliedAt = 0;
      clearFogSessionOnMain();
      currentSaveId = null;
      fogDiskLoadedForSaveId = null;
    }
    smoothController?.beginLive(view);
    root.dataset.state = 'live';
    root.dataset.hasPlayer = 'true';
    // Catch waypoints placed while minimap was idle / missed an IPC push.
    void refreshWaypointFromMain();
  } else {
    smoothController?.updateTarget(view);
  }

  // Draw after live state is set so the overlay is not hidden as idle.
  updateMinimapWaypointVisual();

  if (minimapWaypointHasArrived(telemetry.x, telemetry.y)) {
    void clearWaypointOnMain();
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
    // Menu / leave world: idle immediately when Lua reports reason=menu.
    // Vehicle / respawn blips: 12 s hold when save is known; 2.5 s without save.
    if (shouldIdleInstantly(telemetry) || shouldShowIdleAfterInactive(root)) {
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
    if (shouldIdleInstantly(telemetry) || shouldShowIdleAfterInactive(root)) {
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
    void enqueueMinimapTask(() => syncSessionState(root, core, mapLayer, mapImage));
  }, SESSION_CHECK_MS);
}

function bindFogDeletedHandler() {
  if (!window.sonarMinimapApi?.onMapFogDeleted) return;

  if (fogSaveUnsubscribe) {
    fogSaveUnsubscribe();
    fogSaveUnsubscribe = null;
  }

  fogSaveUnsubscribe = window.sonarMinimapApi.onMapFogDeleted((saveId) => {
    bumpFogGeneration();
    clearFogSaveTimer();
    if (!saveId || saveId !== currentSaveId || !fogController) return;

    fogController.reset();
    fogController.clearMovementHistory();
    setCurrentMarkers([]);
    markersAppliedAt = 0;
    currentSaveId = null;
    fogDiskLoadedForSaveId = null;
    lastTelemetryForSave = null;
    clearFogSessionOnMain();
  });
}

function bindMarkersUpdate() {
  if (!window.sonarMinimapApi?.onMapMarkersUpdate) return;

  if (markersUnsubscribe) {
    markersUnsubscribe();
    markersUnsubscribe = null;
  }

  markersUnsubscribe = window.sonarMinimapApi.onMapMarkersUpdate((payload) => {
    const saveId = payload?.saveId || null;
    if (saveId && currentSaveId && saveId !== currentSaveId) {
      return;
    }
    setCurrentMarkers(payload?.markers || []);
  });
}

async function clearWaypointOnMain() {
  if (!window.sonarMinimapApi?.clearMapWaypoint) return;
  try {
    await window.sonarMinimapApi.clearMapWaypoint();
  } catch {
    // Ignore clear failures.
  }
}

const MINIMAP_WAYPOINT_ARRIVE = 2500;
const MINIMAP_WAYPOINT_GRACE_MS = 3000;

let minimapWaypointData = null;
let minimapWaypointLayer = null;
let minimapWaypointLineOutline = null;
let minimapWaypointLine = null;
let minimapWaypointCircle = null;
let minimapWaypointPlacedAt = 0;

function getMinimapCoreAndLayer() {
  const root = document.getElementById('sonarMinimap');
  return {
    root,
    core: root?.querySelector('.sonar-minimap-core') || null,
    mapLayer: root?.querySelector('.sonar-minimap-map-layer') || null,
  };
}

function resolveMinimapMapPoint(u, v) {
  const { core } = getMinimapCoreAndLayer();
  const view = smoothController?.getView?.() || window.SonarMapView.MAP_VIEW;
  if (!core || !view?.visibleWidth) return null;
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;

  const width = core.clientWidth;
  const height = core.clientHeight;
  if (!width || !height) return null;

  const scale = width / view.visibleWidth;
  const imgW = view.imageWidth * scale;
  const imgH = view.imageHeight * scale;
  const left = width * 0.5 - view.centerU * imgW;
  const top = height * 0.5 - view.centerV * imgH;

  return {
    x: left + u * imgW,
    y: top + v * imgH,
  };
}

function ensureMinimapWaypointDom() {
  if (minimapWaypointLayer) return true;
  const { core, mapLayer } = getMinimapCoreAndLayer();
  if (!core || !mapLayer) return false;

  minimapWaypointLayer = document.createElement('div');
  minimapWaypointLayer.className = 'sonar-minimap-waypoint-layer';
  minimapWaypointLayer.setAttribute('aria-hidden', 'true');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('sonar-minimap-waypoint-svg');

  minimapWaypointLineOutline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  minimapWaypointLineOutline.setAttribute('stroke', '#061820');
  minimapWaypointLineOutline.setAttribute('stroke-width', '4');
  minimapWaypointLineOutline.setAttribute('stroke-dasharray', '12 9');
  minimapWaypointLineOutline.setAttribute('stroke-linecap', 'round');
  minimapWaypointLineOutline.setAttribute('fill', 'none');

  minimapWaypointLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  minimapWaypointLine.setAttribute('stroke', '#ff2d2d');
  minimapWaypointLine.setAttribute('stroke-width', '2.25');
  minimapWaypointLine.setAttribute('stroke-dasharray', '12 9');
  minimapWaypointLine.setAttribute('stroke-linecap', 'round');
  minimapWaypointLine.setAttribute('fill', 'none');
  minimapWaypointLine.style.filter = 'drop-shadow(0 0 3px rgba(255, 45, 45, 0.45))';

  svg.appendChild(minimapWaypointLineOutline);
  svg.appendChild(minimapWaypointLine);

  minimapWaypointCircle = document.createElement('div');
  minimapWaypointCircle.className = 'sonar-minimap-waypoint-circle';

  minimapWaypointLayer.appendChild(svg);
  minimapWaypointLayer.appendChild(minimapWaypointCircle);
  mapLayer.appendChild(minimapWaypointLayer);
  return true;
}

function hideMinimapWaypointVisual() {
  if (minimapWaypointLayer) {
    minimapWaypointLayer.style.visibility = 'hidden';
  }
  if (minimapWaypointLine) {
    minimapWaypointLine.style.visibility = 'hidden';
  }
  if (minimapWaypointLineOutline) {
    minimapWaypointLineOutline.style.visibility = 'hidden';
  }
  if (minimapWaypointCircle) {
    minimapWaypointCircle.style.visibility = 'hidden';
  }
}

function updateMinimapWaypointVisual() {
  if (!ensureMinimapWaypointDom()) return;

  const { root, core } = getMinimapCoreAndLayer();
  const view = smoothController?.getView?.() || window.SonarMapView.MAP_VIEW;

  if (
    !minimapWaypointData ||
    !root ||
    root.dataset.state !== 'live' ||
    !core ||
    !view
  ) {
    hideMinimapWaypointVisual();
    return;
  }

  let u = Number(minimapWaypointData.u);
  let v = Number(minimapWaypointData.v);
  if (!Number.isFinite(u) || !Number.isFinite(v)) {
    const uv = window.SonarMapProjection.worldToMapUV(
      minimapWaypointData.x,
      minimapWaypointData.y,
    );
    if (!uv) {
      hideMinimapWaypointVisual();
      return;
    }
    u = uv.u;
    v = uv.v;
  }

  const to = resolveMinimapMapPoint(u, v);
  const from = resolveMinimapMapPoint(view.centerU, view.centerV);
  if (!to || !from) {
    hideMinimapWaypointVisual();
    return;
  }

  const width = Math.max(1, core.clientWidth);
  const height = Math.max(1, core.clientHeight);
  const svg = minimapWaypointLayer.querySelector('svg');
  if (svg) {
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
  }

  for (const el of [minimapWaypointLine, minimapWaypointLineOutline]) {
    el.setAttribute('x1', String(from.x));
    el.setAttribute('y1', String(from.y));
    el.setAttribute('x2', String(to.x));
    el.setAttribute('y2', String(to.y));
    el.style.visibility = 'visible';
  }

  minimapWaypointCircle.style.left = `${to.x}px`;
  minimapWaypointCircle.style.top = `${to.y}px`;
  minimapWaypointCircle.style.visibility = 'visible';
  minimapWaypointLayer.style.visibility = 'visible';
}

function minimapWaypointHasArrived(playerX, playerY) {
  if (!minimapWaypointData) return false;
  if (!Number.isFinite(playerX) || !Number.isFinite(playerY)) return false;
  const x = Number(minimapWaypointData.x);
  const y = Number(minimapWaypointData.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x === 0 && y === 0 && Number.isFinite(minimapWaypointData.u)) return false;
  if (Date.now() - minimapWaypointPlacedAt < MINIMAP_WAYPOINT_GRACE_MS) return false;
  const dx = playerX - x;
  const dy = playerY - y;
  return Math.sqrt(dx * dx + dy * dy) <= MINIMAP_WAYPOINT_ARRIVE;
}

function applyWaypointPayload(payload) {
  if (
    payload &&
    ((Number.isFinite(payload.u) && Number.isFinite(payload.v)) ||
      (Number.isFinite(payload.x) && Number.isFinite(payload.y)))
  ) {
    minimapWaypointData = {
      u: Number(payload.u),
      v: Number(payload.v),
      x: Number(payload.x),
      y: Number(payload.y),
      placedAt: Number(payload.placedAt) || Date.now(),
    };
    minimapWaypointPlacedAt = minimapWaypointData.placedAt;
  } else {
    minimapWaypointData = null;
    minimapWaypointPlacedAt = 0;
  }
  updateMinimapWaypointVisual();
}

async function refreshWaypointFromMain() {
  if (!window.sonarMinimapApi?.getMapWaypoint) return;
  try {
    const waypoint = await window.sonarMinimapApi.getMapWaypoint();
    applyWaypointPayload(waypoint);
  } catch {
    // Ignore waypoint fetch failures.
  }
}

function bindWaypointUpdate() {
  if (!window.sonarMinimapApi?.onMapWaypointUpdate) return;

  if (waypointUnsubscribe) {
    waypointUnsubscribe();
    waypointUnsubscribe = null;
  }

  waypointUnsubscribe = window.sonarMinimapApi.onMapWaypointUpdate((payload) => {
    applyWaypointPayload(payload);
  });
}

function bindTelemetry(root, core, mapLayer, mapImage) {
  if (!window.sonarMinimapApi?.onMapTelemetryUpdate) return;

  if (telemetryUnsubscribe) {
    telemetryUnsubscribe();
    telemetryUnsubscribe = null;
  }

  telemetryUnsubscribe = window.sonarMinimapApi.onMapTelemetryUpdate((telemetry) => {
    void enqueueMinimapTask(async () => {
      await handleTelemetry(root, core, mapLayer, mapImage, telemetry);
      if (hasLivePosition(telemetry)) {
        root.dataset.lastLiveAt = String(Date.now());
      }
    });
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

  await showIdleState(root, { preserveWaypoint: true });

  try {
    const idleUrl = await window.sonarMinimapApi.getIdleImageUrl();
    if (idleUrl) {
      await loadImage(idleImage, idleUrl);
    }

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
      onViewFrame: () => {
        markerLayer?.updatePositions();
        updateMinimapWaypointVisual();
      },
    });

    markerLayer = window.SonarMapMarkers.createMarkerLayer({
      container: mapLayer,
      getViewport: () => core,
      getView: () => smoothController?.getView?.() || window.SonarMapView.MAP_VIEW,
      mode: 'layer',
    });

    ensureMinimapWaypointDom();

    bindTelemetry(root, core, mapLayer, mapImage);
    bindFogDeletedHandler();
    bindMarkersUpdate();
    bindWaypointUpdate();
    if (window.sonarMinimapApi?.onMinimapSizeUpdate) {
      window.sonarMinimapApi.onMinimapSizeUpdate(({ size }) => {
        applyMinimapVisualSize(size);
        markerLayer?.updatePositions();
        updateMinimapWaypointVisual();
      });
    }
    startSessionWatch(root, core, mapLayer, mapImage);
    await syncSessionState(root, core, mapLayer, mapImage);
    await refreshWaypointFromMain();
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
