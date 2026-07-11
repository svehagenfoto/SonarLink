const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sonarlink', {
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  getInitialState: () => ipcRenderer.invoke('get-initial-state'),
  onGameDetected: (cb) => {
    ipcRenderer.on('game-detected', () => cb());
  },
  onStartupUpdate: (cb) => {
    ipcRenderer.on('startup-update', (_event, payload) => cb(payload));
  },
  onStartupError: (cb) => {
    ipcRenderer.on('startup-error', (_event, payload) => cb(payload));
  },
  pickDataFolder: () => ipcRenderer.invoke('startup-pick-data-folder'),
  // TEMP DEV
  skipToMenu: () => ipcRenderer.invoke('startup-skip-to-menu'),
  uninstallSonarLink: () => ipcRenderer.invoke('startup-uninstall-sonarlink'),
  setThirdPersonEnabled: (enabled) => ipcRenderer.invoke('set-third-person-enabled', enabled),
  setThirdPersonBind: (key) => ipcRenderer.invoke('set-third-person-bind', key),
  setThirdPersonDistance: (percent) => ipcRenderer.invoke('set-third-person-distance', percent, { smooth: true }),
  setThirdPersonDistancePreview: (percent) => ipcRenderer.invoke('set-third-person-distance', percent, { smooth: false }),
  getThirdPersonState: () => ipcRenderer.invoke('get-third-person-state'),
  onThirdPersonCameraState: (cb) => {
    ipcRenderer.on('third-person-camera-state', (_event, payload) => cb(payload));
  },
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),
});
