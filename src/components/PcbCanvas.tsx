import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { partName } from '../lib/library.i18n';
import { usePinchZoom } from './usePinchZoom';
import { useRefitOnShow } from './useRefitOnShow';
import { getDef, partBox, placedPads, rotatePoint, resolvePin, type PlacedPad } from '../lib/library';
import { netConnections, snap } from '../lib/geometry';
import { textStrokes } from '../lib/font';
import { partPinSilkLabels, refLabelPosForPart } from '../lib/gerber';
import { keepoutRects } from '../lib/features';
import { VIA_D, VIA_DRILL } from '../lib/router';
import { clearanceViolations, type DrcIssue } from '../lib/drc';
import PinMenu from './PinMenu';
import { MountingHoles, PourLayer } from './PourLayer';
import CanvasHud from './CanvasHud';

type Drag =
  | { kind: 'part'; ref: string; dx: number; dy: number; x: number; y: number }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'wire'; from: PlacedPad; x: number; y: number; sx: number; sy: number };

/** 패드를 놓을 때 인정하는 거리 (mm, 패드 크기에 더함) */
const PAD_SNAP = 0.8;
/** 이만큼(화면 px) 안 움직이고 떼면 탭으로 본다 */
const TAP_PX = 8;

export default function PcbCanvas({ issues = [] }: { issues?: DrcIssue[] }) {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const hoverNet = useStore((s) => s.highlightNet);
  const view = useStore((s) => s.view);
  const realSide = useStore((s) => s.realSide);
  const show = useStore((s) => s.showLayer);
  const lastRoute = useStore((s) => s.lastRoute);
  const { select, setHighlightNet, movePart, nudgePart, rotatePart, duplicatePart, deletePart, toggleRealSide, undo, redo, connectSchPins, disconnectSchPin } = useStore.getState();

  const svgRef = useRef<SVGSVGElement>(null);
  const tr = useT();
  const [vb, setVb] = useState({ x: -10, y: -10, w: 80, h: 60 });
  const [baseW, setBaseW] = useState(80);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; pad: PlacedPad } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const { board } = project;
  const real = view === 'real';
  const realBack = real && realSide === 'bottom';

  // 보드 크기가 바뀌면 화면에 맞추기 (숨겨진 0 크기 상태에서는 건너뜀)
  const fit = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const pad = 8;
    const bw = board.width + pad * 2, bh = board.height + pad * 2;
    const aspect = r.width / r.height;
    const w = Math.max(bw, bh * aspect), h = w / aspect;
    setBaseW(w);
    setVb({ x: board.width / 2 - w / 2, y: board.height / 2 - h / 2, w, h });
  }, [board.width, board.height]);
  const fitTick = useStore((s) => s.fitTick);
  useEffect(fit, [fit, fitTick]);
  useRefitOnShow(svgRef, fit);

  const zoomBy = useCallback((factor: number) => {
    setVb((v) => {
      const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
      const w = Math.min(500, Math.max(8, v.w * factor));
      const f = w / v.w;
      const h = v.h * f;
      return { x: cx - w / 2, y: cy - h / 2, w, h };
    });
  }, []);

  // 키보드 단축키 (모달이 열려 있거나 캔버스가 숨겨져 있으면 무시, Ctrl/Cmd+R 등 브라우저 단축키 보존)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.modal-bg')) return;
      const el = svgRef.current;
      if (!el || el.getBoundingClientRect().width < 10) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        if (selected) { e.preventDefault(); duplicatePart(selected); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') { setDrag(null); select(null); return; }
      if (e.key === 'f' || e.key === 'F' || e.key === '0') { fit(); return; }
      if (e.key === '=' || e.key === '+') { zoomBy(0.8); return; }
      if (e.key === '-') { zoomBy(1.25); return; }
      if (!selected) return;
      const step = e.shiftKey ? 4 : 1;
      if (e.key === 'ArrowLeft') { e.preventDefault(); nudgePart(selected, realBack ? step : -step, 0); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); nudgePart(selected, realBack ? -step : step, 0); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); nudgePart(selected, 0, -step); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); nudgePart(selected, 0, step); return; }
      if (e.key === 'r' || e.key === 'R') rotatePart(selected);
      if (e.key === 'Delete' || e.key === 'Backspace') deletePart(selected);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, realBack, rotatePart, duplicatePart, deletePart, nudgePart, select, undo, redo, fit, zoomBy]);

  const toSvg = (e: { clientX: number; clientY: number }) => {
    const el = svgRef.current;
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return { x: 0, y: 0 };
    const pt = el.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const toBoard = (e: { clientX: number; clientY: number }) => {
    const p = toSvg(e);
    return realBack ? { x: board.width - p.x, y: p.y } : p;
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

  // 드래그 중에는 로컬 좌표만 갱신해 전체 리렌더·DRC·저장 부하를 없애고, 놓을 때 한 번만 커밋
  const displayParts = useMemo(
    () => (drag?.kind === 'part' ? project.parts.map((p) => (p.ref === drag.ref ? { ...p, x: drag.x, y: drag.y } : p)) : project.parts),
    [project.parts, drag],
  );

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    if (drag.kind === 'wire') {
      const p = toBoard(e);
      setDrag({ ...drag, x: p.x, y: p.y });
      return;
    }
    if (drag.kind === 'pan') {
      const r = svgRef.current!.getBoundingClientRect();
      const scale = Math.max(vb.w / Math.max(1, r.width), vb.h / Math.max(1, r.height));
      setVb((v) => ({ ...v, x: drag.vx - (e.clientX - drag.sx) * scale, y: drag.vy - (e.clientY - drag.sy) * scale }));
    } else {
      const p = toBoard(e);
      const nx = snap(p.x - drag.dx), ny = snap(p.y - drag.dy);
      if (nx !== drag.x || ny !== drag.y) setDrag({ ...drag, x: nx, y: ny });
    }
  };

  const pads = useMemo(() => displayParts.flatMap(placedPads), [displayParts]);

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
    } else if (drag?.kind === 'part') {
      const orig = project.parts.find((p) => p.ref === drag.ref);
      if (orig && (orig.x !== drag.x || orig.y !== drag.y)) movePart(drag.ref, drag.x, drag.y, true);
    }
    setDrag(null);
  };
  const cancelDrag = () => setDrag(null);

  const pinNet = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of project.nets) for (const pin of n.pins) for (const pad of resolvePin(displayParts, pin)) m.set(`${pad.ref}.${pad.num}`, n.name);
    return m;
  }, [project.nets, displayParts]);

  // DRC 시각 강조: 겹침·보드 밖·구멍 충돌 부품 + 구리 간격 위반 좌표
  const errorRefs = useMemo(() => {
    const set = new Set<string>();
    for (const it of issues) {
      if (it.level === 'error' && it.refs) for (const r of it.refs) set.add(r);
    }
    return set;
  }, [issues]);
  const clearDots = useMemo(() => {
    if (real || !issues.some((i) => i.code === 'clearance')) return [];
    return clearanceViolations(project).slice(0, 30);
  }, [real, issues, project]);

  const keepouts = useMemo(
    () => keepoutRects({ ...project, parts: displayParts }),
    [project, displayParts],
  );

  // 부품 실크스크린·참조명·커넥터 핀 라벨·값 위치 사전 계산 (팬·줌·호버마다 O(N^2) 재계산 방지)
  const partRender = useMemo(() => displayParts.map((part) => {
    const def = getDef(part.type);
    const box = partBox(part);
    const lp = refLabelPosForPart(part, board);
    const refStrokes = textStrokes(part.ref, lp.x, lp.y, lp.h).map((st) => st.map((q) => q.join(',')).join(' '));
    const pinLabelStrokes = partPinSilkLabels(part, board).flatMap((pl) =>
      textStrokes(pl.text, pl.x, pl.y, pl.h).map((st) => st.map((q) => q.join(',')).join(' ')),
    );
    const silk = (def?.footprint.silk ?? []).map((s) => {
      if (s.kind === 'line') {
        const [x1, y1] = rotatePoint(s.x1, s.y1, part.rot);
        const [x2, y2] = rotatePoint(s.x2, s.y2, part.rot);
        return { kind: 'line' as const, x1: part.x + x1, y1: part.y + y1, x2: part.x + x2, y2: part.y + y2 };
      }
      const [cx, cy] = rotatePoint(s.x, s.y, part.rot);
      return { kind: 'circle' as const, cx: part.x + cx, cy: part.y + cy, r: s.r };
    });
    // 값(value)은 패드·드릴 구멍과 겹치지 않도록 부품 바깥쪽(참조명 반대편)에 배치
    const refAbove = lp.y < box.y1;
    const valY = refAbove ? box.y2 + 0.95 : box.y1 - 0.85;
    return { part, def, box, refStrokes, pinLabelStrokes, silk, valY };
  }), [displayParts, board]);

  // 래츠네스트: 배선이 없는 넷 + 자동배선 실패 연결
  const ratsnest = useMemo(() => {
    const routedNets = new Set(project.tracks.map((t) => t.net));
    const failed = new Set((lastRoute?.failed ?? []).map((f) => f.net));
    const lines: { net: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const net of project.nets) {
      if (routedNets.has(net.name) && !failed.has(net.name)) continue;
      for (const [a, b] of netConnections(displayParts, net)) lines.push({ net: net.name, x1: a.ax, y1: a.ay, x2: b.ax, y2: b.ay });
    }
    return lines;
  }, [project.nets, project.tracks, displayParts, lastRoute]);

  const colors = real
    ? { board: '#1d6b3c', edge: '#e8d9a8', top: '#2c8a50', bottom: '#2c8a50', pad: '#d9b44a', silk: '#f5f5f0', hole: '#111' }
    : { board: '#0d2b22', edge: '#e5c07b', top: '#d9483b', bottom: '#3b7dd9', pad: '#c8a24a', silk: '#e8e8e8', hole: '#0a0a0a' };

  const minor = 1.27;
  const gridStep = vb.w > 150 ? minor * 4 : minor * 2;
  const selectedPart = selected ? project.parts.find((p) => p.ref === selected) : undefined;
  const zoomPct = Math.round((baseW / Math.max(1, vb.w)) * 100);
  const trackLayers: ('top' | 'bottom')[] = real ? [realBack ? 'bottom' : 'top'] : ['bottom', 'top'];

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
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: vb.x, vy: vb.y });
        setMenu(null);
        select(null);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancelDrag}
      onLostPointerCapture={cancelDrag}
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

      <g transform={realBack ? `translate(${board.width} 0) scale(-1 1)` : undefined}>
      {/* 보드 */}
      <rect x={0} y={0} width={board.width} height={board.height} rx={real ? 1 : 0} fill={colors.board} stroke={colors.edge} strokeWidth={0.2} filter={real ? 'url(#shadow)' : undefined} />
      {!real && <rect x={0} y={0} width={board.width} height={board.height} fill="url(#grid)" pointerEvents="none" />}

      {/* GND 구리 채우기 (실물 보기에서는 보고 있는 면만 렌더링) */}
      {trackLayers.map((layer) => {
        if (!show[layer]) return null;
        const opacity = real ? 0.6 : layer === 'top' ? 0.26 : 0.22;
        return <PourLayer key={`pour-${layer}`} project={project} side={layer} color={real ? '#2f9a5a' : colors[layer]} opacity={opacity} />;
      })}

      {/* 배선 */}
      {trackLayers.map((layer) =>
        show[layer] && project.tracks.filter((t) => t.layer === layer).map((t, i) => (
          <polyline
            key={`${layer}${i}`}
            points={t.points.map((p) => p.join(',')).join(' ')}
            fill="none"
            stroke={colors[layer]}
            strokeOpacity={real ? (hoverNet && hoverNet !== t.net ? 0.45 : 1) : hoverNet && hoverNet !== t.net ? 0.25 : layer === 'bottom' ? 0.75 : 0.9}
            strokeWidth={t.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="stroke"
            onPointerEnter={() => setHighlightNet(t.net)}
            onPointerLeave={() => setHighlightNet(null)}
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

      {/* 무선 안테나 금지 구역 (편집 보기에서 표시) */}
      {!real && keepouts.map((k, i) => (
        <g key={`ko${i}`} pointerEvents="none">
          <rect
            x={k.x1}
            y={k.y1}
            width={k.x2 - k.x1}
            height={k.y2 - k.y1}
            fill="#f59e0b"
            fillOpacity={0.12}
            stroke="#f59e0b"
            strokeOpacity={0.75}
            strokeWidth={0.2}
            strokeDasharray="0.9 0.6"
          >
            <title>{tr('canvas.antennaKeepout')}</title>
          </rect>
          <text
            x={(k.x1 + k.x2) / 2}
            y={(k.y1 + k.y2) / 2}
            className="keepout-label"
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={1.4}
          >
            ANTENNA KEEPOUT
          </text>
        </g>
      ))}

      {/* 부품 (실물 뒷면에서는 앞면 실크스크린을 감춤) */}
      {partRender.map(({ part, def, box, refStrokes, pinLabelStrokes, silk, valY }) => {
        const isSel = part.ref === selected;
        const hasErr = !real && errorRefs.has(part.ref);
        return (
          <g
            key={part.ref}
            className="part"
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.button !== 0) return;
              e.currentTarget.setPointerCapture?.(e.pointerId);
              const p = toBoard(e);
              select(part.ref);
              setDrag({ kind: 'part', ref: part.ref, dx: p.x - part.x, dy: p.y - part.y, x: part.x, y: part.y });
            }}
            onDoubleClick={(e) => { e.stopPropagation(); rotatePart(part.ref); }}
          >
            <rect x={box.x1} y={box.y1} width={box.x2 - box.x1} height={box.y2 - box.y1}
              fill={isSel ? 'rgba(255,158,41,0.10)' : hasErr ? 'rgba(230,115,127,0.14)' : 'transparent'}
              stroke={isSel ? '#ff9e29' : hasErr ? '#e6737f' : 'none'}
              strokeWidth={hasErr ? 0.28 : 0.2}
              strokeDasharray={isSel || hasErr ? '0.6 0.4' : undefined} />
            {show.silk && !realBack && silk.map((s, i) => (
              s.kind === 'line'
                ? <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={colors.silk} strokeWidth={0.15} strokeLinecap="round" />
                : <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill="none" stroke={colors.silk} strokeWidth={0.15} />
            ))}
            {show.silk && !realBack && refStrokes.map((pts, i) => (
              <polyline key={`t${i}`} points={pts} fill="none" stroke={colors.silk} strokeWidth={0.15} strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {show.silk && !realBack && pinLabelStrokes.map((pts, i) => (
              <polyline key={`p${i}`} points={pts} fill="none" stroke={colors.silk} strokeWidth={0.13} strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {!real && part.value && (
              <text x={part.x} y={valY} className="part-value" textAnchor="middle" dominantBaseline="middle" fontSize={0.95}>
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
              e.currentTarget.setPointerCapture?.(e.pointerId);
              setMenu(null);
              setDrag({ kind: 'wire', from: p, x: p.ax, y: p.ay, sx: e.clientX, sy: e.clientY });
            }}
            onPointerEnter={() => net && setHighlightNet(net)}
            onPointerLeave={() => setHighlightNet(null)}
          >
            <title>{tr('canvas.pinTitle', { pin: `${p.ref}.${p.pin}`, net: net ? ` · ${net}` : '' })}</title>
            {p.shape === 'circle' ? (
              <circle cx={p.ax} cy={p.ay} r={p.aw / 2} fill={fill} />
            ) : (
              <rect x={p.ax - p.aw / 2} y={p.ay - p.ah / 2} width={p.aw} height={p.ah} rx={p.shape === 'oval' ? Math.min(p.aw, p.ah) / 2 : 0.1} fill={fill} />
            )}
            {p.drill > 0 && <circle cx={p.ax} cy={p.ay} r={p.drill / 2} fill={colors.hole} />}
            {!real && vb.w < 70 && (
              <text x={p.ax} y={p.ay} className="pad-label" textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(0.62, 2.2 / Math.max(1, p.pin.length))}>{p.pin}</text>
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

      {/* 구리 간격 위반 시각 마커 */}
      {clearDots.map((v, i) => (
        <g key={`cv${i}`} pointerEvents="none">
          <circle cx={v.x} cy={v.y} r={1.1} fill="rgba(230,115,127,0.22)" stroke="#e6737f" strokeWidth={0.22} />
        </g>
      ))}
      </g>

      {/* 치수 표시 */}
      <text x={board.width / 2} y={-1.6} className="dim-label" textAnchor="middle" fontSize={1.6}>{board.width} mm</text>
      <text x={-1.6} y={board.height / 2} className="dim-label" textAnchor="middle" fontSize={1.6} transform={`rotate(-90 ${-1.6} ${board.height / 2})`}>{board.height} mm</text>
      {hoverNet && <text x={board.width} y={board.height + 3} className="dim-label" textAnchor="end" fontSize={1.6}>{tr('canvas.net', { net: hoverNet })}</text>}
    </svg>
    <CanvasHud
      zoomPct={zoomPct}
      onZoomIn={() => zoomBy(0.8)}
      onZoomOut={() => zoomBy(1.25)}
      onFit={fit}
      selectedPart={selectedPart}
      onRotate={selectedPart ? () => rotatePart(selectedPart.ref) : undefined}
      onDuplicate={selectedPart ? () => duplicatePart(selectedPart.ref) : undefined}
      onDelete={selectedPart ? () => deletePart(selectedPart.ref) : undefined}
      realBack={realBack}
      onFlipBack={toggleRealSide}
    />
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
