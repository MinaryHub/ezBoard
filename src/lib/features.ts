// 보드 부가 기능: GND 구리 채우기, 고정 나사 구멍.
// 화면(PcbCanvas), 거버, 배선기, 배치, 검사가 모두 같은 값을 쓴다.
import type { Project } from '../types';
import type { PlacedPad } from './library';

/** 채우기와 다른 넷 구리 사이 간격. 손납땜에서 납이 번지지 않도록 넉넉히 */
export const POUR_CLEAR = 0.5;
/** 보드 가장자리에서 채우기를 띄우는 거리 */
export const POUR_EDGE = 0.8;
/** GND 패드와 채우기를 잇는 열 차단(thermal) 다리 굵기 */
export const SPOKE_W = 0.5;

/** M3 나사 구멍 */
export const HOLE_D = 3.2;
/** 구멍 가장자리에서 보드 끝까지 */
export const HOLE_INSET = 3.5;
/** 나사 머리와 와셔가 닿는 범위: 이 안에는 구리와 부품을 두지 않는다 */
export const HOLE_KEEP = 3.2;
/** 구멍을 넣을 수 있는 가장 작은 보드 변 */
export const HOLE_MIN_BOARD = 25;

// schematic.ts의 netKind와 같은 규칙 (서로 import하면 순환이 생겨 따로 둔다)
const GND_RE = /^(?:gnd|0v|vss|ground|agnd|dgnd)\d*$/i;

/** 채우기에 쓸 그라운드 넷 이름 (없으면 undefined) */
export function pourNet(project: Project): string | undefined {
  if (!project.pour) return undefined;
  const gnd = project.nets.filter((n) => GND_RE.test(n.name) && n.pins.length > 0);
  // GND가 여러 개면 핀이 가장 많은 것
  return gnd.sort((a, b) => b.pins.length - a.pins.length)[0]?.name;
}

/** 고정 나사 구멍 중심 좌표 (네 귀퉁이) */
export function mountingHoles(project: Project): [number, number][] {
  const { width: w, height: h } = project.board;
  if (!project.holes || w < HOLE_MIN_BOARD || h < HOLE_MIN_BOARD) return [];
  const c = HOLE_INSET + HOLE_D / 2;
  return [[c, c], [w - c, c], [w - c, h - c], [c, h - c]];
}

/** 사각 영역이 나사 구멍 금지 구역과 겹치는가 */
export function hitsHole(holes: [number, number][], b: { x1: number; y1: number; x2: number; y2: number }, extra = 0): boolean {
  const r = HOLE_KEEP + extra;
  return holes.some(([x, y]) => {
    const dx = Math.max(b.x1 - x, 0, x - b.x2);
    const dy = Math.max(b.y1 - y, 0, y - b.y2);
    return dx * dx + dy * dy < r * r;
  });
}

/** GND 패드를 채우기에 잇는 다리 4개 (패드 중심에서 바깥으로) */
export function thermalSpokes(p: PlacedPad): [[number, number], [number, number]][] {
  const rx = p.aw / 2 + POUR_CLEAR + 0.2, ry = p.ah / 2 + POUR_CLEAR + 0.2;
  return [
    [[p.ax - rx, p.ay], [p.ax + rx, p.ay]],
    [[p.ax, p.ay - ry], [p.ax, p.ay + ry]],
  ];
}
