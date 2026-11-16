// 2층 그리드 A* 자동 배선기
import type { Layer, Project, Track, Via } from '../types';
import { placedPads, type PlacedPad } from './library';
import { netConnections } from './geometry';
import { HOLE_KEEP, mountingHoles } from './features';

export const PITCH = 0.635;
export const TRACK_W = 0.4;
export const POWER_W = 0.8;
export const CLEARANCE = 0.25;
export const VIA_D = 0.8;
export const VIA_DRILL = 0.4;

const FREE = -1;
const BLOCKED = -2;

export const isPowerNet = (name: string) => /^(gnd|vcc|vdd|vin|v\+|5v|3v3|\+?\d+(\.\d+)?v|vbat|power)/i.test(name);

export interface RouteResult {
  tracks: Track[];
  vias: Via[];
  failed: { net: string; from: string; to: string }[];
}

export class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

function routeOnce(project: Project, order: [string, PlacedPad, PlacedPad][]): RouteResult {
  const { board } = project;
  const W = Math.floor(board.width / PITCH) + 1;
  const H = Math.floor(board.height / PITCH) + 1;
  const N = W * H;
  const owner = [new Int32Array(N).fill(FREE), new Int32Array(N).fill(FREE)];
  const netIds = new Map<string, number>();
  project.nets.forEach((n, i) => netIds.set(n.name, i));

  const pinNet = new Map<string, number>();
  for (const net of project.nets) for (const pin of net.pins) pinNet.set(pin.toLowerCase(), netIds.get(net.name)!);

  // 보드 가장자리 금지 영역
  const edge = 0.6;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const px = x * PITCH, py = y * PITCH;
      if (px < edge || py < edge || px > board.width - edge || py > board.height - edge) {
        owner[0][y * W + x] = BLOCKED;
        owner[1][y * W + x] = BLOCKED;
      }
    }

  // 고정 나사 구멍 주변 금지 영역 (나사 머리가 구리에 닿지 않게)
  for (const [hx, hy] of mountingHoles(project)) {
    const r = HOLE_KEEP + TRACK_W / 2;
    for (let y = Math.max(0, Math.floor((hy - r) / PITCH)); y <= Math.min(H - 1, Math.ceil((hy + r) / PITCH)); y++)
      for (let x = Math.max(0, Math.floor((hx - r) / PITCH)); x <= Math.min(W - 1, Math.ceil((hx + r) / PITCH)); x++)
        if (Math.hypot(x * PITCH - hx, y * PITCH - hy) <= r) { owner[0][y * W + x] = BLOCKED; owner[1][y * W + x] = BLOCKED; }
  }

  // 패드 주변 영역을 해당 넷 소유로 (다른 넷과 겹치면 금지)
  const claim = (layer: number, i: number, net: number) => {
    const o = owner[layer][i];
    if (o === FREE) owner[layer][i] = net;
    else if (o !== net) owner[layer][i] = BLOCKED;
  };
  const padHalo = (pad: PlacedPad, net: number, extra: number) => {
    const hx = pad.aw / 2 + extra, hy = pad.ah / 2 + extra;
    const x0 = Math.max(0, Math.ceil((pad.ax - hx) / PITCH)), x1 = Math.min(W - 1, Math.floor((pad.ax + hx) / PITCH));
    const y0 = Math.max(0, Math.ceil((pad.ay - hy) / PITCH)), y1 = Math.min(H - 1, Math.floor((pad.ay + hy) / PITCH));
    const round = pad.shape === 'circle';
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (round && Math.hypot(x * PITCH - pad.ax, y * PITCH - pad.ay) > pad.aw / 2 + extra) continue;
        claim(0, y * W + x, net);
        claim(1, y * W + x, net);
      }
  };
  let unconnectedId = project.nets.length + 1;
  for (const part of project.parts)
    for (const pad of placedPads(part)) {
      const net = pinNet.get(`${part.ref}.${pad.pin}`.toLowerCase()) ?? pinNet.get(`${part.ref}.${pad.num}`.toLowerCase()) ?? unconnectedId++;
      padHalo(pad, net, CLEARANCE + TRACK_W / 2);
    }

  const cellOf = (x: number, y: number) => {
    const cx = Math.min(W - 1, Math.max(0, Math.round(x / PITCH)));
    const cy = Math.min(H - 1, Math.max(0, Math.round(y / PITCH)));
    return cy * W + cx;
  };

  const tracks: Track[] = [];
  const vias: Via[] = [];
  const failed: RouteResult['failed'] = [];
  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
  const S = 2 * N * 5;
  const g = new Float32Array(S);
  const prev = new Int32Array(S);

  const jobs: [string, PlacedPad, PlacedPad, boolean][] = order.map(([n, a, b]) => [n, a, b, isPowerNet(n)]);
  for (let jobIdx = 0; jobIdx < jobs.length; jobIdx++) {
    const [netName, a, b, wide] = jobs[jobIdx];
    const net = netIds.get(netName)!;
    const ok1 = (l: number, i: number) => owner[l][i] === FREE || owner[l][i] === net;
    // 굵은 선은 주변 칸까지 비어 있어야 함
    const usable = wide
      ? (l: number, i: number) => ok1(l, i) && (i % W === 0 || ok1(l, i - 1)) && (i % W === W - 1 || ok1(l, i + 1)) && (i < W || ok1(l, i - W)) && (i >= N - W || ok1(l, i + W))
      : ok1;
    const viaOk = (i: number) => {
      const x = i % W, y = (i / W) | 0;
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
      for (const j of [i, i - 1, i + 1, i - W, i + W]) if (!usable(0, j) || !usable(1, j)) return false;
      return true;
    };
    g.fill(Infinity);
    prev.fill(-1);
    const heap = new Heap();
    const target = cellOf(b.ax, b.ay);
    const tx = target % W, ty = (target / W) | 0;
    const h = (i: number) => (Math.abs((i % W) - tx) + Math.abs(((i / W) | 0) - ty)) * 1.0;
    const start = cellOf(a.ax, a.ay);
    for (const l of [0, 1]) {
      const s = (l * N + start) * 5 + 4;
      g[s] = 0;
      heap.push(h(start), s);
    }
    let found = -1;
    let iter = 0;
    while (heap.size && iter++ < 400000) {
      const s = heap.pop();
      const dir = s % 5;
      const node = (s - dir) / 5;
      const l = node >= N ? 1 : 0;
      const i = node - l * N;
      if (i === target) { found = s; break; }
      const gs = g[s];
      const x = i % W, y = (i / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (!usable(l, ni)) continue;
        const own = owner[l][ni] === net ? 0.6 : 1;
        const cost = gs + own * (l === 1 ? 1.05 : 1) + (dir !== 4 && dir !== d ? 1.5 : 0);
        const ns = ((l * N + ni) * 5) + d;
        if (cost < g[ns]) { g[ns] = cost; prev[ns] = s; heap.push(cost + h(ni), ns); }
      }
      // 비아로 층 이동
      const ol = 1 - l;
      if (viaOk(i)) {
        const ns = ((ol * N + i) * 5) + 4;
        const cost = gs + 10;
        if (cost < g[ns]) { g[ns] = cost; prev[ns] = s; heap.push(cost + h(i), ns); }
      }
    }
    if (found < 0 && wide) {
      // 굵게 못 가면 보통 굵기로 다시 시도
      jobs.splice(jobIdx + 1, 0, [netName, a, b, false]);
      continue;
    }
    if (found < 0) {
      failed.push({ net: netName, from: `${a.ref}.${a.pin}`, to: `${b.ref}.${b.pin}` });
      continue;
    }
    // 경로 복원
    const path: { l: number; i: number }[] = [];
    for (let s = found; s >= 0; s = prev[s]) {
      const node = (s - (s % 5)) / 5;
      const l = node >= N ? 1 : 0;
      path.push({ l, i: node - l * N });
    }
    path.reverse();
    const width = wide ? POWER_W : TRACK_W;
    let seg: [number, number][] = [[a.ax, a.ay]];
    let segLayer = path[0].l;
    const flush = (layer: number) => {
      if (seg.length >= 2) tracks.push({ net: netName, layer: (layer ? 'bottom' : 'top') as Layer, width, points: simplify(seg) });
    };
    for (let k = 0; k < path.length; k++) {
      const { l, i } = path[k];
      const px = (i % W) * PITCH, py = ((i / W) | 0) * PITCH;
      owner[l][i] = net;
      if (width > TRACK_W) {
        // 굵은 전원선은 주변 칸도 점유
        for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < N && owner[l][j] === FREE) owner[l][j] = net;
      }
      if (l !== segLayer) {
        flush(segLayer);
        vias.push({ net: netName, x: px, y: py });
        for (const j of [i, i - 1, i + 1, i - W, i + W]) { owner[0][j] = net; owner[1][j] = net; }
        seg = [[px, py]];
        segLayer = l;
      } else {
        seg.push([px, py]);
      }
    }
    seg.push([b.ax, b.ay]);
    flush(segLayer);
  }
  return { tracks, vias, failed };
}

function simplify(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2], b = last!;
      const cross = (b[0] - a[0]) * (p[1] - b[1]) - (b[1] - a[1]) * (p[0] - b[0]);
      if (Math.abs(cross) < 1e-6) { out[out.length - 1] = p; continue; }
    }
    out.push(p);
  }
  return out;
}

/** 모든 넷을 자동 배선. 실패가 있으면 순서를 바꿔 몇 번 재시도 */
export function autoRoute(project: Project): RouteResult {
  let conns: [string, PlacedPad, PlacedPad][] = [];
  for (const net of project.nets)
    for (const [a, b] of netConnections(project.parts, net)) conns.push([net.name, a, b]);
  // 짧은 연결부터, 전원은 나중에 (굵어서 길을 많이 막음)
  const len = (c: [string, PlacedPad, PlacedPad]) => Math.abs(c[1].ax - c[2].ax) + Math.abs(c[1].ay - c[2].ay);
  conns.sort((x, y) => len(x) - len(y));

  let best: RouteResult | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = routeOnce(project, conns);
    if (!best || r.failed.length < best.failed.length) best = r;
    if (!r.failed.length) break;
    // 실패한 연결을 앞으로
    const failedKeys = new Set(r.failed.map((f) => `${f.from}|${f.to}`));
    const key = (c: [string, PlacedPad, PlacedPad]) => `${c[1].ref}.${c[1].pin}|${c[2].ref}.${c[2].pin}`;
    conns = [...conns.filter((c) => failedKeys.has(key(c))), ...conns.filter((c) => !failedKeys.has(key(c)))];
  }
  return best!;
}
