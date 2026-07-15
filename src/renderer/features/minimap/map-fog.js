/**
 * Fog of war in map UV space. Reveals a smooth circle around the player.
 */

const FOG_GRID_WIDTH = 114;
const FOG_GRID_HEIGHT = 48;
const REVEAL_RADIUS_CELLS = 1.35;
const REVEAL_SOFT_EDGE = 0.55;
const REVEAL_STAMP_MIN_WORLD = 0.08;
const FOG_COLOR = '#03080c';
const MAX_REVEAL_SPEED = 50;
const MAX_REVEAL_SPEED_BUFFER = 8;
const HARD_TELEPORT_DISTANCE = 120;
const MIN_REVEAL_DELTA_S = 0.75;
const MAX_GAP_FOR_SPEED_CHECK_S = 12;

function createFogController(options) {
  const { core, mapLayer, shape = 'square' } = options;
  const canvas = document.createElement('canvas');
  canvas.className = 'sonar-minimap-fog-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  mapLayer.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const revealed = new Uint8Array(FOG_GRID_WIDTH * FOG_GRID_HEIGHT);
  const revealStamps = [];
  let lastTelemetrySample = null;

  function getViewportSize() {
    if (shape === 'rect') {
      return {
        width: core.clientWidth,
        height: core.clientHeight,
      };
    }

    const size = core.clientWidth;
    return { width: size, height: size };
  }

  function fillFogBackground() {
    const { width, height } = getViewportSize();
    if (!width || !height) return;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = FOG_COLOR;
    ctx.fillRect(0, 0, width, height);
  }

  function gridIndex(gx, gy) {
    return gy * FOG_GRID_WIDTH + gx;
  }

  function resize() {
    const { width, height } = getViewportSize();
    if (!width || !height) return false;

    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.round(width * dpr);
    const pxH = Math.round(height * dpr);
    if (canvas.width === pxW && canvas.height === pxH) {
      return true;
    }

    canvas.width = pxW;
    canvas.height = pxH;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function getMapLayout(view) {
    const { width, height } = getViewportSize();
    const scale = width / view.visibleWidth;
    const imgW = view.imageWidth * scale;
    const imgH = view.imageHeight * scale;
    const left = width * 0.5 - view.centerU * imgW;
    const top = height * 0.5 - view.centerV * imgH;

    return { imgW, imgH, left, top, viewportWidth: width, viewportHeight: height };
  }

  function uvToScreen(u, v, view) {
    const { imgW, imgH, left, top } = getMapLayout(view);
    return {
      x: left + u * imgW,
      y: top + v * imgH,
    };
  }

  function getRevealRadiusPx(view) {
    const { imgW } = getMapLayout(view);
    return (REVEAL_RADIUS_CELLS / FOG_GRID_WIDTH) * imgW;
  }

  function punchSmoothCircle(x, y, radiusPx) {
    if (radiusPx <= 0) return;

    const inner = Math.max(0, radiusPx * (1 - REVEAL_SOFT_EDGE));
    const gradient = ctx.createRadialGradient(x, y, inner * 0.2, x, y, radiusPx);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(0.75, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radiusPx, 0, Math.PI * 2);
    ctx.fill();
  }

  function redrawFog(view) {
    if (!resize()) return;

    const { width, height } = getViewportSize();
    if (!width || !height || !view) return;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = FOG_COLOR;
    ctx.fillRect(0, 0, width, height);

    const radiusPx = getRevealRadiusPx(view);
    ctx.globalCompositeOperation = 'destination-out';

    for (let gy = 0; gy < FOG_GRID_HEIGHT; gy += 1) {
      for (let gx = 0; gx < FOG_GRID_WIDTH; gx += 1) {
        if (!revealed[gridIndex(gx, gy)]) continue;

        const u = (gx + 0.5) / FOG_GRID_WIDTH;
        const v = (gy + 0.5) / FOG_GRID_HEIGHT;
        const screen = uvToScreen(u, v, view);
        punchSmoothCircle(screen.x, screen.y, radiusPx);
      }
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  function isPlausibleStep(telemetry) {
    if (!telemetry || !Number.isFinite(telemetry.x) || !Number.isFinite(telemetry.y)) {
      return false;
    }

    if (!lastTelemetrySample) return true;

    const dx = telemetry.x - lastTelemetrySample.x;
    const dy = telemetry.y - lastTelemetrySample.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.5) return true;

    const ts = Number.isFinite(telemetry.ts) ? telemetry.ts : Date.now();
    const deltaS = Math.max((ts - lastTelemetrySample.ts) / 1000, MIN_REVEAL_DELTA_S);

    if (distance > HARD_TELEPORT_DISTANCE) return false;

    if (deltaS <= MAX_GAP_FOR_SPEED_CHECK_S) {
      const maxDistance = (MAX_REVEAL_SPEED * deltaS) + MAX_REVEAL_SPEED_BUFFER;
      if (distance > maxDistance) return false;
    }

    return true;
  }

  function shouldAddStamp(telemetry) {
    if (!revealStamps.length) return true;

    const last = revealStamps[revealStamps.length - 1];
    const dx = telemetry.x - last.x;
    const dy = telemetry.y - last.y;
    const minWorldSq = REVEAL_STAMP_MIN_WORLD * REVEAL_STAMP_MIN_WORLD;
    return (dx * dx) + (dy * dy) >= minWorldSq;
  }

  function markRevealAtUV(u, v) {
    const cx = u * FOG_GRID_WIDTH;
    const cy = v * FOG_GRID_HEIGHT;
    const radiusSq = REVEAL_RADIUS_CELLS * REVEAL_RADIUS_CELLS;

    const minGx = Math.max(0, Math.floor(cx - REVEAL_RADIUS_CELLS));
    const maxGx = Math.min(FOG_GRID_WIDTH - 1, Math.ceil(cx + REVEAL_RADIUS_CELLS));
    const minGy = Math.max(0, Math.floor(cy - REVEAL_RADIUS_CELLS));
    const maxGy = Math.min(FOG_GRID_HEIGHT - 1, Math.ceil(cy + REVEAL_RADIUS_CELLS));

    for (let gy = minGy; gy <= maxGy; gy += 1) {
      for (let gx = minGx; gx <= maxGx; gx += 1) {
        const cellDx = (gx + 0.5) - cx;
        const cellDy = (gy + 0.5) - cy;
        if ((cellDx * cellDx) + (cellDy * cellDy) > radiusSq) continue;

        const idx = gridIndex(gx, gy);
        if (revealed[idx]) continue;
        revealed[idx] = 1;
      }
    }
  }

  function commitReveal(telemetry, view) {
    if (!telemetry || !view) return false;

    const ts = Number.isFinite(telemetry.ts) ? telemetry.ts : Date.now();
    const plausible = isPlausibleStep(telemetry);

    lastTelemetrySample = {
      x: telemetry.x,
      y: telemetry.y,
      ts,
    };

    if (!plausible || !shouldAddStamp(telemetry)) {
      return false;
    }

    const u = view.centerU;
    const v = view.centerV;
    revealStamps.push({ u, v, x: telemetry.x, y: telemetry.y });
    markRevealAtUV(u, v);
    return true;
  }

  function reset() {
    revealed.fill(0);
    revealStamps.length = 0;
    lastTelemetrySample = null;
    resize();
    fillFogBackground();
  }

  function onViewUpdate(view) {
    if (!view) return;
    redrawFog(view);
  }

  function exportState() {
    let count = 0;
    for (let i = 0; i < revealed.length; i += 1) {
      if (revealed[i]) count += 1;
    }

    return {
      gridWidth: FOG_GRID_WIDTH,
      gridHeight: FOG_GRID_HEIGHT,
      revealed: btoa(String.fromCharCode.apply(null, revealed)),
      exploredPercent: Math.round((count / revealed.length) * 1000) / 10,
    };
  }

  function importState(data) {
    revealed.fill(0);
    revealStamps.length = 0;
    lastTelemetrySample = null;

    if (!data?.revealed) {
      resize();
      fillFogBackground();
      return;
    }

    try {
      const binary = atob(data.revealed);
      const len = Math.min(binary.length, revealed.length);
      for (let i = 0; i < len; i += 1) {
        revealed[i] = binary.charCodeAt(i) ? 1 : 0;
      }
    } catch {
      revealed.fill(0);
    }

    resize();
    fillFogBackground();
  }

  function mergeState(data) {
    if (!data?.revealed) return false;

    let changed = false;

    try {
      const binary = atob(data.revealed);
      const len = Math.min(binary.length, revealed.length);
      for (let i = 0; i < len; i += 1) {
        if (!binary.charCodeAt(i) || revealed[i]) continue;
        revealed[i] = 1;
        changed = true;
      }
    } catch {
      return false;
    }

    return changed;
  }

  function hasExploredArea() {
    for (let i = 0; i < revealed.length; i += 1) {
      if (revealed[i]) return true;
    }
    return false;
  }

  function clearMovementHistory() {
    lastTelemetrySample = null;
  }

  function destroy() {
    canvas.remove();
  }

  reset();

  return {
    onViewUpdate,
    commitReveal,
    exportState,
    importState,
    mergeState,
    hasExploredArea,
    clearMovementHistory,
    reset,
    destroy,
  };
}

window.SonarMapFog = {
  FOG_GRID_WIDTH,
  FOG_GRID_HEIGHT,
  createFogController,
};
