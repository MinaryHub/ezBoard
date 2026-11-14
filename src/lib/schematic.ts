// 회로도 자동 배치 + 배선. 전원(GND, VCC 등)은 기호로, 나머지 연결은 직각 전선으로 그린다.
import type { Net, Part, SchPos } from '../types';
import { resolvePin } from './library';
import { symbolFor, xformDir, xformPoint, type Dir } from './symbols';
import { Heap, isPowerNet } from './router';

export type NetKind = 'gnd' | 'power' | 'signal';
export const netKind = (name: string): NetKind =>
  /^(gnd|0v|vss|ground|agnd|dgnd)/i.test(name) ? 'gnd' : isPowerNet(name) ? 'power' : 'signal';

export interface Rect { x1: number; y1: number; x2: number; y2: number }

const DIRV: Record<Dir, [number, number]> = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] };

export interface AbsPin { ref: string; name: string; x: number; y: number; dir: Dir; net?: string }

export function absPins(part: Part, pos: SchPos, pinNet: Map<string, string>): AbsPin[] {
  const sym = symbolFor(part.type);
  return sym.pins.map((p) => {
    const [x, y] = xformPoint(sym, p.x, p.y, pos.rot);
    return { ref: part.ref, name: p.name, x: pos.x + x, y: pos.y + y, dir: xformDir(sym, p.dir, pos.rot), net: pinNet.get(`${part.ref}.${p.name}`) };
  });
}

export function absBody(part: Part, pos: SchPos): Rect {
  const sym = symbolFor(part.type);
  const b = sym.body;
  const [ax, ay] = xformPoint(sym, b.x1, b.y1, pos.rot);
  const [bx, by] = xformPoint(sym, b.x2, b.y2, pos.rot);
  return { x1: pos.x + Math.min(ax, bx), y1: pos.y + Math.min(ay, by), x2: pos.x + Math.max(ax, bx), y2: pos.y + Math.max(ay, by) };
}

/** 참조/값 글자 위치: 핀이 없는 쪽(위 → 오른쪽 → 왼쪽 → 아래)에, 모두 막혀 있으면 오른쪽 위 모서리 */
export function labelPlacement(part: Part, pos: SchPos) {
  const b = absBody(part, pos);
  const lw = Math.max(part.ref.length, part.value.length) * 0.68 + 0.4;
  const sym = symbolFor(part.type);
  const dirs = new Set(sym.pins.map((p) => xformDir(sym, p.dir, pos.rot)));
  const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
  const wide = b.x2 - b.x1 >= b.y2 - b.y1;
  const order: Dir[] = wide ? ['u', 'r', 'l', 'd'] : ['r', 'l', 'u', 'd'];
  const side = order.find((d) => !dirs.has(d));
  if (side === 'u')
    return { x: cx, y1: b.y1 - 1.8, y2: b.y1 - 0.5, anchor: 'middle' as const, rect: { x1: cx - lw / 2, y1: b.y1 - 3, x2: cx + lw / 2, y2: b.y1 } };
  if (side === 'd')
    return { x: cx, y1: b.y2 + 1.4, y2: b.y2 + 2.6, anchor: 'middle' as const, rect: { x1: cx - lw / 2, y1: b.y2, x2: cx + lw / 2, y2: b.y2 + 3 } };
  if (side === 'r')
    return { x: b.x2 + 0.6, y1: cy - 0.3, y2: cy + 1.0, anchor: 'start' as const, rect: { x1: b.x2, y1: cy - 1.5, x2: b.x2 + 0.6 + lw, y2: cy + 1.4 } };
  if (side === 'l')
    return { x: b.x1 - 0.6, y1: cy - 0.3, y2: cy + 1.0, anchor: 'end' as const, rect: { x1: b.x1 - 0.6 - lw, y1: cy - 1.5, x2: b.x1, y2: cy + 1.4 } };
  return { x: b.x2 + 0.4, y1: b.y1 - 1.6, y2: b.y1 - 0.4, anchor: 'start' as const, rect: { x1: b.x2, y1: b.y1 - 2.8, x2: b.x2 + 0.4 + lw, y2: b.y1 } };
}

/** 부품이 차지하는 전체 영역 (기호 + 핀 + 글자 + 전원 기호) */
export function extentOf(part: Part, pos: SchPos, pinNet: Map<string, string>): Rect {
  const r = { ...absBody(part, pos) };
  const grow = (x: number, y: number) => { r.x1 = Math.min(r.x1, x); r.y1 = Math.min(r.y1, y); r.x2 = Math.max(r.x2, x); r.y2 = Math.max(r.y2, y); };
  for (const p of absPins(part, pos, pinNet)) {
    grow(p.x, p.y);
    if (p.net && netKind(p.net) !== 'signal') {
      const [dx, dy] = DIRV[p.dir];
      grow(p.x + dx * 3.2 + dy * 1.6, p.y + dy * 3.2 + dx * 1.6);
      grow(p.x + dx * 3.2 - dy * 1.6, p.y + dy * 3.2 - dx * 1.6);
    }
  }
  const l = labelPlacement(part, pos).rect;
  grow(l.x1, l.y1); grow(l.x2, l.y2);
  return r;
}

/** "부품.핀" → 해당 넷 이름 */
export function buildPinNet(parts: Part[], nets: Net[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of nets)
    for (const pin of n.pins) {
      const pads = resolvePin(parts, pin);
      if (pads.length) m.set(`${pads[0].ref}.${pads[0].pin}`, n.name);
    }
  return m;
}

const GAP = 3;
const hit = (a: Rect, b: Rect, gap: number) => a.x1 < b.x2 + gap && a.x2 > b.x1 - gap && a.y1 < b.y2 + gap && a.y2 > b.y1 - gap;

/** 위치가 없는 부품을 연결 관계를 보고 배치 */
export function layoutSchematic(parts: Part[], nets: Net[], existing: Record<string, SchPos> = {}): Record<string, SchPos> {
  const pinNet = buildPinNet(parts, nets);
  const pos: Record<string, SchPos> = {};
  for (const p of parts) if (existing[p.ref]) pos[p.ref] = existing[p.ref];
  const toPlace = parts.filter((p) => !pos[p.ref]);
  if (!toPlace.length) return pos;

  // 핀이 많은 부품(IC, 모듈)부터, 그다음 연결이 많은 순서
  const deg = (p: Part) => symbolFor(p.type).pins.filter((x) => pinNet.has(`${p.ref}.${x.name}`)).length;
  toPlace.sort((a, b) => symbolFor(b.type).pins.length - symbolFor(a.type).pins.length || deg(b) - deg(a));

  const placed: { part: Part; ext: Rect; pins: AbsPin[] }[] = parts
    .filter((p) => pos[p.ref])
    .map((p) => ({ part: p, ext: extentOf(p, pos[p.ref], pinNet), pins: absPins(p, pos[p.ref], pinNet) }));

  // 연결이 하나도 없는 부품은 맨 마지막에 아래쪽 줄에 따로 놓는다
  const loose = toPlace.filter((p) => deg(p) === 0);
  const linkedParts = toPlace.filter((p) => deg(p) > 0);

  for (const part of linkedParts) {
    const sym = symbolFor(part.type);
    if (!placed.length) {
      pos[part.ref] = { x: 0, y: 0, rot: 0 };
    } else {
      let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity, cx = 0, cy = 0;
      for (const q of placed) {
        bx1 = Math.min(bx1, q.ext.x1); by1 = Math.min(by1, q.ext.y1); bx2 = Math.max(bx2, q.ext.x2); by2 = Math.max(by2, q.ext.y2);
        cx += (q.ext.x1 + q.ext.x2) / 2; cy += (q.ext.y1 + q.ext.y2) / 2;
      }
      cx /= placed.length; cy /= placed.length;
      const self = extentOf(part, { x: 0, y: 0, rot: 0 }, pinNet);
      const reach = Math.max(self.x2 - self.x1, self.y2 - self.y1) + 4;
      let best: SchPos | null = null;
      let bestCost = Infinity;
      for (const rot of sym.rotatable ? [0, 90, 180, 270] : [0, 180]) {
        // (0,0) 기준으로 한 번만 계산하고 평행이동
        const ext0 = extentOf(part, { x: 0, y: 0, rot }, pinNet);
        const pins0 = absPins(part, { x: 0, y: 0, rot }, pinNet).filter((p) => p.net);
        const targets = pins0.map((pin) => placed.flatMap((q) => q.pins.filter((t) => t.net === pin.net)));
        const rotCost = rot === 90 || rot === 270 ? 0.3 : rot === 180 ? 0.6 : 0;
        for (let y = Math.floor(by1 - reach); y <= Math.ceil(by2 + reach); y++) {
          for (let x = Math.floor(bx1 - reach); x <= Math.ceil(bx2 + reach); x++) {
            const ext = { x1: ext0.x1 + x, y1: ext0.y1 + y, x2: ext0.x2 + x, y2: ext0.y2 + y };
            let blocked = false;
            for (const q of placed) if (hit(ext, q.ext, GAP)) { blocked = true; break; }
            if (blocked) continue;
            let cost = 0.04 * (Math.abs(x - cx) + Math.abs(y - cy)) + rotCost;
            for (let k = 0; k < pins0.length && cost < bestCost; k++) {
              const pin = pins0[k];
              const px = pin.x + x, py = pin.y + y;
              let bestD = Infinity, vx = 0, vy = 0;
              for (const t of targets[k]) {
                const d = Math.abs(t.x - px) + Math.abs(t.y - py);
                if (d < bestD) { bestD = d; vx = t.x - px; vy = t.y - py; }
              }
              if (bestD === Infinity) continue;
              if (netKind(pin.net!) === 'signal') {
                const [dx, dy] = DIRV[pin.dir];
                cost += bestD + (vx * dx + vy * dy < 0 ? 4 : 0);
              } else cost += bestD * 0.15;
            }
            if (cost < bestCost) { bestCost = cost; best = { x, y, rot }; }
          }
        }
      }
      pos[part.ref] = best ?? { x: Math.ceil(bx2 + 6), y: 0, rot: 0 };
    }
    placed.push({ part, ext: extentOf(part, pos[part.ref], pinNet), pins: absPins(part, pos[part.ref], pinNet) });
  }

  if (loose.length) {
    let bx1 = 0, by2 = 0;
    if (placed.length) {
      bx1 = Math.min(...placed.map((q) => q.ext.x1));
      by2 = Math.max(...placed.map((q) => q.ext.y2));
    }
    let cursor = bx1;
    for (const part of loose) {
      const e = extentOf(part, { x: 0, y: 0, rot: 0 }, pinNet);
      const x = Math.round(cursor - e.x1), y = Math.round(by2 + GAP + 2 - e.y1);
      pos[part.ref] = { x, y, rot: 0 };
      cursor += e.x2 - e.x1 + GAP + 1;
      placed.push({ part, ext: extentOf(part, pos[part.ref], pinNet), pins: absPins(part, pos[part.ref], pinNet) });
    }
  }
  return pos;
}

export interface SchRoute {
  wires: { net: string; points: [number, number][] }[];
  dots: { net: string; x: number; y: number }[];
  power: { net: string; kind: NetKind; x: number; y: number; dir: Dir }[];
  labels: { net: string; x: number; y: number; dir: Dir }[];
  pins: AbsPin[];
  bounds: Rect;
}

/** 신호 넷을 그리드 위에서 직각으로 배선 (다른 넷과는 교차만 허용) */
export function routeSchematic(parts: Part[], nets: Net[], pos: Record<string, SchPos>): SchRoute {
  const pinNet = buildPinNet(parts, nets);
  const allPins: AbsPin[] = [];
  const bodies: Rect[] = [];
  let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
  for (const p of parts) {
    const ps = pos[p.ref];
    if (!ps) continue;
    allPins.push(...absPins(p, ps, pinNet));
    bodies.push(absBody(p, ps));
    const e = extentOf(p, ps, pinNet);
    bx1 = Math.min(bx1, e.x1); by1 = Math.min(by1, e.y1); bx2 = Math.max(bx2, e.x2); by2 = Math.max(by2, e.y2);
  }
  const out: SchRoute = { wires: [], dots: [], power: [], labels: [], pins: allPins, bounds: { x1: bx1, y1: by1, x2: bx2, y2: by2 } };
  if (!allPins.length) { out.bounds = { x1: -10, y1: -10, x2: 10, y2: 10 }; return out; }

  const M = 6;
  const ox = Math.floor(bx1) - M, oy = Math.floor(by1) - M;
  const W = Math.ceil(bx2) + M - ox + 1, H = Math.ceil(by2) + M - oy + 1;
  const N = W * H;
  const FREE = -1, BLOCK = -2;
  const hOwn = new Int32Array(N).fill(FREE);
  const vOwn = new Int32Array(N).fill(FREE);
  const idx = (x: number, y: number) => (y - oy) * W + (x - ox);
  const inside = (x: number, y: number) => x >= ox && y >= oy && x < ox + W && y < oy + H;
  const setBoth = (x: number, y: number, v: number) => { if (inside(x, y)) { const i = idx(x, y); hOwn[i] = v; vOwn[i] = v; } };

  for (const b of bodies)
    for (let y = Math.ceil(b.y1); y <= Math.floor(b.y2); y++)
      for (let x = Math.ceil(b.x1); x <= Math.floor(b.x2); x++) setBoth(x, y, BLOCK);

  // 기호 바로 옆 칸은 비용을 높여 전선이 기호에 붙어 다니지 않게
  const near = new Float32Array(N);
  for (const b of bodies)
    for (let y = Math.ceil(b.y1) - 1; y <= Math.floor(b.y2) + 1; y++)
      for (let x = Math.ceil(b.x1) - 1; x <= Math.floor(b.x2) + 1; x++) if (inside(x, y)) near[idx(x, y)] = 1.5;

  const netId = new Map(nets.map((n, i) => [n.name, i]));
  let uniq = nets.length + 1;
  for (const p of allPins) {
    const [dx, dy] = DIRV[p.dir];
    // 핀 다리(끝점 안쪽)는 막기
    for (let k = 1; k < 4; k++) {
      const x = p.x - dx * k, y = p.y - dy * k;
      if (bodies.some((b) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2)) break;
      setBoth(x, y, BLOCK);
    }
    if (p.net && netKind(p.net) !== 'signal') {
      out.power.push({ net: p.net, kind: netKind(p.net), x: p.x, y: p.y, dir: p.dir });
      for (let k = 0; k <= 3; k++) for (const s of [-1, 0, 1]) setBoth(p.x + dx * k + dy * s, p.y + dy * k + dx * s, BLOCK);
    } else {
      setBoth(p.x, p.y, p.net ? netId.get(p.net)! : uniq++);
    }
  }

  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
  const isH = (d: number) => d < 2;
  const ownerArr = (d: number) => (isH(d) ? hOwn : vOwn);
  const S = N * 5;
  const g = new Float32Array(S);
  const prev = new Int32Array(S);
  const degree = new Map<string, number>();
  const bump = (net: string, i: number) => { const k = `${net}|${i}`; degree.set(k, (degree.get(k) ?? 0) + 1); };

  const signalNets = nets
    .filter((n) => netKind(n.name) === 'signal')
    .map((n) => ({ n, pins: allPins.filter((p) => p.net === n.name) }))
    .filter((x) => x.pins.length >= 2)
    .sort((a, b) => span(a.pins) - span(b.pins));

  for (const { n, pins } of signalNets) {
    const net = netId.get(n.name)!;
    const tree = new Set<number>([idx(pins[0].x, pins[0].y)]);
    const rest = pins.slice(1).sort((a, b) => Math.abs(a.x - pins[0].x) + Math.abs(a.y - pins[0].y) - (Math.abs(b.x - pins[0].x) + Math.abs(b.y - pins[0].y)));
    let labeledRoot = false;
    for (const pin of rest) {
      const start = idx(pin.x, pin.y);
      if (tree.has(start)) continue;
      g.fill(Infinity);
      prev.fill(-1);
      const heap = new Heap();
      const s0 = start * 5 + 4;
      g[s0] = 0;
      heap.push(0, s0);
      let found = -1;
      while (heap.size) {
        const s = heap.pop();
        const dirIn = s % 5;
        const i = (s - dirIn) / 5;
        if (i !== start && tree.has(i)) { found = s; break; }
        const gs = g[s];
        const x = (i % W) + ox, y = Math.floor(i / W) + oy;
        for (let d = 0; d < 4; d++) {
          if (dirIn !== 4 && (d ^ 1) === dirIn && isH(d) === isH(dirIn)) continue; // 되돌아가기 금지
          const nx = x + DX[d], ny = y + DY[d];
          if (!inside(nx, ny)) continue;
          const ni = idx(nx, ny);
          const own = ownerArr(d)[ni];
          if (own !== FREE && own !== net) continue;
          const bend = dirIn !== 4 && isH(d) !== isH(dirIn);
          if (bend || dirIn === 4) { const o = ownerArr(d)[i]; if (o !== FREE && o !== net) continue; }
          const other = (isH(d) ? vOwn : hOwn)[ni];
          const cross = other >= 0 && other !== net ? 3 : 0;
          // 다른 넷 전선과 바로 붙어서 나란히 가면 약간 감점
          let hug = 0;
          const side = isH(d) ? [ni - W, ni + W] : [ni - 1, ni + 1];
          for (const j of side) if (j >= 0 && j < N) { const o = ownerArr(d)[j]; if (o >= 0 && o !== net) hug += 0.4; }
          const cost = gs + 1 + (bend ? 2 : 0) + cross + near[ni] + hug;
          const ns = ni * 5 + d;
          if (cost < g[ns]) { g[ns] = cost; prev[ns] = s; heap.push(cost, ns); }
        }
      }
      if (found < 0) {
        out.labels.push({ net: n.name, x: pin.x, y: pin.y, dir: pin.dir });
        if (!labeledRoot) { out.labels.push({ net: n.name, x: pins[0].x, y: pins[0].y, dir: pins[0].dir }); labeledRoot = true; }
        continue;
      }
      const cells: number[] = [];
      const dirs: number[] = [];
      for (let s = found; s >= 0; s = prev[s]) { cells.push((s - (s % 5)) / 5); dirs.push(s % 5); }
      cells.reverse(); dirs.reverse();
      for (let k = 1; k < cells.length; k++) {
        const arr = ownerArr(dirs[k]);
        arr[cells[k - 1]] = net;
        arr[cells[k]] = net;
        bump(n.name, cells[k - 1]);
        bump(n.name, cells[k]);
      }
      for (const c of cells) tree.add(c);
      const pts: [number, number][] = cells.map((c) => [(c % W) + ox, Math.floor(c / W) + oy]);
      out.wires.push({ net: n.name, points: simplify(pts) });
    }
  }

  // 전선이 3갈래 이상 만나는 곳, 또는 핀에 전선이 2개 이상 붙은 곳에 점
  const pinCells = new Set(allPins.map((p) => `${p.net}|${idx(p.x, p.y)}`));
  for (const [k, d] of degree) {
    const isPin = pinCells.has(k);
    if (d >= 3 || (isPin && d >= 2)) {
      const [net, i] = [k.slice(0, k.lastIndexOf('|')), Number(k.slice(k.lastIndexOf('|') + 1))];
      out.dots.push({ net, x: (i % W) + ox, y: Math.floor(i / W) + oy });
    }
  }
  return out;
}

function span(pins: AbsPin[]) {
  const xs = pins.map((p) => p.x), ys = pins.map((p) => p.y);
  return Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys);
}

function simplify(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of pts) {
    if (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) { out[out.length - 1] = p; continue; }
    }
    out.push(p);
  }
  return out;
}
