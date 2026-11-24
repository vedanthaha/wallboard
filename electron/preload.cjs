const { contextBridge, ipcRenderer } = require('electron');

const api = {
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  openOutput: (displayId) => ipcRenderer.send('output:open', displayId),
  closeOutput: () => ipcRenderer.send('output:close'),
  isOutputOpen: () => ipcRenderer.invoke('output:is-open'),

  onDisplaysChanged: (cb) => {
    const handler = (_event, displays) => cb(displays);
    ipcRenderer.on('displays:changed', handler);
    return () => ipcRenderer.removeListener('displays:changed', handler);
  },
  onOutputOpened: (cb) => {
    const handler = (_event, info) => cb(info);
    ipcRenderer.on('output:opened', handler);
    return () => ipcRenderer.removeListener('output:opened', handler);
  },
  onOutputClosed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('output:closed', handler);
    return () => ipcRenderer.removeListener('output:closed', handler);
  },
  onOutputError: (cb) => {
    const handler = (_event, msg) => cb(msg);
    ipcRenderer.on('output:error', handler);
    return () => ipcRenderer.removeListener('output:error', handler);
  }
};

contextBridge.exposeInMainWorld('wallboard', api);
