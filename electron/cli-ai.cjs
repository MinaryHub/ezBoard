// 로그인한 계정으로 AI 쓰기: 각 회사의 공식 명령줄 도구(CLI)를 대신 실행한다.
//   Claude → Claude Code (`claude`, claude.ai 로그인)
//   GPT    → Codex CLI (`codex`, ChatGPT 로그인)
//   Gemini → Gemini CLI (`gemini`, Google 계정 로그인)
// API 키 없이 사용자가 이미 로그인해 둔 구독(채팅) 계정으로 응답을 받는다.
const { ipcMain } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const isWin = process.platform === 'win32';
const BIN = { claude: 'claude', openai: 'codex', gemini: 'gemini' };
const RUN_TIMEOUT = 5 * 60 * 1000;

// Finder·시작 메뉴로 연 앱은 PATH가 짧다: 로그인 셸의 PATH와 흔한 설치 위치를 더한다
let searchPath = null;
function getSearchPath() {
  if (searchPath) return searchPath;
  const dirs = (process.env.PATH || '').split(path.delimiter);
  const home = os.homedir();
  if (isWin) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    dirs.push(path.join(appData, 'npm'), path.join(home, '.local', 'bin'));
  } else {
    try {
      const shell = process.env.SHELL || '/bin/zsh';
      const r = spawnSync(shell, ['-ilc', 'printf "__EZ__%s__EZ__" "$PATH"'], { encoding: 'utf8', timeout: 5000 });
      const m = /__EZ__(.*)__EZ__/.exec(r.stdout || '');
      if (m) dirs.push(...m[1].split(':'));
    } catch { /* 셸 PATH를 못 읽어도 아래 기본 위치로 찾는다 */ }
    dirs.push(path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin',
      path.join(home, '.npm-global', 'bin'), path.join(home, '.volta', 'bin'), path.join(home, '.bun', 'bin'));
    const nvm = path.join(home, '.nvm', 'versions', 'node');
    try { for (const v of fs.readdirSync(nvm)) dirs.push(path.join(nvm, v, 'bin')); } catch { /* nvm 없음 */ }
  }
  searchPath = [...new Set(dirs.filter(Boolean))].join(path.delimiter);
  return searchPath;
}

function findBin(name) {
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of getSearchPath().split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* 없음 */ }
    }
  }
  return null;
}

function childEnv(extra) {
  const env = { ...process.env, PATH: getSearchPath(), NO_COLOR: '1', ...extra };
  delete env.CLAUDECODE; // Claude Code 안에서 개발 실행할 때 중첩 실행으로 오인하지 않게
  return env;
}

// Windows의 .cmd(npm 설치)는 셸로 실행해야 한다: 인자를 직접 따옴표로 감싼다
const winQuote = (a) => `"${String(a).replace(/"/g, '""')}"`;

function run(bin, args, { input, cwd, env, timeout = RUN_TIMEOUT }) {
  return new Promise((resolve, reject) => {
    const viaShell = isWin && /\.(cmd|bat)$/i.test(bin);
    const child = viaShell
      ? spawn(winQuote(bin), args.map(winQuote), { cwd, env, shell: true, windowsHide: true })
      : spawn(bin, args, { cwd, env, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')); }, timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.on('error', () => { /* 프로그램이 일찍 끝나면 무시 */ });
    child.stdin.end(input ?? '');
  });
}

const tail = (s, n = 600) => {
  // eslint-disable-next-line no-control-regex
  const lines = String(s).replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter((l) => l && !/reconnecting/i.test(l));
  return lines.slice(-3).join('\n').slice(-n);
};

function parseJson(text) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

async function status(provider) {
  const name = BIN[provider];
  const bin = name && findBin(name);
  if (!bin) return { installed: false, loggedIn: false };
  const opt = { env: childEnv(), cwd: os.tmpdir(), timeout: 20000 };
  try {
    if (provider === 'claude') {
      const r = await run(bin, ['auth', 'status'], opt);
      const j = parseJson(r.out);
      return { installed: true, loggedIn: !!j?.loggedIn, detail: j?.authMethod };
    }
    if (provider === 'openai') {
      const r = await run(bin, ['login', 'status'], opt);
      const text = tail(r.out + r.err, 200);
      return { installed: true, loggedIn: r.code === 0 && !/not logged in/i.test(text), detail: text };
    }
    // Gemini CLI는 상태 명령이 없다: 처음 실행 때 고른 로그인 방식(settings.json)과 저장된 Google 로그인 정보로 판단
    const dir = path.join(os.homedir(), '.gemini');
    let selected;
    try { selected = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))?.security?.auth?.selectedType; } catch { /* 아직 설정 없음 */ }
    const loggedIn = !!selected || fs.existsSync(path.join(dir, 'oauth_creds.json')) || !!process.env.GEMINI_API_KEY;
    return { installed: true, loggedIn, detail: selected };
  } catch (e) {
    return { installed: true, loggedIn: false, detail: e.message };
  }
}

const MODEL_RE = /^[\w.:/[\]-]{1,80}$/;

async function ask(provider, { model, system, prompt }) {
  const name = BIN[provider];
  if (!name) throw new Error('unknown provider');
  const bin = findBin(name);
  if (!bin) throw new Error(`NOT_INSTALLED:${name}`);
  if (model && !MODEL_RE.test(model)) throw new Error('bad model name');

  // 빈 임시 폴더에서 실행: 도구가 사용자 파일을 읽거나 고치지 않게 한다
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ezboard-ai-'));
  try {
    const sysFile = path.join(dir, 'system.md');
    fs.writeFileSync(sysFile, system, 'utf8');

    if (provider === 'claude') {
      const args = ['-p', '--output-format', 'json', '--system-prompt-file', sysFile, '--tools', '',
        '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config'];
      if (model) args.push('--model', model);
      const r = await run(bin, args, { input: prompt, cwd: dir, env: childEnv() });
      const j = parseJson(r.out);
      if (!j) throw new Error(tail(r.err || r.out) || `claude exited (${r.code})`);
      if (j.is_error) throw new Error(String(j.result || j.subtype || 'Claude error'));
      return String(j.result ?? '');
    }

    if (provider === 'openai') {
      const outFile = path.join(dir, 'answer.md');
      const args = ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '--color', 'never', '-o', outFile];
      if (model) args.push('-m', model);
      args.push('-');
      const input = `${system}\n\n---\n\n${prompt}`;
      const r = await run(bin, args, { input, cwd: dir, env: childEnv() });
      const text = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
      if (r.code !== 0 || !text.trim()) throw new Error(tail(r.err || r.out) || `codex exited (${r.code})`);
      return text;
    }

    const args = ['-p', ' ', '-o', 'json', '--skip-trust', '--approval-mode', 'plan'];
    if (model) args.push('-m', model);
    const r = await run(bin, args, { input: prompt, cwd: dir, env: childEnv({ GEMINI_SYSTEM_MD: sysFile }) });
    const j = parseJson(r.out);
    if (j?.error) throw new Error(String(j.error.message || j.error));
    if (!j || typeof j.response !== 'string') throw new Error(tail(r.err || r.out) || `gemini exited (${r.code})`);
    return j.response;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function registerCliAiHandlers() {
  ipcMain.handle('ai:cli-status', (_e, provider) => status(provider));
  ipcMain.handle('ai:cli-ask', (_e, provider, req) => ask(provider, req));
}

module.exports = { registerCliAiHandlers, ask, status };
