// 앱 정보와 바깥 주소 (업데이트, 이슈·토론, 후원)
import { Capacitor } from '@capacitor/core';

export const APP_VERSION = __APP_VERSION__;
/** 릴리스를 가져오는 저장소. 공개 저장소라 로그인 없이 읽을 수 있다 (Kreate와 같은 방식) */
export const REPO = 'MinaryHub/ezBoard';
export const REPO_URL = `https://github.com/${REPO}`;
/** 버그 신고·기능 제안 (GitHub Issues) 및 질문·토론 (GitHub Discussions) */
export const ISSUES_URL = `${REPO_URL}/issues`;
export const DISCUSSIONS_URL = `${REPO_URL}/discussions`;
/** 후원 페이지 (Kreate의 "Support Kreate"와 같은 곳) */
export const SPONSORS_URL = 'https://github.com/sponsors/MinaryHub';

/** 현재 앱 버전과 환경 정보를 미리 채운 GitHub 새 이슈 작성 주소 */
export function newIssueUrl(): string {
  const info = platform();
  const body = [
    '### 설명 / Description',
    '<!-- 무엇이 일어났는지, 무엇을 기대했는지 적어주세요. -->',
    '',
    '### 환경 / Environment',
    `- ezBoard: v${APP_VERSION}`,
    `- Platform: ${info.label}`,
  ].join('\n');
  return `${ISSUES_URL}/new?body=${encodeURIComponent(body)}`;
}

export type Platform = 'mac' | 'windows' | 'linux' | 'android' | 'web';

export function platform(): { os: Platform; arch: string; label: string } {
  const bridge = typeof window !== 'undefined' ? window.ezboard : undefined;
  if (bridge) {
    const os: Platform = bridge.platform === 'darwin' ? 'mac' : bridge.platform === 'win32' ? 'windows' : 'linux';
    return { os, arch: bridge.arch, label: `${os} ${bridge.arch} (desktop)` };
  }
  if (Capacitor.getPlatform() === 'android') return { os: 'android', arch: '', label: 'android' };
  const ua = navigator.userAgent.split(') ')[0].split(' (')[1] ?? 'browser';
  return { os: 'web', arch: '', label: `web (${ua})`.slice(0, 60) };
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
