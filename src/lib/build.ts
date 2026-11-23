// AI가 준 회로(JSON)를 보드로 만드는 순수 함수: 배치 → 배선 → 검사.
// 적용(store.applyCircuit)과 적용 전 점검(AI 자동 고침)이 같은 결과를 쓰도록 한 곳에 둔다.
import type { Project } from '../types';
import { circuitToParts, type AiCircuit } from './ai';
import { layoutSchematic } from './schematic';
import { autoPlace, suggestBoardSize } from './geometry';
import { autoRoute, type RouteResult } from './router';
import { netlistIssues, runDrc } from './drc';

/** 배선이 다 안 되면 보드를 이만큼까지 키워 본다 (대부분 업체에서 가장 싼 크기) */
const CHEAP_MAX = 100;
const BOARD_MAX = 200;

export function buildFromCircuit(base: Project, c: AiCircuit): { project: Project; route: RouteResult; grown: boolean } {
  const { parts, keep } = circuitToParts(c, base.parts);
  let board = base.board;
  const bw = Number(c.board?.width), bh = Number(c.board?.height);
  if (Number.isFinite(bw) && Number.isFinite(bh) && bw > 0 && bh > 0) {
    board = { width: Math.min(BOARD_MAX, Math.max(15, bw)), height: Math.min(BOARD_MAX, Math.max(15, bh)) };
  } else if (!keep.size) {
    board = suggestBoardSize(parts);
  }
  const oldSch = Object.fromEntries(Object.entries(base.sch ?? {}).filter(([ref]) => keep.has(ref)));
  const sch = layoutSchematic(parts, c.nets, oldSch);
  let p: Project = { ...base, name: c.name || base.name, board, parts, nets: c.nets, tracks: [], vias: [], sch };
  p = autoPlace(p, keep);
  // 보드에 다 안 들어가면 키워서 다시 배치 (최대 200mm)
  for (let i = 0; i < 4 && p.parts.some((x) => x.x > board.width || x.y > board.height || x.x < 0 || x.y < 0); i++) {
    const nb = { width: Math.min(BOARD_MAX, Math.round(board.width * 1.2)), height: Math.min(BOARD_MAX, Math.round(board.height * 1.2)) };
    if (nb.width === board.width && nb.height === board.height) break;
    board = nb;
    p = autoPlace({ ...p, board }, keep);
  }
  let r = autoRoute(p);
  // 배선이 막히면 보드를 조금씩 키워 다시 시도 (100mm 미만일 때만 100mm까지 확장, 기존 >100mm 보드는 축소하지 않음)
  let grown = false;
  for (let i = 0; i < 2 && r.failed.length; i++) {
    const nb = {
      width: p.board.width >= CHEAP_MAX ? p.board.width : Math.min(CHEAP_MAX, Math.round(p.board.width * 1.15)),
      height: p.board.height >= CHEAP_MAX ? p.board.height : Math.min(CHEAP_MAX, Math.round(p.board.height * 1.15)),
    };
    if (nb.width === p.board.width && nb.height === p.board.height) break;
    const q = autoPlace({ ...p, board: nb, tracks: [], vias: [] }, new Set());
    const r2 = autoRoute(q);
    if (r2.failed.length >= r.failed.length) break;
    p = q; r = r2; grown = true;
  }
  return { project: { ...p, tracks: r.tracks, vias: r.vias }, route: r, grown };
}

/** AI에게 돌려보내 고치게 할 회로 문제 (배치·배선 문제는 앱이 처리하므로 뺀다) */
const FIXABLE = new Set(['badPin', 'short', 'singlePin', 'unused', 'ledNoR', 'unknownType']);

export function circuitIssues(project: Project, problems: string[]): string[] {
  const drc = runDrc(project).filter((i) => FIXABLE.has(i.code)).map((i) => i.message);
  return [...new Set([...problems, ...drc])];
}

/** 배치·자동배선 없이 AI 초안의 넷리스트 문제만 고속 검사 */
export function circuitIssuesFromDraft(base: Project, c: AiCircuit, problems: string[]): string[] {
  const { parts } = circuitToParts(c, base.parts);
  const draft: Project = { ...base, parts, nets: c.nets, tracks: [], vias: [] };
  const drc = netlistIssues(draft).filter((i) => FIXABLE.has(i.code)).map((i) => i.message);
  return [...new Set([...problems, ...drc])];
}

/** 자동 고침 요청 글 (사용자에게는 보이지 않는다) */
export function fixRequest(issues: string[]): string {
  return [
    'ezBoard checked the circuit JSON you just gave and found these problems:',
    ...issues.map((i) => `- ${i}`),
    '',
    'Fix every problem and reply with the corrected FULL circuit in exactly one ```json block, using only part types and pin names from the library.',
    'Keep the refs of parts that do not change. Keep any explanation to one or two short sentences about what you changed.',
  ].join('\n');
}
