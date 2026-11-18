// 자동 업데이트: Windows 설치판과 Linux AppImage에서만.
// 새 버전을 뒤에서 받아 두고, 사용자가 "다시 시작"을 누르거나 앱을 끌 때 설치한다.
// (macOS는 Apple 정식 서명이 있어야 자동 교체가 되므로 기존처럼 설치 파일을 받아 열어 준다)
//
// 업데이트 정보: electron-builder가 만드는 latest.yml / latest-linux.yml (GitHub 릴리스에 함께 올림)
// 이 저장소의 게시된 릴리스만 본다 (초안·시험판 제외).
const { app, BrowserWindow, ipcMain } = require('electron');

/** 이 설치본이 스스로 업데이트할 수 있는가 */
function supported() {
  if (!app.isPackaged) return false;
  if (process.platform === 'win32') return true;
  // .deb로 설치했으면 APPIMAGE가 없다: 그때는 기존처럼 파일을 받아 준다
  if (process.platform === 'linux') return !!process.env.APPIMAGE;
  return false;
}

/** @type {{ status: 'idle'|'checking'|'none'|'downloading'|'ready'|'error', version?: string, received?: number, total?: number, message?: string }} */
let state = { status: 'idle' };
let updater = null;
let lastProgress = 0;

function setState(next) {
  state = next;
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('autoupdate:state', state);
}

function load() {
  if (updater) return updater;
  // 필요할 때만 불러온다 (Mac·개발 실행에서는 아예 쓰지 않음)
  ({ autoUpdater: updater } = require('electron-updater'));
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.logger = { info: () => {}, warn: (m) => console.warn('[update]', m), error: (m) => console.error('[update]', m), debug: () => {} };
  updater.on('checking-for-update', () => setState({ status: 'checking' }));
  updater.on('update-not-available', () => setState({ status: 'none' }));
  updater.on('update-available', (info) => setState({ status: 'downloading', version: info.version, received: 0, total: 0 }));
  updater.on('download-progress', (p) => {
    const now = Date.now();
    if (now - lastProgress < 200) return;
    lastProgress = now;
    setState({ status: 'downloading', version: state.version, received: p.transferred, total: p.total });
  });
  updater.on('update-downloaded', (info) => setState({ status: 'ready', version: info.version }));
  updater.on('error', (e) => setState({ status: 'error', version: state.version, message: String(e?.message ?? e).split('\n')[0] }));
  return updater;
}

function registerAutoUpdateHandlers() {
  ipcMain.handle('autoupdate:supported', () => supported());
  ipcMain.handle('autoupdate:state', () => state);
  // 확인하고, 새 버전이 있으면 바로 받는다
  ipcMain.handle('autoupdate:check', async () => {
    if (!supported()) return { status: 'idle' };
    if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return state;
    try {
      await load().checkForUpdates();
    } catch (e) {
      setState({ status: 'error', message: String(e?.message ?? e).split('\n')[0] });
    }
    return state;
  });
  // 받아 둔 업데이트를 설치하고 다시 시작 (Windows는 설치 화면 없이 조용히)
  ipcMain.handle('autoupdate:install', () => {
    if (state.status !== 'ready') return false;
    setImmediate(() => load().quitAndInstall(true, true));
    return true;
  });
}

module.exports = { registerAutoUpdateHandlers };
