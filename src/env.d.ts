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
}

interface Window {
  ezboard?: EzboardBridge;
}
