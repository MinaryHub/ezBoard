import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { getDef, LIBRARY_LIST, nextRef, placedPads, resolvePin } from '../lib/library';
import { catName, partDefaultValue, partDesc, partName, partPinHelp } from '../lib/library.i18n';
import type { DrcIssue } from '../lib/drc';
import { bomItems, buildBom, buildGerberOnlyZip, buildZip } from '../lib/gerber';
import { saveFile } from '../lib/platform';
import { t as tt, useLang, useT, type TKey } from '../i18n';
import Icon, { type IconName } from './Icon';

export type Tab = 'part' | 'add' | 'nets' | 'check' | 'order';
const TABS: Tab[] = ['part', 'add', 'nets', 'check', 'order'];
const CIRCUIT_FIX_CODES = new Set(['badPin', 'short', 'singlePin', 'unused', 'ledNoR', 'unknownType']);
const LAYOUT_FIX_CODES = new Set(['overlap', 'offboard', 'holePart', 'unrouted', 'clearance', 'noTracks']);
const BOARD_PRESETS: [number, number][] = [[50, 40], [70, 50], [100, 100]];

async function download(blob: Blob, name: string) {
  try { await saveFile(blob, name); } catch (e) { useStore.getState().notify(tt('toast.saveFail', { msg: (e as Error).message })); }
}

const fileBase = (name: string) => name.replace(/[\\/:*?"<>|\s]+/g, '_') || 'ezboard';
const Html = ({ html, className }: { html: string; className?: string }) => <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;

const TAB_ICON: Record<Tab, IconName> = { part: 'part', add: 'add', nets: 'nets', check: 'shield', order: 'order' };

export default function SidePanel({
  tab,
  setTab,
  issues,
  errorCount = 0,
  onAskAiFix,
  onAutoFixLayout,
  onExportImage,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  issues: DrcIssue[];
  errorCount?: number;
  onAskAiFix?: (msgs: string[]) => void;
  onAutoFixLayout?: () => void;
  onExportImage?: (fmt: 'png' | 'svg') => void;
}) {
  const board = useStore((s) => s.project.board);
  const t = useT();
  return (
    <aside className="side">
      {/* 세로 아이콘 탭 (Kreate 속성 패널처럼) */}
      <nav className="vtabs">
        {TABS.map((id) => (
          <button
            key={id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
            data-tip={`${t(`tab.${id}` as TKey)} — ${t(`tip.tab.${id}` as TKey)}`}
            aria-label={t(`tab.${id}` as TKey)}
            aria-pressed={tab === id}
          >
            <Icon name={TAB_ICON[id]} />
            {id === 'check' && errorCount > 0 && <span className="badge" />}
          </button>
        ))}
      </nav>
      <div className="side-main">
        <div className="area-head"><div className="area-title"><Icon name={TAB_ICON[tab]} size={14} />{t(`tab.${tab}` as TKey)}</div></div>
        <div className="side-body">
          {tab === 'part' && <PartTab />}
          {tab === 'add' && <AddTab />}
          {tab === 'nets' && <NetsTab />}
          {tab === 'check' && <CheckTab issues={issues} onAskAiFix={onAskAiFix} onAutoFixLayout={onAutoFixLayout} />}
          {tab === 'order' && <OrderTab key={`${board.width}x${board.height}`} issues={issues} onExportImage={onExportImage} />}
        </div>
      </div>
    </aside>
  );
}

function PartTab() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const stage = useStore((s) => s.stage);
  const { select, updatePart, rotatePart, rotateSchPart, duplicatePart, deletePart } = useStore.getState();
  const t = useT();
  const part = project.parts.find((p) => p.ref === selected);
  const [valEdit, setValEdit] = useState<{ ref: string; orig: string; draft: string } | null>(null);
  const valDraft = part && valEdit && valEdit.ref === part.ref && valEdit.orig === part.value ? valEdit.draft : (part?.value ?? '');

  if (!part) {
    if (!project.parts.length) return <Html className="empty" html={t('part.empty')} />;
    return (
      <>
        <div className="section-label">{t('part.list', { n: project.parts.length })}</div>
        <div className="part-list">
          {project.parts.map((p) => {
            const def = getDef(p.type);
            return (
              <button key={p.ref} onClick={() => select(p.ref)} data-tip={def ? partDesc(def) : undefined}>
                <b>{p.ref}</b><span>{def ? partName(def) : p.type}</span><em>{p.value}</em>
              </button>
            );
          })}
        </div>
        <Html className="tip" html={t('part.tip')} />
      </>
    );
  }
  const def = getDef(part.type);
  const pins = placedPads(part);
  const pinNames = [...new Set(pins.map((p) => p.pin))];
  const pinHelp = def ? partPinHelp(def) : undefined;
  const rotDeg = stage === 'sch' ? (project.sch?.[part.ref]?.rot ?? 0) : part.rot;
  const commitValue = () => {
    if (valDraft !== part.value) updatePart(part.ref, { value: valDraft }, true);
    setValEdit(null);
  };
  return (
    <div className="inspector">
      <div className="insp-head">
        <div>
          <div className="ref">{part.ref}</div>
          <div className="muted">{def ? partName(def) : part.type} · {def?.footprint.name}</div>
        </div>
        <button className="ghost small" onClick={() => select(null)} aria-label={t('common.close')}><Icon name="close" size={14} /></button>
      </div>
      <p className="desc">{def ? partDesc(def) : ''}</p>
      {part.note && <p className="note">📝 {part.note}</p>}
      <label className="field">{t('part.value')}
        <input
          value={valDraft}
          onChange={(e) => setValEdit({ ref: part.ref, orig: part.value, draft: e.target.value })}
          onBlur={commitValue}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }}
        />
      </label>
      <div className="row wrap-row">
        <button
          onClick={() => (stage === 'sch' ? rotateSchPart(part.ref) : rotatePart(part.ref))}
          data-tip={t('tip.rotate')}
        >
          <Icon name="rotate" size={14} />{t('part.rotate', { deg: rotDeg })}
        </button>
        <button onClick={() => duplicatePart(part.ref)} data-tip={t('tip.duplicate')}>
          <Icon name="copy" size={14} />{t('part.duplicate')}
        </button>
        <button className="danger" onClick={() => deletePart(part.ref)} data-tip={t('tip.delete')}>{t('part.delete')}</button>
      </div>
      {pinHelp && <div className="tip">{t('part.pins', { help: pinHelp })}</div>}
      <div className="section-label">{t('part.pinConn')}</div>
      <table className="pins">
        <tbody>
          {pinNames.map((pin) => {
            const matchedNets = project.nets.filter((n) => n.pins.some((x) => {
              const dot = x.lastIndexOf('.');
              if (dot < 0) return false;
              const r = x.slice(0, dot).trim(), pn = x.slice(dot + 1).trim();
              if (r.toLowerCase() !== part.ref.toLowerCase()) return false;
              return pn.toLowerCase() === pin.toLowerCase() || pins.find((p) => p.num === Number(pn))?.pin === pin;
            }));
            return (
              <tr key={pin}>
                <td>{pin}</td>
                <td>
                  {matchedNets.length
                    ? matchedNets.map((n) => <span key={n.name} className="net-tag">{n.name} </span>)
                    : <span className="muted">{t('part.notConnected')}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AddTab() {
  const { addPart, notify } = useStore.getState();
  const lang = useLang((s) => s.lang);
  const t = useT();
  const [q, setQ] = useState('');
  const cats = useMemo(() => {
    const m = new Map<string, typeof LIBRARY_LIST>();
    for (const d of LIBRARY_LIST) {
      const hay = `${d.name}${partName(d)}${d.type}${d.defaultValue}${d.desc}${partDesc(d)}`.toLowerCase();
      if (q && !hay.includes(q.toLowerCase())) continue;
      if (!m.has(d.category)) m.set(d.category, []);
      m.get(d.category)!.push(d);
    }
    return [...m.entries()];
  }, [q, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <input className="search" placeholder={t('add.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('add.search')} />
      <Html className="tip" html={t('add.tip')} />
      {cats.map(([cat, list]) => (
        <div key={cat}>
          <div className="section-label">{catName(cat)}</div>
          <div className="lib-grid">
            {list.map((d) => (
              <button
                key={d.type}
                className="lib-item"
                data-tip={partDesc(d)}
                onClick={() => {
                  const parts = useStore.getState().project.parts;
                  const ref = nextRef(parts, d.prefix);
                  addPart({ ref, type: d.type, value: partDefaultValue(d), x: 0, y: 0, rot: 0 });
                  notify(t('toast.added', { ref }));
                }}
              >
                <b>{partName(d)}</b>
                <span>{partDefaultValue(d)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function NetsTab() {
  const project = useStore((s) => s.project);
  const highlightNet = useStore((s) => s.highlightNet);
  const { commit, setHighlightNet } = useStore.getState();
  const t = useT();
  const [newPins, setNewPins] = useState('');
  const [newName, setNewName] = useState('');
  const setNets = (nets: typeof project.nets) => commit({ ...project, nets: nets.filter((n) => n.pins.length > 0), tracks: [], vias: [] });

  const allPins = useMemo(() => {
    const out: string[] = [];
    for (const part of project.parts) {
      const seen = new Set<string>();
      for (const pad of placedPads(part)) {
        if (seen.has(pad.pin)) continue;
        seen.add(pad.pin);
        out.push(`${part.ref}.${pad.pin}`);
      }
    }
    return out;
  }, [project.parts]);

  const addNet = (e: React.FormEvent) => {
    e.preventDefault();
    const pins = newPins.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!pins.length) return;
    let name = newName.trim() || `NET${project.nets.length + 1}`;
    while (project.nets.some((n) => n.name === name)) name += '_';
    setNets([...project.nets, { name, pins }]);
    setNewPins(''); setNewName('');
  };

  return (
    <>
      <datalist id="ezboard-pins">
        {allPins.map((p) => <option key={p} value={p} />)}
      </datalist>
      <Html className="tip" html={t('nets.tip')} />
      {project.nets.length === 0 && <div className="empty">{t('nets.empty')}</div>}
      {project.nets.map((n, i) => (
        <div
          key={n.name + i}
          className={`net ${highlightNet === n.name ? 'active' : ''}`}
          onPointerEnter={() => setHighlightNet(n.name)}
          onPointerLeave={() => setHighlightNet(null)}
        >
          <div className="net-head">
            <span className="net-tag">{n.name}</span>
            <button className="ghost small" data-tip={t('nets.delete')} aria-label={t('nets.delete')} onClick={() => setNets(project.nets.filter((_, j) => j !== i))}>
              <Icon name="close" size={13} />
            </button>
          </div>
          <div className="pin-chips">
            {n.pins.map((p, k) => {
              const bad = resolvePin(project.parts, p).length === 0;
              return (
                <span key={p + k} className={`pin-chip ${bad ? 'bad' : ''}`} title={bad ? p : undefined}>
                  {p}
                  <button
                    aria-label={`${p} ${t('part.delete')}`}
                    onClick={() => setNets(project.nets.map((x, j) => (j === i ? { ...x, pins: x.pins.filter((_, kk) => kk !== k) } : x)))}
                  >
                    <Icon name="close" size={11} />
                  </button>
                </span>
              );
            })}
            <input
              className="pin-add"
              list="ezboard-pins"
              placeholder={t('nets.addPin')}
              aria-label={t('nets.addPin')}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                const v = (e.target as HTMLInputElement).value.trim();
                if (e.key === 'Enter' && v) {
                  setNets(project.nets.map((x, j) => (j === i ? { ...x, pins: [...x.pins, v] } : x)));
                  (e.target as HTMLInputElement).value = '';
                }
              }}
            />
          </div>
        </div>
      ))}
      <div className="section-label">{t('nets.new')}</div>
      <form className="new-net" onSubmit={addNet}>
        <input placeholder={t('nets.name')} value={newName} onChange={(e) => setNewName(e.target.value)} aria-label={t('nets.name')} />
        <input list="ezboard-pins" placeholder={t('nets.pins')} value={newPins} onChange={(e) => setNewPins(e.target.value)} aria-label={t('nets.pins')} />
        <button type="submit" className="primary" disabled={!newPins.trim()}>{t('nets.add')}</button>
      </form>
    </>
  );
}

function CheckTab({
  issues,
  onAskAiFix,
  onAutoFixLayout,
}: {
  issues: DrcIssue[];
  onAskAiFix?: (msgs: string[]) => void;
  onAutoFixLayout?: () => void;
}) {
  const hasParts = useStore((s) => s.project.parts.length > 0);
  const select = useStore((s) => s.select);
  const t = useT();

  if (!hasParts) return <div className="empty">{t('check.empty')}</div>;
  const circuitErrs = issues.filter((i) => CIRCUIT_FIX_CODES.has(i.code));
  const layoutErrs = issues.filter((i) => LAYOUT_FIX_CODES.has(i.code));

  return (
    <>
      <div className="section-label">{t('check.title')}</div>
      {issues.map((it, i) => (
        it.refs?.[0] ? (
          <button key={i} className={`issue ${it.level}`} onClick={() => select(it.refs![0])}>
            <span>{it.message}</span>
          </button>
        ) : (
          <div key={i} className={`issue ${it.level} static`}>
            <span>{it.message}</span>
          </div>
        )
      ))}
      {circuitErrs.length > 0 && onAskAiFix && (
        <button className="primary block" onClick={() => onAskAiFix(circuitErrs.map((i) => i.message))}>
          <Icon name="sparkles" size={14} />{t('check.askAiFix')}
        </button>
      )}
      {layoutErrs.length > 0 && onAutoFixLayout && (
        <button className="block" onClick={onAutoFixLayout}>
          <Icon name="route" size={14} />{t('check.autoFixLayout')}
        </button>
      )}
      {issues.some((i) => i.level === 'error') && <div className="tip">{t('check.fixTip')}</div>}
    </>
  );
}

function OrderTab({ issues, onExportImage }: { issues: DrcIssue[]; onExportImage?: (fmt: 'png' | 'svg') => void }) {
  const project = useStore((s) => s.project);
  const setBoard = useStore((s) => s.setBoard);
  const notify = useStore((s) => s.notify);
  const lang = useLang((s) => s.lang);
  const t = useT();
  const errors = issues.filter((i) => i.level === 'error');
  const [w, setW] = useState(String(project.board.width));
  const [h, setH] = useState(String(project.board.height));
  const rows = useMemo(() => bomItems(project), [project, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const nw = Math.min(200, Math.max(10, Math.round(Number(w) || 0)));
  const nh = Math.min(200, Math.max(10, Math.round(Number(h) || 0)));
  const validSize = Number.isFinite(Number(w)) && Number.isFinite(Number(h)) && Number(w) >= 10 && Number(h) >= 10 && Number(w) <= 200 && Number(h) <= 200;
  const cheapOk = project.board.width <= 100 && project.board.height <= 100;
  const applySize = (e: React.FormEvent) => {
    e.preventDefault();
    setW(String(nw));
    setH(String(nh));
    if (nw !== project.board.width || nh !== project.board.height) setBoard(nw, nh);
  };

  return (
    <>
      <div className="section-label">{t('order.boardSize')}</div>
      <form className="row" onSubmit={applySize}>
        <input type="number" min={10} max={200} value={w} onChange={(e) => setW(e.target.value)} aria-label="board width mm" />
        <span>×</span>
        <input type="number" min={10} max={200} value={h} onChange={(e) => setH(e.target.value)} aria-label="board height mm" />
        <button type="submit" disabled={!validSize || (nw === project.board.width && nh === project.board.height)} data-tip={t('tip.boardApply')}>{t('order.apply')}</button>
      </form>
      <div className="presets">
        {BOARD_PRESETS.map(([pw, ph]) => (
          <button
            key={`${pw}x${ph}`}
            type="button"
            className={`small num ${project.board.width === pw && project.board.height === ph ? 'engaged' : ''}`}
            onClick={() => { setW(String(pw)); setH(String(ph)); setBoard(pw, ph); }}
          >
            {pw}×{ph}
          </button>
        ))}
        <span className={`tier-badge ${cheapOk ? 'ok' : 'over'}`}>{cheapOk ? t('order.cheapOk') : t('order.cheapOver')}</span>
      </div>
      <div className="tip">{t('order.sizeTip')}</div>

      <div className="section-label">{t('order.extras')}</div>
      <label className="check-row" data-tip={t('tip.pour')}>
        <input type="checkbox" checked={!!project.pour} onChange={(e) => useStore.getState().setPour(e.target.checked)} />{t('order.pour')}
      </label>
      <label className="check-row" data-tip={t('tip.holes')}>
        <input type="checkbox" checked={!!project.holes} onChange={(e) => useStore.getState().setHoles(e.target.checked)} />{t('order.holes')}
      </label>

      <div className="section-label">{t('order.make')}</div>
      {errors.length > 0 && <div className="issue error static">{t('order.hasErrors', { n: errors.length })}</div>}
      <button
        className="primary block"
        disabled={!project.parts.length}
        data-tip={t('tip.orderAll')}
        onClick={async () => { await download(await buildZip(project), `${fileBase(project.name)}_${t('order.fileAll')}.zip`); notify(t('toast.orderDone')); }}
      ><Icon name="order" size={15} />{t('order.all')}</button>
      <button className="block" disabled={!project.parts.length} data-tip={t('tip.orderGerber')} onClick={async () => download(await buildGerberOnlyZip(project), `${fileBase(project.name)}_gerber.zip`)}>
        {t('order.gerber')}
      </button>
      <button className="block" disabled={!project.parts.length} data-tip={t('tip.orderBom')} onClick={() => download(new Blob([buildBom(project)], { type: 'text/csv' }), `${fileBase(project.name)}_BOM.csv`)}>
        {t('order.bom')}
      </button>

      {onExportImage && (
        <>
          <div className="section-label">{t('order.exportImg')}</div>
          <div className="row">
            <button type="button" style={{ flex: 1 }} disabled={!project.parts.length} onClick={() => onExportImage('png')}>
              <Icon name="image" size={14} />{t('order.exportPng')}
            </button>
            <button type="button" style={{ flex: 1 }} disabled={!project.parts.length} onClick={() => onExportImage('svg')}>
              <Icon name="image" size={14} />{t('order.exportSvg')}
            </button>
          </div>
        </>
      )}

      <div className="section-label">{t('order.how')}</div>
      <ol className="steps-guide">
        <li dangerouslySetInnerHTML={{ __html: t('order.h1') }} />
        <li>{t('order.h2')}</li>
        <li>{t('order.h3')}</li>
        <li>{t('order.h4')}</li>
      </ol>

      {rows.length > 0 && (
        <>
          <div className="section-label">{t('order.needed')}</div>
          <div className="bom-wrap">
            <table className="bom">
              <thead><tr><th>{t('bom.part')}</th><th>{t('bom.value')}</th><th>{t('bom.qty')}</th><th>{t('bom.refs')}</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.no}><td>{r.name}</td><td>{r.value}</td><td>{r.qty}</td><td>{r.refs}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
