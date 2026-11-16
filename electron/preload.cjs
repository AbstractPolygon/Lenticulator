// Minimal, sandboxed bridge: the renderer is the same web app that runs in a browser.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('lenticulatorHost', {
  isDesktop: true,
  platform: process.platform,
});
