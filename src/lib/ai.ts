// Claude / Gemini / GPT 대화형 회로 설계. 브라우저에서 각 API를 직접 호출하거나,
// 데스크톱 앱에서는 로그인한 계정(공식 CLI: claude / codex / gemini)으로 부른다.
import type { AiSettings, ChatMessage, Net, Part, Project, Provider } from '../types';
import { LIBRARY, librarySummary } from './library';
import { getLang, t } from '../i18n';

export const PROVIDERS: Record<Provider, {
  label: string; short: string; keyUrl: string; keyHint: string; defaultModel: string;
  /** 로그인 계정 연결에 쓰는 공식 CLI */
  cli: { name: string; product: string; install: string; login: string; url: string };
}> = {
  claude: {
    label: 'Claude (Anthropic)', short: 'Claude', keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-...', defaultModel: 'claude-sonnet-5-5',
    cli: { name: 'claude', product: 'Claude Code', install: 'curl -fsSL https://claude.ai/install.sh | bash', login: 'claude', url: 'https://docs.claude.com/en/docs/claude-code/setup' },
  },
  gemini: {
    label: 'Gemini (Google)', short: 'Gemini', keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza...', defaultModel: 'gemini-2.5-pro',
    cli: { name: 'gemini', product: 'Gemini CLI', install: 'npm install -g @google/gemini-cli', login: 'gemini', url: 'https://github.com/google-gemini/gemini-cli' },
  },
  openai: {
    label: 'GPT (OpenAI)', short: 'GPT', keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-...', defaultModel: 'gpt-5',
    cli: { name: 'codex', product: 'Codex CLI', install: 'npm install -g @openai/codex', login: 'codex login', url: 'https://github.com/openai/codex' },
  },
};

/** 로그인 계정 연결은 데스크톱 앱에서만 된다 (프로그램 실행이 필요) */
export const canUseAccount = () => typeof window !== 'undefined' && !!window.ezboard?.cliAsk;

export const usesAccount = (settings: AiSettings, p: Provider = settings.provider) => settings.auth?.[p] === 'account' && canUseAccount();

/** 이 제공사로 바로 대화할 수 있게 설정되어 있는지 (키가 있거나 계정 연결) */
export const isConnected = (settings: AiSettings, p: Provider = settings.provider) => usesAccount(settings, p) || !!settings.keys[p]?.trim();

export async function accountStatus(p: Provider) {
  if (!window.ezboard?.cliStatus) return { installed: false, loggedIn: false };
  return window.ezboard.cliStatus(p);
}

/** CLI는 한 번에 글 하나만 받으므로 지난 대화를 한 덩어리로 펼친다 */
function flattenHistory(history: ChatMessage[]): string {
  if (history.length === 1) return history[0].content;
  const turns = history.map((m) => `[${m.role === 'user' ? 'User' : 'ezBoard assistant (you)'}]\n${m.content}`).join('\n\n');
  return `The conversation so far is below. Reply to the last User message, following the system instructions.\n\n${turns}`;
}

async function callAccount(settings: AiSettings, system: string, history: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const { provider } = settings;
  const model = settings.cliModels?.[provider]?.trim() || undefined;
  const onAbort = () => { void window.ezboard?.cliCancel?.(); };
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await window.ezboard!.cliAsk(provider, { model, system, prompt: flattenHistory(history) });
  } catch (e) {
    // ipc 오류는 "Error invoking remote method ...: Error: 원래 메시지" 형태
    const msg = String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    if (msg === 'CANCELLED' || signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const cli = PROVIDERS[provider].cli;
    if (msg.startsWith('NOT_INSTALLED')) throw new Error(t('err.cliMissing', { product: cli.product, install: cli.install }));
    if (msg === 'timeout') throw new Error(t('err.cliTimeout'));
    const limit = /usage limit|rate limit|quota|upgrade to/i.test(msg) ? msg.split('\n').find((l) => /usage limit|rate limit|quota|upgrade to/i.test(l)) : null;
    if (limit) throw new Error(t('err.cliLimit', { product: cli.product, msg: limit.replace(/^ERROR:\s*/, '') }));
    if (/\b(log ?in|auth|unauthori[sz]ed|401|credential)\b/i.test(msg)) throw new Error(t('err.cliLogin', { product: cli.product, login: cli.login, msg }));
    throw new Error(msg);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

export interface AiCircuit {
  name?: string;
  board?: { width: number; height: number };
  parts: { ref: string; type: string; value?: string; note?: string }[];
  nets: Net[];
}

function systemPrompt(project: Project): string {
  const current = {
    name: project.name,
    board: project.board,
    parts: project.parts.map((p) => ({ ref: p.ref, type: p.type, value: p.value, note: p.note })),
    nets: project.nets,
  };
  return `당신은 "ezBoard"의 회로 설계 도우미입니다. 사용자는 전자회로를 처음 해보는 초보자일 수 있습니다.

## 대화 방식
${getLang() === 'en' ? '- IMPORTANT: The user interface is in English. Always reply in English, in plain words, and write part notes in English. Explain technical terms briefly the first time they appear.' : '- 항상 한국어로, 쉬운 말로 설명하세요. 전문용어는 처음 나올 때 한 줄로 풀어주세요.'}
- 요구사항이 애매하면 합리적인 기본값(예: 5V USB 전원, 빨간 LED)을 가정하고, 가정한 내용을 짧게 알려주세요. 정말 필요한 경우에만 질문하세요.
- 회로를 만들거나 수정했다면: ① 회로가 하는 일 ② 부품별 역할 ③ 조립·납땜 팁 ④ 주의사항을 간단히 설명하세요.
- 사용자가 질문만 하면 회로 JSON 없이 답만 하세요.

## 회로 출력 규칙
회로를 새로 만들거나 수정할 때는 답변 끝에 \`\`\`json 코드블록을 정확히 하나 넣으세요. 이 JSON은 **회로 전체**(수정되지 않은 부분 포함)를 담아야 하며, 프로그램이 자동으로 PCB에 적용합니다.
형식:
\`\`\`json
{
  "name": "LED 깜빡이",
  "board": { "width": 50, "height": 40 },
  "parts": [ { "ref": "R1", "type": "resistor", "value": "330Ω", "note": "LED 전류 제한" } ],
  "nets": [ { "name": "GND", "pins": ["J1.-", "LED1.K"] } ]
}
\`\`\`
- type은 아래 라이브러리에 있는 것만 사용하세요. 핀 이름도 정확히 아래 목록대로 쓰세요 ("참조.핀" 형식, 예: "U1.VCC", "R1.2", "A1.D13").
- 하나의 핀은 하나의 넷에만 속해야 합니다. 넷 이름은 GND, VCC(또는 5V, 3V3), 기능을 나타내는 이름(LED_DRIVE 등)으로 지으세요.
- 기존 회로를 수정할 때는 바뀌지 않는 부품의 ref를 그대로 유지하세요 (PCB 위치가 유지됩니다).
- 반드시 전원 입력(power_in, 핀 헤더, 아두이노 등)을 포함하세요. LED에는 직렬 저항을, IC 전원 핀 근처에는 100nF 커패시터를 넣으세요.
- 값은 쉽게 구할 수 있는 표준값(E12)을 쓰고, LED 저항값 같은 계산은 설명에 간단히 보여주세요.
- board는 부품이 여유 있게 들어갈 크기(mm)로, 초보자가 주문하기 쉽게 100x100mm 이하로 하세요. 생략하면 자동으로 정합니다.

## 부품 라이브러리 (type: 이름 — 핀)
${librarySummary()}

## 현재 회로
${project.parts.length ? JSON.stringify(current) : '(비어 있음)'}`;
}

/** Claude/Gemini 규격에 맞게 user로 시작하고 같은 역할이 연속되지 않도록 병합 */
function normalizeHistory(messages: ChatMessage[]): ChatMessage[] {
  const clean = messages.filter((m) => !m.error && m.content.trim()).slice(-20);
  const merged: ChatMessage[] = [];
  for (const m of clean) {
    if (!merged.length && m.role !== 'user') continue;
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      merged[merged.length - 1] = { ...last, content: `${last.content}\n\n${m.content}` };
    } else {
      merged.push(m);
    }
  }
  return merged;
}

async function readJsonSafe(res: Response, fallbackPrefix: string) {
  const raw = await res.text();
  let data: Record<string, unknown> | null = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { /* 비-JSON 오류 응답 */ }
  if (!res.ok) {
    const errObj = data?.error as { message?: string } | undefined;
    const msg = errObj?.message || (typeof data?.message === 'string' ? data.message : '') || `${fallbackPrefix} (${res.status})`;
    throw new Error(msg);
  }
  if (!data) throw new Error(`${fallbackPrefix}: empty JSON response`);
  return data;
}

function withTimeout(signal?: AbortSignal, ms = 180_000): { signal: AbortSignal; cleanup: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), ms);
  const onAbort = () => ctrl.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

async function callProvider(settings: AiSettings, system: string, messages: ChatMessage[], userSignal?: AbortSignal): Promise<string> {
  const { provider } = settings;
  const history = normalizeHistory(messages);
  if (usesAccount(settings)) return callAccount(settings, system, history, userSignal);
  const key = settings.keys[provider]?.trim();
  const model = settings.models[provider]?.trim() || PROVIDERS[provider].defaultModel;
  if (!key) throw new Error(t('err.noKey', { provider: PROVIDERS[provider].label }));

  const { signal, cleanup } = withTimeout(userSignal);
  try {
    if (provider === 'claude') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model, max_tokens: 16000, system, messages: history.map((m) => ({ role: m.role, content: m.content })) }),
        signal,
      });
      const data = await readJsonSafe(res, 'Claude error');
      const content = Array.isArray(data.content) ? data.content : [];
      return content.filter((c: { type?: string }) => c.type === 'text').map((c: { text?: string }) => c.text ?? '').join('');
    }

    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...history.map((m) => ({ role: m.role, content: m.content }))] }),
        signal,
      });
      const data = await readJsonSafe(res, 'OpenAI error');
      const choices = Array.isArray(data.choices) ? data.choices : [];
      return (choices[0] as { message?: { content?: string } } | undefined)?.message?.content ?? '';
    }

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      }),
      signal,
    });
    const data = await readJsonSafe(res, 'Gemini error');
    const cands = Array.isArray(data.candidates) ? data.candidates : [];
    const parts = ((cands[0] as { content?: { parts?: { text?: string }[] } } | undefined)?.content?.parts) ?? [];
    return parts.map((p) => p.text ?? '').join('');
  } finally {
    cleanup();
  }
}

/** 각 제공사의 사용 가능한 모델 목록 */
export async function listModels(provider: Provider, key: string): Promise<string[]> {
  if (!key.trim()) throw new Error(t('err.keyFirst'));
  const { signal, cleanup } = withTimeout(undefined, 20_000);
  try {
    if (provider === 'claude') {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        signal,
      });
      const data = await readJsonSafe(res, 'Claude models error');
      const arr = Array.isArray(data.data) ? data.data : [];
      return arr.map((m: { id: string }) => m.id).filter(Boolean);
    }
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` }, signal });
      const data = await readJsonSafe(res, 'OpenAI models error');
      const arr = Array.isArray(data.data) ? data.data : [];
      return arr
        .map((m: { id: string }) => m.id)
        .filter((id: string) => typeof id === 'string' && /^(gpt-|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|embedding)/.test(id))
        .sort()
        .reverse();
    }
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key }, signal });
    const data = await readJsonSafe(res, 'Gemini models error');
    const arr = Array.isArray(data.models) ? data.models : [];
    return arr
      .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: { name: string }) => String(m.name ?? '').replace(/^models\//, ''))
      .filter((id: string) => id.startsWith('gemini'))
      .reverse();
  } finally {
    cleanup();
  }
}

export function extractCircuit(text: string): { display: string; circuit?: AiCircuit; problems: string[] } {
  const re = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  let last: { full: string; body: string } | null = null;
  while ((match = re.exec(text))) {
    if (match[1].includes('"parts"')) last = { full: match[0], body: match[1] };
  }
  if (!last) return { display: text.trim(), problems: [] };
  const idx = text.lastIndexOf(last.full);
  const display = (idx >= 0 ? text.slice(0, idx) + text.slice(idx + last.full.length) : text).trim();
  try {
    const raw = JSON.parse(last.body);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.parts) || !Array.isArray(raw.nets)) {
      throw new Error('missing parts / nets arrays');
    }
    const problems: string[] = [];
    const seenRefs = new Set<string>();
    const parts = raw.parts
      .filter((p: { ref?: unknown; type?: unknown }) => {
        if (!p || typeof p.ref !== 'string' || typeof p.type !== 'string') return false;
        const ref = p.ref.trim();
        const type = p.type.trim();
        if (!ref || !type) return false;
        if (!LIBRARY[type]) { problems.push(t('err.unknownPart', { type, ref })); return false; }
        const key = ref.toLowerCase();
        if (seenRefs.has(key)) return false;
        seenRefs.add(key);
        return true;
      })
      .map((p: { ref: string; type: string; value?: unknown; note?: unknown }) => ({
        ref: p.ref.trim(),
        type: p.type.trim(),
        value: typeof p.value === 'string' ? p.value : undefined,
        note: typeof p.note === 'string' ? p.note : undefined,
      }));
    const nets: Net[] = raw.nets
      .filter((n: { name?: unknown; pins?: unknown }) => n && typeof n.name === 'string' && n.name.trim() && Array.isArray(n.pins))
      .map((n: { name: string; pins: unknown[]; width?: unknown }) => {
        const w = Number(n.width);
        const base: Net = { name: n.name.trim(), pins: n.pins.map((x) => String(x).trim()).filter(Boolean) };
        if (Number.isFinite(w) && w >= 0.25 && w <= 3.0) base.width = Math.round(w * 100) / 100;
        return base;
      });
    const bw = Number(raw.board?.width), bh = Number(raw.board?.height);
    const board = Number.isFinite(bw) && Number.isFinite(bh) && bw > 0 && bh > 0 ? { width: bw, height: bh } : undefined;
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : undefined;
    return { display, circuit: { name, board, parts, nets }, problems };
  } catch (e) {
    return { display, problems: [t('err.badJson', { msg: (e as Error).message })] };
  }
}

export async function askAi(settings: AiSettings, project: Project, messages: ChatMessage[], signal?: AbortSignal) {
  const text = await callProvider(settings, systemPrompt(project), messages, signal);
  return { ...extractCircuit(text), raw: text };
}

export function circuitToParts(c: AiCircuit, prev: Part[]): { parts: Part[]; keep: Set<string> } {
  const keep = new Set<string>();
  const parts: Part[] = c.parts.map((p) => {
    const old = prev.find((o) => o.ref === p.ref && o.type === p.type);
    if (old) keep.add(p.ref);
    return {
      ref: p.ref,
      type: p.type,
      value: p.value ?? LIBRARY[p.type].defaultValue,
      note: p.note,
      x: old?.x ?? 0,
      y: old?.y ?? 0,
      rot: old?.rot ?? 0,
    };
  });
  return { parts, keep };
}
