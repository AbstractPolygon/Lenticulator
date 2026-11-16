// Minimal, sandboxed bridge: the renderer is the same web app that runs in a browser.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lenticulatorHost', {
  isDesktop: true,
  platform: process.platform,
  // sample images are an optional download on desktop (served from app://…/samples/ once installed)
  samples: {
    installed: () => ipcRenderer.invoke('samples:installed'),
    download: (onProgress) => {
      const listener = (_e, done, total) => onProgress(done, total);
      ipcRenderer.on('samples:progress', listener);
      return ipcRenderer.invoke('samples:download').finally(() => ipcRenderer.removeListener('samples:progress', listener));
    },
    remove: () => ipcRenderer.invoke('samples:remove'),
  },
});
