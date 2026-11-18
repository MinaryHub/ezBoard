// ezBoard 데스크톱 앱 (macOS / Windows / Linux)
const { app, BrowserWindow, shell, session, Menu, ipcMain, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { once } = require('node:events');
const { registerCliAiHandlers } = require('./cli-ai.cjs');
const { registerAutoUpdateHandlers } = require('./auto-update.cjs');

// file:// 페이지에서 부르는 바깥 API: CORS 응답 헤더를 보정한다
const AI_HOSTS = ['api.anthropic.com', 'api.openai.com', 'generativelanguage.googleapis.com', 'ezboard-contact.vercel.app'];

// 업데이트 파일은 이 저장소의 GitHub 릴리스에서만 받는다
const RELEASE_PREFIX = '/MinaryHub/ezBoard/releases/download/';
const downloaded = new Set();

function registerUpdateHandlers() {
  ipcMain.handle('update:download', async (event, { url, name }) => {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'github.com' || !u.pathname.startsWith(RELEASE_PREFIX)) {
      throw new Error('download source not allowed');
    }
    if (typeof name !== 'string' || !/^[\w.-]+$/.test(name)) throw new Error('bad file name');
    const dest = path.join(app.getPath('downloads'), name);
    const part = `${dest}.part`;
    const res = await net.fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length') || 0);
    const out = fs.createWriteStream(part);
    let received = 0;
    let last = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (!out.write(Buffer.from(value))) await once(out, 'drain');
        const now = Date.now();
        if (now - last > 150) { last = now; event.sender.send('update:progress', { received, total }); }
      }
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    } catch (e) {
      out.destroy();
      fs.rmSync(part, { force: true });
      throw e;
    }
    if (total && received !== total) { fs.rmSync(part, { force: true }); throw new Error('download was cut short'); }
    fs.renameSync(part, dest);
    event.sender.send('update:progress', { received, total: total || received });
    downloaded.add(dest);
    return dest;
  });

  // 내려받은 설치 파일 열기: Windows는 설치 프로그램이 파일을 바꿀 수 있게 앱을 닫는다
  ipcMain.handle('update:open', async (_event, file) => {
    if (!downloaded.has(file)) throw new Error('unknown file');
    if (process.platform === 'linux') {
      if (file.endsWith('.AppImage')) fs.chmodSync(file, 0o755);
      shell.showItemInFolder(file);
      return;
    }
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
    if (process.platform === 'win32') setTimeout(() => app.quit(), 1500);
  });

  ipcMain.handle('open-external', async (_event, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) await shell.openExternal(url);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    title: 'ezBoard',
    backgroundColor: '#0f1216',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // 외부 링크(API 키 발급 페이지 등)는 기본 브라우저로 연다
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); }
  });

  if (process.env.EZBOARD_DEV_URL) win.loadURL(process.env.EZBOARD_DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  registerUpdateHandlers();
  registerAutoUpdateHandlers();
  registerCliAiHandlers();
  // file:// 에서 AI API 호출 시 CORS 응답 헤더 보정
  session.defaultSession.webRequest.onHeadersReceived({ urls: AI_HOSTS.map((h) => `https://${h}/*`) }, (details, cb) => {
    const headers = { ...details.responseHeaders };
    for (const k of Object.keys(headers)) if (k.toLowerCase().startsWith('access-control-allow-')) delete headers[k];
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Headers'] = ['*'];
    headers['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS'];
    cb({ responseHeaders: headers, statusLine: details.method === 'OPTIONS' ? 'HTTP/1.1 200 OK' : details.statusLine });
  });

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
