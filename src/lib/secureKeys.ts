// 데스크톱 앱에서는 AI 키를 운영체제 보안 저장소에 두고, localStorage에는 빈 값만 남긴다.
// 웹·안드로이드나 보안 저장소가 없는 Linux에서는 예전처럼 localStorage에 둔다.
import type { AiSettings, Provider } from '../types';

type Keys = AiSettings['keys'];
const ALL_PROVIDERS: Provider[] = ['claude', 'gemini', 'openai'];
let supported: boolean | null = null;
/** 시작 때 읽기가 끝나기 전에는 보안 저장소에 직접 덮어쓰지 않고 보류한다 */
let ready = false;
let pendingKeys: Keys | null = null;

export async function secureKeysSupported(): Promise<boolean> {
  if (supported !== null) return supported;
  const b = typeof window !== 'undefined' ? window.ezboard?.keys : undefined;
  supported = b ? await b.supported().catch(() => false) : false;
  return supported;
}

/** localStorage에 저장할 설정: 보안 저장소를 쓰면 키를 비운다 */
export function forLocalStorage(s: AiSettings): AiSettings {
  if (!supported || !ready) return s;
  return { ...s, keys: { claude: '', gemini: '', openai: '' } };
}

export async function saveKeys(keys: Keys): Promise<boolean> {
  if (!ready) {
    pendingKeys = { ...keys };
    return false;
  }
  if (!(await secureKeysSupported())) return false;
  return window.ezboard!.keys!.set(keys).catch(() => false);
}

/**
 * 시작할 때: 보안 저장소의 키를 읽어 온다.
 * localStorage에 예전 평문 키가 남아 있거나 시작 직후 사용자가 키를 입력했으면 보안 저장소로 반영한다.
 */
export async function loadKeys(current: Keys): Promise<{ keys: Keys; migrated: boolean } | null> {
  if (!(await secureKeysSupported())) return null;
  const stored = (await window.ezboard!.keys!.get()) as Partial<Keys>;
  const keys: Keys = { claude: '', gemini: '', openai: '' };
  let migrated = false;
  for (const p of ALL_PROVIDERS) {
    if (pendingKeys) {
      keys[p] = pendingKeys[p] ?? '';
      migrated = true;
    } else if (current[p]) {
      keys[p] = current[p];
      if (current[p] !== stored[p]) migrated = true;
    } else if (stored[p]) {
      keys[p] = stored[p]!;
    }
  }
  pendingKeys = null;
  if (migrated) await window.ezboard!.keys!.set(keys).catch(() => false);
  ready = true;
  return { keys, migrated };
}
