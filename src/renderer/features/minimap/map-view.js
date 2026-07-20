/**
 * Minimap viewport config and layout.
 */

const MAP_IMAGE_WIDTH = 9145;
const MAP_IMAGE_HEIGHT = 3845;

const MAP_VIEW = {
  imageWidth: MAP_IMAGE_WIDTH,
  imageHeight: MAP_IMAGE_HEIGHT,
  centerU: 0.5,
  centerV: 0.5,
  visibleWidth: 950,
};

function applyMapViewport(image, viewport, view = MAP_VIEW) {
  const size = viewport.clientWidth;
  if (!size || !view.visibleWidth) return;

  const scale = size / view.visibleWidth;
  const width = view.imageWidth * scale;
  const height = view.imageHeight * scale;
  const left = size * 0.5 - view.centerU * width;
  const top = size * 0.5 - view.centerV * height;

  image.style.width = `${width}px`;
  image.style.height = `${height}px`;
  image.style.left = `${left}px`;
  image.style.top = `${top}px`;
}

function applyMapViewportRect(image, viewport, view = MAP_VIEW) {
  const vpW = viewport.clientWidth;
  const vpH = viewport.clientHeight;
  if (!vpW || !vpH || !view.visibleWidth) return;

  const scale = vpW / view.visibleWidth;
  const width = view.imageWidth * scale;
  const height = view.imageHeight * scale;
  const left = vpW * 0.5 - view.centerU * width;
  const top = vpH * 0.5 - view.centerV * height;

  image.style.width = `${width}px`;
  image.style.height = `${height}px`;
  image.style.left = `${left}px`;
  image.style.top = `${top}px`;
}

function buildFitAllView(viewportWidth, viewportHeight) {
  const vpW = Math.max(1, Number(viewportWidth) || 0);
  const vpH = Math.max(1, Number(viewportHeight) || 0);
  const visibleWidth = Math.max(
    MAP_IMAGE_WIDTH,
    (MAP_IMAGE_HEIGHT * vpW) / vpH,
  );

  return {
    imageWidth: MAP_IMAGE_WIDTH,
    imageHeight: MAP_IMAGE_HEIGHT,
    centerU: 0.5,
    centerV: 0.5,
    visibleWidth,
  };
}

function mapUvToScreenRect(viewport, view, u, v) {
  const vpW = viewport.clientWidth;
  const vpH = viewport.clientHeight;
  if (!vpW || !vpH || !view?.visibleWidth) return null;

  const scale = vpW / view.visibleWidth;
  const imgW = view.imageWidth * scale;
  const imgH = view.imageHeight * scale;
  const left = vpW * 0.5 - view.centerU * imgW;
  const top = vpH * 0.5 - view.centerV * imgH;

  return {
    x: left + u * imgW,
    y: top + v * imgH,
  };
}

function screenRectToMapUv(viewport, view, screenX, screenY) {
  const vpW = viewport.clientWidth;
  const vpH = viewport.clientHeight;
  if (!vpW || !vpH || !view?.visibleWidth) return null;

  const scale = vpW / view.visibleWidth;
  const imgW = view.imageWidth * scale;
  const imgH = view.imageHeight * scale;
  if (!imgW || !imgH) return null;

  const left = vpW * 0.5 - view.centerU * imgW;
  const top = vpH * 0.5 - view.centerV * imgH;
  const u = (screenX - left) / imgW;
  const v = (screenY - top) / imgH;

  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;

  return { u, v };
}

/** Same as screenRectToMapUv, but snaps outside clicks onto the map edge. */
function screenRectToMapUvClamped(viewport, view, screenX, screenY) {
  const vpW = viewport.clientWidth;
  const vpH = viewport.clientHeight;
  if (!vpW || !vpH || !view?.visibleWidth) return null;

  const scale = vpW / view.visibleWidth;
  const imgW = view.imageWidth * scale;
  const imgH = view.imageHeight * scale;
  if (!imgW || !imgH) return null;

  const left = vpW * 0.5 - view.centerU * imgW;
  const top = vpH * 0.5 - view.centerV * imgH;
  const u = (screenX - left) / imgW;
  const v = (screenY - top) / imgH;

  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;

  return {
    u: Math.max(0, Math.min(1, u)),
    v: Math.max(0, Math.min(1, v)),
  };
}

function buildViewFromTelemetry(telemetry) {
  const uv = window.SonarMapProjection.worldToMapUV(telemetry.x, telemetry.y);
  if (!uv) return null;

  const heading = window.SonarMapProjection.headingFromForward(
    telemetry.forwardX,
    telemetry.forwardY
  );

  return {
    ...MAP_VIEW,
    centerU: uv.u,
    centerV: uv.v,
    heading,
  };
}

function applyMapRotation(mapLayer, heading) {
  if (!mapLayer || !Number.isFinite(heading)) {
    mapLayer.style.transform = '';
    return;
  }
  const rotation = window.SonarMapProjection.mapRotationFromHeading(heading);
  mapLayer.style.transform = `rotate(${rotation}deg)`;
}

window.SonarMapView = {
  MAP_VIEW,
  MAP_IMAGE_WIDTH,
  MAP_IMAGE_HEIGHT,
  applyMapViewport,
  applyMapViewportRect,
  applyMapRotation,
  buildViewFromTelemetry,
  buildFitAllView,
  mapUvToScreenRect,
  screenRectToMapUv,
  screenRectToMapUvClamped,
};
