import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { partName } from '../lib/library.i18n';
import { usePinchZoom } from './usePinchZoom';
import { useRefitOnShow } from './useRefitOnShow';
import { getDef } from '../lib/library';
import { symbolFor, xformPoint, type Dir } from '../lib/symbols';
import { absBody, labelPlacement, layoutSchematic, routeSchematic, type AbsPin } from '../lib/schematic';
import PinMenu from './PinMenu';
import type { SchPos } from '../types';

const INK = '#2b2f36';
const WIRE = '#14804a';
// 선택 = 강조색(밝은 바탕용 진한 주황), 연결 강조 = 정보색 파랑
const HILITE = '#266fc9';
const SEL = '#c46a00';
const DIRV: Record<Dir, [number, number]> = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] };
/** 핀을 잡거나 놓을 때 인정하는 거리 (회로도 단위) */
const PIN_SNAP = 1.2;
/** 이만큼(화면 px) 안 움직이고 떼면 탭으로 본다 */
const TAP_PX = 8;

/** 전원/접지 기호 */
function PowerSymbol({ kind, net, x, y, dir, color, title }: { kind: string; net: string; x: number; y: number; dir: Dir; color: string; title: string }) {
  const [dx, dy] = DIRV[dir];
  const px = -dy, py = dx; // 수직 방향
  const ex = x + dx * 1.5, ey = y + dy * 1.5;
  if (kind === 'gnd') {
    const bars = [1.2, 0.75, 0.3].map((w, i) => {
      const cx = ex + dx * i * 0.45, cy = ey + dy * i * 0.45;
      return `M${cx - px * w} ${cy - py * w}L${cx + px * w} ${cy + py * w}`;
    });
    return (
      <g stroke={color} strokeWidth={0.15} strokeLinecap="round">
        <path d={`M${x} ${y}L${ex} ${ey}${bars.join('')}`} fill="none" />
        <title>{title}</title>
      </g>
    );
  }
  const tx = ex + dx * 1.1, ty = ey + dy * 1.1;
  const vertical = dy !== 0;
  return (
    <g stroke={color} strokeWidth={0.15} strokeLinecap="round">
      <path d={`M${x} ${y}L${ex} ${ey}M${ex - px * 1} ${ey - py * 1}L${ex + px * 1} ${ey + py * 1}`} fill="none" />
      <text
        x={vertical ? ex : tx}
        y={vertical ? ty + (dy > 0 ? 0.4 : 0.3) : ey + 0.35}
        fontSize={1}
        textAnchor={vertical ? 'middle' : dx > 0 ? 'start' : 'end'}
        fill={color}
        stroke="none"
        className="sch-text bold"
      >{net}</text>
      <title>{title}</title>
    </g>
  );
}

export default function SchematicCanvas() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const { select, moveSchPart, rotateSchPart, deletePart, undo, redo, connectSchPins, disconnectSchPin } = useStore.getState();
  const svgRef = useRef<SVGSVGElement>(null);
  const tr = useT();
  const [vb, setVb] = useState({ x: -40, y: -30, w: 80, h: 60 });
  const [drag, setDrag] = useState<
    | { kind: 'part'; ref: string; dx: number; dy: number; pos: SchPos }
    | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
    | { kind: 'wire'; from: AbsPin; x: number; y: number; sx: number; sy: number }
    | null
  >(null);
  const [hoverNet, setHoverNet] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; pin: AbsPin } | null>(null);

  const basePos = useMemo(() => layoutSchematic(project.parts, project.nets, project.sch ?? {}), [project.parts, project.nets, project.sch]);
  const pos = useMemo(() => (drag?.kind === 'part' ? { ...basePos, [drag.ref]: drag.pos } : basePos), [basePos, drag]);
  const route = useMemo(() => routeSchematic(project.parts, project.nets, pos), [project.parts, project.nets, pos]);

  const fit = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const b = route.bounds;
    const pad = 4;
    const bw = b.x2 - b.x1 + pad * 2, bh = b.y2 - b.y1 + pad * 2;
    const aspect = r.width / r.height;
    const w = Math.max(bw, bh * aspect, 30), h = w / aspect;
    setVb({ x: (b.x1 + b.x2) / 2 - w / 2, y: (b.y1 + b.y2) / 2 - h / 2, w, h });
  }, [route.bounds]);
  // 부품 구성이 바뀌면 화면 맞추기
  const partKey = project.parts.map((p) => p.ref).join(',');
  const fitTick = useStore((s) => s.fitTick);
  useEffect(fit, [partKey, fitTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useRefitOnShow(svgRef, fit);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.modal-bg')) return;
      const el = svgRef.current;
      if (!el || el.getBoundingClientRect().width < 10) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') { setDrag(null); select(null); return; }
      if (e.key === 'f' || e.key === 'F' || e.key === '0') { fit(); return; }
      if (!selected) return;
      if (e.key === 'r' || e.key === 'R') rotateSchPart(selected);
      if (e.key === 'Delete' || e.key === 'Backspace') deletePart(selected);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, rotateSchPart, deletePart, select, undo, redo, fit]);

  const toSvg = (e: { clientX: number; clientY: number }) => {
    const el = svgRef.current;
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return { x: 0, y: 0 };
    const pt = el.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const pinch = usePinchZoom(toSvg, setVb, () => setDrag(null));

  const onWheel = (e: React.WheelEvent) => {
    setMenu(null);
    const p = toSvg(e);
    const k = Math.exp(e.deltaY * 0.0015);
    setVb((v) => {
      const w = Math.min(600, Math.max(10, v.w * k));
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
      const r = svgRef.current!.getBoundingClientRect();
      const scale = Math.max(vb.w / Math.max(1, r.width), vb.h / Math.max(1, r.height));
      setVb((v) => ({ ...v, x: drag.vx - (e.clientX - drag.sx) * scale, y: drag.vy - (e.clientY - drag.sy) * scale }));
    } else {
      const p = toSvg(e);
      const x = Math.round(p.x - drag.dx), y = Math.round(p.y - drag.dy);
      if (x !== drag.pos.x || y !== drag.pos.y) setDrag({ ...drag, pos: { ...drag.pos, x, y } });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag?.kind === 'wire') {
      const target = pinAt(drag.x, drag.y, drag.from);
      if (target) connectSchPins({ ref: drag.from.ref, name: drag.from.name }, { ref: target.ref, name: target.name });
      // 끌지 않고 눌렀다 떼면(탭) 핀 메뉴 — 터치 화면에서 연결 끊기
      else if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < TAP_PX) setMenu({ x: e.clientX, y: e.clientY, pin: drag.from });
    }
    if (drag?.kind === 'part') {
      const orig = basePos[drag.ref];
      if (orig && (orig.x !== drag.pos.x || orig.y !== drag.pos.y)) moveSchPart(drag.ref, drag.pos.x, drag.pos.y, basePos);
    }
    setDrag(null);
  };
  const cancelDrag = () => setDrag(null);

  /** 이 위치에서 가장 가까운 핀 (끌기 중 놓을 곳) */
  const pinAt = (x: number, y: number, except?: AbsPin): AbsPin | null => {
    let best: AbsPin | null = null;
    let bd = PIN_SNAP * PIN_SNAP;
    for (const p of route.pins) {
      if (except && p.ref === except.ref && p.name === except.name) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };
  const wireTarget = drag?.kind === 'wire' ? pinAt(drag.x, drag.y, drag.from) : null;

  const closeMenu = useCallback(() => setMenu(null), []);

  const netColor = (net?: string) => (hoverNet && net === hoverNet ? HILITE : WIRE);
  const connectedPins = useMemo(() => new Set(route.pins.filter((p) => p.net).map((p) => `${p.ref}.${p.name}`)), [route.pins]);
  const wireStrings = useMemo(() => route.wires.map((w) => w.points.map((p) => p.join(',')).join(' ')), [route.wires]);

  return (
    <>
    <svg
      ref={svgRef}
      className="sch-canvas"
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
        <pattern id="sch-grid" width={1} height={1} patternUnits="userSpaceOnUse">
          <circle cx={0} cy={0} r={0.05} fill="#c9c4b5" />
        </pattern>
      </defs>
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#sch-grid)" pointerEvents="none" />

      {/* 전선 */}
      {route.wires.map((w, i) => (
        <g key={`w${i}`} onPointerEnter={() => setHoverNet(w.net)} onPointerLeave={() => setHoverNet(null)}>
          <polyline points={wireStrings[i]} fill="none" stroke="transparent" strokeWidth={1} />
          <polyline points={wireStrings[i]} fill="none" stroke={netColor(w.net)} strokeWidth={hoverNet === w.net ? 0.28 : 0.18} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
          <title>{tr('canvas.net', { net: w.net })}</title>
        </g>
      ))}
      {route.dots.map((d, i) => <circle key={`d${i}`} cx={d.x} cy={d.y} r={0.35} fill={netColor(d.net)} pointerEvents="none" />)}

      {/* 전원 기호 */}
      {route.power.map((p, i) => (
        <g key={`p${i}`} onPointerEnter={() => setHoverNet(p.net)} onPointerLeave={() => setHoverNet(null)}>
          <PowerSymbol
            {...p}
            color={hoverNet === p.net ? HILITE : p.kind === 'gnd' ? INK : '#b91c1c'}
            title={tr(p.kind === 'gnd' ? 'canvas.gndTitle' : 'canvas.powerTitle', { net: p.net })}
          />
        </g>
      ))}

      {/* 배선 실패 시 넷 이름표 */}
      {route.labels.map((l, i) => {
        const [dx, dy] = DIRV[l.dir];
        const ex = l.x + dx * 1.2, ey = l.y + dy * 1.2;
        return (
          <g key={`l${i}`} onPointerEnter={() => setHoverNet(l.net)} onPointerLeave={() => setHoverNet(null)}>
            <path d={`M${l.x} ${l.y}L${ex} ${ey}`} stroke={netColor(l.net)} strokeWidth={0.18} />
            <text x={ex + (dx || 0) * 0.3} y={ey + (dy > 0 ? 1 : dy < 0 ? -0.4 : 0.35)} fontSize={0.95} textAnchor={dx < 0 ? 'end' : dx > 0 ? 'start' : 'middle'} fill={netColor(l.net)} className="sch-text bold">{l.net}</text>
          </g>
        );
      })}

      {/* 부품 기호 */}
      {project.parts.map((part) => {
        const p = pos[part.ref];
        if (!p) return null;
        const normRot = ((p.rot % 360) + 360) % 360;
        const sym = symbolFor(part.type);
        const body = absBody(part, p);
        const isSel = part.ref === selected;
        const color = isSel ? SEL : INK;
        const lab = labelPlacement(part, p);
        return (
          <g
            key={part.ref}
            className="sch-part"
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.button !== 0) return;
              e.currentTarget.setPointerCapture?.(e.pointerId);
              const s = toSvg(e);
              select(part.ref);
              setDrag({ kind: 'part', ref: part.ref, dx: s.x - p.x, dy: s.y - p.y, pos: p });
            }}
            onDoubleClick={(e) => { e.stopPropagation(); rotateSchPart(part.ref); }}
          >
            <rect x={body.x1 - 0.6} y={body.y1 - 0.6} width={body.x2 - body.x1 + 1.2} height={body.y2 - body.y1 + 1.2}
              fill={isSel ? 'rgba(255,158,41,0.12)' : 'transparent'} stroke={isSel ? SEL : 'none'} strokeWidth={0.1} strokeDasharray="0.5 0.3" rx={0.4} />
            <g transform={`translate(${p.x} ${p.y}) ${sym.rotatable ? `rotate(${normRot})` : normRot === 180 ? 'scale(-1 1)' : ''}`} stroke={color} strokeWidth={0.15} strokeLinecap="round" strokeLinejoin="round" fill="none">
              {sym.shapes.map((s, i) => {
                if (s.k === 'path') return <path key={i} d={s.d} fill={s.fill ? color : 'none'} />;
                if (s.k === 'circle') return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={s.fill ? color : 'none'} />;
                if (s.k === 'rect') return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill="#fffbea" />;
                return null;
              })}
            </g>
            {/* 글자는 회전하지 않도록 따로 */}
            {sym.shapes.filter((s) => s.k === 'text').map((s, i) => {
              if (s.k !== 'text') return null;
              const size = s.size ?? 1;
              if (!sym.rotatable && normRot === 180) {
                const anchor = s.anchor === 'start' ? 'end' : s.anchor === 'end' ? 'start' : 'middle';
                return <text key={`t${i}`} x={p.x - s.x} y={p.y + s.y} fontSize={size} textAnchor={anchor} fill={color} className="sch-text">{s.t}</text>;
              }
              if (!normRot) return <text key={`t${i}`} x={p.x + s.x} y={p.y + s.y} fontSize={size} textAnchor={s.anchor ?? 'start'} fill={color} className="sch-text">{s.t}</text>;
              // 회전된 기호: 글자 중심만 회전시키고 글자는 똑바로
              const [cx, cy] = xformPoint(sym, s.x, s.y - 0.35 * size, normRot);
              return <text key={`t${i}`} x={p.x + cx} y={p.y + cy + 0.35 * size} fontSize={size} textAnchor="middle" fill={color} className="sch-text">{s.t}</text>;
            })}
            <text x={lab.x} y={lab.y1} fontSize={1.05} textAnchor={lab.anchor} fill={color} className="sch-text bold">{part.ref}</text>
            <text x={lab.x} y={lab.y2} fontSize={0.95} textAnchor={lab.anchor} fill="#57534e" className="sch-text">{part.value}</text>
            <title>{tr('canvas.partTitle', { ref: part.ref, name: getDef(part.type) ? partName(getDef(part.type)!) : part.type, value: part.value })}</title>
          </g>
        );
      })}

      {/* 핀 끝: 끌어서 다른 핀에 놓으면 연결, Alt+클릭으로 끊기 */}
      {route.pins.map((p) => {
        const isTarget = wireTarget && wireTarget.ref === p.ref && wireTarget.name === p.name;
        const isFrom = drag?.kind === 'wire' && drag.from.ref === p.ref && drag.from.name === p.name;
        return (
          <g
            key={`h${p.ref}.${p.name}`}
            className={`sch-pin ${drag?.kind === 'wire' ? 'wiring' : ''} ${isTarget || isFrom ? 'on' : ''}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.button !== 0) return;
              if (e.altKey) { disconnectSchPin({ ref: p.ref, name: p.name }); return; }
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
              setMenu(null);
              setDrag({ kind: 'wire', from: p, x: p.x, y: p.y, sx: e.clientX, sy: e.clientY });
            }}
            onPointerEnter={() => p.net && setHoverNet(p.net)}
            onPointerLeave={() => setHoverNet(null)}
          >
            <circle cx={p.x} cy={p.y} r={0.9} fill="transparent" />
            <circle className="dot" cx={p.x} cy={p.y} r={0.38} />
            <title>{tr('canvas.pinTitle', { pin: `${p.ref}.${p.name}`, net: p.net ? ` · ${p.net}` : '' })}</title>
          </g>
        );
      })}

      {/* 끌고 있는 새 연결 */}
      {drag?.kind === 'wire' && (
        <g pointerEvents="none">
          <line x1={drag.from.x} y1={drag.from.y} x2={wireTarget?.x ?? drag.x} y2={wireTarget?.y ?? drag.y}
            stroke={wireTarget ? HILITE : SEL} strokeWidth={0.2} strokeDasharray={wireTarget ? undefined : '0.6 0.4'} strokeLinecap="round" />
          {wireTarget && <circle cx={wireTarget.x} cy={wireTarget.y} r={0.7} fill="none" stroke={HILITE} strokeWidth={0.18} />}
        </g>
      )}

      {/* 연결 안 된 핀 표시 */}
      {route.pins.filter((p) => !connectedPins.has(`${p.ref}.${p.name}`)).map((p, i) => (
        <g key={`nc${i}`} stroke="#a8a29e" strokeWidth={0.12} pointerEvents="none">
          <path d={`M${p.x - 0.35} ${p.y - 0.35}L${p.x + 0.35} ${p.y + 0.35}M${p.x + 0.35} ${p.y - 0.35}L${p.x - 0.35} ${p.y + 0.35}`} />
        </g>
      ))}

      {hoverNet && <text x={vb.x + vb.w - 1} y={vb.y + vb.h - 1} fontSize={vb.w / 60} textAnchor="end" fill={HILITE} className="sch-text bold">{tr('canvas.net', { net: hoverNet })}</text>}
    </svg>
    {menu && (
      <PinMenu
        x={menu.x} y={menu.y} pin={`${menu.pin.ref}.${menu.pin.name}`} net={menu.pin.net}
        onDisconnect={() => disconnectSchPin({ ref: menu.pin.ref, name: menu.pin.name })}
        onClose={closeMenu}
      />
    )}
    </>
  );
}
