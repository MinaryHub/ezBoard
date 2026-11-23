// 실행 환경(웹 / 데스크톱 / 안드로이드)에 따라 다르게 동작해야 하는 기능
import { Capacitor } from '@capacitor/core';
import { t } from '../i18n';

export const isNative = Capacitor.isNativePlatform();

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * 파일 저장. 웹·데스크톱은 다운로드(저장 대화상자),
 * 안드로이드는 앱 캐시에 쓴 뒤 공유 시트를 띄워 "파일에 저장 / 드라이브 / 메일" 등을 고르게 한다.
 */
export async function saveFile(blob: Blob, name: string): Promise<void> {
  const safe = name.replace(/[\\/:*?"<>|]+/g, '_').replace(/^\.+$/, '') || 'ezboard';
  if (isNative) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const res = await Filesystem.writeFile({ path: safe, data: await blobToBase64(blob), directory: Directory.Cache });
    try {
      await Share.share({ title: safe, files: [res.uri], dialogTitle: t('share.title') });
    } catch (e) {
      // 사용자가 공유 창을 닫은 경우는 오류가 아님
      if (/cancel/i.test((e as Error).message)) return;
      throw e;
    }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = safe;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 15_000);
}
