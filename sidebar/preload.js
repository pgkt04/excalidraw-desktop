const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workspaceAPI', {
  getInitialState: () => ipcRenderer.invoke('workspace:getState'),
  selectFolder: () => ipcRenderer.invoke('workspace:selectFolder'),

  openFile: (filePath) => ipcRenderer.invoke('file:open', filePath),
  newFile: () => ipcRenderer.invoke('file:new'),
  renameFile: (oldPath, newName) => ipcRenderer.invoke('file:rename', { oldPath, newName }),
  deleteFile: (filePath) => ipcRenderer.invoke('file:delete', filePath),
  saveCurrent: () => ipcRenderer.invoke('file:save'),
  saveCurrentAs: () => ipcRenderer.invoke('file:saveAs'),

  onFilesChanged: (cb) => {
    ipcRenderer.on('workspace:filesChanged', (_event, files) => cb(files));
  },
  onWorkspaceChanged: (cb) => {
    ipcRenderer.on('workspace:changed', (_event, dir) => cb(dir));
  },
  onCurrentFileChanged: (cb) => {
    ipcRenderer.on('workspace:currentFileChanged', (_event, filePath) => cb(filePath));
  },
});
