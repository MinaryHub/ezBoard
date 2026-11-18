// 데스크톱 앱에서는 AI 키를 운영체제 보안 저장소에 두고, localStorage에는 빈 값만 남긴다.
// 웹·안드로이드나 보안 저장소가 없는 Linux에서는 예전처럼 localStorage에 둔다.
import type { AiSettings, Provider } from '../types';

type Keys = AiSettings['keys'];
let supported: boolean | null = null;
/** 시작 때 읽기가 끝나기 전에는 저장하지 않는다 (빈 칸으로 덮어써 키를 지우는 일을 막음) */
let ready = false;

export async function secureKeysSupported(): Promise<boolean> {
  if (supported !== null) return supported;
  const b = window.ezboard?.keys;
  supported = b ? await b.supported().catch(() => false) : false;
  return supported;
}

/** localStorage에 저장할 설정: 보안 저장소를 쓰면 키를 비운다 */
export function forLocalStorage(s: AiSettings): AiSettings {
  if (!supported || !ready) return s;
  return { ...s, keys: { claude: '', gemini: '', openai: '' } };
}

export async function saveKeys(keys: Keys) {
  if (!ready || !(await secureKeysSupported())) return;
  await window.ezboard!.keys!.set(keys);
}

/**
 * 시작할 때: 보안 저장소의 키를 읽어 온다.
 * localStorage에 예전 평문 키가 남아 있으면 보안 저장소로 옮긴다 (반환값의 migrated=true).
 */
export async function loadKeys(current: Keys): Promise<{ keys: Keys; migrated: boolean } | null> {
  if (!(await secureKeysSupported())) return null;
  const stored = (await window.ezboard!.keys!.get()) as Partial<Keys>;
  const keys = { ...current };
  let migrated = false;
  for (const p of Object.keys(keys) as Provider[]) {
    if (current[p]) {
      if (current[p] !== stored[p]) migrated = true;
    } else if (stored[p]) keys[p] = stored[p]!;
  }
  if (migrated) await window.ezboard!.keys!.set(keys);
  ready = true;
  return { keys, migrated };
}
