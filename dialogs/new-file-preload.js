const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('newFileDialogAPI', {
  submit: (name) => ipcRenderer.invoke('dialog:new-file-submit', name),
  cancel: () => ipcRenderer.invoke('dialog:new-file-cancel'),
  getExistingNames: () => ipcRenderer.invoke('dialog:new-file-getExistingNames'),
});
