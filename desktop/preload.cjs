// Мост между окном и студией: только платформа, команды меню и полноэкранный режим.
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (callback) => {
  const handler = (_e, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('photonDesktop', {
  platform: process.platform,
  onCommand: listen('photon:command'),
  onFullscreen: listen('photon:fullscreen'),
});
