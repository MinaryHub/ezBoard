// ezBoard 데스크톱 앱 (macOS / Windows / Linux)
const { app, BrowserWindow, shell, session, Menu } = require('electron');
const path = require('node:path');

const AI_HOSTS = ['api.anthropic.com', 'api.openai.com', 'generativelanguage.googleapis.com'];

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
