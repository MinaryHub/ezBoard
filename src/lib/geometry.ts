import type { Net, Part, Project } from '../types';
import { partBox, resolvePin, type PlacedPad } from './library';
import { hitsHole, mountingHoles } from './features';

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
  const placedBoxes = placed.map(partBox);
  const toPlace = project.parts.filter((p) => !keep.has(p.ref));

  // 대소문자 구분 없이 부품 간 연결 인접 목록 사전 계산
  const adj = new Map<string, Set<string>>();
  for (const p of project.parts) adj.set(p.ref.toLowerCase(), new Set());
  for (const net of project.nets) {
    const refs = [...new Set(net.pins.map((x) => x.slice(0, x.lastIndexOf('.')).trim().toLowerCase()).filter((r) => adj.has(r)))];
    for (const r of refs) for (const q of refs) if (r !== q) adj.get(r)!.add(q);
  }
  const areaOf = new Map(toPlace.map((p) => { const b = partBox(p); return [p.ref, (b.x2 - b.x1) * (b.y2 - b.y1)]; }));
  toPlace.sort((a, b) => (areaOf.get(b.ref)! - areaOf.get(a.ref)!) || ((adj.get(b.ref.toLowerCase())?.size ?? 0) - (adj.get(a.ref.toLowerCase())?.size ?? 0)));

  const holes = mountingHoles(project);
  const overlaps = (b: { x1: number; y1: number; x2: number; y2: number }) => {
    if (b.x1 < margin || b.y1 < margin || b.x2 > board.width - margin || b.y2 > board.height - margin) return true;
    if (hitsHole(holes, b, 0.5)) return true;
    for (let i = 0; i < placedBoxes.length; i++) {
      const c = placedBoxes[i];
      if (b.x1 < c.x2 + 1.5 && b.x2 > c.x1 - 1.5 && b.y1 < c.y2 + 1.5 && b.y2 > c.y1 - 1.5) return true;
    }
    return false;
  };

  let overflowY = margin;
  for (const part of toPlace) {
    const neighRefs = adj.get(part.ref.toLowerCase());
    const neighbors = neighRefs ? placed.filter((q) => neighRefs.has(q.ref.toLowerCase())) : [];
    const baseBox = partBox({ ...part, x: 0, y: 0, rot: 0 });
    const hw0 = (baseBox.x2 - baseBox.x1) / 2, hh0 = (baseBox.y2 - baseBox.y1) / 2;

    let best: Part | null = null;
    let bestCost = Infinity;
    for (const rot of [0, 90]) {
      const hw = rot === 90 ? hh0 : hw0;
      const hh = rot === 90 ? hw0 : hh0;
      const yMin = Math.max(margin, Math.ceil((margin + hh) / GRID) * GRID);
      const yMax = board.height - margin - hh;
      const xMin = Math.max(margin, Math.ceil((margin + hw) / GRID) * GRID);
      const xMax = board.width - margin - hw;
      for (let y = yMin; y <= yMax; y += GRID * 2) {
        const sy = snap(y);
        for (let x = xMin; x <= xMax; x += GRID * 2) {
          const sx = snap(x);
          const b = { x1: sx - hw, y1: sy - hh, x2: sx + hw, y2: sy + hh };
          if (overlaps(b)) continue;
          let c = 0;
          if (neighbors.length) {
            for (let k = 0; k < neighbors.length; k++) c += Math.hypot(neighbors[k].x - sx, neighbors[k].y - sy);
          } else {
            c = Math.hypot(sx - board.width / 2, sy - board.height / 2) * 0.1;
          }
          c += rot ? 0.5 : 0;
          if (c < bestCost) { bestCost = c; best = { ...part, x: sx, y: sy, rot }; }
        }
      }
    }
    // 자리가 없으면 보드 밖 오른쪽에 겹치지 않게 둔다 (사용자가 보드를 키우도록 DRC가 알려줌)
    const chosen = best ?? { ...part, x: snap(board.width + 10 + hw0), y: snap(overflowY + hh0), rot: 0 };
    if (!best) overflowY += hh0 * 2 + 3;
    placed.push(chosen);
    placedBoxes.push(partBox(chosen));
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
  return {
    width: Math.max(side, Math.ceil((maxW + 10) / 5) * 5),
    height: Math.max(side, Math.ceil((maxH + 10) / 5) * 5),
  };
}
