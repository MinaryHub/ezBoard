// AI API 키를 운영체제 보안 저장소로 암호화해 보관 (macOS 키체인, Windows DPAPI, Linux 키링).
// 화면(웹 페이지)의 localStorage에는 키를 남기지 않는다. 암호화를 쓸 수 없는 환경이면 supported=false.
const { app, ipcMain, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const PROVIDERS = ['claude', 'gemini', 'openai'];
const file = () => path.join(app.getPath('userData'), 'ai-keys.json');

function available() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  // Linux에서 키링이 없으면 'basic_text'(사실상 평문)로 떨어진다: 그때는 쓰지 않는다
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') return false;
  return true;
}

function readAll() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; }
  const out = {};
  for (const p of PROVIDERS) {
    if (typeof raw[p] === 'string' && raw[p]) {
      try { out[p] = safeStorage.decryptString(Buffer.from(raw[p], 'base64')); } catch { /* 손상된 키 하나만 건너뜀 */ }
    }
  }
  return out;
}

function writeAll(keys) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { /* 새 파일 */ }
  for (const p of PROVIDERS) {
    const v = keys[p];
    if (typeof v !== 'string' || v.length >= 1000) continue;
    const trimmed = v.trim();
    if (trimmed) raw[p] = safeStorage.encryptString(trimmed).toString('base64');
    else delete raw[p];
  }
  const dest = file();
  const tmp = `${dest}.tmp`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(raw), { mode: 0o600 });
  if (process.platform !== 'win32') try { fs.chmodSync(tmp, 0o600); } catch { /* 무시 */ }
  fs.renameSync(tmp, dest);
}

function registerSecureKeyHandlers() {
  ipcMain.handle('keys:supported', () => available());
  ipcMain.handle('keys:get', () => (available() ? readAll() : {}));
  ipcMain.handle('keys:set', (_event, keys) => {
    if (!available() || !keys || typeof keys !== 'object') return false;
    writeAll(keys);
    return true;
  });
}

module.exports = { registerSecureKeyHandlers };
