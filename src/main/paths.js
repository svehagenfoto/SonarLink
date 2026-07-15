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

function mapImagePath() {
  const devPath = path.join(getAppContentRoot(), 'Assets', 'sn2map', 'sn2-v0.1.png');
  if (fs.existsSync(devPath)) return devPath;

  return path.join(process.resourcesPath, 'sn2map', 'sn2-v0.1.png');
}

function sonarLinkImagePath() {
  const masterPath = path.join(getAppContentRoot(), 'Assets', 'SonarLink.png');
  if (fs.existsSync(masterPath)) return masterPath;

  return assetPath('logo-256.png');
}

module.exports = {
  getProjectRoot,
  getAppContentRoot,
  getGeneratedAssetsDir,
  assetPath,
  mapImagePath,
  sonarLinkImagePath,
};
