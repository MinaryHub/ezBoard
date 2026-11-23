// 로그인한 계정으로 AI 쓰기: 각 회사의 공식 명령줄 도구(CLI)를 대신 실행한다.
//   Claude → Claude Code (`claude`, claude.ai 로그인)
//   GPT    → Codex CLI (`codex`, ChatGPT 로그인)
//   Gemini → Gemini CLI (`gemini`, Google 계정 로그인)
// API 키 없이 사용자가 이미 로그인해 둔 구독(채팅) 계정으로 응답을 받는다.
const { app, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const isWin = process.platform === 'win32';
const BIN = { claude: 'claude', openai: 'codex', gemini: 'gemini' };
const RUN_TIMEOUT = 5 * 60 * 1000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const activeChildren = new Set();

function killTree(child) {
  if (!child || child.killed) return;
  if (isWin && child.pid) {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /* 무시 */ }
    return;
  }
  try { child.kill('SIGTERM'); } catch { /* 무시 */ }
  const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* 무시 */ } }, 2000);
  t.unref?.();
}

// Finder·시작 메뉴로 연 앱은 PATH가 짧다: 로그인 셸의 PATH와 흔한 설치 위치를 비동기로 더한다
let searchPathPromise = null;
function getSearchPath(refresh = false) {
  if (refresh) searchPathPromise = null;
  if (searchPathPromise) return searchPathPromise;
  searchPathPromise = (async () => {
    const dirs = (process.env.PATH || '').split(path.delimiter);
    const home = os.homedir();
    if (isWin) {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      dirs.push(path.join(appData, 'npm'), path.join(home, '.local', 'bin'));
    } else {
      const shell = process.env.SHELL || '/bin/zsh';
      if (/(?:^|\/)(?:sh|bash|zsh|ksh)$/.test(shell)) {
        try {
          const out = await new Promise((resolve) => {
            const p = spawn(shell, ['-ilc', 'printf "__EZ__%s__EZ__" "$PATH"'], { stdio: ['ignore', 'pipe', 'ignore'] });
            const chunks = [];
            const timer = setTimeout(() => { killTree(p); resolve(''); }, 4000);
            p.stdout.on('data', (d) => chunks.push(d));
            p.on('error', () => { clearTimeout(timer); resolve(''); });
            p.on('close', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf8')); });
          });
          const m = /__EZ__(.*)__EZ__/.exec(out);
          if (m) dirs.push(...m[1].split(':'));
        } catch { /* 셸 PATH를 못 읽어도 아래 기본 위치로 찾는다 */ }
      }
      dirs.push(path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin',
        path.join(home, '.npm-global', 'bin'), path.join(home, '.volta', 'bin'), path.join(home, '.bun', 'bin'));
      const nvm = path.join(home, '.nvm', 'versions', 'node');
      try { for (const v of fs.readdirSync(nvm)) dirs.push(path.join(nvm, v, 'bin')); } catch { /* nvm 없음 */ }
    }
    return [...new Set(dirs.filter(Boolean))].join(path.delimiter);
  })();
  return searchPathPromise;
}

async function findBin(name, refresh = false) {
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];
  const sp = await getSearchPath(refresh);
  for (const dir of sp.split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try {
        if (!fs.statSync(p).isFile()) continue;
        if (!isWin) fs.accessSync(p, fs.constants.X_OK);
        return p;
      } catch { /* 없음 또는 실행 권한 없음 */ }
    }
  }
  return null;
}

async function childEnv(extra) {
  const env = { ...process.env, PATH: await getSearchPath(), NO_COLOR: '1', ...extra };
  delete env.CLAUDECODE; // Claude Code 안에서 개발 실행할 때 중첩 실행으로 오인하지 않게
  return env;
}

// Windows의 .cmd(npm 설치)는 셸로 실행해야 한다: cmd 메타문자/환경변수 확장을 방어해 감싼다
const winQuote = (a) => `"${String(a).replace(/"/g, '\\"').replace(/%/g, '%%')}"`;

function run(bin, args, { input, cwd, env, timeout = RUN_TIMEOUT }) {
  return new Promise((resolve, reject) => {
    const viaShell = isWin && /\.(cmd|bat)$/i.test(bin);
    const child = viaShell
      ? spawn(winQuote(bin), args.map(winQuote), { cwd, env, shell: true, windowsHide: true })
      : spawn(bin, args, { cwd, env, windowsHide: true });
    activeChildren.add(child);
    const outChunks = [];
    const errChunks = [];
    let outLen = 0;
    let errLen = 0;
    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeChildren.delete(child);
      fn(val);
    };
    const timer = setTimeout(() => { killTree(child); finish(reject, new Error('timeout')); }, timeout);
    child.stdout.on('data', (d) => {
      if (outLen < MAX_OUTPUT_BYTES) { outChunks.push(d); outLen += d.length; }
    });
    child.stderr.on('data', (d) => {
      if (errLen < MAX_OUTPUT_BYTES) { errChunks.push(d); errLen += d.length; }
    });
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code, signal) => {
      if (child._ezCancelled) { finish(reject, new Error('CANCELLED')); return; }
      const out = Buffer.concat(outChunks).toString('utf8');
      const err = Buffer.concat(errChunks).toString('utf8');
      finish(resolve, { code, signal, out, err });
    });
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
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* 아래에서 줄/블록 단위로 추출 */ }
  const lines = trimmed.split(/\r?\n/).reverse();
  for (const line of lines) {
    const l = line.trim();
    if (l.startsWith('{') && l.endsWith('}')) {
      try { return JSON.parse(l); } catch { /* 계속 */ }
    }
  }
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

async function status(provider) {
  const name = BIN[provider];
  const bin = name && await findBin(name, true);
  if (!bin) return { installed: false, loggedIn: false };
  const opt = { env: await childEnv(), cwd: os.tmpdir(), timeout: 20000 };
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

async function ask(provider, req) {
  if (!req || typeof req !== 'object') throw new Error('bad request');
  const { model, system, prompt } = req;
  if (typeof system !== 'string' || typeof prompt !== 'string') throw new Error('bad request');
  const name = BIN[provider];
  if (!name) throw new Error('unknown provider');
  const bin = await findBin(name);
  if (!bin) throw new Error(`NOT_INSTALLED:${name}`);
  if (model && (typeof model !== 'string' || !MODEL_RE.test(model))) throw new Error('bad model name');

  // 빈 임시 폴더에서 실행: 도구가 사용자 파일을 읽거나 고치지 않게 한다
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ezboard-ai-'));
  try {
    const sysFile = path.join(dir, 'system.md');
    fs.writeFileSync(sysFile, system, 'utf8');
    const env = await childEnv();

    if (provider === 'claude') {
      const args = ['-p', '--output-format', 'json', '--system-prompt-file', sysFile, '--tools', '',
        '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config'];
      if (model) args.push('--model', model);
      const r = await run(bin, args, { input: prompt, cwd: dir, env });
      const j = parseJson(r.out);
      if (!j) throw new Error(tail(r.err || r.out) || `claude exited (${r.code})`);
      if (j.is_error || (r.code !== 0 && !j.result)) throw new Error(String(j.result || j.subtype || tail(r.err) || `claude exited (${r.code})`));
      return String(j.result ?? '');
    }

    if (provider === 'openai') {
      const outFile = path.join(dir, 'answer.md');
      const args = ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '--color', 'never', '-o', outFile];
      if (model) args.push('-m', model);
      args.push('-');
      const input = `${system}\n\n---\n\n${prompt}`;
      const r = await run(bin, args, { input, cwd: dir, env });
      const text = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
      if (r.code !== 0 || !text.trim()) throw new Error(tail(r.err || r.out) || `codex exited (${r.code})`);
      return text;
    }

    const args = ['-p', ' ', '-o', 'json', '--skip-trust', '--approval-mode', 'plan'];
    if (model) args.push('-m', model);
    const r = await run(bin, args, { input: prompt, cwd: dir, env: { ...env, GEMINI_SYSTEM_MD: sysFile } });
    const j = parseJson(r.out);
    if (j?.error) throw new Error(String(j.error.message || j.error));
    if (!j || typeof j.response !== 'string') throw new Error(tail(r.err || r.out) || `gemini exited (${r.code})`);
    return j.response;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* Windows EBUSY로 원래 오류를 덮지 않게 무시 */ }
  }
}

function cancelAll() {
  for (const child of activeChildren) {
    child._ezCancelled = true;
    killTree(child);
  }
}

function registerCliAiHandlers() {
  ipcMain.handle('ai:cli-status', (_e, provider) => status(provider));
  ipcMain.handle('ai:cli-ask', (_e, provider, req) => ask(provider, req));
  ipcMain.handle('ai:cli-cancel', () => { cancelAll(); });
  app?.on?.('before-quit', cancelAll);
}

module.exports = { registerCliAiHandlers, ask, status, cancelAll };
