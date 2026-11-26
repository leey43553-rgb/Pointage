const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  printToPDF: (html, fileName) => ipcRenderer.invoke('app:print-to-pdf', { html, fileName }),
  getDataPath: () => ipcRenderer.invoke('app:get-data-path'),
  openDataFolder: () => ipcRenderer.invoke('app:open-data-folder'),
});
