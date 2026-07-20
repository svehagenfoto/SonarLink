/**
 * In-memory fog grid + markers shared between minimap and world map.
 * Minimap is the primary fog writer; either side may update markers.
 */

const { normalizeMarkers } = require('./mapFogStore');

let sessionFog = null;
let sessionSaveFile = null;
let sessionMarkers = [];

function setSession(payload) {
  if (!payload || !payload.fog) return false;
  sessionFog = payload.fog;
  sessionSaveFile = typeof payload.saveFile === 'string' ? payload.saveFile : null;

  if (Object.prototype.hasOwnProperty.call(payload, 'markers')) {
    sessionMarkers = normalizeMarkers(payload.markers);
  }

  return true;
}

function setMarkers(markers) {
  sessionMarkers = normalizeMarkers(markers);
  return sessionMarkers;
}

function clearSession() {
  sessionFog = null;
  sessionSaveFile = null;
  sessionMarkers = [];
}

function getSession() {
  if (!sessionFog) return null;
  return {
    fog: sessionFog,
    saveFile: sessionSaveFile,
    markers: sessionMarkers,
  };
}

module.exports = {
  setSession,
  setMarkers,
  clearSession,
  getSession,
};
