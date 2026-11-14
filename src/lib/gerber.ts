// 거버(RS-274X) + 엑셀론 드릴 + BOM 생성. JLCPCB, PCBWay 등에 그대로 업로드 가능
import JSZip from 'jszip';
import type { Project } from '../types';
import { getDef, partBox, placedPads, rotatePoint, type PlacedPad } from './library';
import { textStrokes, textWidth } from './font';
import { VIA_D, VIA_DRILL } from './router';
import { t } from '../i18n';
import { partName } from './library.i18n';

const SILK_W = 0.15;
const MASK_EXP = 0.1;

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
  circle(x: number, y: number, r: number, width: number) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 36; i++) pts.push([x + r * Math.cos((i / 36) * Math.PI * 2), y + r * Math.sin((i / 36) * Math.PI * 2)]);
    this.polyline(pts, width);
  }
  toString(fileFunction: string) {
    const head = [
      `%TF.GenerationSoftware,ezBoard,AI PCB,1.0*%`,
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
    const lp = refLabelPos(project, part.ref);
    for (const st of textStrokes(part.ref, lp.x, lp.y, lp.h)) g.polyline(st, SILK_W);
  }
  // 보드 이름
  const name = project.name.replace(/[^A-Za-z0-9 _.\-+/]/g, '').slice(0, 24) || 'EZBOARD';
  const nh = 1.2;
  for (const st of textStrokes(name, 1.2, project.board.height - nh - 0.8, nh)) g.polyline(st, SILK_W);
}

/** 참조 이름(R1 등) 글자 위치. 화면 표시와 거버가 같은 위치를 쓴다 */
export function refLabelPos(project: Project, ref: string) {
  const part = project.parts.find((p) => p.ref === ref)!;
  const b = partBox(part);
  const h = 1.0;
  const w = textWidth(ref, h);
  let y = b.y1 - h - 0.3;
  if (y < 0.5) y = b.y2 + 0.3;
  return { x: part.x - w / 2, y, h, w };
}

export function buildGerbers(project: Project): Record<string, string> {
  const H = project.board.height;
  const mk = (name: string) => { const g = new Gerber(name); g.h = H; return g; };
  const pads = project.parts.flatMap(placedPads);

  const files: Record<string, string> = {};
  for (const side of ['top', 'bottom'] as const) {
    const cu = mk(`${side} copper`);
    for (const p of pads) cu.flashPad(p);
    for (const t of project.tracks.filter((t) => t.layer === side)) cu.polyline(t.points, t.width);
    for (const v of project.vias) cu.flashCircle(v.x, v.y, VIA_D);
    files[side === 'top' ? 'ezboard-F_Cu.gtl' : 'ezboard-B_Cu.gbl'] = cu.toString(side === 'top' ? 'Copper,L1,Top' : 'Copper,L2,Bot');

    const mask = mk(`${side} mask`);
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
  return files;
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
  const tools = [...holes.keys()].sort();
  const out = ['M48', '; DRILL file generated by ezBoard', 'FMAT,2', 'METRIC,TZ'];
  tools.forEach((d, i) => out.push(`T${i + 1}C${d}`));
  out.push('%', 'G90', 'G05');
  tools.forEach((d, i) => {
    out.push(`T${i + 1}`);
    for (const [x, y] of holes.get(d)!) out.push(`X${x.toFixed(3)}Y${y.toFixed(3)}`);
  });
  out.push('T0', 'M30', '');
  return out.join('\n');
}

export function buildBom(project: Project): string {
  const groups = new Map<string, { refs: string[]; name: string; value: string; fp: string }>();
  for (const p of project.parts) {
    const def = getDef(p.type);
    const key = `${p.type}|${p.value}`;
    if (!groups.has(key)) groups.set(key, { refs: [], name: def ? partName(def) : p.type, value: p.value, fp: def?.footprint.name ?? '' });
    groups.get(key)!.refs.push(p.ref);
  }
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = [[t('bom.no'), t('bom.part'), t('bom.value'), t('bom.qty'), t('bom.refs'), t('bom.fp')].map(esc).join(',')];
  let i = 1;
  for (const g of groups.values()) rows.push([String(i++), g.name, g.value, String(g.refs.length), g.refs.join(' '), g.fp].map(esc).join(','));
  return '﻿' + rows.join('\n') + '\n';
}

export async function buildZip(project: Project): Promise<Blob> {
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
  const zip = new JSZip();
  for (const [name, content] of Object.entries(buildGerbers(project))) zip.file(name, content);
  return zip.generateAsync({ type: 'blob' });
}
