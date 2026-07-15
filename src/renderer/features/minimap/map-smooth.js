/**
 * Smooth minimap pan and rotation between telemetry updates.
 */

const MAP_RENDER_FPS = 30;
const MIN_FRAME_MS = 1000 / MAP_RENDER_FPS;

function lerpFactor(deltaMs, smoothMs) {
  if (!smoothMs || smoothMs <= 0) return 1;
  return 1 - Math.exp(-deltaMs / smoothMs);
}

function lerpAngle(current, target, amount) {
  let delta = target - current;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return current + delta * amount;
}

function createMapSmoothController(options) {
  const {
    core,
    mapLayer,
    mapImage,
    fogController = null,
    positionSmoothMs = 300,
    rotationSmoothMs = 250,
  } = options;

  let rafId = null;
  let lastFrameAt = 0;
  let active = false;
  let hasTarget = false;
  let snapNext = true;

  const current = { centerU: 0.5, centerV: 0.5, heading: 0 };
  const target = { centerU: 0.5, centerV: 0.5, heading: 0 };

  function renderFrame(now) {
    rafId = requestAnimationFrame(renderFrame);

    if (!active || !hasTarget) return;

    if (lastFrameAt && now - lastFrameAt < MIN_FRAME_MS) {
      return;
    }

    const deltaMs = lastFrameAt ? now - lastFrameAt : MIN_FRAME_MS;
    lastFrameAt = now;

    if (snapNext) {
      current.centerU = target.centerU;
      current.centerV = target.centerV;
      current.heading = target.heading;
      snapNext = false;
    } else {
      const posAmount = lerpFactor(deltaMs, positionSmoothMs);
      const rotAmount = lerpFactor(deltaMs, rotationSmoothMs);
      current.centerU += (target.centerU - current.centerU) * posAmount;
      current.centerV += (target.centerV - current.centerV) * posAmount;
      current.heading = lerpAngle(current.heading, target.heading, rotAmount);
    }

    const view = {
      ...window.SonarMapView.MAP_VIEW,
      centerU: current.centerU,
      centerV: current.centerV,
      heading: current.heading,
    };

    window.SonarMapView.applyMapViewport(mapImage, core, view);
    window.SonarMapView.applyMapRotation(mapLayer, current.heading);
    fogController?.onViewUpdate(view);
  }

  function start() {
    if (rafId !== null) return;
    lastFrameAt = 0;
    rafId = requestAnimationFrame(renderFrame);
  }

  function stop() {
    if (rafId === null) return;
    cancelAnimationFrame(rafId);
    rafId = null;
    lastFrameAt = 0;
  }

  function setTarget(view) {
    target.centerU = view.centerU;
    target.centerV = view.centerV;
    target.heading = view.heading;
    hasTarget = true;
  }

  return {
    beginLive(view) {
      const firstLive = !active;
      active = true;
      setTarget(view);
      snapNext = firstLive;
      start();
    },

    updateTarget(view) {
      if (!active) return;
      setTarget(view);
    },

    endLive() {
      active = false;
      hasTarget = false;
      snapNext = true;
      stop();
    },

    stop,
  };
}

window.SonarMapSmooth = {
  createMapSmoothController,
};
