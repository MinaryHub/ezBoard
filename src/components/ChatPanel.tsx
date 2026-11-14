import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { askAi, PROVIDERS } from '../lib/ai';
import { getExamples } from '../lib/examples';
import { useLang, useT, type TKey } from '../i18n';
import type { Provider } from '../types';

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 아주 작은 마크다운 렌더러 (굵게, 코드, 제목, 목록) */
function renderMarkdown(src: string): string {
  const blocks = src.split(/```[a-z]*\n?/);
  return blocks
    .map((b, i) => {
      if (i % 2 === 1) return `<pre>${escapeHtml(b)}</pre>`;
      const lines = escapeHtml(b).split('\n');
      const out: string[] = [];
      let list: 'ul' | 'ol' | null = null;
      const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
      for (const raw of lines) {
        const line = raw
          .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
          .replace(/`([^`]+)`/g, '<code>$1</code>');
        const ul = line.match(/^\s*[-*•]\s+(.*)/);
        const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
        const h = line.match(/^#{1,4}\s+(.*)/);
        if (ul) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${ul[1]}</li>`); }
        else if (ol) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${ol[1]}</li>`); }
        else if (h) { close(); out.push(`<h4>${h[1]}</h4>`); }
        else if (line.trim() === '') { close(); out.push('<div class="gap"></div>'); }
        else { close(); out.push(`<p>${line}</p>`); }
      }
      close();
      return out.join('');
    })
    .join('');
}

const SUGGESTIONS: TKey[] = ['chat.s1', 'chat.s2', 'chat.s3', 'chat.s4'];
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
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const hasKey = !!settings.keys[settings.provider]?.trim();

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    if (!hasKey) { onOpenSettings(); notify(t('toast.needKey')); return; }
    setInput('');
    pushMessage({ role: 'user', content });
    setBusy(true);
    try {
      const all = [...useStore.getState().messages];
      const res = await askAi(settings, useStore.getState().project, all);
      let display = res.display || t('chat.made');
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
      <div className="chat-head">
        <div className="chat-title">{t('chat.title')}</div>
        <select value={settings.provider} onChange={(e) => setSettings({ ...settings, provider: e.target.value as Provider })} data-tip={t('tip.provider')}>
          {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
            <option key={p} value={p}>{PROVIDERS[p].short}{settings.keys[p] ? '' : t('chat.noKey')}</option>
          ))}
        </select>
        {messages.length > 0 && <button className="ghost small" onClick={clearChat} data-tip={t('tip.clearChat')}>🗑</button>}
      </div>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="welcome">
            <h3>{t('chat.welcome')}</h3>
            <p>{t('chat.welcomeText')}</p>
            {!hasKey && <button className="primary block" onClick={onOpenSettings} data-tip={t('tip.settings')}>{t('chat.connect')}</button>}
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
        {busy && <div className="msg assistant thinking"><span className="dots"><i /><i /><i /></span> {t('chat.thinking')}</div>}
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
        <button className="primary" type="submit" disabled={busy || !input.trim()} data-tip={t('tip.send')}>{t('chat.send')}</button>
      </form>
    </aside>
  );
}
