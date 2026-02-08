const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('helios', {
  getTheme: () => ipcRenderer.invoke('get-theme'),
  toggleTheme: (theme) => ipcRenderer.invoke('toggle-theme', theme),
  getEnv: (key) => ipcRenderer.invoke('get-env', key),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  exportPdf: () => ipcRenderer.invoke('export-pdf'),
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  openFile: (opts) => ipcRenderer.invoke('open-file', opts),
  isElectron: true,

  // Fleet connection test
  fleetTestConnection: (hostname) => ipcRenderer.invoke('fleet-test-connection', hostname),

  // Fleet / Drone CRUD
  fleetGetAll: () => ipcRenderer.invoke('fleet-get-all'),
  fleetGet: (id) => ipcRenderer.invoke('fleet-get', id),
  fleetAdd: (data) => ipcRenderer.invoke('fleet-add', data),
  fleetUpdate: (id, data) => ipcRenderer.invoke('fleet-update', id, data),
  fleetDelete: (id) => ipcRenderer.invoke('fleet-delete', id),
  fleetPing: (id) => ipcRenderer.invoke('fleet-ping', id)
});
