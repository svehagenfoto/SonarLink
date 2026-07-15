const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sonarMinimapApi', {
  getMapImageUrl: () => ipcRenderer.invoke('get-minimap-map-url'),
  getIdleImageUrl: () => ipcRenderer.invoke('get-minimap-idle-url'),
  getMapTelemetry: () => ipcRenderer.invoke('get-map-telemetry'),
  getMinimapSessionState: () => ipcRenderer.invoke('get-minimap-session-state'),
  resolveMapSaveId: (telemetry) => ipcRenderer.invoke('resolve-map-save-id', telemetry),
  getMapFogSave: (saveId, hints) => ipcRenderer.invoke('get-map-fog-save', saveId, hints),
  saveMapFogSave: (saveId, data) => ipcRenderer.invoke('save-map-fog-save', saveId, data),
  onMapFogSavesChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('map-fog-saves-changed', listener);
    return () => ipcRenderer.removeListener('map-fog-saves-changed', listener);
  },
  onMapFogDeleted: (callback) => {
    const listener = (_event, saveId) => callback(saveId);
    ipcRenderer.on('map-fog-deleted', listener);
    return () => ipcRenderer.removeListener('map-fog-deleted', listener);
  },
  onMapTelemetryUpdate: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('map-telemetry-update', listener);
    return () => ipcRenderer.removeListener('map-telemetry-update', listener);
  },
  getMapFogSession: () => ipcRenderer.invoke('get-map-fog-session'),
  pushMapFogSession: (payload) => ipcRenderer.invoke('push-map-fog-session', payload),
  clearMapFogSession: () => ipcRenderer.invoke('clear-map-fog-session'),
  onMapFogSessionUpdate: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('map-fog-session-update', listener);
    return () => ipcRenderer.removeListener('map-fog-session-update', listener);
  },
  onMinimapSizeUpdate: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('minimap-size-update', listener);
    return () => ipcRenderer.removeListener('minimap-size-update', listener);
  },
  hideBigMap: () => ipcRenderer.invoke('hide-big-map'),
});
