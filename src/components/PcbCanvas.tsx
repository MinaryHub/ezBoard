import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { partName } from '../lib/library.i18n';
import { usePinchZoom } from './usePinchZoom';
import { useRefitOnShow } from './useRefitOnShow';
import { getDef, partBox, placedPads, rotatePoint, resolvePin, type PlacedPad } from '../lib/library';
import { netConnections, snap } from '../lib/geometry';
import { textStrokes } from '../lib/font';
import { refLabelPos } from '../lib/gerber';
import { VIA_D, VIA_DRILL } from '../lib/router';
import PinMenu from './PinMenu';
import { MountingHoles, PourLayer } from './PourLayer';

type Drag =
  | { kind: 'part'; ref: string; dx: number; dy: number; moved: boolean }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'wire'; from: PlacedPad; x: number; y: number; sx: number; sy: number };

/** 패드를 놓을 때 인정하는 거리 (mm, 패드 크기에 더함) */
const PAD_SNAP = 0.8;
/** 이만큼(화면 px) 안 움직이고 떼면 탭으로 본다 */
const TAP_PX = 8;

export default function PcbCanvas() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const view = useStore((s) => s.view);
  const show = useStore((s) => s.showLayer);
  const lastRoute = useStore((s) => s.lastRoute);
  const { select, movePart, rotatePart, deletePart, undo, redo, connectSchPins, disconnectSchPin } = useStore.getState();

  const svgRef = useRef<SVGSVGElement>(null);
  const tr = useT();
  const [vb, setVb] = useState({ x: -10, y: -10, w: 80, h: 60 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverNet, setHoverNet] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; pad: PlacedPad } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const { board } = project;
  const real = view === 'real';

  // 보드 크기가 바뀌면 화면에 맞추기
  const fit = () => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    const bw = board.width + pad * 2, bh = board.height + pad * 2;
    const aspect = r.width / Math.max(1, r.height);
    const w = Math.max(bw, bh * aspect), h = w / aspect;
    setVb({ x: board.width / 2 - w / 2, y: board.height / 2 - h / 2, w, h });
  };
  const fitTick = useStore((s) => s.fitTick);
  useEffect(fit, [board.width, board.height, fitTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useRefitOnShow(svgRef, fit);

  // 키보드 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (!selected) return;
      if (e.key === 'r' || e.key === 'R') rotatePart(selected);
      if (e.key === 'Delete' || e.key === 'Backspace') deletePart(selected);
      if (e.key === 'Escape') select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, rotatePart, deletePart, select, undo, redo]);

  const toSvg = (e: { clientX: number; clientY: number }) => {
    const el = svgRef.current!;
    const pt = el.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(el.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  const pinch = usePinchZoom(toSvg, setVb, () => setDrag(null));

  const onWheel = (e: React.WheelEvent) => {
    setMenu(null);
    const p = toSvg(e);
    const k = Math.exp(e.deltaY * 0.0015);
    setVb((v) => {
      const w = Math.min(500, Math.max(8, v.w * k));
      const f = w / v.w;
      return { x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f, w, h: v.h * f };
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    if (drag.kind === 'wire') {
      const p = toSvg(e);
      setDrag({ ...drag, x: p.x, y: p.y });
      return;
    }
    if (drag.kind === 'pan') {
      const el = svgRef.current!.getBoundingClientRect();
      const scale = vb.w / el.width;
      setVb((v) => ({ ...v, x: drag.vx - (e.clientX - drag.sx) * scale, y: drag.vy - (e.clientY - drag.sy) * scale }));
    } else {
      const p = toSvg(e);
      const part = project.parts.find((x) => x.ref === drag.ref);
      if (!part) return;
      const nx = snap(p.x - drag.dx), ny = snap(p.y - drag.dy);
      if (nx !== part.x || ny !== part.y) {
        movePart(drag.ref, nx, ny, !drag.moved);
        if (!drag.moved) setDrag({ ...drag, moved: true });
      }
    }
  };

  const pads = useMemo(() => project.parts.flatMap(placedPads), [project.parts]);

  /** 이 위치에 있는 패드 (끌기 중 놓을 곳). 다른 부품의 패드가 겹치면 가까운 쪽 */
  const padAt = (x: number, y: number, except?: PlacedPad): PlacedPad | null => {
    let best: PlacedPad | null = null;
    let bd = Infinity;
    for (const p of pads) {
      if (except && p.ref === except.ref && p.num === except.num) continue;
      const reach = Math.max(p.aw, p.ah) / 2 + PAD_SNAP;
      const d = Math.hypot(p.ax - x, p.ay - y);
      if (d <= reach && d < bd) { bd = d; best = p; }
    }
    return best;
  };
  const wireTarget = drag?.kind === 'wire' ? padAt(drag.x, drag.y, drag.from) : null;

  const onPointerUp = (e: React.PointerEvent) => {
    if (drag?.kind === 'wire') {
      const t = padAt(drag.x, drag.y, drag.from);
      if (t) connectSchPins({ ref: drag.from.ref, name: drag.from.pin }, { ref: t.ref, name: t.pin });
      // 끌지 않고 눌렀다 떼면(탭) 패드 메뉴 — 터치 화면에서 연결 끊기
      else if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < TAP_PX) setMenu({ x: e.clientX, y: e.clientY, pad: drag.from });
    }
    setDrag(null);
  };
  const pinNet = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of project.nets) for (const pin of n.pins) for (const pad of resolvePin(project.parts, pin)) m.set(`${pad.ref}.${pad.num}`, n.name);
    return m;
  }, [project.nets, project.parts]);

  // 래츠네스트: 배선이 없는 넷 + 자동배선 실패 연결
  const ratsnest = useMemo(() => {
    const routedNets = new Set(project.tracks.map((t) => t.net));
    const failed = new Set((lastRoute?.failed ?? []).map((f) => f.net));
    const lines: { net: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const net of project.nets) {
      if (routedNets.has(net.name) && !failed.has(net.name)) continue;
      for (const [a, b] of netConnections(project.parts, net)) lines.push({ net: net.name, x1: a.ax, y1: a.ay, x2: b.ax, y2: b.ay });
    }
    return lines;
  }, [project, lastRoute]);

  const colors = real
    ? { board: '#1d6b3c', edge: '#e8d9a8', top: '#2c8a50', bottom: '#226a40', pad: '#d9b44a', silk: '#f5f5f0', hole: '#111' }
    : { board: '#0d2b22', edge: '#e5c07b', top: '#d9483b', bottom: '#3b7dd9', pad: '#c8a24a', silk: '#e8e8e8', hole: '#0a0a0a' };

  const minor = 1.27;
  const gridStep = vb.w > 150 ? minor * 4 : minor * 2;

  return (
    <>
    <svg
      ref={svgRef}
      className="pcb-canvas"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      onWheel={onWheel}
      {...pinch}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.button !== 1) return;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: vb.x, vy: vb.y });
        setMenu(null);
        select(null);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={fit}
    >
      <defs>
        <pattern id="grid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
          <circle cx={0} cy={0} r={0.08} fill="#ffffff22" />
        </pattern>
        <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0.4" dy="0.6" stdDeviation="0.6" floodOpacity="0.5" />
        </filter>
      </defs>

      {/* 보드 */}
      <rect x={0} y={0} width={board.width} height={board.height} rx={real ? 1 : 0} fill={colors.board} stroke={colors.edge} strokeWidth={0.2} filter={real ? 'url(#shadow)' : undefined} />
      {!real && <rect x={0} y={0} width={board.width} height={board.height} fill="url(#grid)" pointerEvents="none" />}

      {/* GND 구리 채우기 */}
      {(['bottom', 'top'] as const).map((layer) => show[layer] && (
        <PourLayer key={`pour-${layer}`} project={project} side={layer} color={real ? '#2f9a5a' : colors[layer]} opacity={real ? (layer === 'top' ? 0.6 : 0) : layer === 'top' ? 0.26 : 0.22} />
      ))}

      {/* 배선 */}
      {(['bottom', 'top'] as const).map((layer) =>
        show[layer] && project.tracks.filter((t) => t.layer === layer).map((t, i) => (
          <polyline
            key={`${layer}${i}`}
            points={t.points.map((p) => p.join(',')).join(' ')}
            fill="none"
            stroke={colors[layer]}
            strokeOpacity={real ? 1 : hoverNet && hoverNet !== t.net ? 0.25 : layer === 'bottom' ? 0.75 : 0.9}
            strokeWidth={t.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="stroke"
            onPointerEnter={() => setHoverNet(t.net)}
            onPointerLeave={() => setHoverNet(null)}
          >
            <title>{tr('canvas.trackTitle', { net: t.net, layer: tr(layer === 'top' ? 'tb.top' : 'tb.bottom') })}</title>
          </polyline>
        )),
      )}
      {project.vias.map((v, i) => (
        <g key={`via${i}`}>
          <circle cx={v.x} cy={v.y} r={VIA_D / 2} fill={real ? colors.top : '#bbb'} />
          <circle cx={v.x} cy={v.y} r={VIA_DRILL / 2} fill={colors.hole} />
        </g>
      ))}

      <MountingHoles project={project} hole={colors.hole} real={real} label={tr('canvas.hole')} />

      {/* 부품 */}
      {project.parts.map((part) => {
        const def = getDef(part.type);
        const box = partBox(part);
        const isSel = part.ref === selected;
        return (
          <g
            key={part.ref}
            className="part"
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.button !== 0) return;
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
              const p = toSvg(e);
              select(part.ref);
              setDrag({ kind: 'part', ref: part.ref, dx: p.x - part.x, dy: p.y - part.y, moved: false });
            }}
            onDoubleClick={(e) => { e.stopPropagation(); rotatePart(part.ref); }}
          >
            <rect x={box.x1} y={box.y1} width={box.x2 - box.x1} height={box.y2 - box.y1}
              fill={isSel ? 'rgba(255,158,41,0.10)' : 'transparent'} stroke={isSel ? '#ff9e29' : 'none'} strokeWidth={0.2} strokeDasharray={isSel ? '0.6 0.4' : undefined} />
            {show.silk && def?.footprint.silk.map((s, i) => {
              if (s.kind === 'line') {
                const [x1, y1] = rotatePoint(s.x1, s.y1, part.rot);
                const [x2, y2] = rotatePoint(s.x2, s.y2, part.rot);
                return <line key={i} x1={part.x + x1} y1={part.y + y1} x2={part.x + x2} y2={part.y + y2} stroke={colors.silk} strokeWidth={0.15} strokeLinecap="round" />;
              }
              const [cx, cy] = rotatePoint(s.x, s.y, part.rot);
              return <circle key={i} cx={part.x + cx} cy={part.y + cy} r={s.r} fill="none" stroke={colors.silk} strokeWidth={0.15} />;
            })}
            {show.silk && (() => {
              const lp = refLabelPos(project, part.ref);
              return textStrokes(part.ref, lp.x, lp.y, lp.h).map((st, i) => (
                <polyline key={`t${i}`} points={st.map((p) => p.join(',')).join(' ')} fill="none" stroke={colors.silk} strokeWidth={0.15} strokeLinecap="round" strokeLinejoin="round" />
              ));
            })()}
            {!real && (
              <text x={part.x} y={part.y} className="part-value" textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(1.1, (box.x2 - box.x1) / 6)}>
                {part.value}
              </text>
            )}
            <title>{tr('canvas.partTitle', { ref: part.ref, name: def ? partName(def) : part.type, value: part.value })}</title>
          </g>
        );
      })}

      {/* 패드 (부품 위에 그려서 잘 보이게) */}
      {pads.map((p) => {
        const net = pinNet.get(`${p.ref}.${p.num}`);
        const dim = !real && hoverNet && net !== hoverNet;
        const on = (wireTarget && wireTarget.ref === p.ref && wireTarget.num === p.num) || (drag?.kind === 'wire' && drag.from.ref === p.ref && drag.from.num === p.num);
        const fill = dim ? '#6b5a2c' : on || (hoverNet && net === hoverNet) ? '#ffe28a' : colors.pad;
        return (
          <g
            key={`${p.ref}.${p.num}`}
            className="pcb-pad"
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.button !== 0) return;
              if (e.altKey) { disconnectSchPin({ ref: p.ref, name: p.pin }); return; }
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
              setMenu(null);
              setDrag({ kind: 'wire', from: p, x: p.ax, y: p.ay, sx: e.clientX, sy: e.clientY });
            }}
            onPointerEnter={() => net && setHoverNet(net)}
            onPointerLeave={() => setHoverNet(null)}
          >
            <title>{tr('canvas.pinTitle', { pin: `${p.ref}.${p.pin}`, net: net ? ` · ${net}` : '' })}</title>
            {p.shape === 'circle' ? (
              <circle cx={p.ax} cy={p.ay} r={p.aw / 2} fill={fill} />
            ) : (
              <rect x={p.ax - p.aw / 2} y={p.ay - p.ah / 2} width={p.aw} height={p.ah} rx={p.shape === 'oval' ? Math.min(p.aw, p.ah) / 2 : 0.1} fill={fill} />
            )}
            {p.drill > 0 && <circle cx={p.ax} cy={p.ay} r={p.drill / 2} fill={colors.hole} />}
            {!real && vb.w < 70 && (
              <text x={p.ax} y={p.ay} className="pad-label" textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(0.55, 2.2 / Math.max(1, p.pin.length))}>{p.pin}</text>
            )}
          </g>
        );
      })}

      {/* 끌고 있는 새 연결 */}
      {drag?.kind === 'wire' && (
        <g pointerEvents="none">
          <line x1={drag.from.ax} y1={drag.from.ay} x2={wireTarget?.ax ?? drag.x} y2={wireTarget?.ay ?? drag.y}
            stroke={wireTarget ? '#ffe28a' : '#ff9e29'} strokeWidth={0.3} strokeDasharray={wireTarget ? undefined : '0.8 0.5'} strokeLinecap="round" />
          {wireTarget && <circle cx={wireTarget.ax} cy={wireTarget.ay} r={Math.max(wireTarget.aw, wireTarget.ah) / 2 + 0.35} fill="none" stroke="#ffe28a" strokeWidth={0.25} />}
        </g>
      )}

      {/* 래츠네스트 */}
      {show.ratsnest && ratsnest.map((l, i) => (
        <line key={`rn${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#facc15" strokeWidth={0.15} strokeDasharray="0.5 0.4" opacity={0.9} pointerEvents="none" />
      ))}

      {/* 치수 표시 */}
      <text x={board.width / 2} y={-1.6} className="dim-label" textAnchor="middle" fontSize={1.6}>{board.width} mm</text>
      <text x={-1.6} y={board.height / 2} className="dim-label" textAnchor="middle" fontSize={1.6} transform={`rotate(-90 ${-1.6} ${board.height / 2})`}>{board.height} mm</text>
      {hoverNet && <text x={board.width} y={board.height + 3} className="dim-label" textAnchor="end" fontSize={1.6}>{tr('canvas.net', { net: hoverNet })}</text>}
    </svg>
    {menu && (
      <PinMenu
        x={menu.x} y={menu.y} pin={`${menu.pad.ref}.${menu.pad.pin}`} net={pinNet.get(`${menu.pad.ref}.${menu.pad.num}`)}
        onDisconnect={() => disconnectSchPin({ ref: menu.pad.ref, name: menu.pad.pin })}
        onClose={closeMenu}
      />
    )}
    </>
  );
}
