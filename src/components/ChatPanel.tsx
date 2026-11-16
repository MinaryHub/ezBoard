import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { askAi, isConnected, PROVIDERS, usesAccount } from '../lib/ai';
import { getExamples } from '../lib/examples';
import { useLang, useT, type TKey } from '../i18n';
import { renderMarkdown } from '../lib/markdown';
import { buildFromCircuit, circuitIssues, fixRequest } from '../lib/build';
import type { Provider } from '../types';
import Icon from './Icon';

const SUGGESTIONS: TKey[] = ['chat.s1', 'chat.s2', 'chat.s3', 'chat.s4'];
/** AI 초안에서 문제가 나오면 고쳐 달라고 다시 묻는 최대 횟수 */
const MAX_FIX_ROUNDS = 2;
const isPhone = () => window.matchMedia('(max-width: 760px)').matches;

export default function ChatPanel({ onOpenSettings, onCircuit }: { onOpenSettings: () => void; onCircuit?: () => void }) {
  const messages = useStore((s) => s.messages);
  const settings = useStore((s) => s.settings);
  const project = useStore((s) => s.project);
  const { pushMessage, applyCircuit, setSettings, clearChat, notify } = useStore.getState();
  const lang = useLang((s) => s.lang);
  const t = useT();
  const examples = getExamples(lang);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const hasKey = isConnected(settings);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    if (!hasKey) { onOpenSettings(); notify(t('toast.needKey')); return; }
    setInput('');
    pushMessage({ role: 'user', content });
    setBusy(true);
    try {
      const base = useStore.getState().project;
      let convo = [...useStore.getState().messages];
      let res = await askAi(settings, base, convo);
      const display0 = res.display;
      // 자동 점검: 적용하기 전에 회로를 만들어 검사하고, 고칠 수 있는 문제는 AI에게 돌려보낸다
      const issuesOf = (r: typeof res) => (r.circuit ? circuitIssues(buildFromCircuit(base, r.circuit).project, r.problems) : r.problems);
      const firstIssues = issuesOf(res);
      let issues = firstIssues;
      for (let round = 1; round <= MAX_FIX_ROUNDS && issues.length; round++) {
        setPhase(t('chat.fixing', { round, n: issues.length }));
        convo = [...convo, { role: 'assistant', content: res.raw }, { role: 'user', content: fixRequest(issues) }];
        const next = await askAi(settings, base, convo);
        if (!next.circuit) break;
        const nextIssues = issuesOf(next);
        if (nextIssues.length > issues.length) break;
        res = next;
        issues = nextIssues;
      }
      const fixed = firstIssues.filter((i) => !issues.includes(i)).length;
      let display = display0 || res.display || t('chat.made');
      if (fixed) display += '\n\n' + t('chat.autoFixed', { n: fixed });
      if (res.problems.length) display += '\n\n' + res.problems.map((p) => `- ⚠️ ${p}`).join('\n');
      if (res.circuit) {
        applyCircuit(res.circuit);
        const r = useStore.getState().lastRoute;
        display += '\n\n' + t('chat.applied', { n: res.circuit.parts.length }) + (r ? (r.failed.length ? t('chat.routePartial', { n: r.failed.length }) : t('chat.routeOk')) : '');
      }
      pushMessage({ role: 'assistant', content: display, circuitApplied: !!res.circuit });
      if (res.circuit && isPhone()) setTimeout(() => onCircuit?.(), 1200);
    } catch (e) {
      const msg = (e as Error).message;
      const hint = /fetch/i.test(msg) ? t('chat.netHint') : '';
      pushMessage({ role: 'assistant', content: t('chat.error', { msg }) + hint, error: true });
    } finally {
      setBusy(false);
      setPhase(null);
    }
  };

  const loadExample = (i: number) => {
    const ex = examples[i];
    pushMessage({ role: 'user', content: ex.prompt });
    applyCircuit(ex.circuit);
    const parts = ex.circuit.parts.map((p) => `- **${p.ref}** ${p.value}${p.note ? ` — ${p.note}` : ''}`).join('\n');
    pushMessage({ role: 'assistant', circuitApplied: true, content: t('chat.exampleLoaded', { title: ex.title, desc: ex.desc, parts }) });
    if (isPhone()) setTimeout(() => onCircuit?.(), 600);
  };

  return (
    <aside className="chat">
      <div className="area-head">
        <div className="area-title"><Icon name="chat" size={14} />{t('area.chat')}</div>
        <div className="spacer" />
        <select value={settings.provider} onChange={(e) => setSettings({ ...settings, provider: e.target.value as Provider })} data-tip={t('tip.provider')}>
          {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
            <option key={p} value={p}>{PROVIDERS[p].short}{usesAccount(settings, p) ? t('chat.account') : isConnected(settings, p) ? '' : t('chat.noKey')}</option>
          ))}
        </select>
        {messages.length > 0 && <button className="ghost small" onClick={clearChat} data-tip={t('tip.clearChat')} aria-label="clear"><Icon name="trash" size={14} /></button>}
      </div>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="welcome">
            <h3>{t('chat.welcome')}</h3>
            <p>{t('chat.welcomeText')}</p>
            {!hasKey && <button className="primary block" onClick={onOpenSettings} data-tip={t('tip.settings')}><Icon name="key" size={15} />{t('chat.connect').replace('🔑 ', '')}</button>}
            <div className="section-label">{t('chat.tryExamples')}</div>
            {examples.map((ex, i) => (
              <button key={ex.title} className="example" onClick={() => loadExample(i)} data-tip={t('tip.example')}>
                <b>{ex.title}</b>
                <span>{ex.desc}</span>
              </button>
            ))}
            <div className="section-label">{t('chat.askLike')}</div>
            <div className="chips">
              {SUGGESTIONS.map((k) => <button key={k} className="chip" onClick={() => setInput(t(k))} data-tip={t('tip.suggest')}>{t(k)}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role} ${m.error ? 'error' : ''}`}>
            {m.role === 'assistant'
              ? <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
              : <div>{m.content}</div>}
          </div>
        ))}
        {busy && <div className="msg assistant thinking"><span className="dots"><i /><i /><i /></span> {phase ?? t('chat.thinking')}</div>}
      </div>

      {messages.length > 0 && project.parts.length > 0 && !busy && (
        <div className="chips quick">
          <button className="chip" onClick={() => send(t('chat.reviewPrompt'))} data-tip={t('tip.review')}>{t('chat.review')}</button>
          <button className="chip" onClick={() => send(t('chat.solderPrompt'))} data-tip={t('tip.solder')}>{t('chat.solder')}</button>
          <button className="chip" onClick={() => send(t('chat.howPrompt'))} data-tip={t('tip.how')}>{t('chat.how')}</button>
        </div>
      )}

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <textarea
          value={input}
          placeholder={project.parts.length ? t('chat.placeholderEdit') : t('chat.placeholderNew')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); } }}
          rows={2}
        />
        <button className={input.trim() ? 'has-text' : ''} type="submit" disabled={busy || !input.trim()} data-tip={t('tip.send')} aria-label={t('chat.send')}><Icon name="send" size={15} /></button>
      </form>
    </aside>
  );
}
