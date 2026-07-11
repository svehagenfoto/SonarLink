const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { assetPath } = require('./paths');

let tray = null;

function loadTrayIcon() {
  const tray32 = assetPath('tray-32.png');
  const tray16 = assetPath('tray-16.png');
  const file = fs.existsSync(tray32) ? tray32 : tray16;
  if (!fs.existsSync(file)) return nativeImage.createEmpty();
  return nativeImage.createFromPath(file);
}

function createTray({ onRestart, onQuit }) {
  if (tray) return tray;

  tray = new Tray(loadTrayIcon());
  tray.setToolTip('SonarLink');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Restart SonarLink',
      click: () => onRestart(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => onQuit(),
    },
  ]);

  tray.setContextMenu(menu);
  return tray;
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = {
  createTray,
  destroyTray,
};
