const fs = require('fs');
const path = require('path');
const {
  LEGACY_CONFIG_DIR,
  isDataRootValid,
  clearAllLocationPointers,
} = require('./dataRoot');
const { getDataRoot, setDataRoot, readConfig } = require('./configStore');

function removePath(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) return;
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function clearLocationPointer() {
  clearAllLocationPointers();
}

function resetSonarLinkDataRoot(dataRoot) {
  if (!dataRoot || !isDataRootValid(dataRoot)) return;
  const entries = fs.readdirSync(dataRoot);
  for (const entry of entries) {
    removePath(path.join(dataRoot, entry));
  }
}

function resetGameModFiles(gameWin64Dir) {
  if (!gameWin64Dir || !fs.existsSync(gameWin64Dir)) return;

  removePath(path.join(gameWin64Dir, 'dwmapi.dll'));
  removePath(path.join(gameWin64Dir, 'ue4ss'));
}

function resetLegacyAppData() {
  removePath(LEGACY_CONFIG_DIR);
}

function resetAllForTesting() {
  const config = readConfig();
  const dataRoot = getDataRoot();
  const gameWin64Dir = config.gameWin64Dir;

  if (dataRoot) {
    resetSonarLinkDataRoot(dataRoot);
  }

  resetGameModFiles(gameWin64Dir);
  resetLegacyAppData();
  clearLocationPointer();
  setDataRoot(null);

  return {
    ok: true,
    clearedDataRoot: dataRoot || null,
    clearedGameDir: gameWin64Dir || null,
  };
}

module.exports = {
  resetAllForTesting,
  clearLocationPointer,
};
