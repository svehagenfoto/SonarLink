/**
 * In-memory fog grid shared between minimap and world map for the active session.
 * Minimap is the writer; world map reads and renders the same revealed area.
 */

let sessionFog = null;
let sessionSaveFile = null;

function setSession(payload) {
  if (!payload || !payload.fog) return false;
  sessionFog = payload.fog;
  sessionSaveFile = typeof payload.saveFile === 'string' ? payload.saveFile : null;
  return true;
}

function clearSession() {
  sessionFog = null;
  sessionSaveFile = null;
}

function getSession() {
  if (!sessionFog) return null;
  return {
    fog: sessionFog,
    saveFile: sessionSaveFile,
  };
}

module.exports = {
  setSession,
  clearSession,
  getSession,
};
