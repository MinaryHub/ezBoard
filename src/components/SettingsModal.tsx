import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { accountStatus, canUseAccount, listModels, PROVIDERS } from '../lib/ai';
import { useLang, useT } from '../i18n';
import type { AuthMode, Provider } from '../types';
import Icon from './Icon';
import { useAutoUpdate } from '../lib/autoupdate';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const { lang, setLang } = useLang();
  const appearance = useStore((s) => s.appearance);
  const autoSupported = useAutoUpdate((s) => s.supported);
  const autoEnabled = useAutoUpdate((s) => s.enabled);
  const setAutoEnabled = useAutoUpdate((s) => s.setEnabled);
  const setAppearance = useStore((s) => s.setAppearance);
  const t = useT();
  const [draft, setDraft] = useState(settings);
  const [models, setModels] = useState<Partial<Record<Provider, string[]>>>({});
  const [status, setStatus] = useState<Partial<Record<Provider, string>>>({});
  const [acct, setAcct] = useState<Partial<Record<Provider, { installed: boolean; loggedIn: boolean } | 'checking'>>>({});
  const accountOk = canUseAccount();

  const checkAccount = async (p: Provider) => {
    setAcct((a) => ({ ...a, [p]: 'checking' }));
    try {
      const st = await accountStatus(p);
      setAcct((a) => ({ ...a, [p]: st }));
    } catch {
      setAcct((a) => ({ ...a, [p]: { installed: false, loggedIn: false } }));
    }
  };

  // 계정 연결로 되어 있는 제공사는 창을 열 때 상태를 확인한다
  useEffect(() => {
    if (!accountOk) return;
    for (const p of Object.keys(PROVIDERS) as Provider[]) if (draft.auth?.[p] === 'account') checkAccount(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAuth = (p: Provider, mode: AuthMode) => {
    setDraft({ ...draft, auth: { ...draft.auth, [p]: mode } });
    if (mode === 'account' && !acct[p]) checkAccount(p);
  };

  const load = async (p: Provider) => {
    setStatus((s) => ({ ...s, [p]: t('set.loading') }));
    try {
      const list = await listModels(p, draft.keys[p]);
      setModels((m) => ({ ...m, [p]: list }));
      setStatus((s) => ({ ...s, [p]: t('set.ok', { n: list.length }) }));
    } catch (e) {
      setStatus((s) => ({ ...s, [p]: `❌ ${(e as Error).message}` }));
    }
  };

  const save = () => { setSettings(draft); onClose(); };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2><Icon name="settings" size={16} />{t('set.title').replace('⚙️ ', '')}</h2>
        <p className="muted" dangerouslySetInnerHTML={{ __html: t('set.desc') }} />
        <div className="set-row">
          <span className="muted">{t('set.language')}</span>
          <div className="seg">
            <button className={lang === 'ko' ? 'active' : ''} onClick={() => setLang('ko')}>한국어</button>
            <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>English</button>
          </div>
        </div>
        <div className="set-row" data-tip={t('tip.appearance')}>
          <span className="muted">{t('set.appearance')}</span>
          <div className="seg">
            <button className={appearance === 'dark' ? 'active' : ''} onClick={() => setAppearance('dark')}><Icon name="moon" size={14} />{t('set.dark')}</button>
            <button className={appearance === 'light' ? 'active' : ''} onClick={() => setAppearance('light')}><Icon name="sun" size={14} />{t('set.light')}</button>
          </div>
        </div>
        {autoSupported && (
          <div className="set-row" data-tip={t('tip.autoUpdate')}>
            <span className="muted">{t('set.update')}</span>
            <label className="check-row">
              <input type="checkbox" checked={autoEnabled} onChange={(e) => setAutoEnabled(e.target.checked)} />{t('set.autoUpdate')}
            </label>
          </div>
        )}
        {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
          <div key={p} className={`provider-card ${draft.provider === p ? 'active' : ''}`}>
            <label className="provider-head">
              <input type="radio" checked={draft.provider === p} onChange={() => setDraft({ ...draft, provider: p })} />
              <b>{PROVIDERS[p].label}</b>
              <a href={PROVIDERS[p].keyUrl} target="_blank" rel="noreferrer">{t('set.getKey')}</a>
            </label>
            <div className="seg auth-seg">
              <button className={draft.auth[p] !== 'account' ? 'active' : ''} onClick={() => setAuth(p, 'key')}>{t('set.authKey')}</button>
              <button
                className={draft.auth[p] === 'account' ? 'active' : ''}
                onClick={() => setAuth(p, 'account')}
                disabled={!accountOk}
                data-tip={accountOk ? t('set.authAccountTip', { product: PROVIDERS[p].cli.product }) : t('set.accountDesktopOnly')}
              >{t('set.authAccount')}</button>
            </div>
            {draft.auth[p] === 'account' && accountOk ? (
              <>
                <AccountState p={p} st={acct[p]} onRecheck={() => checkAccount(p)} />
                <div className="row">
                  <span className="muted small">{t('set.model')}</span>
                  <input
                    value={draft.cliModels[p]}
                    placeholder={t('set.cliDefaultModel')}
                    onChange={(e) => setDraft({ ...draft, cliModels: { ...draft.cliModels, [p]: e.target.value } })}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="row">
                  <input
                    type="password"
                    placeholder={t('set.key', { hint: PROVIDERS[p].keyHint })}
                    value={draft.keys[p]}
                    onChange={(e) => setDraft({ ...draft, keys: { ...draft.keys, [p]: e.target.value } })}
                  />
                  <button onClick={() => load(p)} disabled={!draft.keys[p]}>{t('set.test')}</button>
                </div>
                <div className="row">
                  <span className="muted small">{t('set.model')}</span>
                  <input
                    list={`models-${p}`}
                    value={draft.models[p]}
                    placeholder={PROVIDERS[p].defaultModel}
                    onChange={(e) => setDraft({ ...draft, models: { ...draft.models, [p]: e.target.value } })}
                  />
                  <datalist id={`models-${p}`}>
                    {(models[p] ?? []).map((m) => <option key={m} value={m} />)}
                  </datalist>
                </div>
              </>
            )}
            {status[p] && <div className="small status">{status[p]}</div>}
          </div>
        ))}
        <div className="modal-actions">
          <button onClick={onClose}>{t('set.cancel')}</button>
          <button className="primary" onClick={save}>{t('set.save')}</button>
        </div>
      </div>
    </div>
  );
}

function AccountState({ p, st, onRecheck }: { p: Provider; st?: { installed: boolean; loggedIn: boolean } | 'checking'; onRecheck: () => void }) {
  const t = useT();
  const cli = PROVIDERS[p].cli;
  const recheck = <button className="small" onClick={onRecheck}>{t('set.recheck')}</button>;
  if (!st || st === 'checking') return <div className="small status">{t('set.loading')}</div>;
  if (st.loggedIn) return <div className="row small status">{t('set.accountOk', { product: cli.product })}<span className="spacer" />{recheck}</div>;
  return (
    <div className="small status account-help">
      <div className="row">{st.installed ? t('set.accountNeedLogin', { product: cli.product }) : t('set.accountNeedInstall', { product: cli.product })}<span className="spacer" />{recheck}</div>
      <ol>
        {!st.installed && <li>{t('set.stepInstall')} <code>{cli.install}</code> <a href={cli.url} target="_blank" rel="noreferrer">↗</a></li>}
        <li>{t('set.stepLogin')} <code>{cli.login}</code></li>
        <li>{t('set.stepRecheck')}</li>
      </ol>
    </div>
  );
}
