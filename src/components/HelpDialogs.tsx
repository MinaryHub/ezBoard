// 도움말 메뉴의 창들: 업데이트, 문의하기, 앱 정보
import { useEffect, useRef, useState } from 'react';
import { useLang, useT } from '../i18n';
import Icon from './Icon';
import { renderMarkdown } from '../lib/markdown';
import { APP_VERSION, CONTACT_URL, REPO_URL, SPONSORS_URL, openExternal, platform } from '../lib/meta';
import { checkForUpdate, currentVersion, skipVersion, type UpdateInfo } from '../lib/update';

function Modal({ title, icon, onClose, children, width = 520 }: { title: string; icon: Parameters<typeof Icon>[0]['name']; onClose: () => void; children: React.ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: `min(${width}px, 94vw)` }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <h2><Icon name={icon} size={16} />{title}</h2>
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
  const { os } = platform();

  useEffect(() => {
    if (initial) return;
    const ctrl = new AbortController();
    checkForUpdate(ctrl.signal)
      .then((info) => setSt(info ? { s: 'available', info } : { s: 'latest' }))
      .catch((e) => { if (!ctrl.signal.aborted) setSt({ s: 'error', msg: t('upd.error', { msg: (e as Error).message }) }); });
    return () => ctrl.abort();
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async (info: UpdateInfo) => {
    const asset = info.asset;
    if (!asset) { openExternal(info.page); return; }
    if (os === 'android' || !window.ezboard) { openExternal(asset.url); return; }
    setSt({ s: 'downloading', info, received: 0, total: asset.size });
    const off = window.ezboard.onProgress((p) => setSt({ s: 'downloading', info, received: p.received, total: p.total || asset.size }));
    try {
      const path = await window.ezboard.download(asset.url, asset.name);
      setSt({ s: 'downloaded', info, path });
    } catch (e) {
      setSt({ s: 'error', msg: t('upd.downloadError', { msg: (e as Error).message }) });
    } finally {
      off();
    }
  };

  const readyText = os === 'windows' ? t('upd.readyWin') : os === 'mac' ? t('upd.readyMac') : t('upd.readyLinux');

  return (
    <Modal title={t('upd.title')} icon="download" onClose={onClose}>
      {st.s === 'checking' && <p className="muted"><span className="dots"><i /><i /><i /></span> {t('upd.checking')}</p>}
      {st.s === 'latest' && <p className="upd-ok"><Icon name="check" size={16} />{t('upd.latest', { v: currentVersion() })}</p>}
      {st.s === 'error' && <p className="form-error">{st.msg}</p>}
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
          {os === 'android' && st.s === 'available' && <p className="tip">{t('upd.androidHint')}</p>}
          {os === 'web' && st.s === 'available' && <p className="tip">{t('upd.webHint')}</p>}
        </>
      )}
      <div className="modal-actions">
        {st.s === 'available' && (
          <>
            <button className="ghost" onClick={() => { skipVersion(st.info.version); onClose(); }}>{t('upd.skip')}</button>
            <span style={{ flex: 1 }} />
            <button onClick={() => openExternal(st.info.page)}>{t('upd.openPage')}</button>
            <button onClick={onClose}>{t('upd.later')}</button>
            {st.info.asset && os !== 'web' && (
              <button className="primary" onClick={() => download(st.info)}>
                {os === 'android' ? t('upd.downloadAndroid') : t('upd.download')}
                <span className="num small" style={{ opacity: 0.8 }}>{mb(st.info.asset.size)}</span>
              </button>
            )}
          </>
        )}
        {st.s === 'downloaded' && (
          <>
            <button onClick={onClose}>{t('upd.later')}</button>
            <button className="primary" onClick={() => window.ezboard?.openDownloaded(st.path)}>{t('upd.install')}</button>
          </>
        )}
        {(st.s === 'latest' || st.s === 'error' || st.s === 'checking') && <button onClick={onClose}>{t('contact.close')}</button>}
      </div>
    </Modal>
  );
}

// ── 문의하기 ──
type Kind = 'bug' | 'feature' | 'question' | 'other';
const KINDS: Kind[] = ['bug', 'feature', 'question', 'other'];

export function ContactDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<Kind>('question');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const honeypot = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ s: 'idle' } | { s: 'sending' } | { s: 'sent' } | { s: 'error'; msg: string }>({ s: 'idle' });
  const info = platform();

  const send = async () => {
    setState({ s: 'sending' });
    try {
      const res = await fetch(CONTACT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ezboard-client': `ezboard/${APP_VERSION}` },
        body: JSON.stringify({ kind, message, name: name || undefined, email: email || undefined, version: APP_VERSION, platform: info.label, website: honeypot.current?.value || undefined }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) { setState({ s: 'sent' }); return; }
      setState({ s: 'error', msg: res.status === 503 || res.status === 404 ? t('contact.notSetup') : t('contact.failed', { msg: data.error ?? `HTTP ${res.status}` }) });
    } catch (e) {
      // 연결 자체가 안 된 경우(오프라인, 서버 없음)는 쉬운 말로
      const err = e as Error;
      setState({ s: 'error', msg: err.name === 'TypeError' || err.name === 'TimeoutError' ? t('contact.network') : t('contact.failed', { msg: err.message }) });
    }
  };

  const emailBad = email !== '' && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
  return (
    <Modal title={t('contact.title')} icon="chat" onClose={onClose}>
      {state.s === 'sent' ? (
        <>
          <p className="upd-ok"><Icon name="check" size={16} />{t('contact.sent')}</p>
          <div className="modal-actions"><button className="primary" onClick={onClose}>{t('contact.close')}</button></div>
        </>
      ) : (
        <>
          <p className="muted">{t('contact.desc')}</p>
          <div className="seg kind-seg">
            {KINDS.map((k) => <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{t(`contact.kind.${k}`)}</button>)}
          </div>
          <label className="form-field">{t('contact.message')}
            <textarea rows={6} maxLength={5000} value={message} placeholder={t('contact.messagePh')} onChange={(e) => setMessage(e.target.value)} />
            <span className="num small counter">{message.length} / 5000</span>
          </label>
          <div className="form-row">
            <label className="form-field">{t('contact.name')}<input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
            <label className="form-field">{t('contact.email')}<input type="email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} className={emailBad ? 'invalid' : ''} /></label>
          </div>
          {/* 사람에게는 보이지 않는 칸: 자동으로 채우는 봇만 채운다 */}
          <input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" className="hp" aria-hidden="true" />
          <p className="muted small">{t('contact.includes', { v: APP_VERSION, platform: info.label })}</p>
          {state.s === 'error' && <p className="form-error">{state.msg}</p>}
          <div className="modal-actions">
            <button onClick={onClose}>{t('set.cancel')}</button>
            <button className="primary" disabled={!message.trim() || emailBad || state.s === 'sending'} onClick={send}>
              <Icon name="send" size={14} />{state.s === 'sending' ? t('contact.sending') : t('contact.send')}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── 앱 정보 ──
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Modal title={t('help.about')} icon="help" onClose={onClose} width={420}>
      <div className="about">
        <img src="./logo-mark.svg" alt="" width={72} height={72} />
        <div>
          <div className="about-name">ezBoard</div>
          <div className="num muted">{t('about.version', { v: APP_VERSION })}</div>
          <div className="muted">{t('about.desc')}</div>
        </div>
      </div>
      <p className="muted small">{t('about.sponsorText')}</p>
      <div className="modal-actions">
        <button onClick={() => openExternal(REPO_URL)}><Icon name="open" size={14} />{t('about.source')}</button>
        <button className="primary" onClick={() => openExternal(SPONSORS_URL)}><Icon name="heart" size={14} />{t('help.sponsor')}</button>
      </div>
    </Modal>
  );
}
