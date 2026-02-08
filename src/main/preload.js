const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('helios', {
  getTheme: () => ipcRenderer.invoke('get-theme'),
  toggleTheme: (theme) => ipcRenderer.invoke('toggle-theme', theme),
  getEnv: (key) => ipcRenderer.invoke('get-env', key),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  exportPdf: () => ipcRenderer.invoke('export-pdf'),
  isElectron: true
});
