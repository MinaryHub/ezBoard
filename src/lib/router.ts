// 2층 그리드 A* 자동 배선기
import type { Layer, Project, Track, Via } from '../types';
import { placedPads, resolvePin, type PlacedPad } from './library';
import { netConnections } from './geometry';
import { HOLE_KEEP, keepoutRects, mountingHoles } from './features';

export const PITCH = 0.635;
export const TRACK_W = 0.4;
export const POWER_W = 0.8;
export const CLEARANCE = 0.25;
export const VIA_D = 0.8;
export const VIA_DRILL = 0.4;

const FREE = -1;
const BLOCKED = -2;

export const isPowerNet = (name: string) =>
  /^(?:gnd|0v|vss|ground|agnd|dgnd|vcc|avcc|dvcc|vdd|vin|vbus|vsys|vm|vbat|v\+|power|pwr|[+-]?\d+(?:\.\d+)?v|3v3|5v0?)\d*$/i.test(name.trim());

export function netTrackWidth(net: { name: string; width?: number }): number {
  if (typeof net.width === 'number' && Number.isFinite(net.width) && net.width >= 0.25 && net.width <= 3.0) {
    return net.width;
  }
  return isPowerNet(net.name) ? POWER_W : TRACK_W;
}

export interface RouteResult {
  tracks: Track[];
  vias: Via[];
  failed: { net: string; from: string; to: string }[];
}

export class Heap {
  private k: number[] = [];
  private v: number[] = [];
  lastKey = 0;
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
    this.lastKey = k[0];
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
  const thtPad = new Uint8Array(N);
  const netIds = new Map<string, number>();
  const netWidthMap = new Map<string, number>();
  project.nets.forEach((n, i) => { netIds.set(n.name, i); netWidthMap.set(n.name, netTrackWidth(n)); });

  // resolvePin과 동일한 규칙으로 패드별 넷 ID 매핑 (멀티패드 핀 번호 참조·공백 포함 일관성 보장)
  const padNet = new Map<string, number>();
  for (const net of project.nets) {
    const id = netIds.get(net.name)!;
    for (const pin of net.pins) {
      for (const pad of resolvePin(project.parts, pin)) padNet.set(`${pad.ref}#${pad.num}`, id);
    }
  }

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

  // 고정 나사 구멍 주변 금지 영역 (나사 머리가 구리에 닿지 않게, 직교 현 침범 여유 포함)
  for (const [hx, hy] of mountingHoles(project)) {
    const r = HOLE_KEEP + TRACK_W / 2 + 0.15;
    for (let y = Math.max(0, Math.floor((hy - r) / PITCH)); y <= Math.min(H - 1, Math.ceil((hy + r) / PITCH)); y++)
      for (let x = Math.max(0, Math.floor((hx - r) / PITCH)); x <= Math.min(W - 1, Math.ceil((hx + r) / PITCH)); x++)
        if (Math.hypot(x * PITCH - hx, y * PITCH - hy) <= r) { owner[0][y * W + x] = BLOCKED; owner[1][y * W + x] = BLOCKED; }
  }

  // 부품 구리 금지 영역 (예: ESP32 Wi-Fi 안테나 하단)
  for (const k of keepoutRects(project)) {
    const m = TRACK_W / 2 + CLEARANCE;
    const x0 = Math.max(0, Math.floor((k.x1 - m) / PITCH)), x1 = Math.min(W - 1, Math.ceil((k.x2 + m) / PITCH));
    const y0 = Math.max(0, Math.floor((k.y1 - m) / PITCH)), y1 = Math.min(H - 1, Math.ceil((k.y2 + m) / PITCH));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) { owner[0][y * W + x] = BLOCKED; owner[1][y * W + x] = BLOCKED; }
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
        const px = x * PITCH, py = y * PITCH;
        if (round && Math.hypot(px - pad.ax, py - pad.ay) > pad.aw / 2 + extra) continue;
        const idx = y * W + x;
        claim(0, idx, net);
        claim(1, idx, net);
        if (pad.drill > 0 && Math.abs(px - pad.ax) <= pad.aw / 2 + VIA_D / 2 && Math.abs(py - pad.ay) <= pad.ah / 2 + VIA_D / 2) {
          thtPad[idx] = 1;
        }
      }
  };
  let unconnectedId = project.nets.length + 1;
  for (const part of project.parts)
    for (const pad of placedPads(part)) {
      const net = padNet.get(`${part.ref}#${pad.num}`) ?? unconnectedId++;
      padHalo(pad, net, CLEARANCE + TRACK_W / 2);
    }

  const cellOf = (x: number, y: number) => {
    const cx = Math.min(W - 1, Math.max(0, Math.round(x / PITCH)));
    const cy = Math.min(H - 1, Math.max(0, Math.round(y / PITCH)));
    return cy * W + cx;
  };

  const tracks: Track[] = [];
  const vias: Via[] = [];
  const viaSeen = new Set<string>();
  const failed: RouteResult['failed'] = [];
  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
  const S = 2 * N * 5;
  const g = new Float32Array(S);
  const prev = new Int32Array(S);

  const jobs: [string, PlacedPad, PlacedPad, number][] = order.map(([n, a, b]) => [n, a, b, netWidthMap.get(n) ?? (isPowerNet(n) ? POWER_W : TRACK_W)]);
  for (let jobIdx = 0; jobIdx < jobs.length; jobIdx++) {
    const [netName, a, b, width] = jobs[jobIdx];
    const net = netIds.get(netName)!;
    const rad = width > TRACK_W ? Math.max(1, Math.ceil((width - TRACK_W) / (2 * PITCH))) : 0;
    const ok1 = (l: number, i: number) => owner[l][i] === FREE || owner[l][i] === net;
    // 굵은 선은 반경 rad 칸까지 비어 있어야 함
    const usable = rad === 0
      ? ok1
      : (l: number, i: number) => {
          if (!ok1(l, i)) return false;
          const x = i % W, y = (i / W) | 0;
          for (let dy = -rad; dy <= rad; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= H) continue;
            for (let dx = -rad; dx <= rad; dx++) {
              if (Math.abs(dx) + Math.abs(dy) > rad + (rad > 1 ? 1 : 0)) continue;
              const nx = x + dx;
              if (nx < 0 || nx >= W) continue;
              if (!ok1(l, ny * W + nx)) return false;
            }
          }
          return true;
        };
    const viaOk = (i: number, x: number, y: number) => {
      if (thtPad[i] || x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
      return (
        usable(0, i) && usable(1, i) &&
        usable(0, i - 1) && usable(1, i - 1) &&
        usable(0, i + 1) && usable(1, i + 1) &&
        usable(0, i - W) && usable(1, i - W) &&
        usable(0, i + W) && usable(1, i + W)
      );
    };
    g.fill(Infinity);
    prev.fill(-1);
    const heap = new Heap();
    const target = cellOf(b.ax, b.ay);
    const tx = target % W, ty = (target / W) | 0;
    const h = (i: number) => (Math.abs((i % W) - tx) + Math.abs(((i / W) | 0) - ty)) * 0.6;
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
      const gs = g[s];
      const dir = s % 5;
      const node = (s - dir) / 5;
      const l = node >= N ? 1 : 0;
      const i = node - l * N;
      if (heap.lastKey > gs + h(i) + 1e-3) continue;
      if (i === target) { found = s; break; }
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
      // 비아로 층 이동 (스루홀 패드 위에는 뚫지 않음)
      const ol = 1 - l;
      if (viaOk(i, x, y)) {
        const ns = ((ol * N + i) * 5) + 4;
        const cost = gs + 10;
        if (cost < g[ns]) { g[ns] = cost; prev[ns] = s; heap.push(cost + h(i), ns); }
      }
    }
    if (found < 0 && width > TRACK_W) {
      // 굵게 못 가면 한 단계 가늘게(0.8mm → 0.4mm) 다시 시도
      const nextW = width > POWER_W ? POWER_W : TRACK_W;
      jobs.splice(jobIdx + 1, 0, [netName, a, b, nextW]);
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
    let seg: [number, number][] = [[a.ax, a.ay]];
    let segLayer = path[0].l;
    const flush = (layer: number) => {
      if (seg.length >= 2) tracks.push({ net: netName, layer: (layer ? 'bottom' : 'top') as Layer, width, points: simplify(seg) });
    };
    for (let k = 0; k < path.length; k++) {
      const { l, i } = path[k];
      const gx = i % W, gy = (i / W) | 0;
      const px = gx * PITCH, py = gy * PITCH;
      owner[l][i] = net;
      if (rad > 0) {
        for (let dy = -rad; dy <= rad; dy++) {
          const ny = gy + dy;
          if (ny < 0 || ny >= H) continue;
          for (let dx = -rad; dx <= rad; dx++) {
            if (Math.abs(dx) + Math.abs(dy) > rad + (rad > 1 ? 1 : 0)) continue;
            const nx = gx + dx;
            if (nx < 0 || nx >= W) continue;
            const ni = ny * W + nx;
            if (owner[l][ni] === FREE) owner[l][ni] = net;
          }
        }
      }
      if (l !== segLayer) {
        flush(segLayer);
        const vk = `${gx},${gy}`;
        if (!viaSeen.has(vk)) {
          viaSeen.add(vk);
          vias.push({ net: netName, x: px, y: py });
        }
        owner[0][i] = net; owner[1][i] = net;
        if (gx > 0) { owner[0][i - 1] = net; owner[1][i - 1] = net; }
        if (gx < W - 1) { owner[0][i + 1] = net; owner[1][i + 1] = net; }
        if (gy > 0) { owner[0][i - W] = net; owner[1][i - W] = net; }
        if (gy < H - 1) { owner[0][i + W] = net; owner[1][i + W] = net; }
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
  const widths = new Map(project.nets.map((n) => [n.name, netTrackWidth(n)]));
  for (const net of project.nets)
    for (const [a, b] of netConnections(project.parts, net)) conns.push([net.name, a, b]);
  // 짧은 연결부터, 굵은 선(전원·고전류)은 나중에
  const len = (c: [string, PlacedPad, PlacedPad]) => Math.abs(c[1].ax - c[2].ax) + Math.abs(c[1].ay - c[2].ay);
  conns.sort((x, y) => ((widths.get(x[0]) ?? TRACK_W) > TRACK_W ? 1 : 0) - ((widths.get(y[0]) ?? TRACK_W) > TRACK_W ? 1 : 0) || len(x) - len(y));

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
