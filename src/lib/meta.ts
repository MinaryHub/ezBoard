// 앱 정보와 바깥 주소 (업데이트, 문의, 후원)
import { Capacitor } from '@capacitor/core';

export const APP_VERSION = __APP_VERSION__;
/** 릴리스를 가져오는 저장소. 공개 저장소라 로그인 없이 읽을 수 있다 (Kreate와 같은 방식) */
export const REPO = 'MinaryHub/ezBoard';
export const REPO_URL = `https://github.com/${REPO}`;
/** 후원 페이지 (Kreate의 "Support Kreate"와 같은 곳) */
export const SPONSORS_URL = 'https://github.com/sponsors/MinaryHub';
/** 문의하기 전송 서버. 받는 주소와 메일 키는 앱이 아니라 서버 설정에만 있다 */
export const CONTACT_URL = import.meta.env.VITE_CONTACT_URL || 'https://ezboard-contact.vercel.app/api/contact';

export type Platform = 'mac' | 'windows' | 'linux' | 'android' | 'web';

export function platform(): { os: Platform; arch: string; label: string } {
  const bridge = typeof window !== 'undefined' ? window.ezboard : undefined;
  if (bridge) {
    const os: Platform = bridge.platform === 'darwin' ? 'mac' : bridge.platform === 'win32' ? 'windows' : 'linux';
    return { os, arch: bridge.arch, label: `${os} ${bridge.arch} (desktop)` };
  }
  if (Capacitor.getPlatform() === 'android') return { os: 'android', arch: '', label: 'android' };
  return { os: 'web', arch: '', label: `web (${navigator.userAgent.split(') ')[0].split(' (')[1] ?? 'browser'})` };
}

/** 바깥 링크를 시스템 브라우저로 연다 */
export async function openExternal(url: string) {
  if (window.ezboard) return window.ezboard.openExternal(url);
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    return Browser.open({ url });
  }
  window.open(url, '_blank', 'noopener');
}
