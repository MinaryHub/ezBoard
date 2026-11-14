// 앱 화면(웹 페이지)과 데스크톱 기능 사이의 좁은 다리.
// 업데이트 파일 내려받기·열기와 바깥 링크 열기만 건넨다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ezboard', {
  platform: process.platform,
  arch: process.arch,
  download: (url, name) => ipcRenderer.invoke('update:download', { url, name }),
  onProgress: (cb) => {
    const handler = (_event, p) => cb(p);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },
  openDownloaded: (path) => ipcRenderer.invoke('update:open', path),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
