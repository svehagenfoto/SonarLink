/**
 * In-memory temporary waypoint shared by world map and minimap.
 * Never written to disk.
 */

let waypoint = null;

function normalizeWaypoint(payload) {
  if (!payload) return null;

  const u = Number(payload.u);
  const v = Number(payload.v);
  const x = Number(payload.x);
  const y = Number(payload.y);
  const placedAt = Number(payload.placedAt);
  const placed = Number.isFinite(placedAt) ? placedAt : Date.now();

  if (Number.isFinite(u) && Number.isFinite(v)) {
    return {
      u,
      v,
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      placedAt: placed,
    };
  }

  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { x, y, placedAt: placed };
  }

  return null;
}

function getWaypoint() {
  return waypoint ? { ...waypoint } : null;
}

function setWaypoint(payload) {
  waypoint = normalizeWaypoint(payload);
  return getWaypoint();
}

function clearWaypoint() {
  waypoint = null;
  return null;
}

module.exports = {
  getWaypoint,
  setWaypoint,
  clearWaypoint,
};
