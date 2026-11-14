import { useMemo, useRef, useState } from 'react';
import { useStore } from './store';
import PcbCanvas from './components/PcbCanvas';
import SchematicCanvas from './components/SchematicCanvas';
import ChatPanel from './components/ChatPanel';
import SidePanel, { type Tab } from './components/SidePanel';
import SettingsModal from './components/SettingsModal';
import Tooltip from './components/Tooltip';
import { runDrc, unroutedCount } from './lib/drc';
import type { Project } from './types';
import { saveFile } from './lib/platform';
import { useLang, useT, type TKey } from './i18n';

export default function App() {
  const project = useStore((s) => s.project);
  const view = useStore((s) => s.view);
  const stage = useStore((s) => s.stage);
  const show = useStore((s) => s.showLayer);
  const toast = useStore((s) => s.toast);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const st = useStore.getState();
  const { lang, setLang } = useLang();
  const t = useT();
  const [tab, setTab] = useState<Tab>('part');
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 휴대폰 화면에서는 한 번에 한 영역만 보여준다
  const [pane, setPane] = useState<'chat' | 'stage' | 'side'>('chat');
  const fileRef = useRef<HTMLInputElement>(null);

  const status = useMemo(() => {
    const issues = runDrc(project);
    const placeOk = project.parts.length > 0 && !issues.some((i) => i.code === 'overlap' || i.code === 'offboard');
    const routeOk = placeOk && project.tracks.length > 0 && unroutedCount(project) === 0;
    const checkOk = routeOk && !issues.some((i) => i.level === 'error');
    return { circuit: project.parts.length > 0, place: placeOk, route: routeOk, check: checkOk };
  }, [project]);

  const runRoute = () => {
    if (!project.nets.length) { st.notify(t('toast.noNets')); return; }
    const r = st.runAutoRoute();
    st.notify(r.failed.length ? t('toast.routeFail', { n: r.failed.length }) : t('toast.routeOk'));
  };

  const steps: { key: 'circuit' | 'place' | 'route' | 'check' | 'order'; done: boolean; action: () => void }[] = [
    { key: 'circuit', done: status.circuit, action: () => { st.setStage('sch'); setPane('stage'); } },
    { key: 'place', done: status.place, action: () => { st.setStage('pcb'); setTab('part'); setPane('stage'); } },
    { key: 'route', done: status.route, action: () => { st.setStage('pcb'); setPane('stage'); runRoute(); } },
    { key: 'check', done: status.check, action: () => { setTab('check'); setPane('side'); } },
    { key: 'order', done: false, action: () => { setTab('order'); setPane('side'); } },
  ];
  const current = steps.findIndex((s) => !s.done);

  const saveProject = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    saveFile(blob, `${project.name || 'ezboard'}.ezboard.json`).catch((e) => st.notify(t('toast.saveFail', { msg: e.message })));
  };
  const openFile = async (f: File) => {
    try {
      const p = JSON.parse(await f.text()) as Project;
      if (!Array.isArray(p.parts)) throw new Error();
      st.loadProject(p);
      st.notify(t('toast.opened', { name: p.name }));
    } catch {
      st.notify(t('toast.notProject'));
    }
  };

  const layer = (k: 'top' | 'bottom' | 'silk' | 'ratsnest', cls: string, label: TKey, tip: TKey) => (
    <label className={`layer ${cls} ${show[k] ? 'on' : ''}`} data-tip={t(tip)}>
      <input type="checkbox" checked={show[k]} onChange={() => st.toggleLayer(k)} />{t(label)}
    </label>
  );

  return (
    <div className="app">
      <header className="top">
        <div className="brand"><img src="./logo-mark.svg" alt="" />ez<span>Board</span></div>
        <input className="project-name" value={project.name} onChange={(e) => st.setName(e.target.value)} data-tip={t('tip.name')} />
        <div className="steps">
          {steps.map((s, i) => (
            <button key={s.key} className={`step ${s.done ? 'done' : ''} ${i === current ? 'current' : ''}`} onClick={s.action} data-tip={t(`tip.step.${s.key}` as TKey)}>
              <span className="num">{s.done ? '✓' : i + 1}</span>{t(`step.${s.key}` as TKey)}
            </button>
          ))}
        </div>
        <div className="top-actions">
          <button className="ghost" onClick={() => { if (!project.parts.length || confirm(t('top.confirmNew'))) st.newProject(); }} data-tip={t('tip.new')}>{t('top.new')}</button>
          <button className="ghost" onClick={() => fileRef.current?.click()} data-tip={t('tip.open')}>{t('top.open')}</button>
          <button className="ghost" onClick={saveProject} data-tip={t('tip.save')}>{t('top.save')}</button>
          <button className="ghost" onClick={st.undo} disabled={!past} data-tip={t('tip.undo')}>↶</button>
          <button className="ghost" onClick={st.redo} disabled={!future} data-tip={t('tip.redo')}>↷</button>
          <button className="ghost lang-btn" onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')} data-tip={t('tip.lang')}>{lang === 'ko' ? 'EN' : '한'}</button>
          <button className="ghost" onClick={() => setSettingsOpen(true)} data-tip={t('tip.settings')}>⚙️</button>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }} />
        </div>
      </header>

      <main className={`main pane-${pane}`}>
        <ChatPanel onOpenSettings={() => setSettingsOpen(true)} onCircuit={() => setPane('stage')} />
        <section className="stage">
          <div className="toolbar">
            <div className="seg stage-switch">
              <button className={stage === 'sch' ? 'active' : ''} onClick={() => st.setStage('sch')} data-tip={t('tip.sch')}>{t('tb.sch')}</button>
              <button className={stage === 'pcb' ? 'active' : ''} onClick={() => st.setStage('pcb')} data-tip={t('tip.pcb')}>{t('tb.pcb')}</button>
            </div>
            <div className="sep" />
            {stage === 'sch' ? (
              <>
                <button onClick={() => { st.relayoutSchematic(); st.notify(t('toast.tidy')); }} disabled={!project.parts.length} data-tip={t('tip.tidy')}>{t('tb.tidy')}</button>
                <span className="toolbar-hint">{t('tb.schHint')}</span>
              </>
            ) : (
              <>
                <button onClick={() => { st.runAutoPlace(); st.notify(t('toast.placed')); }} disabled={!project.parts.length} data-tip={t('tip.autoPlace')}>{t('tb.autoPlace')}</button>
                <button className="primary" onClick={runRoute} disabled={!project.nets.length} data-tip={t('tip.autoRoute')}>{t('tb.autoRoute')}</button>
                <button onClick={st.clearRoutes} disabled={!project.tracks.length} data-tip={t('tip.clearRoutes')}>{t('tb.clearRoutes')}</button>
                <div className="sep" />
                <div className="seg">
                  <button className={view === 'edit' ? 'active' : ''} onClick={() => st.setView('edit')} data-tip={t('tip.editView')}>{t('tb.editView')}</button>
                  <button className={view === 'real' ? 'active' : ''} onClick={() => st.setView('real')} data-tip={t('tip.realView')}>{t('tb.realView')}</button>
                </div>
                <div className="sep" />
                {layer('top', 'top', 'tb.top', 'tip.top')}
                {layer('bottom', 'bottom', 'tb.bottom', 'tip.bottom')}
                {layer('silk', 'silk', 'tb.silk', 'tip.silk')}
                {layer('ratsnest', 'rats', 'tb.rats', 'tip.rats')}
              </>
            )}
          </div>
          <div className={`canvas-wrap ${stage === 'sch' ? 'paper' : ''}`}>
            {stage === 'sch' ? <SchematicCanvas /> : <PcbCanvas />}
            {!project.parts.length && (
              <div className="canvas-empty">
                <div className="big">🛠️</div>
                <div>{t('canvas.empty1')}</div>
                <div className="muted">{t('canvas.empty2')}</div>
              </div>
            )}
            {stage === 'sch' ? (
              <div className="legend">
                <span><i style={{ background: '#14804a' }} />{t('legend.wire')}</span>
                <span><i style={{ background: '#b91c1c' }} />{t('legend.power')}</span>
                <span><i style={{ background: '#2b2f36' }} />{t('legend.gnd')}</span>
                <span>{t('legend.dot')}</span>
              </div>
            ) : (
              <div className="legend">
                <span><i style={{ background: '#d9483b' }} />{t('legend.topTrack')}</span>
                <span><i style={{ background: '#3b7dd9' }} />{t('legend.bottomTrack')}</span>
                <span><i style={{ background: '#facc15' }} />{t('legend.unrouted')}</span>
              </div>
            )}
          </div>
        </section>
        <SidePanel tab={tab} setTab={setTab} />
        <nav className="mobile-nav">
          <button className={pane === 'chat' ? 'active' : ''} onClick={() => setPane('chat')}><span>💬</span>{t('nav.chat')}</button>
          <button className={pane === 'stage' ? 'active' : ''} onClick={() => setPane('stage')}><span>{stage === 'sch' ? '📐' : '🟩'}</span>{stage === 'sch' ? t('nav.sch') : t('nav.pcb')}</button>
          <button className={pane === 'side' ? 'active' : ''} onClick={() => setPane('side')}><span>📋</span>{t('nav.side')}</button>
        </nav>
      </main>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {toast && <div className="toast">{toast}</div>}
      <Tooltip />
    </div>
  );
}
