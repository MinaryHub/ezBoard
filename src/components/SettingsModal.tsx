import { useState } from 'react';
import { useStore } from '../store';
import { listModels, PROVIDERS } from '../lib/ai';
import { useLang, useT } from '../i18n';
import type { Provider } from '../types';
import Icon from './Icon';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const { lang, setLang } = useLang();
  const appearance = useStore((s) => s.appearance);
  const setAppearance = useStore((s) => s.setAppearance);
  const t = useT();
  const [draft, setDraft] = useState(settings);
  const [models, setModels] = useState<Partial<Record<Provider, string[]>>>({});
  const [status, setStatus] = useState<Partial<Record<Provider, string>>>({});

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
        {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
          <div key={p} className={`provider-card ${draft.provider === p ? 'active' : ''}`}>
            <label className="provider-head">
              <input type="radio" checked={draft.provider === p} onChange={() => setDraft({ ...draft, provider: p })} />
              <b>{PROVIDERS[p].label}</b>
              <a href={PROVIDERS[p].keyUrl} target="_blank" rel="noreferrer">{t('set.getKey')}</a>
            </label>
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
