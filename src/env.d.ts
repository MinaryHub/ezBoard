/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** 문의하기 전송 서버 주소 (기본: https://ezboard-contact.vercel.app/api/contact) */
  readonly VITE_CONTACT_URL?: string;
}

/** 데스크톱(Electron) 앱에서만 있는 다리 (electron/preload.cjs) */
interface EzboardBridge {
  platform: string;
  arch: string;
  download(url: string, name: string): Promise<string>;
  onProgress(cb: (p: { received: number; total: number }) => void): () => void;
  openDownloaded(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** 로그인한 계정(공식 CLI) 상태 */
  cliStatus(provider: string): Promise<{ installed: boolean; loggedIn: boolean; detail?: string }>;
  /** 로그인한 계정(공식 CLI)으로 질문 */
  cliAsk(provider: string, req: { model?: string; system: string; prompt: string }): Promise<string>;
  /** 자동 업데이트 (Windows 설치판, Linux AppImage). 예전 버전 앱에는 없다 */
  autoUpdate?: {
    supported(): Promise<boolean>;
    state(): Promise<AutoUpdateState>;
    check(): Promise<AutoUpdateState>;
    install(): Promise<boolean>;
    onState(cb: (s: AutoUpdateState) => void): () => void;
  };
}

interface AutoUpdateState {
  status: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error';
  version?: string;
  received?: number;
  total?: number;
  message?: string;
}

interface Window {
  ezboard?: EzboardBridge;
}
