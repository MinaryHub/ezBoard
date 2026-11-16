import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { getDef, LIBRARY_LIST, nextRef, placedPads } from '../lib/library';
import { catName, partDefaultValue, partDesc, partName, partPinHelp } from '../lib/library.i18n';
import { runDrc } from '../lib/drc';
import { buildBom, buildGerberOnlyZip, buildZip } from '../lib/gerber';
import { saveFile } from '../lib/platform';
import { t as tt, useLang, useT, type TKey } from '../i18n';
import Icon, { type IconName } from './Icon';

export type Tab = 'part' | 'add' | 'nets' | 'check' | 'order';
const TABS: Tab[] = ['part', 'add', 'nets', 'check', 'order'];

async function download(blob: Blob, name: string) {
  try { await saveFile(blob, name); } catch (e) { useStore.getState().notify(tt('toast.saveFail', { msg: (e as Error).message })); }
}

const fileBase = (name: string) => name.replace(/[\\/:*?"<>|\s]+/g, '_') || 'ezboard';
const Html = ({ html, className }: { html: string; className?: string }) => <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;

const TAB_ICON: Record<Tab, IconName> = { part: 'part', add: 'add', nets: 'nets', check: 'shield', order: 'order' };

export default function SidePanel({ tab, setTab, errorCount = 0 }: { tab: Tab; setTab: (t: Tab) => void; errorCount?: number }) {
  const board = useStore((s) => s.project.board);
  const lang = useLang((s) => s.lang);
  const t = useT();
  return (
    <aside className="side">
      {/* 세로 아이콘 탭 (Kreate 속성 패널처럼) */}
      <nav className="vtabs">
        {TABS.map((id) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} data-tip={`${t(`tab.${id}` as TKey)} — ${t(`tip.tab.${id}` as TKey)}`} aria-label={t(`tab.${id}` as TKey)}>
            <Icon name={TAB_ICON[id]} />
            {id === 'check' && errorCount > 0 && <span className="badge" />}
          </button>
        ))}
      </nav>
      <div className="side-main">
      <div className="area-head"><div className="area-title"><Icon name={TAB_ICON[tab]} size={14} />{t(`tab.${tab}` as TKey)}</div></div>
      <div className="side-body" key={lang}>
        {tab === 'part' && <PartTab />}
        {tab === 'add' && <AddTab onAdded={() => setTab('part')} />}
        {tab === 'nets' && <NetsTab />}
        {tab === 'check' && <CheckTab />}
        {tab === 'order' && <OrderTab key={`${board.width}x${board.height}`} />}
      </div>
      </div>
    </aside>
  );
}

function PartTab() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const { select, updatePart, rotatePart, deletePart } = useStore.getState();
  const t = useT();
  const part = project.parts.find((p) => p.ref === selected);

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
  return (
    <div className="inspector">
      <div className="insp-head">
        <div>
          <div className="ref">{part.ref}</div>
          <div className="muted">{def ? partName(def) : part.type} · {def?.footprint.name}</div>
        </div>
        <button className="ghost small" onClick={() => select(null)}>✕</button>
      </div>
      <p className="desc">{def ? partDesc(def) : ''}</p>
      {part.note && <p className="note">📝 {part.note}</p>}
      <label className="field">{t('part.value')}
        <input value={part.value} onChange={(e) => updatePart(part.ref, { value: e.target.value })} />
      </label>
      <div className="row">
        <button onClick={() => rotatePart(part.ref)} data-tip={t('tip.rotate')}><Icon name="rotate" size={14} />{t('part.rotate', { deg: part.rot })}</button>
        <button className="danger" onClick={() => deletePart(part.ref)} data-tip={t('tip.delete')}>{t('part.delete')}</button>
      </div>
      {pinHelp && <div className="tip">{t('part.pins', { help: pinHelp })}</div>}
      <div className="section-label">{t('part.pinConn')}</div>
      <table className="pins">
        <tbody>
          {pinNames.map((pin) => {
            const net = project.nets.find((n) => n.pins.some((x) => {
              const [r, pn] = [x.slice(0, x.lastIndexOf('.')), x.slice(x.lastIndexOf('.') + 1)];
              if (r.toLowerCase() !== part.ref.toLowerCase()) return false;
              return pn.toLowerCase() === pin.toLowerCase() || pins.find((p) => p.num === Number(pn))?.pin === pin;
            }));
            return <tr key={pin}><td>{pin}</td><td>{net ? <span className="net-tag">{net.name}</span> : <span className="muted">{t('part.notConnected')}</span>}</td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

function AddTab({ onAdded }: { onAdded: () => void }) {
  const project = useStore((s) => s.project);
  const addPart = useStore((s) => s.addPart);
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
  }, [q]);
  return (
    <>
      <input className="search" placeholder={t('add.search')} value={q} onChange={(e) => setQ(e.target.value)} />
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
                  addPart({ ref: nextRef(project.parts, d.prefix), type: d.type, value: partDefaultValue(d), x: 0, y: 0, rot: 0 });
                  onAdded();
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
  const commit = useStore((s) => s.commit);
  const t = useT();
  const [newPins, setNewPins] = useState('');
  const [newName, setNewName] = useState('');
  const setNets = (nets: typeof project.nets) => commit({ ...project, nets, tracks: [], vias: [] });

  return (
    <>
      <Html className="tip" html={t('nets.tip')} />
      {project.nets.length === 0 && <div className="empty">{t('nets.empty')}</div>}
      {project.nets.map((n, i) => (
        <div key={n.name + i} className="net">
          <div className="net-head">
            <span className="net-tag">{n.name}</span>
            <button className="ghost small" data-tip={t('nets.delete')} onClick={() => setNets(project.nets.filter((_, j) => j !== i))}>✕</button>
          </div>
          <div className="pin-chips">
            {n.pins.map((p, k) => (
              <span key={p + k} className="pin-chip">
                {p}
                <button onClick={() => setNets(project.nets.map((x, j) => (j === i ? { ...x, pins: x.pins.filter((_, kk) => kk !== k) } : x)))}>×</button>
              </span>
            ))}
            <input
              className="pin-add"
              placeholder={t('nets.addPin')}
              onKeyDown={(e) => {
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
      <div className="new-net">
        <input placeholder={t('nets.name')} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input placeholder={t('nets.pins')} value={newPins} onChange={(e) => setNewPins(e.target.value)} />
        <button
          className="primary"
          disabled={!newPins.trim()}
          onClick={() => {
            const pins = newPins.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
            let name = newName.trim() || `NET${project.nets.length + 1}`;
            while (project.nets.some((n) => n.name === name)) name += '_';
            setNets([...project.nets, { name, pins }]);
            setNewPins(''); setNewName('');
          }}
        >{t('nets.add')}</button>
      </div>
    </>
  );
}

function CheckTab() {
  const project = useStore((s) => s.project);
  const select = useStore((s) => s.select);
  const lang = useLang((s) => s.lang);
  const t = useT();
  const issues = useMemo(() => runDrc(project), [project, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project.parts.length) return <div className="empty">{t('check.empty')}</div>;
  return (
    <>
      <div className="section-label">{t('check.title')}</div>
      {issues.map((it, i) => (
        <button key={i} className={`issue ${it.level}`} onClick={() => it.refs?.[0] && select(it.refs[0])}>
          <span>{it.message}</span>
        </button>
      ))}
      {issues.some((i) => i.level === 'error') && <div className="tip">{t('check.fixTip')}</div>}
    </>
  );
}

function OrderTab() {
  const project = useStore((s) => s.project);
  const setBoard = useStore((s) => s.setBoard);
  const notify = useStore((s) => s.notify);
  const lang = useLang((s) => s.lang);
  const t = useT();
  const issues = useMemo(() => runDrc(project), [project, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const errors = issues.filter((i) => i.level === 'error');
  const [w, setW] = useState(project.board.width);
  const [h, setH] = useState(project.board.height);
  const bomRows = useMemo(
    () => buildBom(project).replace('﻿', '').trim().split('\n').slice(1).map((r) => r.split('","').map((c) => c.replace(/"/g, ''))),
    [project, lang], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <>
      <div className="section-label">{t('order.boardSize')}</div>
      <div className="row">
        <input type="number" min={10} max={200} value={w} onChange={(e) => setW(Number(e.target.value))} />
        <span>×</span>
        <input type="number" min={10} max={200} value={h} onChange={(e) => setH(Number(e.target.value))} />
        <button onClick={() => setBoard(w, h)} disabled={w === project.board.width && h === project.board.height} data-tip={t('tip.boardApply')}>{t('order.apply')}</button>
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

      <div className="section-label">{t('order.how')}</div>
      <ol className="steps-guide">
        <li dangerouslySetInnerHTML={{ __html: t('order.h1') }} />
        <li>{t('order.h2')}</li>
        <li>{t('order.h3')}</li>
        <li>{t('order.h4')}</li>
      </ol>

      {bomRows.length > 0 && (
        <>
          <div className="section-label">{t('order.needed')}</div>
          <table className="bom">
            <thead><tr><th>{t('bom.part')}</th><th>{t('bom.value')}</th><th>{t('bom.qty')}</th><th>{t('bom.refs')}</th></tr></thead>
            <tbody>{bomRows.map((r) => <tr key={r[0]}><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </>
  );
}
