/**
 * Temporary red waypoint overlay (world map + minimap).
 * Not persisted. Hit-test is for world map only.
 */

/* Sonar beacon shape; red for clear temporary target. */
const WAYPOINT_COLOR = '#ff2d2d';
const WAYPOINT_COLOR_SOFT = 'rgba(255, 45, 45, 0.42)';
const WAYPOINT_OUTLINE = '#061820';
const ARRIVE_RADIUS_WORLD = 2500;
const ARRIVE_GRACE_MS = 3000;
const HIT_RADIUS_PX = 18;
const CIRCLE_RADIUS_PX = 6.5;
const LINE_DASH = '12 9';
const LINE_WIDTH = '2.25';
const LINE_OUTLINE_WIDTH = '4';

function resolveLayerPoint(viewport, view, u, v) {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (!width || !height || !view?.visibleWidth) return null;

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

/**
 * Minimap draws on the fixed core (player stays centered). Map layer rotates
 * underneath, so UV points must be rotated around the core center to match.
 */
function resolveMinimapScreenPoint(viewport, view, u, v) {
  const point = resolveLayerPoint(viewport, view, u, v);
  if (!point) return null;

  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const heading = Number.isFinite(view.heading) ? view.heading : 0;
  const rotDeg = window.SonarMapProjection.mapRotationFromHeading(heading);
  const rot = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const dx = point.x - cx;
  const dy = point.y - cy;

  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

function resolveScreenPoint(viewport, view, u, v, mode) {
  if (mode === 'minimap') {
    return resolveMinimapScreenPoint(viewport, view, u, v);
  }
  if (mode === 'screen') {
    return window.SonarMapView.mapUvToScreenRect(viewport, view, u, v);
  }
  return resolveLayerPoint(viewport, view, u, v);
}

function createWaypointOverlay(options) {
  const {
    container,
    getViewport,
    getView,
    mode = 'screen',
  } = options;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('sonar-map-waypoint-layer');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.pointerEvents = 'none';

  const lineOutline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  lineOutline.classList.add('sonar-map-waypoint-line-outline');
  lineOutline.setAttribute('stroke', WAYPOINT_OUTLINE);
  lineOutline.setAttribute('stroke-width', LINE_OUTLINE_WIDTH);
  lineOutline.setAttribute('stroke-dasharray', LINE_DASH);
  lineOutline.setAttribute('stroke-linecap', 'round');
  lineOutline.setAttribute('fill', 'none');

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.classList.add('sonar-map-waypoint-line');
  line.setAttribute('stroke', WAYPOINT_COLOR);
  line.setAttribute('stroke-width', LINE_WIDTH);
  line.setAttribute('stroke-dasharray', LINE_DASH);
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('fill', 'none');

  const circleOutline = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circleOutline.classList.add('sonar-map-waypoint-circle-outline');
  circleOutline.setAttribute('r', String(CIRCLE_RADIUS_PX + 2));
  circleOutline.setAttribute('fill', 'none');
  circleOutline.setAttribute('stroke', WAYPOINT_OUTLINE);
  circleOutline.setAttribute('stroke-width', '2.5');

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.classList.add('sonar-map-waypoint-circle');
  circle.setAttribute('r', String(CIRCLE_RADIUS_PX));
  circle.setAttribute('fill', WAYPOINT_COLOR_SOFT);
  circle.setAttribute('stroke', WAYPOINT_COLOR);
  circle.setAttribute('stroke-width', '2');

  const circleCore = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circleCore.classList.add('sonar-map-waypoint-circle-core');
  circleCore.setAttribute('r', '2');
  circleCore.setAttribute('fill', WAYPOINT_COLOR);
  circleCore.setAttribute('stroke', WAYPOINT_OUTLINE);
  circleCore.setAttribute('stroke-width', '1');

  svg.appendChild(lineOutline);
  svg.appendChild(line);
  svg.appendChild(circleOutline);
  svg.appendChild(circle);
  svg.appendChild(circleCore);
  container.appendChild(svg);

  let waypoint = null;
  let playerUv = null;

  function setHidden(hidden) {
    svg.style.visibility = hidden ? 'hidden' : 'visible';
    if (hidden) {
      line.style.visibility = 'hidden';
      lineOutline.style.visibility = 'hidden';
    }
  }

  function resolvePlacedAt(next, previous) {
    if (Number.isFinite(next?.placedAt)) return next.placedAt;
    if (
      previous &&
      Number.isFinite(previous.placedAt) &&
      Number(previous.x) === Number(next?.x) &&
      Number(previous.y) === Number(next?.y)
    ) {
      return previous.placedAt;
    }
    return Date.now();
  }

  function setWaypoint(next) {
    if (
      next &&
      Number.isFinite(next.u) &&
      Number.isFinite(next.v)
    ) {
      waypoint = {
        x: Number(next.x),
        y: Number(next.y),
        u: next.u,
        v: next.v,
        placedAt: resolvePlacedAt(next, waypoint),
      };
      update();
      return;
    }

    if (
      next &&
      Number.isFinite(next.x) &&
      Number.isFinite(next.y)
    ) {
      const uv = window.SonarMapProjection.worldToMapUV(next.x, next.y);
      if (!uv) {
        waypoint = null;
      } else {
        waypoint = {
          x: next.x,
          y: next.y,
          u: uv.u,
          v: uv.v,
          placedAt: resolvePlacedAt(next, waypoint),
        };
      }
    } else {
      waypoint = null;
    }
    update();
  }

  function clear() {
    waypoint = null;
    line.style.visibility = 'hidden';
    lineOutline.style.visibility = 'hidden';
    update();
  }

  function getWaypoint() {
    return waypoint ? { x: waypoint.x, y: waypoint.y, u: waypoint.u, v: waypoint.v } : null;
  }

  function setPlayerWorld(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      playerUv = null;
      update();
      return;
    }
    playerUv = window.SonarMapProjection.worldToMapUV(x, y);
    update();
  }

  function clearPlayer() {
    playerUv = null;
    update();
  }

  function distanceToPlayer(playerX, playerY) {
    if (!waypoint || !Number.isFinite(playerX) || !Number.isFinite(playerY)) {
      return null;
    }
    if (!Number.isFinite(waypoint.x) || !Number.isFinite(waypoint.y)) {
      return null;
    }
    const dx = playerX - waypoint.x;
    const dy = playerY - waypoint.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function hasArrived(playerX, playerY) {
    if (!waypoint) return false;
    if (!Number.isFinite(waypoint.x) || !Number.isFinite(waypoint.y)) {
      return false;
    }
    if (waypoint.x === 0 && waypoint.y === 0 && Number.isFinite(waypoint.u)) {
      return false;
    }
    if (
      Number.isFinite(waypoint.placedAt) &&
      Date.now() - waypoint.placedAt < ARRIVE_GRACE_MS
    ) {
      return false;
    }
    const dist = distanceToPlayer(playerX, playerY);
    return dist !== null && dist <= ARRIVE_RADIUS_WORLD;
  }

  function update() {
    const viewport = getViewport();
    const view = getView();
    if (!viewport || !view || !waypoint) {
      setHidden(true);
      return;
    }

    const to = resolveScreenPoint(viewport, view, waypoint.u, waypoint.v, mode);
    if (!to) {
      setHidden(true);
      return;
    }

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

    // Line from player. Prefer live player UV; fall back to view center
    // (minimap keeps the player centered, so this always draws a visible ray).
    const fromUv =
      playerUv ||
      (view &&
      Number.isFinite(view.centerU) &&
      Number.isFinite(view.centerV)
        ? { u: view.centerU, v: view.centerV }
        : null);

    if (fromUv) {
      const from = resolveScreenPoint(
        viewport,
        view,
        fromUv.u,
        fromUv.v,
        mode,
      );
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

  function hitTest(clientX, clientY) {
    if (!waypoint) return false;
    const viewport = getViewport();
    const view = getView();
    if (!viewport || !view) return false;

    const point = resolveScreenPoint(
      viewport,
      view,
      waypoint.u,
      waypoint.v,
      mode,
    );
    if (!point) return false;

    const rect = viewport.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const dx = point.x - localX;
    const dy = point.y - localY;
    return Math.sqrt(dx * dx + dy * dy) <= HIT_RADIUS_PX;
  }

  function destroy() {
    svg.remove();
    waypoint = null;
    playerUv = null;
  }

  setHidden(true);

  return {
    setWaypoint,
    clear,
    getWaypoint,
    setPlayerWorld,
    clearPlayer,
    hasArrived,
    update,
    hitTest,
    destroy,
    getElement: () => svg,
  };
}

window.SonarMapWaypoint = {
  WAYPOINT_COLOR,
  ARRIVE_RADIUS_WORLD,
  createWaypointOverlay,
};
