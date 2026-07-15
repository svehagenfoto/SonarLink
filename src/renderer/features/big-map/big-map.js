/**
 * SonarLink world map — full map view with shared fog, zoom and pan.
 * Map stays north-up; only the player arrow rotates.
 * Fog data comes from the minimap session via main process.
 */

let currentView = null;
let fogController = null;
let navigation = null;
let telemetryUnsubscribe = null;
let fogSessionUnsubscribe = null;
let resizeObserver = null;
let playerMarker = null;
let currentSaveFile = null;

function hasLivePosition(telemetry) {
  return (
    telemetry &&
    telemetry.active === true &&
    Number.isFinite(telemetry.x) &&
    Number.isFinite(telemetry.y)
  );
}

function updateSavePendingState(telemetry = null) {
  if (!window.SonarMapSavePending) return;

  const viewport = getViewport();
  if (!viewport) return;

  const live = viewport.dataset.state === 'live';
  let saveFile = currentSaveFile;

  if (telemetry !== null) {
    if (telemetry.saveFile) {
      currentSaveFile = telemetry.saveFile;
      saveFile = telemetry.saveFile;
    } else {
      saveFile = currentSaveFile;
    }
  }

  window.SonarMapSavePending.applySavePendingState(viewport, {
    live,
    saveFile,
  });
}

function loadImage(image, url) {
  return new Promise((resolve, reject) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', reject, { once: true });
    image.src = url;
  });
}

function getViewport() {
  return document.getElementById('bigMapViewport');
}

function getMapLayer() {
  return document.getElementById('bigMapLayer');
}

function getMapImage() {
  return document.getElementById('bigMapImage');
}

function getPlayerArrow() {
  return document.getElementById('bigMapPlayerArrow');
}

function buildViewportView() {
  const viewport = getViewport();
  if (!viewport) return null;
  return window.SonarMapView.buildFitAllView(
    viewport.clientWidth,
    viewport.clientHeight,
  );
}

function isViewValid(view) {
  return Boolean(
    view &&
    Number.isFinite(view.visibleWidth) &&
    view.visibleWidth > 0,
  );
}

function applyCurrentView() {
  const viewport = getViewport();
  const image = getMapImage();
  if (!viewport || !image || !isViewValid(currentView)) return;

  window.SonarMapView.applyMapViewportRect(image, viewport, currentView);
  fogController?.onViewUpdate(currentView);
  updatePlayerMarker();
}

function applyFogSession(session) {
  if (!fogController || !currentView) return;

  if (session?.fog) {
    fogController.importState(session.fog);
    if (session.saveFile) {
      currentSaveFile = session.saveFile;
    }
  } else {
    fogController.reset();
  }

  fogController.onViewUpdate(currentView);
  updateSavePendingState();
}

function updatePlayerMarkerFromTelemetry(telemetry) {
  if (!hasLivePosition(telemetry)) {
    playerMarker = null;
    updatePlayerMarker();
    return;
  }

  const uv = window.SonarMapProjection.worldToMapUV(telemetry.x, telemetry.y);
  if (!uv) {
    playerMarker = null;
    updatePlayerMarker();
    return;
  }

  const heading = window.SonarMapProjection.headingFromForward(
    telemetry.forwardX,
    telemetry.forwardY,
  );

  playerMarker = {
    u: uv.u,
    v: uv.v,
    heading,
  };
  updatePlayerMarker();
}

function updatePlayerMarker() {
  const viewport = getViewport();
  const arrow = getPlayerArrow();
  if (!viewport || !arrow || !currentView || !playerMarker) return;

  const screen = window.SonarMapView.mapUvToScreenRect(
    viewport,
    currentView,
    playerMarker.u,
    playerMarker.v,
  );
  if (!screen) return;

  const rotation = window.SonarMapProjection.arrowRotationFromHeading(playerMarker.heading);
  arrow.style.left = `${screen.x}px`;
  arrow.style.top = `${screen.y}px`;
  arrow.style.transform = `rotate(${rotation}deg)`;
}

function updateSessionState(telemetry) {
  const viewport = getViewport();
  if (!viewport) return;

  if (hasLivePosition(telemetry)) {
    viewport.dataset.state = 'live';
  } else {
    viewport.dataset.state = 'idle';
    playerMarker = null;
    updatePlayerMarker();
  }

  updateSavePendingState(telemetry);
}

function handleTelemetryUpdate(telemetry) {
  try {
    updateSessionState(telemetry);
    updatePlayerMarkerFromTelemetry(telemetry);
  } catch {
    // Ignore transient telemetry handling errors in the world map window.
  }
}

function bindTelemetry() {
  if (!window.sonarMinimapApi?.onMapTelemetryUpdate) return;

  if (telemetryUnsubscribe) {
    telemetryUnsubscribe();
    telemetryUnsubscribe = null;
  }

  telemetryUnsubscribe = window.sonarMinimapApi.onMapTelemetryUpdate((telemetry) => {
    handleTelemetryUpdate(telemetry);
  });
}

function bindFogSession() {
  if (!window.sonarMinimapApi?.onMapFogSessionUpdate) return;

  if (fogSessionUnsubscribe) {
    fogSessionUnsubscribe();
    fogSessionUnsubscribe = null;
  }

  fogSessionUnsubscribe = window.sonarMinimapApi.onMapFogSessionUpdate((session) => {
    applyFogSession(session);
  });
}

function bindResize() {
  const viewport = getViewport();
  if (!viewport || !window.ResizeObserver) return;

  resizeObserver = new ResizeObserver(() => {
    currentView = buildViewportView();
    applyCurrentView();
  });

  resizeObserver.observe(viewport);
}

function bindClickOutsideToClose() {
  document.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;

    const viewport = getViewport();
    if (!viewport || viewport.contains(event.target)) return;

    window.sonarMinimapApi?.hideBigMap?.();
  });
}

async function initBigMap() {
  const viewport = getViewport();
  const mapLayer = getMapLayer();
  const mapImage = getMapImage();

  if (!viewport || !mapLayer || !mapImage || !window.sonarMinimapApi) {
    return;
  }

  try {
    const mapUrl = await window.sonarMinimapApi.getMapImageUrl();
    if (mapUrl) {
      await loadImage(mapImage, mapUrl);
    }
  } catch {
    // Continue even if the map image failed to load.
  }

  fogController = window.SonarMapFog.createFogController({
    core: viewport,
    mapLayer,
    shape: 'rect',
  });

  currentView = buildViewportView();
  applyCurrentView();

  navigation = window.SonarMapNavigation.createMapNavigation({
    viewport,
    image: mapImage,
    fogController,
    getView: () => currentView,
    setView: (view) => {
      currentView = view;
    },
    onViewChange: () => {
      updatePlayerMarker();
    },
  });

  bindTelemetry();
  bindFogSession();
  bindResize();
  bindClickOutsideToClose();

  try {
    const session = await window.sonarMinimapApi.getMapFogSession?.();
    applyFogSession(session);
  } catch {
    // Fog session may not be ready yet.
  }

  try {
    const telemetry = await window.sonarMinimapApi.getMapTelemetry();
    handleTelemetryUpdate(telemetry);
  } catch {
    // World map can stay closed if telemetry is not ready yet.
  }
}

window.SonarBigMap = {
  init: initBigMap,
};
