// 도움말 메뉴의 창들: 업데이트, 앱 정보
import { useEffect, useRef, useState } from 'react';
import { useLang, useT } from '../i18n';
import Icon from './Icon';
import { renderMarkdown } from '../lib/markdown';
import { APP_VERSION, DISCUSSIONS_URL, ISSUES_URL, REPO_URL, SPONSORS_URL, openExternal, platform } from '../lib/meta';
import { checkForUpdate, currentVersion, skipVersion, type UpdateInfo } from '../lib/update';
import { checkNow, installNow, useAutoUpdate } from '../lib/autoupdate';

function Modal({ title, icon, onClose, children, width = 520 }: { title: string; icon: Parameters<typeof Icon>[0]['name']; onClose: () => void; children: React.ReactNode; width?: number }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: `min(${width}px, 94vw)` }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2><Icon name={icon} size={16} />{title}</h2>
          <button type="button" className="ghost small" onClick={onClose} aria-label={t('common.close')}><Icon name="close" size={15} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** 릴리스 노트에서 지금 언어 부분만 (한국어 / --- / English 형식), 그림과 다운로드 표는 뺀다 */
function localizedNotes(notes: string, lang: 'ko' | 'en'): string {
  const parts = notes.split(/\r?\n-{3,}\r?\n/);
  let text = parts[0];
  if (lang === 'en' && parts.length > 1) text = parts.find((p) => /english/i.test(p)) ?? parts[parts.length - 1];
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)\s*/g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\|/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── 업데이트 ──
type UpdState =
  | { s: 'checking' }
  | { s: 'latest' }
  | { s: 'error'; msg: string }
  | { s: 'available'; info: UpdateInfo }
  | { s: 'downloading'; info: UpdateInfo; received: number; total: number }
  | { s: 'downloaded'; info: UpdateInfo; path: string };

export function UpdateDialog({ onClose, initial }: { onClose: () => void; initial?: UpdateInfo | null }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const [st, setSt] = useState<UpdState>(initial ? { s: 'available', info: initial } : { s: 'checking' });
  const offProgressRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const { os } = platform();
  // Windows 설치판·Linux AppImage: 앱이 뒤에서 받아 두고 다시 시작할 때 설치한다
  const autoOk = useAutoUpdate((s) => s.supported);
  const auto = useAutoUpdate((s) => s.state);
  const autoReady = autoOk && auto.status === 'ready';
  const autoGetting = autoOk && (auto.status === 'downloading' || auto.status === 'checking');

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      offProgressRef.current?.();
      offProgressRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (initial) return;
    const ctrl = new AbortController();
    checkForUpdate(ctrl.signal)
      .then((info) => { if (mountedRef.current) setSt(info ? { s: 'available', info } : { s: 'latest' }); })
      .catch((e) => { if (!ctrl.signal.aborted && mountedRef.current) setSt({ s: 'error', msg: t('upd.error', { msg: (e as Error).message }) }); });
    return () => ctrl.abort();
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async (info: UpdateInfo) => {
    if (autoOk && auto.status !== 'error') { void checkNow(); return; }
    const asset = info.asset;
    if (!asset) { void openExternal(info.page); return; }
    if (os === 'android' || !window.ezboard) { void openExternal(asset.url); return; }
    setSt({ s: 'downloading', info, received: 0, total: asset.size });
    offProgressRef.current?.();
    const off = window.ezboard.onProgress((p) => {
      if (mountedRef.current) setSt({ s: 'downloading', info, received: p.received, total: p.total || asset.size });
    });
    offProgressRef.current = off;
    try {
      const path = await window.ezboard.download(asset.url, asset.name);
      if (mountedRef.current) setSt({ s: 'downloaded', info, path });
    } catch (e) {
      if (mountedRef.current) setSt({ s: 'error', msg: t('upd.downloadError', { msg: (e as Error).message }) });
    } finally {
      off();
      if (offProgressRef.current === off) offProgressRef.current = null;
    }
  };

  const openFile = (p: string) => {
    void window.ezboard?.openDownloaded(p).catch((e) => {
      if (mountedRef.current) setSt({ s: 'error', msg: t('upd.downloadError', { msg: (e as Error).message }) });
    });
  };

  const readyText = os === 'windows' ? t('upd.readyWin') : os === 'mac' ? t('upd.readyMac') : t('upd.readyLinux');

  return (
    <Modal title={t('upd.title')} icon="download" onClose={onClose}>
      {st.s === 'checking' && !autoReady && <p className="muted"><span className="dots"><i /><i /><i /></span> {t('upd.checking')}</p>}
      {st.s === 'latest' && !autoReady && <p className="upd-ok"><Icon name="check" size={16} />{t('upd.latest', { v: currentVersion() })}</p>}
      {st.s === 'error' && !autoReady && <p className="form-error">{st.msg}</p>}
      {(st.s === 'available' || st.s === 'downloading' || st.s === 'downloaded') && (
        <>
          <div className="upd-head">
            <div className="upd-version">{t('upd.available', { v: st.info.version })}</div>
            <div className="muted small">{t('upd.current', { v: currentVersion(), date: st.info.publishedAt.slice(0, 10) })}</div>
          </div>
          <div className="section-label">{t('upd.whatsNew')}</div>
          <div className="upd-notes md" dangerouslySetInnerHTML={{ __html: renderMarkdown(localizedNotes(st.info.notes, lang)) }} />
          {st.s === 'downloading' && (
            <div className="progress">
              <div className="bar"><i style={{ width: `${st.total ? Math.min(100, (st.received / st.total) * 100) : 0}%` }} /></div>
              <span className="num small">{t('upd.downloading', { p: `${mb(st.received)} / ${mb(st.total)}` })}</span>
            </div>
          )}
          {st.s === 'downloaded' && <p className="tip">{readyText}</p>}
          {autoGetting && (
            <div className="progress">
              <div className="bar"><i style={{ width: `${auto.total ? Math.min(100, ((auto.received ?? 0) / auto.total) * 100) : 0}%` }} /></div>
              <span className="num small">{auto.total ? t('upd.downloading', { p: `${mb(auto.received ?? 0)} / ${mb(auto.total)}` }) : t('upd.autoGetting')}</span>
            </div>
          )}
          {autoOk && auto.status === 'error' && <p className="form-error">{t('upd.autoError', { msg: auto.message ?? '' })}</p>}
          {os === 'android' && st.s === 'available' && <p className="tip">{t('upd.androidHint')}</p>}
          {os === 'web' && st.s === 'available' && <p className="tip">{t('upd.webHint')}</p>}
        </>
      )}
      {autoReady && <p className="tip">{t('upd.readyAuto', { v: auto.version ?? (st.s === 'available' ? st.info.version : '') })}</p>}
      <div className="modal-actions">
        {autoReady ? (
          <>
            <button onClick={onClose}>{t('upd.later')}</button>
            <button className="primary" onClick={() => void installNow()}><Icon name="rotate" size={14} />{t('upd.restart')}</button>
          </>
        ) : st.s === 'available' ? (
          <>
            <button className="ghost" onClick={() => { skipVersion(st.info.version); onClose(); }}>{t('upd.skip')}</button>
            <span style={{ flex: 1 }} />
            <button onClick={() => void openExternal(st.info.page)}>{t('upd.openPage')}</button>
            <button onClick={onClose}>{t('upd.later')}</button>
            {st.info.asset && os !== 'web' && (
              <button className="primary" disabled={autoGetting} onClick={() => download(st.info)}>
                {os === 'android' ? t('upd.downloadAndroid') : t('upd.download')}
                <span className="num small" style={{ opacity: 0.8 }}>{mb(st.info.asset.size)}</span>
              </button>
            )}
          </>
        ) : st.s === 'downloaded' ? (
          <>
            <button onClick={onClose}>{t('upd.later')}</button>
            <button className="primary" onClick={() => openFile(st.path)}>{t('upd.install')}</button>
          </>
        ) : (
          <button onClick={onClose}>{t('common.close')}</button>
        )}
      </div>
    </Modal>
  );
}

// ── 앱 정보 ──
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Modal title={t('help.about')} icon="help" onClose={onClose} width={440}>
      <div className="about">
        <img src="./logo-mark.svg" alt="" width={72} height={72} />
        <div>
          <div className="about-name">ezBoard</div>
          <div className="num muted">{t('about.version', { v: APP_VERSION })}</div>
          <div className="muted">{t('about.desc')}</div>
        </div>
      </div>
      <p className="muted small">{t('about.sponsorText')}</p>
      <div className="modal-actions about-actions">
        <button type="button" onClick={() => void openExternal(REPO_URL)}><Icon name="open" size={14} />{t('about.source')}</button>
        <button type="button" onClick={() => void openExternal(ISSUES_URL)}><Icon name="issue" size={14} />{t('about.issues')}</button>
        <button type="button" onClick={() => void openExternal(DISCUSSIONS_URL)}><Icon name="chat" size={14} />{t('about.discussions')}</button>
        <button type="button" className="primary" onClick={() => void openExternal(SPONSORS_URL)}><Icon name="heart" size={14} />{t('help.sponsor')}</button>
      </div>
    </Modal>
  );
}
