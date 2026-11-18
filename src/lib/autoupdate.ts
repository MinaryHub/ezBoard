// 자동 업데이트 상태 (Windows 설치판, Linux AppImage에서만 켜진다).
// 데스크톱 쪽(electron/auto-update.cjs)이 뒤에서 받아 두고, 여기서는 상태를 보여 주고 "다시 시작"만 부탁한다.
import { create } from 'zustand';

const KEY = 'ezboard.update.auto';

/** 사용자 설정: 업데이트를 자동으로 받기 (기본 켜짐) */
export function autoUpdateEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

interface AutoState {
  supported: boolean;
  enabled: boolean;
  state: AutoUpdateState;
  setEnabled: (on: boolean) => void;
}

export const useAutoUpdate = create<AutoState>((set) => ({
  supported: false,
  enabled: autoUpdateEnabled(),
  state: { status: 'idle' },
  setEnabled: (enabled) => {
    try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch { /* 무시 */ }
    set({ enabled });
    if (enabled) void checkNow();
  },
}));

let started = false;

/** 앱 시작 때 한 번: 지원 여부를 알아보고, 켜져 있으면 확인·다운로드를 시작한다 */
export async function initAutoUpdate() {
  const bridge = window.ezboard?.autoUpdate;
  if (started || !bridge) return;
  started = true;
  const supported = await bridge.supported().catch(() => false);
  if (!supported) return;
  bridge.onState((state) => useAutoUpdate.setState({ state }));
  useAutoUpdate.setState({ supported, state: await bridge.state() });
  if (useAutoUpdate.getState().enabled) void checkNow();
}

/** 지금 확인하고, 새 버전이 있으면 받는다 */
export async function checkNow(): Promise<AutoUpdateState | null> {
  const bridge = window.ezboard?.autoUpdate;
  if (!bridge || !useAutoUpdate.getState().supported) return null;
  const state = await bridge.check();
  useAutoUpdate.setState({ state });
  return state;
}

/** 받아 둔 새 버전을 설치하고 다시 시작 */
export function installNow() {
  return window.ezboard?.autoUpdate?.install();
}
