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
  uninstallSonarLink: () => ipcRenderer.invoke('startup-uninstall-sonarlink'),
  setThirdPersonEnabled: (enabled) => ipcRenderer.invoke('set-third-person-enabled', enabled),
  setThirdPersonBind: (key) => ipcRenderer.invoke('set-third-person-bind', key),
  setThirdPersonDistance: (percent) => ipcRenderer.invoke('set-third-person-distance', percent, { smooth: true }),
  setThirdPersonDistancePreview: (percent) => ipcRenderer.invoke('set-third-person-distance', percent, { smooth: false }),
  getThirdPersonState: () => ipcRenderer.invoke('get-third-person-state'),
  onThirdPersonCameraState: (cb) => {
    ipcRenderer.on('third-person-camera-state', (_event, payload) => cb(payload));
  },
  getCustomizeProfile: () => ipcRenderer.invoke('get-customize-profile'),
  onCustomizeProfileChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('customize-profile-changed', listener);
    return () => ipcRenderer.removeListener('customize-profile-changed', listener);
  },
  setMinimapEnabled: (enabled) => ipcRenderer.invoke('set-minimap-enabled', enabled),
  getMinimapSettings: () => ipcRenderer.invoke('get-minimap-settings'),
  setMinimapSize: (percent, options) => ipcRenderer.invoke('set-minimap-size', percent, options),
  setMinimapMapBind: (key) => ipcRenderer.invoke('set-minimap-map-bind', key),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  listMapFogSaves: () => ipcRenderer.invoke('list-map-fog-saves'),
  deleteMapFogSave: (saveId) => ipcRenderer.invoke('delete-map-fog-save', saveId),
  deleteOrphanMapFogSaves: () => ipcRenderer.invoke('delete-orphan-map-fog-saves'),
  onMapFogSavesChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('map-fog-saves-changed', listener);
    return () => ipcRenderer.removeListener('map-fog-saves-changed', listener);
  },
  listWorldSettingsSaves: () => ipcRenderer.invoke('list-world-settings-saves'),
  deleteWorldSettingsSave: (saveId) => ipcRenderer.invoke('delete-world-settings-save', saveId),
  deleteOrphanWorldSettingsSaves: () => ipcRenderer.invoke('delete-orphan-world-settings-saves'),
  onWorldSettingsSavesChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('world-settings-saves-changed', listener);
    return () => ipcRenderer.removeListener('world-settings-saves-changed', listener);
  },
});
