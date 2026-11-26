import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { askAi, isConnected, PROVIDERS, usesAccount } from '../lib/ai';
import { getExamples } from '../lib/examples';
import { useLang, useT, type TKey } from '../i18n';
import { renderMarkdown } from '../lib/markdown';
import { circuitIssuesFromDraft, fixRequest } from '../lib/build';
import type { ChatMessage, Provider } from '../types';
import Icon from './Icon';

const SUGGESTIONS: TKey[] = ['chat.s1', 'chat.s2', 'chat.s3', 'chat.s4'];
/** AI 초안에서 문제가 나오면 고쳐 달라고 다시 묻는 최대 횟수 */
const MAX_FIX_ROUNDS = 2;
const isPhone = () => window.matchMedia('(max-width: 760px)').matches;

const MessageItem = memo(function MessageItem({ m, onRetry, retryLabel }: { m: ChatMessage; onRetry?: () => void; retryLabel?: string }) {
  const html = useMemo(() => (m.role === 'assistant' ? renderMarkdown(m.content) : ''), [m.role, m.content]);
  return (
    <div className={`msg ${m.role} ${m.error ? 'error' : ''}`}>
      {m.role === 'assistant' ? <div className="md" dangerouslySetInnerHTML={{ __html: html }} /> : <div>{m.content}</div>}
      {m.error && onRetry && (
        <button type="button" className="ghost small msg-retry" onClick={onRetry}>
          <Icon name="retry" size={12} />{retryLabel}
        </button>
      )}
    </div>
  );
});

export default function ChatPanel({ onOpenSettings, onCircuit }: { onOpenSettings: () => void; onCircuit?: () => void }) {
  const messages = useStore((s) => s.messages);
  const settings = useStore((s) => s.settings);
  const hasParts = useStore((s) => s.project.parts.length > 0);
  const pendingPrompt = useStore((s) => s.pendingPrompt);
  const { pushMessage, applyCircuit, setSettings, clearChat, requestAiPrompt, notify } = useStore.getState();
  const lang = useLang((s) => s.lang);
  const t = useT();
  const examples = useMemo(() => getExamples(lang), [lang]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [exOpen, setExOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const exRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => () => {
    abortRef.current?.abort();
    clearTimeout(navTimerRef.current);
  }, []);

  useEffect(() => {
    if (!exOpen) return;
    const close = (e: Event) => { if (!exRef.current?.contains(e.target as Node)) setExOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setExOpen(false); };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', esc); };
  }, [exOpen]);

  // 입력창 자동 높이 조절
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(130, Math.max(46, el.scrollHeight))}px`;
  }, [input]);

  const hasKey = isConnected(settings);

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const send = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const curSettings = useStore.getState().settings;
    if (!isConnected(curSettings)) { onOpenSettings(); notify(t('toast.needKey')); return; }
    setInput('');
    const startGen = useStore.getState().sessionGen;
    pushMessage({ role: 'user', content });
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const base = useStore.getState().project;
      let convo = [...useStore.getState().messages];
      let res = await askAi(curSettings, base, convo, ctrl.signal);
      if (ctrl.signal.aborted || useStore.getState().sessionGen !== startGen) return;
      const display0 = res.display;
      // 자동 점검: 배치·배선 없이 넷리스트 규칙만 고속 검사하고, 고칠 수 있는 문제는 AI에게 돌려보낸다
      const issuesOf = (r: typeof res) => (r.circuit ? circuitIssuesFromDraft(base, r.circuit, r.problems) : r.problems);
      const firstIssues = issuesOf(res);
      let issues = firstIssues;
      for (let round = 1; round <= MAX_FIX_ROUNDS && issues.length; round++) {
        setPhase(t('chat.fixing', { round, n: issues.length }));
        convo = [...convo, { role: 'assistant', content: res.raw }, { role: 'user', content: fixRequest(issues) }];
        const next = await askAi(curSettings, base, convo, ctrl.signal);
        if (ctrl.signal.aborted || useStore.getState().sessionGen !== startGen) return;
        if (!next.circuit) break;
        const nextIssues = issuesOf(next);
        if (nextIssues.length > issues.length) break;
        res = next;
        issues = nextIssues;
      }
      if (ctrl.signal.aborted || useStore.getState().sessionGen !== startGen) return;
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
      if (res.circuit && isPhone()) {
        clearTimeout(navTimerRef.current);
        navTimerRef.current = setTimeout(() => onCircuit?.(), 1200);
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError' || ctrl.signal.aborted || useStore.getState().sessionGen !== startGen) return;
      const msg = (e as Error).message;
      const hint = /fetch/i.test(msg) ? t('chat.netHint') : '';
      pushMessage({ role: 'assistant', content: t('chat.error', { msg }) + hint, error: true });
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(false);
      setPhase(null);
    }
  }, [busy, onOpenSettings, onCircuit, pushMessage, applyCircuit, notify, t]);

  // 검사 탭 등에서 AI 수정 요청이 들어오면 즉시 전송
  useEffect(() => {
    if (!pendingPrompt || busy) return;
    const prompt = pendingPrompt;
    const id = setTimeout(() => {
      requestAiPrompt(null);
      void send(prompt);
    }, 0);
    return () => clearTimeout(id);
  }, [pendingPrompt, busy, requestAiPrompt, send]);

  const loadExample = (i: number) => {
    setExOpen(false);
    if (busy) stop();
    const ex = examples[i];
    pushMessage({ role: 'user', content: ex.prompt });
    applyCircuit(ex.circuit);
    const parts = ex.circuit.parts.map((p) => `- **${p.ref}** ${p.value}${p.note ? ` — ${p.note}` : ''}`).join('\n');
    pushMessage({ role: 'assistant', circuitApplied: true, content: t('chat.exampleLoaded', { title: ex.title, desc: ex.desc, parts }) });
    if (isPhone()) {
      clearTimeout(navTimerRef.current);
      navTimerRef.current = setTimeout(() => onCircuit?.(), 600);
    }
  };

  const retryAt = (idx: number) => {
    for (let j = idx - 1; j >= 0; j--) {
      if (messages[j].role === 'user') { void send(messages[j].content); return; }
    }
  };

  return (
    <aside className="chat">
      <div className="area-head">
        <div className="area-title"><Icon name="chat" size={14} />{t('area.chat')}</div>
        <div className="spacer" />
        <div className="menu-wrap" ref={exRef}>
          <button
            type="button"
            className={`ghost small ${exOpen ? 'open' : ''}`}
            onClick={() => setExOpen((o) => !o)}
            data-tip={exOpen ? undefined : t('tip.examples')}
            aria-label={t('chat.examples')}
            aria-haspopup="menu"
            aria-expanded={exOpen}
          >
            <Icon name="examples" size={13} /><span>{t('chat.examples')}</span>
          </button>
          {exOpen && (
            <div className="menu ex-menu" role="menu">
              {examples.map((ex, i) => (
                <button key={ex.title} role="menuitem" onClick={() => loadExample(i)}>
                  <div className="ex-item">
                    <b>{ex.title}</b>
                    <span>{ex.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <select
          value={settings.provider}
          onChange={(e) => setSettings({ ...settings, provider: e.target.value as Provider })}
          data-tip={t('tip.provider')}
          aria-label={t('tip.provider')}
        >
          {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
            <option key={p} value={p}>{PROVIDERS[p].short}{usesAccount(settings, p) ? t('chat.account') : isConnected(settings, p) ? '' : t('chat.noKey')}</option>
          ))}
        </select>
        {messages.length > 0 && (
          <button className="ghost small" disabled={busy} onClick={clearChat} data-tip={t('tip.clearChat')} aria-label={t('tip.clearChat')}>
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="welcome">
            <h3>{t('chat.welcome')}</h3>
            <p>{t('chat.welcomeText')}</p>
            {!hasKey && <button className="primary block" onClick={onOpenSettings} data-tip={t('tip.settings')}><Icon name="key" size={15} />{t('chat.connect')}</button>}
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
          <MessageItem
            key={i}
            m={m}
            onRetry={m.error && !busy ? () => retryAt(i) : undefined}
            retryLabel={t('chat.retry')}
          />
        ))}
        {busy && (
          <div className="msg assistant thinking">
            <span className="dots"><i /><i /><i /></span>
            <span>{phase ?? t('chat.thinking')}</span>
            <button type="button" className="ghost small chat-stop" onClick={stop} aria-label={t('set.cancel')}>
              <Icon name="close" size={13} />{t('set.cancel')}
            </button>
          </div>
        )}
      </div>

      {messages.length > 0 && hasParts && !busy && (
        <div className="chips quick">
          <button className="chip" onClick={() => send(t('chat.reviewPrompt'))} data-tip={t('tip.review')}>{t('chat.review')}</button>
          <button className="chip" onClick={() => send(t('chat.solderPrompt'))} data-tip={t('tip.solder')}>{t('chat.solder')}</button>
          <button className="chip" onClick={() => send(t('chat.howPrompt'))} data-tip={t('tip.how')}>{t('chat.how')}</button>
        </div>
      )}

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <textarea
          ref={taRef}
          value={input}
          placeholder={hasParts ? t('chat.placeholderEdit') : t('chat.placeholderNew')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }}
          rows={2}
        />
        <button className={input.trim() ? 'has-text' : ''} type="submit" disabled={busy || !input.trim()} data-tip={t('tip.send')} aria-label={t('chat.send')}><Icon name="send" size={15} /></button>
      </form>
    </aside>
  );
}
