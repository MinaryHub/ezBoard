// PCB 화면의 GND 구리 채우기와 고정 나사 구멍. 거버(pourInto)와 같은 순서로 그린다:
// 보드 전체를 칠하고 → 다른 넷 둘레·구멍을 지우고 → GND 패드는 열 차단 다리로만 잇는다.
import { memo, useMemo } from 'react';
import type { Project } from '../types';
import { placedPads, resolvePin, type PlacedPad } from '../lib/library';
import { VIA_D } from '../lib/router';
import { HOLE_D, HOLE_KEEP, POUR_CLEAR, POUR_EDGE, SPOKE_W, keepoutRects, mountingHoles, pourNet, thermalSpokes } from '../lib/features';

type Side = 'top' | 'bottom';

function PadShape({ p, exp, fill }: { p: PlacedPad; exp: number; fill: string }) {
  const w = p.aw + exp * 2, h = p.ah + exp * 2;
  if (p.shape === 'circle') return <circle cx={p.ax} cy={p.ay} r={w / 2} fill={fill} />;
  return <rect x={p.ax - w / 2} y={p.ay - h / 2} width={w} height={h} rx={p.shape === 'oval' ? Math.min(w, h) / 2 : exp} fill={fill} />;
}

export const PourLayer = memo(function PourLayer({ project, side, color, opacity }: { project: Project; side: Side; color: string; opacity: number }) {
  const data = useMemo(() => {
    if (opacity <= 0) return null;
    const gnd = pourNet(project);
    if (!gnd) return null;
    const padNet = new Map<string, string>();
    for (const n of project.nets) for (const pin of n.pins) for (const pad of resolvePin(project.parts, pin)) padNet.set(`${pad.ref}#${pad.num}`, n.name);
    const pads = project.parts.flatMap(placedPads);
    const isGnd = (p: PlacedPad) => padNet.get(`${p.ref}#${p.num}`) === gnd;
    return {
      gnd,
      others: pads.filter((p) => !isGnd(p)),
      gndPads: pads.filter(isGnd),
      tracks: project.tracks.filter((tr) => tr.layer === side && tr.net !== gnd),
      vias: project.vias.filter((v) => v.net !== gnd),
      holes: mountingHoles(project),
      keepouts: keepoutRects(project),
    };
  }, [project, side, opacity]);

  const { width: w, height: h } = project.board;
  if (!data || opacity <= 0 || w <= POUR_EDGE * 2 || h <= POUR_EDGE * 2) return null;
  const id = `pour-${side}`;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return (
    <g pointerEvents="none">
      <mask id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
        <rect x={POUR_EDGE} y={POUR_EDGE} width={w - POUR_EDGE * 2} height={h - POUR_EDGE * 2} fill="white" />
        {data.gndPads.map((p, i) => <PadShape key={`g${i}`} p={p} exp={POUR_CLEAR} fill="black" />)}
        {data.gndPads.flatMap((p, i) => thermalSpokes(p).map((s, j) => (
          <line
            key={`${i}-${j}`}
            x1={clamp(s[0][0], POUR_EDGE, w - POUR_EDGE)}
            y1={clamp(s[0][1], POUR_EDGE, h - POUR_EDGE)}
            x2={clamp(s[1][0], POUR_EDGE, w - POUR_EDGE)}
            y2={clamp(s[1][1], POUR_EDGE, h - POUR_EDGE)}
            stroke="white"
            strokeWidth={SPOKE_W}
          />
        )))}
        {data.others.map((p, i) => <PadShape key={`o${i}`} p={p} exp={POUR_CLEAR} fill="black" />)}
        {data.tracks.map((tr, i) => (
          <polyline key={`t${i}`} points={tr.points.map((q) => q.join(',')).join(' ')} fill="none" stroke="black" strokeWidth={tr.width + POUR_CLEAR * 2} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {data.vias.map((v, i) => <circle key={`v${i}`} cx={v.x} cy={v.y} r={VIA_D / 2 + POUR_CLEAR} fill="black" />)}
        {data.holes.map(([x, y], i) => <circle key={`h${i}`} cx={x} cy={y} r={HOLE_KEEP} fill="black" />)}
        {data.keepouts.map((k, i) => <rect key={`k${i}`} x={k.x1} y={k.y1} width={k.x2 - k.x1} height={k.y2 - k.y1} fill="black" />)}
      </mask>
      <rect x={0} y={0} width={w} height={h} fill={color} fillOpacity={opacity} mask={`url(#${id})`} />
    </g>
  );
});

export const MountingHoles = memo(function MountingHoles({ project, hole, real, label }: { project: Project; hole: string; real: boolean; label: string }) {
  const holes = useMemo(() => mountingHoles(project), [project]);
  if (!holes.length) return null;
  return (
    <g pointerEvents="none">
      {holes.map(([x, y], i) => (
        <g key={i}>
          {!real && <circle cx={x} cy={y} r={HOLE_KEEP} fill="none" stroke="#e5c07b" strokeOpacity={0.45} strokeWidth={0.12} strokeDasharray="0.5 0.4" />}
          <circle cx={x} cy={y} r={HOLE_D / 2} fill={hole} stroke={real ? '#cbb57a' : 'none'} strokeWidth={0.15}>
            <title>{label}</title>
          </circle>
        </g>
      ))}
    </g>
  );
});
