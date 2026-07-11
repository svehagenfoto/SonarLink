const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function getProjectRoot() {
  if (app.isPackaged) {
    return path.dirname(process.execPath);
  }
  return path.join(__dirname, '..', '..');
}

/** App content root (src in dev, app.asar when packaged). Use for bundled files. */
function getAppContentRoot() {
  if (app.isPackaged) {
    return app.getAppPath();
  }
  return path.join(__dirname, '..', '..');
}

function getGeneratedAssetsDir() {
  const dev = path.join(getProjectRoot(), 'Assets', 'generated');
  if (fs.existsSync(dev)) return dev;

  const packaged = path.join(process.resourcesPath, 'assets');
  if (fs.existsSync(packaged)) return packaged;

  return dev;
}

function assetPath(name) {
  return path.join(getGeneratedAssetsDir(), name);
}

module.exports = {
  getProjectRoot,
  getAppContentRoot,
  getGeneratedAssetsDir,
  assetPath,
};
