/**
 * SonarLink world map — full map view with shared fog, zoom and pan.
 * Map stays north-up; only the player arrow rotates.
 * Fog data comes from the minimap session via main process.
 * Markers: right click to place/edit; auto saved with fog file.
 */

const MARKER_NAME_SAVE_DEBOUNCE_MS = 250;

let currentView = null;
let fogController = null;
let markerLayer = null;
let waypointOverlay = null;
let navigation = null;
let telemetryUnsubscribe = null;
let fogSessionUnsubscribe = null;
let markersUnsubscribe = null;
let waypointUnsubscribe = null;
let resizeObserver = null;
let playerMarker = null;
let lastLiveTelemetry = null;
let waypointPlacedAt = 0;
let currentSaveFile = null;
let currentSaveId = null;
let editorEl = null;
let editingMarkerId = null;
let nameSaveTimer = null;

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
      // Keep last confirmed save across telemetry blips (same as minimap).
      // Cleared only via fog session reset / idle world leave.
      saveFile = currentSaveFile;
    }
  }

  window.SonarMapSavePending.applySavePendingState(viewport, {
    live,
    saveFile,
  });
  updateMarkerHints();
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

function canEditMarkers() {
  return Boolean(currentSaveId && currentSaveFile && markerLayer);
}

function canPlaceWaypoint() {
  // Same unlock as markers (confirmed world). Live position only needed for the line.
  return Boolean(canEditMarkers());
}

function updateMarkerHints() {
  const viewport = getViewport();
  const markerHint = document.getElementById('bigMapMarkerHint');
  const waypointHint = document.getElementById('bigMapWaypointHint');
  if (!viewport) return;

  const markersReady = canEditMarkers();
  const waypointReady = canPlaceWaypoint();
  viewport.dataset.markersReady = markersReady ? 'true' : 'false';
  if (markerHint) {
    markerHint.hidden = !markersReady;
  }
  if (waypointHint) {
    waypointHint.hidden = !waypointReady;
  }
}

function applyCurrentView() {
  const viewport = getViewport();
  const image = getMapImage();
  if (!viewport || !image || !isViewValid(currentView)) return;

  window.SonarMapView.applyMapViewportRect(image, viewport, currentView);
  fogController?.onViewUpdate(currentView);
  markerLayer?.updatePositions();
  waypointOverlay?.update();
  updatePlayerMarker();
  repositionEditor();
}

function applyMarkersList(markers) {
  if (!markerLayer) return;
  markerLayer.setMarkers(Array.isArray(markers) ? markers : []);
  if (editingMarkerId) {
    const stillThere = markerLayer.getMarkers().some((m) => m.id === editingMarkerId);
    if (!stillThere) {
      closeMarkerEditor();
    } else {
      syncEditorFromMarker();
      repositionEditor();
    }
  }
}

async function resolveSaveIdFromFile(saveFile) {
  if (!saveFile || !window.sonarMinimapApi?.resolveMapSaveId) return null;
  try {
    return await window.sonarMinimapApi.resolveMapSaveId({ saveFile });
  } catch {
    return null;
  }
}

async function applyFogSession(session) {
  if (!fogController || !currentView) return;

  if (session?.fog) {
    fogController.importState(session.fog);
    if (session.saveFile) {
      currentSaveFile = session.saveFile;
      currentSaveId = await resolveSaveIdFromFile(session.saveFile);
    }
    applyMarkersList(session.markers);
  } else {
    fogController.reset();
    currentSaveFile = null;
    currentSaveId = null;
    applyMarkersList([]);
    closeMarkerEditor();
    void clearWaypointOnMain();
  }

  fogController.onViewUpdate(currentView);
  updateSavePendingState();
  updateMarkerHints();
}

function updatePlayerMarkerFromTelemetry(telemetry) {
  if (!hasLivePosition(telemetry)) {
    playerMarker = null;
    lastLiveTelemetry = null;
    waypointOverlay?.clearPlayer();
    updatePlayerMarker();
    updateMarkerHints();
    return;
  }

  lastLiveTelemetry = telemetry;
  waypointOverlay?.setPlayerWorld(telemetry.x, telemetry.y);

  if (waypointOverlay?.hasArrived(telemetry.x, telemetry.y)) {
    void clearWaypointOnMain();
  }

  const uv = window.SonarMapProjection.worldToMapUV(telemetry.x, telemetry.y);
  if (!uv) {
    playerMarker = null;
    updatePlayerMarker();
    updateMarkerHints();
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
  updateMarkerHints();
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
    lastLiveTelemetry = null;
    waypointOverlay?.clearPlayer();
    updatePlayerMarker();
    if (telemetry?.active === false && telemetry?.reason === 'menu') {
      void clearWaypointOnMain();
    }
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

function clearNameSaveTimer() {
  if (nameSaveTimer) {
    clearTimeout(nameSaveTimer);
    nameSaveTimer = null;
  }
}

function getEditingMarker() {
  if (!editingMarkerId || !markerLayer) return null;
  return markerLayer.getMarkers().find((m) => m.id === editingMarkerId) || null;
}

function syncEditorFromMarker() {
  if (!editorEl) return;
  const marker = getEditingMarker();
  if (!marker) return;

  const nameInput = editorEl.querySelector('.sonar-marker-editor-name');
  if (nameInput && document.activeElement !== nameInput) {
    nameInput.value = marker.name || '';
  }

  editorEl.querySelectorAll('.sonar-marker-editor-swatch').forEach((swatch) => {
    swatch.classList.toggle('is-selected', swatch.dataset.colorId === marker.colorId);
  });
}

function repositionEditor() {
  if (!editorEl || !editingMarkerId || !currentView) return;

  const viewport = getViewport();
  const marker = getEditingMarker();
  if (!viewport || !marker) return;

  const screen = window.SonarMapView.mapUvToScreenRect(
    viewport,
    currentView,
    marker.u,
    marker.v,
  );
  if (!screen) return;

  const pad = 8;
  const editorW = editorEl.offsetWidth || 200;
  const editorH = editorEl.offsetHeight || 120;
  let left = screen.x + 14;
  let top = screen.y - editorH - 8;

  if (left + editorW > viewport.clientWidth - pad) {
    left = screen.x - editorW - 14;
  }
  if (left < pad) left = pad;
  if (top < pad) top = screen.y + 18;
  if (top + editorH > viewport.clientHeight - pad) {
    top = Math.max(pad, viewport.clientHeight - editorH - pad);
  }

  editorEl.style.left = `${left}px`;
  editorEl.style.top = `${top}px`;
}

function closeMarkerEditor() {
  window.sonarMinimapApi?.setFeatureBindsSuspended?.(false);

  if (nameSaveTimer && editingMarkerId && editorEl) {
    clearTimeout(nameSaveTimer);
    nameSaveTimer = null;
    const nameInput = editorEl.querySelector('.sonar-marker-editor-name');
    const markerId = editingMarkerId;
    const value = nameInput ? nameInput.value.slice(0, 64) : '';
    editingMarkerId = null;
    if (editorEl) {
      editorEl.remove();
      editorEl = null;
    }
    void commitMarkerPatch(markerId, { name: value });
    return;
  }

  clearNameSaveTimer();
  editingMarkerId = null;
  if (editorEl) {
    editorEl.remove();
    editorEl = null;
  }
}

async function persistMarkers(markers, saveId = currentSaveId) {
  if (!saveId || !window.sonarMinimapApi?.saveMapMarkers) return;
  try {
    await window.sonarMinimapApi.saveMapMarkers(saveId, markers);
  } catch {
    // Keep local markers; next edit retries.
  }
}

async function commitMarkerPatch(markerId, patch) {
  if (!markerLayer || !canEditMarkers()) return;

  const saveId = currentSaveId;
  const next = markerLayer.getMarkers().map((marker) => {
    if (marker.id !== markerId) return marker;
    return {
      ...marker,
      ...patch,
      updatedAt: Date.now(),
    };
  });

  markerLayer.setMarkers(next);
  repositionEditor();
  if (!saveId || saveId !== currentSaveId) return;
  await persistMarkers(next, saveId);
}

async function deleteEditingMarker() {
  if (!markerLayer || !editingMarkerId || !canEditMarkers()) return;

  const saveId = currentSaveId;
  const id = editingMarkerId;
  closeMarkerEditor();
  const next = markerLayer.getMarkers().filter((marker) => marker.id !== id);
  markerLayer.setMarkers(next);
  if (!saveId || saveId !== currentSaveId) return;
  await persistMarkers(next, saveId);
}

function openMarkerEditor(markerId) {
  const viewport = getViewport();
  if (!viewport || !markerLayer) return;

  const marker = markerLayer.getMarkers().find((m) => m.id === markerId);
  if (!marker) return;

  closeMarkerEditor();
  editingMarkerId = markerId;

  editorEl = document.createElement('div');
  editorEl.className = 'sonar-marker-editor';
  editorEl.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });
  editorEl.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  const colors = document.createElement('div');
  colors.className = 'sonar-marker-editor-colors';

  for (const preset of window.SonarMapMarkers.COLOR_PRESETS) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'sonar-marker-editor-swatch';
    swatch.dataset.colorId = preset.id;
    swatch.style.setProperty('--swatch-color', preset.hex);
    swatch.title = preset.id;
    swatch.classList.toggle('is-selected', preset.id === marker.colorId);
    swatch.addEventListener('click', () => {
      void commitMarkerPatch(markerId, { colorId: preset.id });
      syncEditorFromMarker();
    });
    colors.appendChild(swatch);
  }

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'sonar-marker-editor-name';
  nameInput.maxLength = 64;
  nameInput.placeholder = 'Marker name';
  nameInput.value = marker.name || '';
  nameInput.addEventListener('focus', () => {
    window.sonarMinimapApi?.setFeatureBindsSuspended?.(true);
  });
  nameInput.addEventListener('blur', () => {
    window.sonarMinimapApi?.setFeatureBindsSuspended?.(false);
  });
  nameInput.addEventListener('input', () => {
    clearNameSaveTimer();
    const value = nameInput.value.slice(0, 64);
    nameSaveTimer = setTimeout(() => {
      nameSaveTimer = null;
      void commitMarkerPatch(markerId, { name: value });
    }, MARKER_NAME_SAVE_DEBOUNCE_MS);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'sonar-marker-editor-delete';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => {
    void deleteEditingMarker();
  });

  editorEl.appendChild(colors);
  editorEl.appendChild(nameInput);
  editorEl.appendChild(deleteBtn);
  viewport.appendChild(editorEl);
  repositionEditor();

  requestAnimationFrame(() => {
    nameInput.focus();
    nameInput.select();
  });
}

async function createMarkerAtClient(clientX, clientY) {
  if (!canEditMarkers() || !currentView) return;

  const viewport = getViewport();
  if (!viewport) return;

  const saveId = currentSaveId;
  const rect = viewport.getBoundingClientRect();
  const uv = window.SonarMapView.screenRectToMapUv(
    viewport,
    currentView,
    clientX - rect.left,
    clientY - rect.top,
  );
  if (!uv) return;

  const now = Date.now();
  const marker = {
    id: window.SonarMapMarkers.createMarkerId(),
    u: uv.u,
    v: uv.v,
    name: '',
    colorId: 'cyan',
    createdAt: now,
    updatedAt: now,
  };

  const next = [...markerLayer.getMarkers(), marker];
  markerLayer.setMarkers(next);
  openMarkerEditor(marker.id);
  if (!saveId || saveId !== currentSaveId) return;
  await persistMarkers(next, saveId);
}

function bindMarkerInteractions() {
  const viewport = getViewport();
  if (!viewport) return;

  viewport.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (!canEditMarkers()) return;

    const hit = markerLayer.hitTest(event.clientX, event.clientY);
    if (hit) {
      openMarkerEditor(hit.id);
      return;
    }

    void createMarkerAtClient(event.clientX, event.clientY);
  });

  document.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || !editorEl) return;
    if (editorEl.contains(event.target)) return;
    closeMarkerEditor();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && editorEl) {
      closeMarkerEditor();
    }
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

async function setWaypointOnMain(payload) {
  if (!window.sonarMinimapApi?.setMapWaypoint) return null;
  try {
    return await window.sonarMinimapApi.setMapWaypoint(payload);
  } catch {
    return null;
  }
}

function applyWaypointPayload(payload) {
  if (!waypointOverlay) return;
  if (
    payload &&
    ((Number.isFinite(payload.u) && Number.isFinite(payload.v)) ||
      (Number.isFinite(payload.x) && Number.isFinite(payload.y)))
  ) {
    waypointOverlay.setWaypoint(payload);
  } else {
    waypointOverlay.clear();
  }
}

function flashWaypointHint(message) {
  const hint = document.getElementById('bigMapWaypointHint');
  if (!hint) return;
  const previous = hint.dataset.defaultText || hint.textContent;
  hint.dataset.defaultText = previous;
  hint.hidden = false;
  hint.textContent = message;
  window.clearTimeout(flashWaypointHint._timer);
  flashWaypointHint._timer = window.setTimeout(() => {
    hint.textContent = hint.dataset.defaultText || previous;
    updateMarkerHints();
  }, 1400);
}

function createInlineWaypointOverlay(container) {
  // Prefer shared module when present (keeps world map + minimap identical).
  if (window.SonarMapWaypoint?.createWaypointOverlay) {
    return window.SonarMapWaypoint.createWaypointOverlay({
      container,
      getViewport: () => getViewport(),
      getView: () => currentView,
      mode: 'screen',
    });
  }

  const color = '#ff2d2d';
  const colorSoft = 'rgba(255, 45, 45, 0.42)';
  const outline = '#061820';
  const arriveRadius = 2500;
  const arriveGraceMs = 3000;
  const hitRadiusPx = 22;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('sonar-map-waypoint-layer');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:8;';

  const lineOutline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  lineOutline.setAttribute('stroke', outline);
  lineOutline.setAttribute('stroke-width', '4');
  lineOutline.setAttribute('stroke-dasharray', '12 9');
  lineOutline.setAttribute('stroke-linecap', 'round');
  lineOutline.setAttribute('fill', 'none');

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '2.25');
  line.setAttribute('stroke-dasharray', '12 9');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('fill', 'none');
  line.style.filter = 'drop-shadow(0 0 3px rgba(255, 45, 45, 0.45))';

  const circleOutline = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circleOutline.setAttribute('r', '8.5');
  circleOutline.setAttribute('fill', 'none');
  circleOutline.setAttribute('stroke', outline);
  circleOutline.setAttribute('stroke-width', '2.5');

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('r', '6.5');
  circle.setAttribute('fill', colorSoft);
  circle.setAttribute('stroke', color);
  circle.setAttribute('stroke-width', '2');
  circle.style.filter = 'drop-shadow(0 0 5px rgba(255, 45, 45, 0.55))';

  const circleCore = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circleCore.setAttribute('r', '2');
  circleCore.setAttribute('fill', color);
  circleCore.setAttribute('stroke', outline);
  circleCore.setAttribute('stroke-width', '1');

  svg.appendChild(lineOutline);
  svg.appendChild(line);
  svg.appendChild(circleOutline);
  svg.appendChild(circle);
  svg.appendChild(circleCore);
  container.appendChild(svg);

  let waypoint = null;
  let playerUv = null;

  function mapPoint(u, v) {
    const viewport = getViewport();
    if (!viewport || !currentView?.visibleWidth) return null;
    return window.SonarMapView.mapUvToScreenRect(viewport, currentView, u, v);
  }

  function setHidden(hidden) {
    svg.style.visibility = hidden ? 'hidden' : 'visible';
    if (hidden) {
      line.style.visibility = 'hidden';
      lineOutline.style.visibility = 'hidden';
    }
  }

  function update() {
    if (!waypoint) {
      setHidden(true);
      return;
    }
    const to = mapPoint(waypoint.u, waypoint.v);
    if (!to) {
      setHidden(true);
      return;
    }
    const viewport = getViewport();
    const width = Math.max(1, viewport.clientWidth);
    const height = Math.max(1, viewport.clientHeight);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    circle.setAttribute('cx', String(to.x));
    circle.setAttribute('cy', String(to.y));
    circleOutline.setAttribute('cx', String(to.x));
    circleOutline.setAttribute('cy', String(to.y));
    circleCore.setAttribute('cx', String(to.x));
    circleCore.setAttribute('cy', String(to.y));

    if (playerUv) {
      const from = mapPoint(playerUv.u, playerUv.v);
      if (from) {
        for (const el of [line, lineOutline]) {
          el.setAttribute('x1', String(from.x));
          el.setAttribute('y1', String(from.y));
          el.setAttribute('x2', String(to.x));
          el.setAttribute('y2', String(to.y));
          el.style.visibility = 'visible';
        }
      } else {
        line.style.visibility = 'hidden';
        lineOutline.style.visibility = 'hidden';
      }
    } else {
      line.style.visibility = 'hidden';
      lineOutline.style.visibility = 'hidden';
    }
    setHidden(false);
  }

  setHidden(true);

  return {
    setWaypoint(next) {
      if (next && Number.isFinite(next.u) && Number.isFinite(next.v)) {
        waypoint = {
          x: Number(next.x),
          y: Number(next.y),
          u: next.u,
          v: next.v,
          placedAt: Number.isFinite(next.placedAt) ? next.placedAt : Date.now(),
        };
      } else if (next && Number.isFinite(next.x) && Number.isFinite(next.y)) {
        const uv = window.SonarMapProjection.worldToMapUV(next.x, next.y);
        waypoint = uv
          ? {
              x: next.x,
              y: next.y,
              u: uv.u,
              v: uv.v,
              placedAt: Number.isFinite(next.placedAt) ? next.placedAt : Date.now(),
            }
          : null;
      } else {
        waypoint = null;
      }
      update();
    },
    clear() {
      waypoint = null;
      line.style.visibility = 'hidden';
      lineOutline.style.visibility = 'hidden';
      update();
    },
    setPlayerWorld(x, y) {
      playerUv =
        Number.isFinite(x) && Number.isFinite(y)
          ? window.SonarMapProjection.worldToMapUV(x, y)
          : null;
      update();
    },
    clearPlayer() {
      playerUv = null;
      update();
    },
    hasArrived(playerX, playerY) {
      if (!waypoint || !Number.isFinite(playerX) || !Number.isFinite(playerY)) {
        return false;
      }
      if (waypoint.x === 0 && waypoint.y === 0) return false;
      if (
        Number.isFinite(waypoint.placedAt) &&
        Date.now() - waypoint.placedAt < arriveGraceMs
      ) {
        return false;
      }
      const dx = playerX - waypoint.x;
      const dy = playerY - waypoint.y;
      return Math.sqrt(dx * dx + dy * dy) <= arriveRadius;
    },
    update,
    hitTest(clientX, clientY) {
      if (!waypoint) return false;
      const point = mapPoint(waypoint.u, waypoint.v);
      if (!point) return false;
      const viewport = getViewport();
      const rect = viewport.getBoundingClientRect();
      const dx = point.x - (clientX - rect.left);
      const dy = point.y - (clientY - rect.top);
      return Math.sqrt(dx * dx + dy * dy) <= hitRadiusPx;
    },
  };
}

function ensureWaypointOverlay() {
  if (waypointOverlay) return true;
  const viewport = getViewport();
  if (!viewport) return false;

  try {
    if (window.SonarMapWaypoint?.createWaypointOverlay) {
      waypointOverlay = window.SonarMapWaypoint.createWaypointOverlay({
        container: viewport,
        getViewport: () => viewport,
        getView: () => currentView,
        mode: 'screen',
      });
    } else {
      // map-waypoint.js did not load in this window — use local fallback.
      waypointOverlay = createInlineWaypointOverlay(viewport);
    }
  } catch {
    waypointOverlay = createInlineWaypointOverlay(viewport);
  }

  return Boolean(waypointOverlay);
}

/**
 * Convert screen click to map UV. Always clamps onto the map image so letterbox
 * clicks still place (fog fills the viewport, but UV only covers the image).
 */
function clientToMapUv(clientX, clientY) {
  const viewport = getViewport();
  if (!viewport || !currentView?.visibleWidth) return null;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;

  const rect = viewport.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;

  const vpW = viewport.clientWidth;
  const vpH = viewport.clientHeight;
  if (!vpW || !vpH) return null;

  const scale = vpW / currentView.visibleWidth;
  const imgW = currentView.imageWidth * scale;
  const imgH = currentView.imageHeight * scale;
  if (!imgW || !imgH) return null;

  const left = vpW * 0.5 - currentView.centerU * imgW;
  const top = vpH * 0.5 - currentView.centerV * imgH;
  const u = (localX - left) / imgW;
  const v = (localY - top) / imgH;
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;

  return {
    u: Math.max(0, Math.min(1, u)),
    v: Math.max(0, Math.min(1, v)),
  };
}

function uvToWorld(u, v) {
  if (typeof window.SonarMapProjection?.mapUVToWorld === 'function') {
    const world = window.SonarMapProjection.mapUVToWorld(u, v);
    if (world && Number.isFinite(world.x) && Number.isFinite(world.y)) {
      return world;
    }
  }
  return null;
}

function placeWaypointAtClient(clientX, clientY) {
  if (!canPlaceWaypoint()) {
    flashWaypointHint('Not unlocked');
    return false;
  }

  if (!currentView || !isViewValid(currentView)) {
    currentView = buildViewportView();
    if (currentView) applyCurrentView();
  }
  if (!currentView || !isViewValid(currentView)) {
    flashWaypointHint('No map view');
    return false;
  }

  if (!ensureWaypointOverlay()) {
    flashWaypointHint('No overlay');
    return false;
  }

  const uv = clientToMapUv(clientX, clientY);
  if (!uv) {
    flashWaypointHint('UV miss');
    return false;
  }

  // World for arrive distance; UV for drawing on both maps.
  const world = uvToWorld(uv.u, uv.v);
  waypointPlacedAt = Date.now();
  const payload = {
    x: world ? world.x : 0,
    y: world ? world.y : 0,
    u: uv.u,
    v: uv.v,
    placedAt: waypointPlacedAt,
  };

  waypointOverlay.setWaypoint(payload);

  if (hasLivePosition(lastLiveTelemetry)) {
    waypointOverlay.setPlayerWorld(lastLiveTelemetry.x, lastLiveTelemetry.y);
  }

  // Always push to main so minimap can draw the same waypoint.
  void setWaypointOnMain(payload);

  return true;
}

function bindWaypoint() {
  const viewport = getViewport();
  if (!viewport) return;

  ensureWaypointOverlay();

  if (window.sonarMinimapApi?.onMapWaypointUpdate) {
    if (waypointUnsubscribe) {
      waypointUnsubscribe();
      waypointUnsubscribe = null;
    }
    waypointUnsubscribe = window.sonarMinimapApi.onMapWaypointUpdate((payload) => {
      applyWaypointPayload(payload);
    });
  }

  void window.sonarMinimapApi.getMapWaypoint?.().then((payload) => {
    applyWaypointPayload(payload);
  }).catch(() => {});
}

function clearWaypointLocalAndMain() {
  waypointOverlay?.clear();
  void clearWaypointOnMain();
}

function handleMapSingleClick(point) {
  if (!canEditMarkers()) return;
  if (!waypointOverlay?.hitTest(point.clientX, point.clientY)) return;
  clearWaypointLocalAndMain();
}

function handleMapDoubleClick(point) {
  if (!canPlaceWaypoint()) {
    flashWaypointHint('World not confirmed');
    return;
  }
  placeWaypointAtClient(point.clientX, point.clientY);
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
    void applyFogSession(session);
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
    applyMarkersList(payload?.markers);
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
    } else {
      mapImage.removeAttribute('src');
    }
  } catch {
    // Continue even if the map image failed to load.
    mapImage.removeAttribute('src');
  }

  fogController = window.SonarMapFog.createFogController({
    core: viewport,
    mapLayer,
    shape: 'rect',
  });

  markerLayer = window.SonarMapMarkers.createMarkerLayer({
    container: viewport,
    getViewport: () => viewport,
    getView: () => currentView,
    mode: 'screen',
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
      markerLayer?.updatePositions();
      waypointOverlay?.update();
      updatePlayerMarker();
      repositionEditor();
    },
    onSingleClick: handleMapSingleClick,
    onDoubleClick: handleMapDoubleClick,
  });

  bindTelemetry();
  bindFogSession();
  bindMarkersUpdate();
  bindResize();
  bindClickOutsideToClose();
  bindMarkerInteractions();
  bindWaypoint();

  try {
    const session = await window.sonarMinimapApi.getMapFogSession?.();
    await applyFogSession(session);
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
