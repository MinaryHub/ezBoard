import type { Net, Part, Project } from '../types';
import { partBox, resolvePin, type PlacedPad } from './library';

export const GRID = 1.27;
export const snap = (v: number, g = GRID) => Math.round(v / g) * g;

/** 각 넷을 이루는 핀 목록 (핀 하나 = 내부 연결된 패드 묶음) */
export function netPinGroups(parts: Part[], net: Net): PlacedPad[][] {
  return net.pins.map((p) => resolvePin(parts, p)).filter((g) => g.length > 0);
}

/** 넷 안의 핀들을 최소 신장 트리로 잇는 연결 목록 (래츠네스트) */
export function netConnections(parts: Part[], net: Net): [PlacedPad, PlacedPad][] {
  const groups = netPinGroups(parts, net);
  if (groups.length < 2) return [];
  const inTree = [0];
  const out: [PlacedPad, PlacedPad][] = [];
  const rest = new Set(groups.map((_, i) => i).slice(1));
  while (rest.size) {
    let best: [number, PlacedPad, PlacedPad, number] | null = null;
    for (const i of inTree)
      for (const j of rest)
        for (const a of groups[i])
          for (const b of groups[j]) {
            const d = Math.hypot(a.ax - b.ax, a.ay - b.ay);
            if (!best || d < best[3]) best = [j, a, b, d];
          }
    if (!best) break;
    out.push([best[1], best[2]]);
    inTree.push(best[0]);
    rest.delete(best[0]);
  }
  return out;
}

/** 부품을 그리드 위에 겹치지 않게 배치. 이미 위치가 있는 부품은 유지 */
export function autoPlace(project: Project, keep: Set<string>): Project {
  const { board } = project;
  const margin = 3;
  const placed: Part[] = project.parts.filter((p) => keep.has(p.ref));
  const toPlace = project.parts.filter((p) => !keep.has(p.ref));

  // 연결이 많은 부품부터 배치
  const degree = (ref: string) => project.nets.filter((n) => n.pins.some((p) => p.startsWith(ref + '.'))).length;
  toPlace.sort((a, b) => {
    const ba = partBox(a), bb = partBox(b);
    return (bb.x2 - bb.x1) * (bb.y2 - bb.y1) - (ba.x2 - ba.x1) * (ba.y2 - ba.y1) || degree(b.ref) - degree(a.ref);
  });

  const overlaps = (p: Part) => {
    const b = partBox(p);
    if (b.x1 < margin || b.y1 < margin || b.x2 > board.width - margin || b.y2 > board.height - margin) return true;
    return placed.some((q) => {
      const c = partBox(q);
      return b.x1 < c.x2 + 1.5 && b.x2 > c.x1 - 1.5 && b.y1 < c.y2 + 1.5 && b.y2 > c.y1 - 1.5;
    });
  };

  // 이미 배치된 연결 상대와의 거리 합 (가까울수록 좋음)
  const cost = (p: Part) => {
    let c = 0;
    for (const net of project.nets) {
      if (!net.pins.some((x) => x.startsWith(p.ref + '.'))) continue;
      for (const pin of net.pins) {
        const ref = pin.split('.')[0];
        const q = placed.find((x) => x.ref === ref);
        if (q && q.ref !== p.ref) c += Math.hypot(q.x - p.x, q.y - p.y);
      }
    }
    // 연결이 없으면 중앙 근처 선호
    return c || Math.hypot(p.x - board.width / 2, p.y - board.height / 2) * 0.1;
  };

  for (const part of toPlace) {
    let best: Part | null = null;
    let bestCost = Infinity;
    for (const rot of [0, 90]) {
      for (let y = margin; y <= board.height - margin; y += GRID * 2) {
        for (let x = margin; x <= board.width - margin; x += GRID * 2) {
          const cand = { ...part, x: snap(x), y: snap(y), rot };
          if (overlaps(cand)) continue;
          const c = cost(cand) + (rot ? 0.5 : 0);
          if (c < bestCost) { bestCost = c; best = cand; }
        }
      }
    }
    // 자리가 없으면 보드 밖 오른쪽에 둔다 (사용자가 보드를 키우도록 DRC가 알려줌)
    placed.push(best ?? { ...part, x: snap(board.width + 10), y: snap(margin + placed.length * 6) });
  }
  const order = new Map(project.parts.map((p, i) => [p.ref, i]));
  placed.sort((a, b) => order.get(a.ref)! - order.get(b.ref)!);
  return { ...project, parts: placed };
}

/** 부품들이 들어가도록 보드 크기 추천 */
export function suggestBoardSize(parts: Part[]): { width: number; height: number } {
  const area = parts.reduce((s, p) => {
    const b = partBox(p);
    return s + (b.x2 - b.x1 + 4) * (b.y2 - b.y1 + 4);
  }, 0);
  const side = Math.max(30, Math.ceil(Math.sqrt(area * 2.2) / 5) * 5);
  let maxW = 0, maxH = 0;
  for (const p of parts) {
    const b = partBox(p);
    maxW = Math.max(maxW, b.x2 - b.x1);
    maxH = Math.max(maxH, b.y2 - b.y1);
  }
  return { width: Math.max(side, Math.ceil((maxW + 10) / 5) * 5), height: Math.max(side, Math.ceil((Math.min(maxW, maxH) + 10) / 5) * 5) };
}
