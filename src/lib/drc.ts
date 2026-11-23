// 설계 규칙 검사 (초보자용 메시지)
import type { Project } from '../types';
import { t, type TKey } from '../i18n';
import { getDef, partBox, placedPads, resolvePin, type PlacedPad } from './library';
import { netConnections } from './geometry';
import { HOLE_KEEP, hitsHole, mountingHoles, pourNet } from './features';
import { isPowerNet, VIA_D } from './router';

type DrcCode = 'unknownType' | 'offboard' | 'overlap' | 'badPin' | 'singlePin' | 'unused' | 'short' | 'ledNoR' | 'capPolarity' | 'noTracks' | 'unrouted' | 'clearance' | 'hole' | 'holeCopper' | 'noGndPour' | 'ok';
const m = (code: DrcCode, vars?: Record<string, string | number>) => ({ code, message: t(`drc.${code}` as TKey, vars) });

export interface DrcIssue {
  level: 'error' | 'warning' | 'info';
  code: DrcCode;
  message: string;
  refs?: string[];
}

function pointInPad(pad: PlacedPad, x: number, y: number, tol = 0): boolean {
  const dx = Math.abs(x - pad.ax), dy = Math.abs(y - pad.ay);
  if (pad.shape === 'circle') return Math.hypot(dx, dy) <= pad.aw / 2 + tol;
  return dx <= pad.aw / 2 + tol && dy <= pad.ah / 2 + tol;
}

/** 넷 안에서 트랙/비아로 실제로 연결된 핀 그룹을 계산해 미배선 연결 수를 센다 (층 구분 + T-접합 포함) */
export function unroutedCount(project: Project): number {
  let count = 0;
  for (const net of project.nets) {
    const conns = netConnections(project.parts, net);
    if (!conns.length) continue;
    const groups = net.pins.map((p) => resolvePin(project.parts, p)).filter((g) => g.length);
    type ConnLayer = 'top' | 'bottom' | 'both';
    const nodes: { x: number; y: number; layer: ConnLayer }[] = [];
    const parent: number[] = [];
    const add = (x: number, y: number, layer: ConnLayer) => { nodes.push({ x, y, layer }); parent.push(parent.length); return parent.length - 1; };
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (a: number, b: number) => { parent[find(a)] = find(b); };
    const layerOk = (a: ConnLayer, b: ConnLayer) => a === 'both' || b === 'both' || a === b;

    const pinNode = groups.map((g) => {
      const id = add(g[0].ax, g[0].ay, 'both');
      for (const pad of g.slice(1)) union(add(pad.ax, pad.ay, 'both'), id);
      return id;
    });
    const items: number[] = [];
    const segs: { ax: number; ay: number; bx: number; by: number; layer: ConnLayer; node: number }[] = [];
    for (const tr of project.tracks) {
      if (tr.net !== net.name) continue;
      let prevId = -1;
      for (let k = 0; k < tr.points.length; k++) {
        const p = tr.points[k];
        const id = add(p[0], p[1], tr.layer);
        if (prevId >= 0) {
          union(prevId, id);
          const prevPt = tr.points[k - 1];
          segs.push({ ax: prevPt[0], ay: prevPt[1], bx: p[0], by: p[1], layer: tr.layer, node: id });
        }
        prevId = id;
        items.push(id);
      }
    }
    for (const v of project.vias) if (v.net === net.name) items.push(add(v.x, v.y, 'both'));

    // 같은 층(또는 스루홀/비아)의 가까운 꼭짓점끼리 연결
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++)
        if (layerOk(nodes[i].layer, nodes[j].layer) && Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) < 0.05) union(i, j);

    // T-접합: 비아/트랙 꼭짓점/패드가 같은 층 선분 위에 닿으면 연결
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      for (const sg of segs) {
        if (!layerOk(nd.layer, sg.layer)) continue;
        if (segDist(sg.ax, sg.ay, sg.bx, sg.by, nd.x, nd.y) < 0.05) union(i, sg.node);
      }
    }

    // 트랙 꼭짓점·비아가 패드 안에 있으면 연결
    for (let gi = 0; gi < groups.length; gi++)
      for (const pad of groups[gi])
        for (const id of items) {
          const nd = nodes[id];
          if (pointInPad(pad, nd.x, nd.y)) union(id, pinNode[gi]);
        }

    const roots = new Set(pinNode.map(find));
    count += roots.size - 1;
  }
  return count;
}

/** 배치·배선 없이 넷리스트·부품 정의만으로 검사 가능한 회로 규칙 (AI 자동 고침에서 고속 호출) */
export function netlistIssues(project: Project): DrcIssue[] {
  const issues: DrcIssue[] = [];
  const { parts, nets } = project;

  for (const p of parts) {
    if (!getDef(p.type)) issues.push({ level: 'error', ...m('unknownType', { ref: p.ref, type: p.type }), refs: [p.ref] });
  }

  for (const net of nets) {
    for (const pin of net.pins)
      if (!resolvePin(parts, pin).length)
        issues.push({ level: 'error', ...m('badPin', { net: net.name, pin }) });
    if (net.pins.length < 2) issues.push({ level: 'warning', ...m('singlePin', { net: net.name }) });
  }

  // 아무 데도 연결되지 않은 부품
  for (const p of parts) {
    const prefix = p.ref.toLowerCase() + '.';
    const used = nets.some((n) => n.pins.some((x) => x.trim().toLowerCase().startsWith(prefix)));
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

  // LED / RGB LED 직렬 저항 확인 (공통 전원·GND 레일의 무관한 저항으로 오판하지 않도록 신호 넷 우선 검사)
  const partByRef = new Map(parts.map((q) => [q.ref.toLowerCase(), q]));
  const isLimiter = (type?: string) =>
    type === 'resistor' || type === 'potentiometer' || type === 'npn' || type === 'nmos' || type === 'nmos_power' || type === 'pnp';
  for (const p of parts.filter((x) => x.type === 'led' || x.type === 'rgb_led')) {
    const prefix = p.ref.toLowerCase() + '.';
    const attached = nets.filter((n) => n.pins.some((x) => x.trim().toLowerCase().startsWith(prefix)));
    if (!attached.length) continue;
    const signalNets = attached.filter((n) => !isPowerNet(n.name));
    const hasResistor = signalNets.some((n) => n.pins.some((x) => {
      const ref = x.slice(0, x.lastIndexOf('.')).trim().toLowerCase();
      return ref !== p.ref.toLowerCase() && isLimiter(partByRef.get(ref)?.type);
    }));
    if (!hasResistor) issues.push({ level: 'warning', ...m('ledNoR', { ref: p.ref }), refs: [p.ref] });
  }

  // 전해 커패시터 극성 (핀 이름 '-' 또는 번호 '2' 모두 인식)
  for (const p of parts.filter((x) => x.type === 'capacitor_pol')) {
    const minus = nets.find((n) => n.pins.some((x) => resolvePin([p], x).some((pad) => pad.pin === '-')));
    if (minus && !/gnd|0v|vss|-/i.test(minus.name))
      issues.push({ level: 'info', ...m('capPolarity', { ref: p.ref, net: minus.name }), refs: [p.ref] });
  }

  return issues;
}

export function runDrc(project: Project): DrcIssue[] {
  const issues: DrcIssue[] = [];
  const { board, parts, nets } = project;

  for (const p of parts) {
    const b = partBox(p);
    if (b.x1 < 0 || b.y1 < 0 || b.x2 > board.width || b.y2 > board.height)
      issues.push({ level: 'error', ...m('offboard', { ref: p.ref }), refs: [p.ref] });
  }

  // 고정 나사 구멍 자리에 부품이나 구리가 있으면 나사가 닿는다
  const holes = mountingHoles(project);
  for (const p of parts)
    if (hitsHole(holes, partBox(p))) issues.push({ level: 'error', ...m('hole', { ref: p.ref }), refs: [p.ref] });
  if (holes.length) {
    const bad = new Set<string>();
    for (const tr of project.tracks) {
      const lim = HOLE_KEEP + tr.width / 2;
      for (let i = 1; i < tr.points.length; i++) {
        const [a, b] = [tr.points[i - 1], tr.points[i]];
        if (holes.some(([hx, hy]) => segDist(a[0], a[1], b[0], b[1], hx, hy) < lim)) bad.add(tr.net);
      }
    }
    for (const v of project.vias) {
      if (holes.some(([hx, hy]) => Math.hypot(v.x - hx, v.y - hy) < HOLE_KEEP + VIA_D / 2)) bad.add(v.net);
    }
    if (bad.size) issues.push({ level: 'error', ...m('holeCopper', { nets: [...bad].join(', ') }) });
  }
  if (project.pour && nets.length && !pourNet(project)) issues.push({ level: 'info', ...m('noGndPour') });

  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const a = partBox(parts[i]), b = partBox(parts[j]);
      if (a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1)
        issues.push({ level: 'error', ...m('overlap', { a: parts[i].ref, b: parts[j].ref }), refs: [parts[i].ref, parts[j].ref] });
    }

  issues.push(...netlistIssues(project));

  const unrouted = unroutedCount(project);
  if (project.tracks.length === 0 && nets.length) issues.push({ level: 'info', ...m('noTracks') });
  else if (unrouted > 0) issues.push({ level: 'error', ...m('unrouted', { n: unrouted }) });

  const viol = clearanceViolations(project);
  if (viol.length) {
    const vnets = [...new Set(viol.map((v) => `${v.a}↔${v.b}`))].slice(0, 4).join(', ');
    issues.push({ level: 'error', ...m('clearance', { n: viol.length, nets: vnets }) });
  }

  const padCount = parts.reduce((s, p) => s + placedPads(p).length, 0);
  if (!issues.some((i) => i.level === 'error' || i.code === 'noTracks') && parts.length)
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

/** 선분과 축 정렬 사각형(AABB) 사이의 정확한 O(1) 거리 */
function segAabbDist(ax: number, ay: number, bx: number, by: number, x1: number, y1: number, x2: number, y2: number): number {
  const inside = (x: number, y: number) => x >= x1 && x <= x2 && y >= y1 && y <= y2;
  if (inside(ax, ay) || inside(bx, by)) return 0;
  const s = [ax, ay, bx, by];
  return Math.min(
    segSeg(s, [x1, y1, x2, y1]),
    segSeg(s, [x2, y1, x2, y2]),
    segSeg(s, [x2, y2, x1, y2]),
    segSeg(s, [x1, y2, x1, y1]),
  );
}

/** 선분과 패드(원/타원/사각) 사이의 정확한 O(1) 거리 */
function segPadGap(pad: PlacedPad, s: number[], w: number): number {
  const [ax, ay, bx, by] = s;
  if (pad.shape === 'circle') {
    return segDist(ax, ay, bx, by, pad.ax, pad.ay) - pad.aw / 2 - w / 2;
  }
  if (pad.shape === 'oval') {
    const r = Math.min(pad.aw, pad.ah) / 2;
    const dx = Math.max(0, pad.aw / 2 - r);
    const dy = Math.max(0, pad.ah / 2 - r);
    return segSeg(s, [pad.ax - dx, pad.ay - dy, pad.ax + dx, pad.ay + dy]) - r - w / 2;
  }
  return segAabbDist(ax, ay, bx, by, pad.ax - pad.aw / 2, pad.ay - pad.ah / 2, pad.ax + pad.aw / 2, pad.ay + pad.ah / 2) - w / 2;
}

/** 점과 패드 경계 사이의 정확한 거리 */
function pointPadDist(pad: PlacedPad, px: number, py: number): number {
  if (pad.shape === 'circle') return Math.hypot(px - pad.ax, py - pad.ay) - pad.aw / 2;
  if (pad.shape === 'oval') {
    const r = Math.min(pad.aw, pad.ah) / 2;
    const dx = Math.max(0, pad.aw / 2 - r);
    const dy = Math.max(0, pad.ah / 2 - r);
    return segDist(pad.ax - dx, pad.ay - dy, pad.ax + dx, pad.ay + dy, px, py) - r;
  }
  const dx = Math.max(Math.abs(px - pad.ax) - pad.aw / 2, 0);
  const dy = Math.max(Math.abs(py - pad.ay) - pad.ah / 2, 0);
  return Math.hypot(dx, dy);
}

/** 다른 넷끼리 구리가 너무 가까운 곳 목록 */
export function clearanceViolations(project: Project): { a: string; b: string; x: number; y: number; gap: number }[] {
  const out: { a: string; b: string; x: number; y: number; gap: number }[] = [];
  const padNet = new Map<string, string>();
  for (const n of project.nets) for (const pin of n.pins) for (const pad of resolvePin(project.parts, pin)) padNet.set(`${pad.ref}#${pad.num}`, n.name);
  const pads = project.parts.flatMap(placedPads).map((p) => ({ p, net: padNet.get(`${p.ref}#${p.num}`) ?? `?${p.ref}#${p.num}` }));
  const segs: { net: string; layer: string; s: number[]; w: number; minX: number; maxX: number; minY: number; maxY: number }[] = [];
  for (const tr of project.tracks) {
    for (let i = 1; i < tr.points.length; i++) {
      const [x1, y1] = tr.points[i - 1], [x2, y2] = tr.points[i];
      segs.push({
        net: tr.net, layer: tr.layer, s: [x1, y1, x2, y2], w: tr.width,
        minX: Math.min(x1, x2), maxX: Math.max(x1, x2), minY: Math.min(y1, y2), maxY: Math.max(y1, y2),
      });
    }
  }

  // 트랙 ↔ 패드 (정확한 AABB 가지치기 + O(1) 해석적 거리)
  for (const sg of segs) {
    const padMargin = sg.w / 2 + MIN_CLEAR;
    for (const { p, net } of pads) {
      if (net === sg.net) continue;
      if (p.ax + p.aw / 2 + padMargin < sg.minX || p.ax - p.aw / 2 - padMargin > sg.maxX) continue;
      if (p.ay + p.ah / 2 + padMargin < sg.minY || p.ay - p.ah / 2 - padMargin > sg.maxY) continue;
      const gap = segPadGap(p, sg.s, sg.w);
      if (gap < MIN_CLEAR) out.push({ a: sg.net, b: net, x: p.ax, y: p.ay, gap });
    }
  }

  // 트랙 ↔ 트랙 (같은 층)
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j];
      if (a.net === b.net || a.layer !== b.layer) continue;
      const margin = (a.w + b.w) / 2 + MIN_CLEAR;
      if (a.maxX + margin < b.minX || b.maxX + margin < a.minX || a.maxY + margin < b.minY || b.maxY + margin < a.minY) continue;
      const gap = segSeg(a.s, b.s) - a.w / 2 - b.w / 2;
      if (gap < MIN_CLEAR) out.push({ a: a.net, b: b.net, x: (a.s[0] + a.s[2]) / 2, y: (a.s[1] + a.s[3]) / 2, gap });
    }

  // 패드 ↔ 패드 (서로 다른 부품의 다른 넷)
  for (let i = 0; i < pads.length; i++)
    for (let j = i + 1; j < pads.length; j++) {
      const a = pads[i], b = pads[j];
      if (a.net === b.net || a.p.ref === b.p.ref) continue;
      const dx = Math.max(Math.abs(a.p.ax - b.p.ax) - (a.p.aw + b.p.aw) / 2, 0);
      const dy = Math.max(Math.abs(a.p.ay - b.p.ay) - (a.p.ah + b.p.ah) / 2, 0);
      const gap = a.p.shape === 'circle' && b.p.shape === 'circle'
        ? Math.hypot(a.p.ax - b.p.ax, a.p.ay - b.p.ay) - (a.p.aw + b.p.aw) / 2
        : Math.hypot(dx, dy);
      if (gap < MIN_CLEAR) out.push({ a: a.net, b: b.net, x: (a.p.ax + b.p.ax) / 2, y: (a.p.ay + b.p.ay) / 2, gap });
    }

  // 비아 ↔ 트랙 / 패드 / 비아
  const viaR = VIA_D / 2;
  for (let vi = 0; vi < project.vias.length; vi++) {
    const v = project.vias[vi];
    for (const sg of segs) {
      if (sg.net === v.net) continue;
      const margin = sg.w / 2 + viaR + MIN_CLEAR;
      if (v.x + margin < sg.minX || v.x - margin > sg.maxX || v.y + margin < sg.minY || v.y - margin > sg.maxY) continue;
      const gap = segDist(sg.s[0], sg.s[1], sg.s[2], sg.s[3], v.x, v.y) - sg.w / 2 - viaR;
      if (gap < MIN_CLEAR) out.push({ a: v.net, b: sg.net, x: v.x, y: v.y, gap });
    }
    for (const { p, net } of pads) {
      if (net === v.net) continue;
      const gap = pointPadDist(p, v.x, v.y) - viaR;
      if (gap < MIN_CLEAR) out.push({ a: v.net, b: net, x: v.x, y: v.y, gap });
    }
    for (let vj = vi + 1; vj < project.vias.length; vj++) {
      const v2 = project.vias[vj];
      if (v2.net === v.net) continue;
      const gap = Math.hypot(v.x - v2.x, v.y - v2.y) - VIA_D;
      if (gap < MIN_CLEAR) out.push({ a: v.net, b: v2.net, x: (v.x + v2.x) / 2, y: (v.y + v2.y) / 2, gap });
    }
  }
  return out;
}
