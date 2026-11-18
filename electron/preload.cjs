// 앱 화면(웹 페이지)과 데스크톱 기능 사이의 좁은 다리.
// 업데이트 파일 내려받기·열기, 자동 업데이트, AI 키 보안 저장, 바깥 링크 열기, 로그인한 AI 계정(CLI) 호출만 건넨다.
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
  cliStatus: (provider) => ipcRenderer.invoke('ai:cli-status', provider),
  cliAsk: (provider, req) => ipcRenderer.invoke('ai:cli-ask', provider, req),
  keys: {
    supported: () => ipcRenderer.invoke('keys:supported'),
    get: () => ipcRenderer.invoke('keys:get'),
    set: (keys) => ipcRenderer.invoke('keys:set', keys),
  },
  autoUpdate: {
    supported: () => ipcRenderer.invoke('autoupdate:supported'),
    state: () => ipcRenderer.invoke('autoupdate:state'),
    check: () => ipcRenderer.invoke('autoupdate:check'),
    install: () => ipcRenderer.invoke('autoupdate:install'),
    onState: (cb) => {
      const handler = (_event, s) => cb(s);
      ipcRenderer.on('autoupdate:state', handler);
      return () => ipcRenderer.removeListener('autoupdate:state', handler);
    },
  },
});
