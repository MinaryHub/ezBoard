// 업데이트 확인: 저장소의 최신 릴리스를 보고, 지금보다 새 버전이면 알려준다.
// (Kreate의 update.rs와 같은 출처 — GitHub releases/latest)
import { APP_VERSION, REPO, platform, type Platform } from './meta';

export interface ReleaseAsset { name: string; url: string; size: number }
export interface UpdateInfo {
  version: string;        // 1.2.0
  notes: string;          // 릴리스 노트 (마크다운)
  page: string;           // 릴리스 페이지
  asset?: ReleaseAsset;   // 이 기기에 맞는 설치 파일
  publishedAt: string;
}

/** "v1.2.0" → [1,2,0]. 숫자가 아닌 꼬리(-beta 등)는 정식 출시보다 낮게 본다 */
function parse(v: string): [number, number, number, number] {
  const m = v.trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(.*)$/);
  if (!m) return [0, 0, 0, 0];
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0), m[4] ? -1 : 0];
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parse(candidate), b = parse(current);
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** 운영체제·CPU에 맞는 설치 파일 고르기 (릴리스 파일 이름 규칙: ezBoard-<버전>-<플랫폼>.<확장자>) */
export function pickAsset(assets: ReleaseAsset[], os: Platform, arch: string): ReleaseAsset | undefined {
  const find = (re: RegExp) => assets.find((a) => re.test(a.name));
  switch (os) {
    case 'mac': return find(arch === 'arm64' ? /-mac-arm64\.dmg$/ : /-mac-x64\.dmg$/) ?? find(/\.dmg$/);
    case 'windows': return find(/-windows-x64-setup\.exe$/) ?? find(/\.exe$/);
    case 'linux': return find(/\.AppImage$/) ?? find(/\.deb$/);
    case 'android': return find(/-android\.apk$/) ?? find(/\.apk$/);
    default: return undefined;
  }
}

/** 지금 버전 (시험용으로 localStorage 'ezboard.debugVersion'을 두면 그 값으로 행동) */
export function currentVersion(): string {
  try { return localStorage.getItem('ezboard.debugVersion') || APP_VERSION; } catch { return APP_VERSION; }
}

export async function checkForUpdate(signal?: AbortSignal): Promise<UpdateInfo | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json' },
    signal,
  });
  if (res.status === 404) return null; // 아직 릴리스가 없음
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const r = await res.json();
  if (r.draft || r.prerelease || typeof r.tag_name !== 'string') return null;
  const version = r.tag_name.replace(/^v/i, '');
  if (!isNewer(version, currentVersion())) return null;
  const assets: ReleaseAsset[] = (r.assets ?? []).map((a: { name: string; browser_download_url: string; size: number }) => ({ name: a.name, url: a.browser_download_url, size: a.size }));
  const { os, arch } = platform();
  return { version, notes: r.body ?? '', page: r.html_url, asset: pickAsset(assets, os, arch), publishedAt: r.published_at };
}

// ── 시작할 때 하루 한 번 자동 확인 ──
const LAST = 'ezboard.update.lastCheck';
const SKIP = 'ezboard.update.skip';
const DAY = 24 * 60 * 60 * 1000;

export function skippedVersion(): string | null {
  try { return localStorage.getItem(SKIP); } catch { return null; }
}
export function skipVersion(v: string) {
  try { localStorage.setItem(SKIP, v); } catch { /* 무시 */ }
}

/** 하루에 한 번만 조용히 확인. 건너뛰기로 한 버전이면 알리지 않는다 */
export async function autoCheck(): Promise<UpdateInfo | null> {
  try {
    const last = Number(localStorage.getItem(LAST) || 0);
    if (Date.now() - last < DAY) return null;
    localStorage.setItem(LAST, String(Date.now()));
  } catch { /* 저장소가 없으면 매번 확인 */ }
  try {
    const info = await checkForUpdate(AbortSignal.timeout(10_000));
    if (info && info.version === skippedVersion()) return null;
    return info;
  } catch {
    return null; // 오프라인 등: 조용히 넘어간다
  }
}
