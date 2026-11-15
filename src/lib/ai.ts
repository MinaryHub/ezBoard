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

async function callAccount(settings: AiSettings, system: string, history: ChatMessage[]): Promise<string> {
  const { provider } = settings;
  const model = settings.cliModels?.[provider]?.trim() || undefined;
  try {
    return await window.ezboard!.cliAsk(provider, { model, system, prompt: flattenHistory(history) });
  } catch (e) {
    // ipc 오류는 "Error invoking remote method ...: Error: 원래 메시지" 형태
    const msg = String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    const cli = PROVIDERS[provider].cli;
    if (msg.startsWith('NOT_INSTALLED')) throw new Error(t('err.cliMissing', { product: cli.product, install: cli.install }));
    if (msg === 'timeout') throw new Error(t('err.cliTimeout'));
    const limit = /usage limit|rate limit|quota|upgrade to/i.test(msg) ? msg.split('\n').find((l) => /usage limit|rate limit|quota|upgrade to/i.test(l)) : null;
    if (limit) throw new Error(t('err.cliLimit', { product: cli.product, msg: limit.replace(/^ERROR:\s*/, '') }));
    if (/log ?in|auth|unauthori[sz]ed|401|credential/i.test(msg)) throw new Error(t('err.cliLogin', { product: cli.product, login: cli.login, msg }));
    throw new Error(msg);
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

async function callProvider(settings: AiSettings, system: string, messages: ChatMessage[]): Promise<string> {
  const { provider } = settings;
  const history = messages.filter((m) => !m.error).slice(-20);
  if (usesAccount(settings)) return callAccount(settings, system, history);
  const key = settings.keys[provider]?.trim();
  const model = settings.models[provider]?.trim() || PROVIDERS[provider].defaultModel;
  if (!key) throw new Error(t('err.noKey', { provider: PROVIDERS[provider].label }));

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
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? `Claude error (${res.status})`);
    return (data.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
  }

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...history.map((m) => ({ role: m.role, content: m.content }))] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? `OpenAI error (${res.status})`);
    return data.choices?.[0]?.message?.content ?? '';
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Gemini error (${res.status})`);
  return (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
}

/** 각 제공사의 사용 가능한 모델 목록 */
export async function listModels(provider: Provider, key: string): Promise<string[]> {
  if (!key.trim()) throw new Error(t('err.keyFirst'));
  if (provider === 'claude') {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? `Error ${res.status}`);
    return data.data.map((m: { id: string }) => m.id);
  }
  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? `Error ${res.status}`);
    return data.data
      .map((m: { id: string }) => m.id)
      .filter((id: string) => /^(gpt-|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|embedding)/.test(id))
      .sort()
      .reverse();
  }
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Error ${res.status}`);
  return data.models
    .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m: { name: string }) => m.name.replace(/^models\//, ''))
    .filter((id: string) => id.startsWith('gemini'))
    .reverse();
}

export function extractCircuit(text: string): { display: string; circuit?: AiCircuit; problems: string[] } {
  const re = /```(?:json)?\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let last: { full: string; body: string } | null = null;
  while ((match = re.exec(text))) {
    if (match[1].includes('"parts"')) last = { full: match[0], body: match[1] };
  }
  if (!last) return { display: text.trim(), problems: [] };
  const display = text.replace(last.full, '').trim();
  try {
    const raw = JSON.parse(last.body);
    if (!Array.isArray(raw.parts) || !Array.isArray(raw.nets)) throw new Error('missing parts / nets arrays');
    const problems: string[] = [];
    const parts = raw.parts.filter((p: { ref?: string; type?: string }) => {
      if (!p.ref || !p.type) return false;
      if (!LIBRARY[p.type]) { problems.push(t('err.unknownPart', { type: p.type, ref: p.ref })); return false; }
      return true;
    });
    const nets: Net[] = raw.nets
      .filter((n: Net) => n && n.name && Array.isArray(n.pins))
      .map((n: Net) => ({ name: String(n.name), pins: n.pins.map(String) }));
    return { display, circuit: { name: raw.name, board: raw.board, parts, nets }, problems };
  } catch (e) {
    return { display, problems: [t('err.badJson', { msg: (e as Error).message })] };
  }
}

export async function askAi(settings: AiSettings, project: Project, messages: ChatMessage[]) {
  const text = await callProvider(settings, systemPrompt(project), messages);
  return extractCircuit(text);
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
