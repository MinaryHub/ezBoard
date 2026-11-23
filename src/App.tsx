import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sanitizeProject, useStore } from './store';
import PcbCanvas from './components/PcbCanvas';
import SchematicCanvas from './components/SchematicCanvas';
import ChatPanel from './components/ChatPanel';
import SidePanel, { type Tab } from './components/SidePanel';
import SettingsModal from './components/SettingsModal';
import Tooltip from './components/Tooltip';
import Icon, { type IconName } from './components/Icon';
import { AboutDialog, UpdateDialog } from './components/HelpDialogs';
import { autoCheck, type UpdateInfo } from './lib/update';
import { initAutoUpdate, useAutoUpdate } from './lib/autoupdate';
import { APP_VERSION, DISCUSSIONS_URL, SPONSORS_URL, newIssueUrl, openExternal } from './lib/meta';
import { runDrc } from './lib/drc';
import { saveFile } from './lib/platform';
import { useLang, useT, type TKey } from './i18n';

type StepKey = 'circuit' | 'place' | 'route' | 'check' | 'order';

function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return <div className="toast" role="status" aria-live="polite">{toast}</div>;
}

export default function App() {
  const project = useStore((s) => s.project);
  const view = useStore((s) => s.view);
  const stage = useStore((s) => s.stage);
  const show = useStore((s) => s.showLayer);
  const appearance = useStore((s) => s.appearance);
  const dirty = useStore((s) => s.dirty);
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
  const lastMsg = useStore((s) => s.lastToast);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dialog, setDialog] = useState<'update' | 'about' | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const auto = useAutoUpdate((s) => s.state);
  const helpRef = useRef<HTMLDivElement>(null);

  // 시작하고 잠시 뒤, 하루에 한 번 조용히 새 버전을 확인한다
  useEffect(() => {
    const id = setTimeout(() => { autoCheck().then((info) => info && setUpdateInfo(info)); void initAutoUpdate(); }, 3000);
    return () => clearTimeout(id);
  }, []);
  // 도움말 메뉴: 바깥을 누르거나 Esc로 닫기
  useEffect(() => {
    if (!helpOpen) return;
    const close = (e: Event) => { if (!helpRef.current?.contains(e.target as Node)) setHelpOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setHelpOpen(false); };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', esc); };
  }, [helpOpen]);
  const openDialog = (d: 'update' | 'about') => { setHelpOpen(false); setDialog(d); };

  useEffect(() => { document.documentElement.dataset.appearance = appearance; }, [appearance]);

  const issues = useMemo(() => runDrc(project), [project, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const status = useMemo(() => {
    const placeOk = project.parts.length > 0 && !issues.some((i) => i.code === 'overlap' || i.code === 'offboard');
    const routeOk = placeOk && project.tracks.length > 0 && !issues.some((i) => i.code === 'unrouted' || i.code === 'noTracks');
    const checkOk = routeOk && !issues.some((i) => i.level === 'error');
    return { circuit: project.parts.length > 0, place: placeOk, route: routeOk, check: checkOk };
  }, [project.parts.length, project.tracks.length, issues]);
  const errorCount = issues.filter((i) => i.level === 'error').length;

  const runRoute = () => {
    if (!project.nets.length) { st.notify(t('toast.noNets')); return; }
    const r = st.runAutoRoute();
    st.notify(r.failed.length ? t('toast.routeFail', { n: r.failed.length }) : t('toast.routeOk'));
  };

  const steps: { key: StepKey; done: boolean; action: () => void }[] = [
    { key: 'circuit', done: status.circuit, action: () => { st.setStage('sch'); setPane('stage'); } },
    { key: 'place', done: status.place, action: () => { st.setStage('pcb'); setTab('part'); setPane('stage'); } },
    { key: 'route', done: status.route, action: () => { st.setStage('pcb'); setPane('stage'); if (!project.tracks.length) runRoute(); } },
    { key: 'check', done: status.check, action: () => { setTab('check'); setPane('side'); } },
    { key: 'order', done: false, action: () => { setTab('order'); setPane('side'); } },
  ];
  const current = steps.findIndex((s) => !s.done);

  const saveProject = useCallback(() => {
    const p = useStore.getState().project;
    const base = (p.name || 'ezboard').replace(/[\\/:*?"<>|\s]+/g, '_') || 'ezboard';
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    saveFile(blob, `${base}.ezboard.json`)
      .then(() => useStore.getState().markSaved())
      .catch((e) => useStore.getState().notify(t('toast.saveFail', { msg: e.message })));
  }, [t]);

  // Ctrl/Cmd+S 저장 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveProject();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveProject]);

  const openFile = async (f: File) => {
    try {
      const clean = sanitizeProject(JSON.parse(await f.text()));
      if (!clean) throw new Error();
      st.loadProject(clean);
      st.notify(t('toast.opened', { name: clean.name }));
    } catch {
      st.notify(t('toast.notProject'));
    }
  };

  /** 리본 버튼: 아이콘 위, 글자 아래 */
  const R = ({ icon, label, tip, onClick, engaged, disabled, primary }: { icon: IconName; label: TKey; tip: TKey; onClick: () => void; engaged?: boolean; disabled?: boolean; primary?: boolean }) => (
    <button
      className={`rbtn ${engaged ? 'engaged' : ''} ${primary ? 'primary-hint' : ''}`}
      onClick={onClick}
      disabled={disabled}
      data-tip={t(tip)}
      aria-pressed={engaged !== undefined ? engaged : undefined}
    >
      <Icon name={icon} />{t(label)}
    </button>
  );
  const L = ({ k, color, label, tip }: { k: 'top' | 'bottom' | 'silk' | 'ratsnest'; color: string; label: TKey; tip: TKey }) => (
    <button className={`rbtn ${show[k] ? '' : 'off'}`} onClick={() => st.toggleLayer(k)} data-tip={t(tip)} aria-pressed={show[k]}>
      <span className="swatch" style={{ color }}><i style={{ background: show[k] ? color : 'transparent' }} /></span>{t(label)}
    </button>
  );

  const realView = view === 'real';
  return (
    <div className={`app pane-${pane}`}>
      {/* ── 메뉴 막대 ── */}
      <header className="menubar">
        <div className="brand">
          <img src="./logo-mark.svg" alt="" /><span className="name">ezBoard</span>
          <button className="ghost version" onClick={() => setDialog('about')} data-tip={t('tip.version', { v: APP_VERSION })} aria-label={t('help.about')}>v{APP_VERSION}</button>
        </div>
        <button className="ghost mi" onClick={() => { if (!project.parts.length || confirm(t('top.confirmNew'))) st.newProject(); }} data-tip={t('tip.new')} aria-label={t('top.new')}><Icon name="new" size={16} /><span className="lbl">{t('top.new')}</span></button>
        <button className="ghost mi" onClick={() => fileRef.current?.click()} data-tip={t('tip.open')} aria-label={t('top.open')}><Icon name="open" size={16} /><span className="lbl">{t('top.open')}</span></button>
        <button className="ghost mi" onClick={saveProject} data-tip={t('tip.save')} aria-label={t('top.save')}><Icon name="save" size={16} /><span className="lbl">{t('top.save')}</span></button>
        <div className="menu-wrap" ref={helpRef}>
          <button className={`ghost mi ${helpOpen ? 'open' : ''}`} onClick={() => setHelpOpen((o) => !o)} data-tip={helpOpen ? undefined : t('tip.help')} aria-label={t('help.menu')} aria-haspopup="menu" aria-expanded={helpOpen}>
            <Icon name="help" size={16} /><span className="lbl">{t('help.menu')}</span>
          </button>
          {helpOpen && (
            <div className="menu" role="menu">
              <button role="menuitem" onClick={() => openDialog('update')}><Icon name="download" size={15} />{t('help.update')}{updateInfo && <span className="menu-badge">{updateInfo.version}</span>}</button>
              <button role="menuitem" onClick={() => { setHelpOpen(false); void openExternal(newIssueUrl()); }}><Icon name="issue" size={15} />{t('help.issues')}</button>
              <button role="menuitem" onClick={() => { setHelpOpen(false); void openExternal(DISCUSSIONS_URL); }}><Icon name="chat" size={15} />{t('help.discussions')}</button>
              <button role="menuitem" onClick={() => { setHelpOpen(false); void openExternal(SPONSORS_URL); }}><Icon name="heart" size={15} />{t('help.sponsor')}</button>
              <div className="menu-sep" />
              <button role="menuitem" onClick={() => openDialog('about')}><Icon name="help" size={15} />{t('help.about')}<span className="menu-ver">v{APP_VERSION}</span></button>
            </div>
          )}
        </div>
        <button className="ghost" onClick={st.undo} disabled={!past} data-tip={t('tip.undo')} aria-label={t('tip.undo')}><Icon name="undo" size={15} /></button>
        <button className="ghost" onClick={st.redo} disabled={!future} data-tip={t('tip.redo')} aria-label={t('tip.redo')}><Icon name="redo" size={15} /></button>
        <div className="doc-tab" data-tip={t('tip.name')}>
          <input value={project.name} onChange={(e) => st.setName(e.target.value)} aria-label={t('tip.name')} />
          {dirty && <span className="dirty" />}
        </div>
        <div className="spacer" />
        <button className="ghost" onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')} data-tip={t('tip.lang')} aria-label={t('tip.lang')}><Icon name="globe" size={15} /><span className="lbl">{lang === 'ko' ? 'EN' : '한국어'}</span></button>
        <button className="ghost" onClick={() => setSettingsOpen(true)} data-tip={t('tip.settings')} aria-label={t('tip.settings')}><Icon name="settings" size={15} /></button>
        <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }} />
      </header>

      {/* ── 리본: 작업 단계 탭 + 도구 묶음 ── */}
      <div className="ribbon">
        <nav className="ribbon-tabs">
          {steps.map((s, i) => (
            <button
              key={s.key}
              className={`rtab ${s.done ? 'done' : ''} ${i === current ? 'current' : ''}`}
              onClick={s.action}
              data-tip={t(`tip.step.${s.key}` as TKey)}
              aria-current={i === current ? 'step' : undefined}
            >
              <span className="n">{s.done ? '✓' : i + 1}</span>{t(`step.${s.key}` as TKey)}
            </button>
          ))}
        </nav>
        <div className="ribbon-tools">
          <div className="rgroup">
            <div className="rgroup-items">
              {R({ icon: 'schematic', label: 'rb.sch', tip: 'tip.sch', engaged: stage === 'sch', onClick: () => st.setStage('sch') })}
              {R({ icon: 'pcb', label: 'rb.pcb', tip: 'tip.pcb', engaged: stage === 'pcb', onClick: () => st.setStage('pcb') })}
              {R({ icon: 'fit', label: 'rb.fit', tip: 'tip.fit', onClick: st.requestFit, disabled: !project.parts.length })}
            </div>
            <div className="rgroup-cap">{t('rib.view')}</div>
          </div>
          {stage === 'sch' ? (
            <>
              <div className="rgroup">
                <div className="rgroup-items">
                  {R({ icon: 'tidy', label: 'rb.tidy', tip: 'tip.tidy', disabled: !project.parts.length, onClick: () => { st.relayoutSchematic(); st.notify(t('toast.tidy')); } })}
                </div>
                <div className="rgroup-cap">{t('rib.tools')}</div>
              </div>
              <div className="rhint">{t('tb.schHint')}</div>
            </>
          ) : (
            <>
              <div className="rgroup">
                <div className="rgroup-items">
                  {R({ icon: 'place', label: 'rb.autoPlace', tip: 'tip.autoPlace', disabled: !project.parts.length, onClick: () => { st.runAutoPlace(); st.notify(t('toast.placed')); } })}
                  {R({ icon: 'route', label: 'rb.autoRoute', tip: 'tip.autoRoute', disabled: !project.nets.length, onClick: runRoute, primary: !status.route && project.nets.length > 0 })}
                  {R({ icon: 'clear', label: 'rb.clear', tip: 'tip.clearRoutes', disabled: !project.tracks.length, onClick: st.clearRoutes })}
                </div>
                <div className="rgroup-cap">{t('rib.tools')}</div>
              </div>
              <div className="rgroup">
                <div className="rgroup-items">
                  {R({ icon: 'edit', label: 'rb.edit', tip: 'tip.editView', engaged: !realView, onClick: () => st.setView('edit') })}
                  {R({ icon: 'real', label: 'rb.real', tip: 'tip.realView', engaged: realView, onClick: () => st.setView('real') })}
                </div>
                <div className="rgroup-cap">{t('rib.display')}</div>
              </div>
              <div className="rgroup">
                <div className="rgroup-items">
                  {L({ k: 'top', color: '#d9483b', label: 'tb.top', tip: 'tip.top' })}
                  {L({ k: 'bottom', color: '#3b7dd9', label: 'tb.bottom', tip: 'tip.bottom' })}
                  {L({ k: 'silk', color: '#c9ccd2', label: 'tb.silk', tip: 'tip.silk' })}
                  {L({ k: 'ratsnest', color: '#facc15', label: 'tb.rats', tip: 'tip.rats' })}
                </div>
                <div className="rgroup-cap">{t('rib.layers')}</div>
              </div>
            </>
          )}
        </div>
      </div>

      <main className={`main pane-${pane}`}>
        <ChatPanel onOpenSettings={() => setSettingsOpen(true)} onCircuit={() => setPane('stage')} />
        <section className="stage">
          <div className={`canvas-wrap ${stage === 'sch' ? 'paper' : ''}`}>
            {stage === 'sch' ? <SchematicCanvas /> : <PcbCanvas />}
            {project.parts.length > 0 && (
              <div className="vp-overlay">
                <div className="l1">{stage === 'sch' ? t('vp.sch') : realView ? t('vp.pcbReal') : t('vp.pcbEdit')}</div>
                <div className="l2">
                  {stage === 'sch'
                    ? t('vp.schInfo', { parts: project.parts.length, nets: project.nets.length })
                    : t('vp.pcbInfo', { w: project.board.width, h: project.board.height, vias: project.vias.length })}
                </div>
              </div>
            )}
            {!project.parts.length && (
              <div className="canvas-empty">
                <div className="big"><Icon name={stage === 'sch' ? 'schematic' : 'pcb'} size={40} /></div>
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
            ) : !realView ? (
              <div className="legend">
                <span><i style={{ background: '#d9483b' }} />{t('legend.topTrack')}</span>
                <span><i style={{ background: '#3b7dd9' }} />{t('legend.bottomTrack')}</span>
                <span><i style={{ background: '#facc15' }} />{t('legend.unrouted')}</span>
              </div>
            ) : (
              <div className="legend">
                <span><i style={{ background: '#2c8a50' }} />{t('legend.topTrack')}</span>
                <span><i style={{ background: '#d9b44a' }} />PAD</span>
                <span><i style={{ background: '#facc15' }} />{t('legend.unrouted')}</span>
              </div>
            )}
          </div>
        </section>
        <SidePanel tab={tab} setTab={setTab} issues={issues} errorCount={errorCount} />
        <nav className="mobile-nav">
          <button className={pane === 'chat' ? 'active' : ''} onClick={() => setPane('chat')}><Icon name="chat" size={20} />{t('nav.chat')}</button>
          <button className={pane === 'stage' ? 'active' : ''} onClick={() => setPane('stage')}><Icon name={stage === 'sch' ? 'schematic' : 'pcb'} size={20} />{stage === 'sch' ? t('nav.sch') : t('nav.pcb')}</button>
          <button className={pane === 'side' ? 'active' : ''} onClick={() => setPane('side')}><Icon name="part" size={20} />{t('nav.side')}</button>
        </nav>
      </main>

      {/* ── 상태 막대 ── */}
      <footer className="statusbar">
        <span className={`mode-chip ${stage}`}>{stage === 'sch' ? t('rb.sch') : t('rb.pcb')}</span>
        <span className="keys">
          <span><kbd>R</kbd>{t('sb.rotate')}</span>
          <span><kbd>Del</kbd>{t('sb.delete')}</span>
          <span><kbd>{t('sb.wheel')}</kbd>{t('sb.zoom')}</span>
          <span><kbd>{t('sb.drag')}</kbd>{t('sb.pan')}</span>
        </span>
        <span className="status-msg">{lastMsg || t('sb.ready')}</span>
        {auto.status === 'ready' ? (
          <button className="update-badge ready" onClick={() => setDialog('update')} data-tip={t('tip.updateReady')}>
            <Icon name="rotate" size={12} />{t('upd.badgeReady')}
          </button>
        ) : auto.status === 'downloading' ? (
          <button className="update-badge" onClick={() => setDialog('update')} data-tip={t('upd.autoGetting')}>
            <Icon name="download" size={12} />{t('upd.badgeGetting', { p: auto.total ? Math.floor(((auto.received ?? 0) / auto.total) * 100) : 0 })}
          </button>
        ) : updateInfo && (
          <button className="update-badge" onClick={() => setDialog('update')} data-tip={t('tip.updateBadge')}>
            <Icon name="download" size={12} />{t('upd.badge', { v: updateInfo.version })}
          </button>
        )}
        {project.parts.length > 0 && (
          <span className="status-sum">
            <span>{t('sb.parts', { n: project.parts.length })}</span>
            <span className="num">{project.board.width}×{project.board.height} mm</span>
            {errorCount ? <span className="bad">{t('sb.errors', { n: errorCount })}</span> : <span className="ok">{t('sb.ok')}</span>}
          </span>
        )}
      </footer>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {dialog === 'update' && <UpdateDialog initial={updateInfo} onClose={() => setDialog(null)} />}
      {dialog === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
      <Toast />
      <Tooltip />
    </div>
  );
}
