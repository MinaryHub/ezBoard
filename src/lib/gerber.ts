// 거버(RS-274X) + 엑셀론 드릴 + BOM 생성. JLCPCB, PCBWay 등에 그대로 업로드 가능
import type { Part, Project } from '../types';
import { getDef, partBox, placedPads, resolvePin, rotatePoint, type PlacedPad } from './library';
import { textStrokes, textWidth } from './font';
import { VIA_D, VIA_DRILL } from './router';
import { HOLE_D, HOLE_KEEP, POUR_CLEAR, POUR_EDGE, SPOKE_W, keepoutRects, mountingHoles, pourNet, thermalSpokes } from './features';
import { t } from '../i18n';
import { partName } from './library.i18n';

const SILK_W = 0.15;
const MASK_EXP = 0.1;
const GEN_VER = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0';

class Gerber {
  private aps = new Map<string, number>();
  private body: string[] = [];
  private cur = '';
  private name: string;
  private polarity: string;
  constructor(name: string, polarity = 'Positive') {
    this.name = name;
    this.polarity = polarity;
  }
  h = 0;
  private ap(def: string): number {
    let d = this.aps.get(def);
    if (!d) { d = 10 + this.aps.size; this.aps.set(def, d); }
    return d;
  }
  private use(def: string) {
    const d = `D${this.ap(def)}`;
    if (d !== this.cur) { this.body.push(`${d}*`); this.cur = d; }
  }
  private c(v: number) { return Math.round(v * 1e6).toString(); }
  private xy(x: number, y: number) { return `X${this.c(x)}Y${this.c(this.h - y)}`; }

  flashPad(p: PlacedPad, exp = 0) {
    const w = p.aw + exp * 2, h = p.ah + exp * 2;
    const f = (n: number) => n.toFixed(4);
    if (p.shape === 'circle') this.use(`C,${f(w)}`);
    else if (p.shape === 'rect') this.use(`R,${f(w)}X${f(h)}`);
    else this.use(`O,${f(w)}X${f(h)}`);
    this.body.push(`${this.xy(p.ax, p.ay)}D03*`);
  }
  flashCircle(x: number, y: number, d: number) {
    this.use(`C,${d.toFixed(4)}`);
    this.body.push(`${this.xy(x, y)}D03*`);
  }
  polyline(pts: [number, number][], width: number) {
    if (pts.length < 2) return;
    this.use(`C,${width.toFixed(4)}`);
    this.body.push(`${this.xy(pts[0][0], pts[0][1])}D02*`);
    for (const p of pts.slice(1)) this.body.push(`${this.xy(p[0], p[1])}D01*`);
  }
  /** 채워진 다각형 (G36/G37 영역) */
  region(pts: [number, number][]) {
    this.body.push('G36*', `${this.xy(pts[0][0], pts[0][1])}D02*`);
    for (const p of pts.slice(1)) this.body.push(`${this.xy(p[0], p[1])}D01*`);
    this.body.push(`${this.xy(pts[0][0], pts[0][1])}D01*`, 'G37*');
  }
  /** 이후 그리는 것을 구리로(dark) 또는 지우기(clear) */
  setDark(dark: boolean) {
    this.body.push(dark ? '%LPD*%' : '%LPC*%');
  }
  circle(x: number, y: number, r: number, width: number) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 36; i++) pts.push([x + r * Math.cos((i / 36) * Math.PI * 2), y + r * Math.sin((i / 36) * Math.PI * 2)]);
    this.polyline(pts, width);
  }
  toString(fileFunction: string) {
    const head = [
      `%TF.GenerationSoftware,ezBoard,AI PCB,${GEN_VER}*%`,
      `%TF.FileFunction,${fileFunction}*%`,
      `%TF.FilePolarity,${this.polarity}*%`,
      '%FSLAX46Y46*%',
      '%MOMM*%',
      `G04 ${this.name}*`,
      '%LPD*%',
      ...[...this.aps.entries()].map(([def, d]) => `%ADD${d}${def}*%`),
    ];
    return [...head, 'G01*', ...this.body, 'M02*', ''].join('\n');
  }
}

export interface PinSilkLabel {
  text: string;
  x: number;
  y: number;
  h: number;
}

function boxHitsPads(x: number, y: number, w: number, h: number, pads: PlacedPad[], margin = 0.15): boolean {
  for (const p of pads) {
    if (x + w + margin > p.ax - p.aw / 2 && x - margin < p.ax + p.aw / 2 && y + h + margin > p.ay - p.ah / 2 && y - margin < p.ay + p.ah / 2) {
      return true;
    }
  }
  return false;
}

/** 커넥터·전원·극성 부품의 핀 이름 실크스크린 위치 계산 (패드와 겹치지 않게 바깥쪽에 배치) */
export function partPinSilkLabels(part: Part, board?: { width: number; height: number }): PinSilkLabel[] {
  const def = getDef(part.type);
  if (!def?.footprint.pinLabels) return [];
  const pads = placedPads(part);
  if (!pads.length) return [];

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pads) {
    if (p.ax < minX) minX = p.ax;
    if (p.ax > maxX) maxX = p.ax;
    if (p.ay < minY) minY = p.ay;
    if (p.ay > maxY) maxY = p.ay;
  }
  const singleRowH = maxY - minY < 0.5;
  const singleRowV = maxX - minX < 0.5;
  const out: PinSilkLabel[] = [];

  for (const p of pads) {
    const text = p.pin.replace(/[^A-Za-z0-9+\-._/]/g, '').slice(0, 4).toUpperCase();
    if (!text) continue;
    const h = text.length === 1 ? 0.78 : text.length >= 4 ? 0.56 : 0.66;
    const w = textWidth(text, h);
    const gap = 0.32;

    // 후보 위치 순서 (우선 방향 → 반대 방향)
    const candidates: [number, number][] = [];
    if (singleRowH) {
      candidates.push(
        [p.ax - w / 2, p.ay + p.ah / 2 + gap],
        [p.ax - w / 2, p.ay - p.ah / 2 - h - gap],
      );
    } else if (singleRowV) {
      candidates.push(
        [p.ax + p.aw / 2 + gap, p.ay - h / 2],
        [p.ax - p.aw / 2 - w - gap, p.ay - h / 2],
      );
    } else {
      const dx = p.ax - part.x, dy = p.ay - part.y;
      if (Math.abs(dx) >= Math.abs(dy)) {
        const right: [number, number] = [p.ax + p.aw / 2 + gap, p.ay - h / 2];
        const left: [number, number] = [p.ax - p.aw / 2 - w - gap, p.ay - h / 2];
        candidates.push(dx >= 0 ? right : left, dx >= 0 ? left : right);
      } else {
        const bot: [number, number] = [p.ax - w / 2, p.ay + p.ah / 2 + gap];
        const top: [number, number] = [p.ax - w / 2, p.ay - p.ah / 2 - h - gap];
        candidates.push(dy >= 0 ? bot : top, dy >= 0 ? top : bot);
      }
    }

    for (const [cx, cy] of candidates) {
      if (board && (cx < 0.25 || cy < 0.25 || cx + w > board.width - 0.25 || cy + h > board.height - 0.25)) continue;
      if (boxHitsPads(cx, cy, w, h, pads, 0.12)) continue;
      out.push({ text, x: cx, y: cy, h });
      break;
    }
  }
  return out;
}

function silkFor(project: Project, g: Gerber) {
  for (const part of project.parts) {
    const def = getDef(part.type);
    if (!def) continue;
    for (const s of def.footprint.silk) {
      if (s.kind === 'line') {
        const [x1, y1] = rotatePoint(s.x1, s.y1, part.rot);
        const [x2, y2] = rotatePoint(s.x2, s.y2, part.rot);
        g.polyline([[part.x + x1, part.y + y1], [part.x + x2, part.y + y2]], SILK_W);
      } else {
        const [cx, cy] = rotatePoint(s.x, s.y, part.rot);
        g.circle(part.x + cx, part.y + cy, s.r, SILK_W);
      }
    }
    const lp = refLabelPosForPart(part, project.board);
    for (const st of textStrokes(part.ref, lp.x, lp.y, lp.h)) g.polyline(st, SILK_W);
    for (const pl of partPinSilkLabels(part, project.board)) {
      for (const st of textStrokes(pl.text, pl.x, pl.y, pl.h)) g.polyline(st, SILK_W);
    }
  }
  // 보드 이름 (한글만 있어 공백이 남는 경우 'EZBOARD'로 폴백)
  const name = project.name.replace(/[^A-Za-z0-9 _.\-+/]/g, '').trim().slice(0, 24) || 'EZBOARD';
  const nh = 1.2;
  for (const st of textStrokes(name, 1.2, project.board.height - nh - 0.8, nh)) g.polyline(st, SILK_W);
}

/** 부품 객체만으로 참조 이름 위치 계산 (패드 침범 회피 포함) */
export function refLabelPosForPart(part: Part, board?: { width: number; height: number }) {
  const b = partBox(part);
  const h = 1.0;
  const w = textWidth(part.ref, h);
  const pads = placedPads(part);
  const clamp = (x: number, y: number) => {
    if (!board) return { x, y };
    return {
      x: Math.max(0.5, Math.min(Math.max(0.5, board.width - w - 0.5), x)),
      y: Math.max(0.5, Math.min(Math.max(0.5, board.height - h - 0.5), y)),
    };
  };
  const candidates: [number, number][] = [
    [part.x - w / 2, b.y1 - h - 0.3],
    [part.x - w / 2, b.y2 + 0.3],
    [b.x2 + 0.35, part.y - h / 2],
    [b.x1 - w - 0.35, part.y - h / 2],
  ];
  for (const [cx, cy] of candidates) {
    if (board && (cx < 0.4 || cy < 0.4 || cx + w > board.width - 0.4 || cy + h > board.height - 0.4)) continue;
    if (!boxHitsPads(cx, cy, w, h, pads, 0.15)) return { x: cx, y: cy, h, w };
  }
  const fb = clamp(part.x - w / 2, b.y1 - h - 0.3 < 0.5 ? b.y2 + 0.3 : b.y1 - h - 0.3);
  return { x: fb.x, y: fb.y, h, w };
}

/** 참조 이름(R1 등) 글자 위치. 화면 표시와 거버가 같은 위치를 쓴다 */
export function refLabelPos(project: Project, ref: string) {
  const part = project.parts.find((p) => p.ref === ref)!;
  return refLabelPosForPart(part, project.board);
}

export function buildGerbers(project: Project): Record<string, string> {
  const H = project.board.height;
  const mk = (name: string, polarity = 'Positive') => { const g = new Gerber(name, polarity); g.h = H; return g; };
  const pads = project.parts.flatMap(placedPads);

  const files: Record<string, string> = {};
  for (const side of ['top', 'bottom'] as const) {
    const cu = mk(`${side} copper`);
    pourInto(cu, project, side, pads);
    for (const p of pads) cu.flashPad(p);
    for (const tr of project.tracks.filter((tr) => tr.layer === side)) cu.polyline(tr.points, tr.width);
    for (const v of project.vias) cu.flashCircle(v.x, v.y, VIA_D);
    files[side === 'top' ? 'ezboard-F_Cu.gtl' : 'ezboard-B_Cu.gbl'] = cu.toString(side === 'top' ? 'Copper,L1,Top' : 'Copper,L2,Bot');

    // 솔더마스크 개구부는 Gerber X2 규격상 Negative 극성
    const mask = mk(`${side} mask`, 'Negative');
    for (const p of pads) mask.flashPad(p, MASK_EXP);
    files[side === 'top' ? 'ezboard-F_Mask.gts' : 'ezboard-B_Mask.gbs'] = mask.toString(side === 'top' ? 'Soldermask,Top' : 'Soldermask,Bot');
  }
  const silk = mk('top silkscreen');
  silkFor(project, silk);
  files['ezboard-F_Silkscreen.gto'] = silk.toString('Legend,Top');

  const edge = mk('board outline');
  const { width: w, height: h } = project.board;
  edge.polyline([[0, 0], [w, 0], [w, h], [0, h], [0, 0]], 0.1);
  files['ezboard-Edge_Cuts.gm1'] = edge.toString('Profile,NP');

  files['ezboard-PTH.drl'] = buildDrill(project, pads);
  const holes = mountingHoles(project);
  if (holes.length) files['ezboard-NPTH.drl'] = buildNpth(project, holes);
  return files;
}

/**
 * GND 구리 채우기: 보드 전체를 구리로 칠하고(dark), 다른 넷 구리 둘레·나사 구멍·안테나 킵아웃을 지운 뒤(clear),
 * GND 패드는 열 차단 다리로만 잇는다. 그 위에 원래 패드와 배선을 그린다.
 */
function pourInto(g: Gerber, project: Project, side: 'top' | 'bottom', pads: PlacedPad[]) {
  const gnd = pourNet(project);
  if (!gnd) return;
  const netOf = padNets(project);
  const isGnd = (p: PlacedPad) => netOf.get(`${p.ref}#${p.num}`) === gnd;
  const { width: w, height: h } = project.board;
  const e = POUR_EDGE;
  if (w <= e * 2 || h <= e * 2) return;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const keepouts = keepoutRects(project);
  const clearOthers = () => {
    for (const p of pads) if (!isGnd(p)) g.flashPad(p, POUR_CLEAR);
    for (const tr of project.tracks) if (tr.layer === side && tr.net !== gnd) g.polyline(tr.points, tr.width + POUR_CLEAR * 2);
    for (const v of project.vias) if (v.net !== gnd) g.flashCircle(v.x, v.y, VIA_D + POUR_CLEAR * 2);
    for (const [x, y] of mountingHoles(project)) g.flashCircle(x, y, HOLE_KEEP * 2);
    for (const k of keepouts) g.region([[k.x1, k.y1], [k.x2, k.y1], [k.x2, k.y2], [k.x1, k.y2]]);
  };
  g.region([[e, e], [w - e, e], [w - e, h - e], [e, h - e]]);
  g.setDark(false);
  clearOthers();
  for (const p of pads) if (isGnd(p)) g.flashPad(p, POUR_CLEAR);
  g.setDark(true);
  for (const p of pads) {
    if (!isGnd(p)) continue;
    for (const [a, b] of thermalSpokes(p)) {
      g.polyline(
        [[clamp(a[0], e, w - e), clamp(a[1], e, h - e)], [clamp(b[0], e, w - e), clamp(b[1], e, h - e)]],
        SPOKE_W,
      );
    }
  }
  // 다리가 다른 넷·킵아웃 가까이 뻗었으면 그 부분을 다시 지운다
  g.setDark(false);
  clearOthers();
  g.setDark(true);
}

/** 패드(부품#번호) → 넷 이름 */
function padNets(project: Project): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of project.nets) for (const pin of n.pins) for (const pad of resolvePin(project.parts, pin)) m.set(`${pad.ref}#${pad.num}`, n.name);
  return m;
}

/** 도금 없는 구멍(고정 나사) 드릴 파일 */
function buildNpth(project: Project, holes: [number, number][]): string {
  const H = project.board.height;
  const out = ['M48', '; NPTH (mounting holes) generated by ezBoard', 'FMAT,2', 'METRIC', `T1C${HOLE_D.toFixed(3)}`, '%', 'G90', 'G05', 'T1'];
  for (const [x, y] of holes) out.push(`X${x.toFixed(3)}Y${(H - y).toFixed(3)}`);
  out.push('T0', 'M30', '');
  return out.join('\n');
}

function buildDrill(project: Project, pads: PlacedPad[]): string {
  const H = project.board.height;
  const holes = new Map<string, [number, number][]>();
  const add = (d: number, x: number, y: number) => {
    const k = d.toFixed(3);
    if (!holes.has(k)) holes.set(k, []);
    holes.get(k)!.push([x, H - y]);
  };
  for (const p of pads) if (p.drill > 0) add(p.drill, p.ax, p.ay);
  for (const v of project.vias) add(VIA_DRILL, v.x, v.y);
  const tools = [...holes.keys()].sort((a, b) => Number(a) - Number(b));
  const out = ['M48', '; DRILL file generated by ezBoard', 'FMAT,2', 'METRIC'];
  tools.forEach((d, i) => out.push(`T${i + 1}C${d}`));
  out.push('%', 'G90', 'G05');
  tools.forEach((d, i) => {
    out.push(`T${i + 1}`);
    for (const [x, y] of holes.get(d)!) out.push(`X${x.toFixed(3)}Y${y.toFixed(3)}`);
  });
  out.push('T0', 'M30', '');
  return out.join('\n');
}

export interface BomItem {
  no: number;
  name: string;
  value: string;
  qty: number;
  refs: string;
  fp: string;
}

export function bomItems(project: Project): BomItem[] {
  const groups = new Map<string, { refs: string[]; name: string; value: string; fp: string }>();
  for (const p of project.parts) {
    const def = getDef(p.type);
    const key = `${p.type}|${p.value}`;
    if (!groups.has(key)) groups.set(key, { refs: [], name: def ? partName(def) : p.type, value: p.value, fp: def?.footprint.name ?? '' });
    groups.get(key)!.refs.push(p.ref);
  }
  let i = 1;
  return [...groups.values()].map((g) => ({ no: i++, name: g.name, value: g.value, qty: g.refs.length, refs: g.refs.join(' '), fp: g.fp }));
}

export function buildBom(project: Project): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = [[t('bom.no'), t('bom.part'), t('bom.value'), t('bom.qty'), t('bom.refs'), t('bom.fp')].map(esc).join(',')];
  for (const g of bomItems(project)) rows.push([String(g.no), g.name, g.value, String(g.qty), g.refs, g.fp].map(esc).join(','));
  return '\uFEFF' + rows.join('\n') + '\n';
}

export async function buildZip(project: Project): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const gerbers = buildGerbers(project);
  const folder = zip.folder('gerber')!;
  for (const [name, content] of Object.entries(gerbers)) folder.file(name, content);
  zip.file('BOM.csv', buildBom(project));
  zip.file('project.ezboard.json', JSON.stringify(project, null, 2));
  const { width: bw, height: bh } = project.board;
  zip.file('README.txt', [
    'ezBoard 주문 파일 / ezBoard order files',
    '',
    '[한국어]',
    '1. gerber 폴더를 압축(zip)해서 JLCPCB / PCBWay 등 PCB 제작 사이트에 업로드하세요.',
    `2. 보드 크기: ${bw} x ${bh} mm, 2층, 두께 1.6mm 권장`,
    '3. BOM.csv 는 필요한 부품 목록입니다. 부품을 구매할 때 참고하세요.',
    '',
    '[English]',
    '1. Zip the gerber folder and upload it to a PCB maker such as JLCPCB or PCBWay.',
    `2. Board size: ${bw} x ${bh} mm, 2 layers, 1.6 mm thickness recommended`,
    '3. BOM.csv lists the parts you need to buy.',
    '',
  ].join('\n'));
  return zip.generateAsync({ type: 'blob' });
}

export async function buildGerberOnlyZip(project: Project): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const [name, content] of Object.entries(buildGerbers(project))) zip.file(name, content);
  return zip.generateAsync({ type: 'blob' });
}
