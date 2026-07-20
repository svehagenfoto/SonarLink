/**
 * Shared map marker pins (world map + minimap).
 * Pins use map UV; tip sits on the coordinate.
 */

const MARKER_COLOR_PRESETS = [
  { id: 'cyan', hex: '#5eebf0' },
  { id: 'warm', hex: '#f5a623' },
  { id: 'green', hex: '#7dffb8' },
  { id: 'blue', hex: '#8ed4f0' },
  { id: 'coral', hex: '#ff6b6b' },
];

const COLOR_BY_ID = Object.fromEntries(
  MARKER_COLOR_PRESETS.map((preset) => [preset.id, preset.hex]),
);

const PIN_PATH = 'M12 0 C5.4 0 0 5.4 0 12 C0 21 12 36 12 36 C12 36 24 21 24 12 C24 5.4 18.6 0 12 0 Z M12 7.5 A4.5 4.5 0 1 1 12 16.5 A4.5 4.5 0 1 1 12 7.5 Z';
const HIT_RADIUS_PX = 18;

function colorHexForId(colorId) {
  return COLOR_BY_ID[colorId] || COLOR_BY_ID.cyan;
}

function createMarkerId() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createMarkerLayer(options) {
  const {
    container,
    getViewport,
    getView,
    mode = 'screen',
  } = options;

  const layer = document.createElement('div');
  layer.className = 'sonar-map-markers-layer';
  layer.setAttribute('aria-hidden', 'true');
  container.appendChild(layer);

  let markers = [];
  const elementsById = new Map();

  function resolveScreenPoint(marker) {
    const viewport = getViewport();
    const view = getView();
    if (!viewport || !view) return null;

    if (mode === 'screen') {
      return window.SonarMapView.mapUvToScreenRect(
        viewport,
        view,
        marker.u,
        marker.v,
      );
    }

    // Layout relative to the same viewport core the fog canvas uses.
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (!width || !height || !view.visibleWidth) return null;

    const scale = width / view.visibleWidth;
    const imgW = view.imageWidth * scale;
    const imgH = view.imageHeight * scale;
    const left = width * 0.5 - view.centerU * imgW;
    const top = height * 0.5 - view.centerV * imgH;

    return {
      x: left + marker.u * imgW,
      y: top + marker.v * imgH,
    };
  }

  function ensureElement(marker) {
    let el = elementsById.get(marker.id);
    if (el) return el;

    el = document.createElement('div');
    el.className = 'sonar-map-marker';
    el.dataset.markerId = marker.id;

    const label = document.createElement('span');
    label.className = 'sonar-map-marker-label';

    const pin = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    pin.classList.add('sonar-map-marker-pin');
    pin.setAttribute('viewBox', '0 0 24 36');
    pin.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', PIN_PATH);
    path.setAttribute('fill-rule', 'evenodd');
    path.classList.add('sonar-map-marker-pin-shape');
    pin.appendChild(path);

    el.appendChild(label);
    el.appendChild(pin);
    layer.appendChild(el);
    elementsById.set(marker.id, el);
    return el;
  }

  function updateElement(marker) {
    const el = ensureElement(marker);
    const label = el.querySelector('.sonar-map-marker-label');
    const shape = el.querySelector('.sonar-map-marker-pin-shape');
    const name = typeof marker.name === 'string' ? marker.name.trim() : '';

    if (label) {
      label.textContent = name;
      label.hidden = !name;
    }

    if (shape) {
      shape.setAttribute('fill', colorHexForId(marker.colorId));
    }

    const point = resolveScreenPoint(marker);
    if (!point) {
      el.style.visibility = 'hidden';
      return;
    }

    el.style.visibility = 'visible';
    el.style.left = `${point.x}px`;
    el.style.top = `${point.y}px`;
  }

  function setMarkers(nextMarkers) {
    markers = Array.isArray(nextMarkers) ? nextMarkers.slice() : [];
    const keep = new Set(markers.map((m) => m.id));

    for (const [id, el] of elementsById) {
      if (!keep.has(id)) {
        el.remove();
        elementsById.delete(id);
      }
    }

    for (const marker of markers) {
      updateElement(marker);
    }
  }

  function getMarkers() {
    return markers.slice();
  }

  function updatePositions() {
    for (const marker of markers) {
      updateElement(marker);
    }
  }

  function hitTest(clientX, clientY) {
    const viewport = getViewport();
    if (!viewport) return null;

    const rect = viewport.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    let best = null;
    let bestDist = HIT_RADIUS_PX;

    for (const marker of markers) {
      const point = resolveScreenPoint(marker);
      if (!point) continue;
      const dx = point.x - localX;
      const dy = point.y - localY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= bestDist) {
        bestDist = dist;
        best = marker;
      }
    }

    return best;
  }

  function destroy() {
    layer.remove();
    elementsById.clear();
    markers = [];
  }

  return {
    setMarkers,
    getMarkers,
    updatePositions,
    hitTest,
    destroy,
    getLayerElement: () => layer,
  };
}

window.SonarMapMarkers = {
  COLOR_PRESETS: MARKER_COLOR_PRESETS,
  colorHexForId,
  createMarkerId,
  createMarkerLayer,
};
