/**
 * Shared save pending status for minimap and world map.
 */

function applySavePendingState(element, options = {}) {
  if (!element) return;

  const { live = false, saveFile = null } = options;
  const awaitingSave = live && !saveFile;
  element.dataset.savePending = awaitingSave ? 'true' : 'false';
}

window.SonarMapSavePending = {
  applySavePendingState,
};
