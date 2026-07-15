/**
 * MapGenie projection for sn2-v0.1.png.
 * Constants from Simple Minimap config.lua (MapGenie mode).
 */

const MAP_GENIE = {
  lngFromXScale: 0.0000028912681189998626,
  lngFromXOffset: -0.049961343800042045,
  latFromYScale: -0.000002992336954998909,
  latFromYOffset: 2.0063350541995395,
  boundsWest: -1.13,
  boundsEast: -0.345,
  boundsSouth: 0.565,
  boundsNorth: 0.895,
};

let projectionCache = null;

function mercatorY(lat) {
  const rad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

function getProjection() {
  if (projectionCache) return projectionCache;

  const top = mercatorY(MAP_GENIE.boundsNorth);
  const bottom = mercatorY(MAP_GENIE.boundsSouth);
  if (bottom === top) {
    projectionCache = { valid: false };
    return projectionCache;
  }

  projectionCache = {
    valid: true,
    west: MAP_GENIE.boundsWest,
    top,
    invLngRange: 1 / (MAP_GENIE.boundsEast - MAP_GENIE.boundsWest),
    invMercatorRange: 1 / (bottom - top),
  };
  return projectionCache;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function worldToMapUV(worldX, worldY) {
  const projection = getProjection();
  if (!projection.valid) return null;

  const lng = worldX * MAP_GENIE.lngFromXScale + MAP_GENIE.lngFromXOffset;
  const lat = worldY * MAP_GENIE.latFromYScale + MAP_GENIE.latFromYOffset;
  const u = clamp01((lng - projection.west) * projection.invLngRange);
  const v = clamp01((mercatorY(lat) - projection.top) * projection.invMercatorRange);

  return { u, v };
}

function headingFromForward(forwardX, forwardY) {
  return (Math.atan2(forwardY, forwardX) * 180) / Math.PI;
}

// MapGenie image axis vs UE forward vector is 90 degrees apart.
const MAP_HEADING_OFFSET = -90;

function mapRotationFromHeading(heading) {
  return -heading + MAP_HEADING_OFFSET;
}

function arrowRotationFromHeading(heading) {
  return -mapRotationFromHeading(heading);
}

window.SonarMapProjection = {
  worldToMapUV,
  headingFromForward,
  mapRotationFromHeading,
  arrowRotationFromHeading,
};
