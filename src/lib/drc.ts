// 설계 규칙 검사 (초보자용 메시지)
import type { Project } from '../types';
import { t, type TKey } from '../i18n';
import { getDef, partBox, placedPads, resolvePin } from './library';
import { netConnections } from './geometry';
import { HOLE_KEEP, hitsHole, mountingHoles, pourNet } from './features';

type DrcCode = 'unknownType' | 'offboard' | 'overlap' | 'badPin' | 'singlePin' | 'unused' | 'short' | 'ledNoR' | 'capPolarity' | 'noTracks' | 'unrouted' | 'clearance' | 'hole' | 'holeCopper' | 'noGndPour' | 'ok';
const m = (code: DrcCode, vars?: Record<string, string | number>) => ({ code, message: t(`drc.${code}` as TKey, vars) });

export interface DrcIssue {
  level: 'error' | 'warning' | 'info';
  code: DrcCode;
  message: string;
  refs?: string[];
}

/** 넷 안에서 트랙/비아로 실제로 연결된 핀 그룹을 계산해 미배선 연결 수를 센다 */
export function unroutedCount(project: Project): number {
  let count = 0;
  for (const net of project.nets) {
    const conns = netConnections(project.parts, net);
    if (!conns.length) continue;
    const groups = net.pins.map((p) => resolvePin(project.parts, p)).filter((g) => g.length);
    // union-find over pins + track endpoints
    const nodes: [number, number][] = [];
    const parent: number[] = [];
    const add = (x: number, y: number) => { nodes.push([x, y]); parent.push(parent.length); return parent.length - 1; };
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (a: number, b: number) => { parent[find(a)] = find(b); };
    const pinNode = groups.map((g) => {
      const id = add(g[0].ax, g[0].ay);
      for (const pad of g.slice(1)) union(add(pad.ax, pad.ay), id);
      return id;
    });
    const near = (a: [number, number], b: [number, number], tol: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;
    const items: number[] = [];
    for (const t of project.tracks.filter((t) => t.net === net.name)) {
      let prevId = -1;
      for (const p of t.points) {
        const id = add(p[0], p[1]);
        if (prevId >= 0) union(prevId, id);
        prevId = id;
        items.push(id);
      }
    }
    for (const v of project.vias.filter((v) => v.net === net.name)) items.push(add(v.x, v.y));
    // 좌표가 가까운 노드끼리 연결 (패드 위 끝점, 비아 위 끝점)
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++)
        if (near(nodes[i], nodes[j], 0.05)) union(i, j);
    // 트랙 꼭짓점이 패드 안에 있으면 연결
    for (const g of groups)
      for (const pad of g)
        for (const id of items) {
          const [x, y] = nodes[id];
          if (Math.abs(x - pad.ax) <= pad.aw / 2 && Math.abs(y - pad.ay) <= pad.ah / 2) union(id, pinNode[groups.indexOf(g)]);
        }
    const roots = new Set(pinNode.map(find));
    count += roots.size - 1;
  }
  return count;
}

export function runDrc(project: Project): DrcIssue[] {
  const issues: DrcIssue[] = [];
  const { board, parts, nets } = project;

  for (const p of parts) {
    if (!getDef(p.type)) issues.push({ level: 'error', ...m('unknownType', { ref: p.ref, type: p.type }), refs: [p.ref] });
    const b = partBox(p);
    if (b.x1 < 0 || b.y1 < 0 || b.x2 > board.width || b.y2 > board.height)
      issues.push({ level: 'error', ...m('offboard', { ref: p.ref }), refs: [p.ref] });
  }
  // 고정 나사 구멍 자리에 부품이나 구리가 있으면 나사가 닿는다
  const holes = mountingHoles(project);
  for (const p of parts)
    if (hitsHole(holes, partBox(p))) issues.push({ level: 'error', ...m('hole', { ref: p.ref }), refs: [p.ref] });
  if (holes.length) {
    const near = (x: number, y: number, r: number) => holes.some(([hx, hy]) => Math.hypot(x - hx, y - hy) < HOLE_KEEP + r);
    const bad = new Set<string>();
    for (const t of project.tracks) {
      for (let i = 1; i < t.points.length; i++) {
        const [a, b] = [t.points[i - 1], t.points[i]];
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.2));
        for (let k = 0; k <= n; k++) if (near(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, t.width / 2)) bad.add(t.net);
      }
    }
    for (const v of project.vias) if (near(v.x, v.y, 0.4)) bad.add(v.net);
    if (bad.size) issues.push({ level: 'error', ...m('holeCopper', { nets: [...bad].join(', ') }) });
  }
  if (project.pour && nets.length && !pourNet(project)) issues.push({ level: 'info', ...m('noGndPour') });

  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const a = partBox(parts[i]), b = partBox(parts[j]);
      if (a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1)
        issues.push({ level: 'error', ...m('overlap', { a: parts[i].ref, b: parts[j].ref }), refs: [parts[i].ref, parts[j].ref] });
    }

  for (const net of nets) {
    for (const pin of net.pins)
      if (!resolvePin(parts, pin).length)
        issues.push({ level: 'error', ...m('badPin', { net: net.name, pin }) });
    if (net.pins.length < 2) issues.push({ level: 'warning', ...m('singlePin', { net: net.name }) });
  }

  // 아무 데도 연결되지 않은 부품
  for (const p of parts) {
    const used = nets.some((n) => n.pins.some((x) => x.toLowerCase().startsWith(p.ref.toLowerCase() + '.')));
    if (!used) issues.push({ level: 'warning', ...m('unused', { ref: p.ref }), refs: [p.ref] });
  }

  // 핀이 두 넷에 동시에 속함 (합선)
  const pinOwner = new Map<string, string>();
  for (const net of nets)
    for (const pin of net.pins) {
      const pads = resolvePin(parts, pin);
      if (!pads.length) continue;
      const key = `${pads[0].ref}.${pads[0].pin}`;
      const prev = pinOwner.get(key);
      if (prev && prev !== net.name)
        issues.push({ level: 'error', ...m('short', { pin: key, a: prev, b: net.name }), refs: [pads[0].ref] });
      pinOwner.set(key, net.name);
    }

  // LED 직렬 저항 확인 (초보자 실수 1위)
  for (const p of parts.filter((x) => x.type === 'led')) {
    const pins = nets.filter((n) => n.pins.some((x) => x.toLowerCase().startsWith(p.ref.toLowerCase() + '.')));
    const hasResistor = pins.some((n) => n.pins.some((x) => {
      const ref = x.split('.')[0];
      const t = parts.find((q) => q.ref === ref)?.type;
      return t === 'resistor' || t === 'potentiometer' || t === 'npn' || t === 'nmos' || t === 'nmos_power' || t === 'pnp';
    }));
    if (!hasResistor) issues.push({ level: 'warning', ...m('ledNoR', { ref: p.ref }), refs: [p.ref] });
  }

  // 전해 커패시터 / 전원 단자 극성
  for (const p of parts.filter((x) => x.type === 'capacitor_pol')) {
    const minus = nets.find((n) => n.pins.some((x) => x.toLowerCase() === `${p.ref}.-`.toLowerCase()));
    if (minus && !/gnd|0v|-/i.test(minus.name))
      issues.push({ level: 'info', ...m('capPolarity', { ref: p.ref, net: minus.name }), refs: [p.ref] });
  }

  const unrouted = unroutedCount(project);
  if (project.tracks.length === 0 && nets.length) issues.push({ level: 'info', ...m('noTracks') });
  else if (unrouted > 0) issues.push({ level: 'error', ...m('unrouted', { n: unrouted }) });

  const viol = clearanceViolations(project);
  if (viol.length) {
    const nets = [...new Set(viol.map((v) => `${v.a}↔${v.b}`))].slice(0, 4).join(', ');
    issues.push({ level: 'error', ...m('clearance', { n: viol.length, nets }) });
  }

  const padCount = parts.reduce((s, p) => s + placedPads(p).length, 0);
  if (!issues.some((i) => i.level === 'error') && parts.length)
    issues.push({ level: 'info', ...m('ok', { parts: parts.length, pads: padCount, nets: nets.length }) });
  return issues;
}

// ---- 구리 간격 검사 ----
const MIN_CLEAR = 0.2;

function segDist(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}
function segSeg(a: number[], b: number[]) {
  // 교차하지 않는다고 보고 끝점 거리의 최솟값 (+ 교차 검사)
  const [x1, y1, x2, y2] = a, [x3, y3, x4, y4] = b;
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (d !== 0) {
    const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
    const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(segDist(x1, y1, x2, y2, x3, y3), segDist(x1, y1, x2, y2, x4, y4), segDist(x3, y3, x4, y4, x1, y1), segDist(x3, y3, x4, y4, x2, y2));
}

/** 다른 넷끼리 구리가 너무 가까운 곳 목록 */
export function clearanceViolations(project: Project): { a: string; b: string; x: number; y: number; gap: number }[] {
  const out: { a: string; b: string; x: number; y: number; gap: number }[] = [];
  const padNet = new Map<string, string>();
  for (const n of project.nets) for (const pin of n.pins) for (const pad of resolvePin(project.parts, pin)) padNet.set(`${pad.ref}#${pad.num}`, n.name);
  const pads = project.parts.flatMap(placedPads).map((p) => ({ p, net: padNet.get(`${p.ref}#${p.num}`) ?? `?${p.ref}#${p.num}` }));
  const segs: { net: string; layer: string; s: number[]; w: number }[] = [];
  for (const t of project.tracks)
    for (let i = 1; i < t.points.length; i++) segs.push({ net: t.net, layer: t.layer, s: [...t.points[i - 1], ...t.points[i]], w: t.width });

  const padGap = (pad: typeof pads[0]['p'], s: number[], w: number) => {
    // 선분을 0.1mm 간격으로 샘플링해서 패드(사각 근사)까지 거리
    const len = Math.hypot(s[2] - s[0], s[3] - s[1]);
    const n = Math.max(1, Math.ceil(len / 0.1));
    let best = Infinity;
    for (let k = 0; k <= n; k++) {
      const x = s[0] + ((s[2] - s[0]) * k) / n, y = s[1] + ((s[3] - s[1]) * k) / n;
      const d = pad.shape === 'circle'
        ? Math.hypot(x - pad.ax, y - pad.ay) - pad.aw / 2
        : Math.hypot(Math.max(Math.abs(x - pad.ax) - pad.aw / 2, 0), Math.max(Math.abs(y - pad.ay) - pad.ah / 2, 0));
      best = Math.min(best, d);
    }
    return best - w / 2;
  };

  for (const sg of segs)
    for (const { p, net } of pads) {
      if (net === sg.net) continue;
      if (Math.abs(p.ax - (sg.s[0] + sg.s[2]) / 2) > 30 && Math.abs(p.ay - (sg.s[1] + sg.s[3]) / 2) > 30) continue;
      const gap = padGap(p, sg.s, sg.w);
      if (gap < MIN_CLEAR) out.push({ a: sg.net, b: net, x: p.ax, y: p.ay, gap });
    }
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j];
      if (a.net === b.net || a.layer !== b.layer) continue;
      const gap = segSeg(a.s, b.s) - a.w / 2 - b.w / 2;
      if (gap < MIN_CLEAR) out.push({ a: a.net, b: b.net, x: a.s[0], y: a.s[1], gap });
    }
  for (const v of project.vias) {
    for (const sg of segs) {
      if (sg.net === v.net) continue;
      const gap = segDist(sg.s[0], sg.s[1], sg.s[2], sg.s[3], v.x, v.y) - sg.w / 2 - 0.4;
      if (gap < MIN_CLEAR) out.push({ a: v.net, b: sg.net, x: v.x, y: v.y, gap });
    }
    for (const { p, net } of pads) {
      if (net === v.net) continue;
      const gap = Math.hypot(p.ax - v.x, p.ay - v.y) - Math.max(p.aw, p.ah) / 2 - 0.4;
      if (gap < MIN_CLEAR) out.push({ a: v.net, b: net, x: v.x, y: v.y, gap });
    }
  }
  return out;
}
