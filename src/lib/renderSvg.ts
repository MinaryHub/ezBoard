// 순수 문자열 기반 SVG 렌더러 (브라우저 1:1 실寸 인쇄·다운로드 + Node MCP 서버 공용)
import type { Project } from '../types';
import { getDef, placedPads, resolvePin, rotatePoint } from './library';
import { textStrokes } from './font';
import { partPinSilkLabels, refLabelPosForPart } from './gerber';
import { HOLE_D, HOLE_KEEP, POUR_CLEAR, POUR_EDGE, SPOKE_W, keepoutRects, mountingHoles, pourNet, thermalSpokes } from './features';
import { VIA_D, VIA_DRILL } from './router';
import { absPins, labelPlacement, layoutSchematic, routeSchematic } from './schematic';
import { symbolFor, type Dir } from './symbols';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number) => Number(n.toFixed(3)).toString();

function strokePolylines(strokes: [number, number][][], color: string, width = 0.15): string {
  return strokes
    .map((st) => `<polyline points="${st.map((p) => `${f(p[0])},${f(p[1])}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join('');
}

/**
 * 1:1 실寸(mm) 검증용 SVG 생성
 * 실제 mm 치수 + 10mm/50mm 교정 눈금자 + 드릴 중심 십자선 + 실크스크린 + 안테나 킵아웃 포함
 */
export function renderTrueScaleSvg(project: Project): string {
  const { width: bw, height: bh } = project.board;
  const padL = 10, padT = 12, padR = 10, padB = 18;
  const rulerLen = Math.min(50, Math.max(20, Math.floor(bw / 10) * 10));
  const totalW = Math.max(bw + padL + padR, rulerLen + padL + padR + 24);
  const totalH = bh + padT + padB;

  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${f(totalW)}mm" height="${f(totalH)}mm" viewBox="0 0 ${f(totalW)} ${f(totalH)}">`);
  out.push(`<style>text{font-family:ui-monospace,Menlo,Consolas,monospace;fill:#111;}</style>`);
  out.push(`<rect x="0" y="0" width="${f(totalW)}" height="${f(totalH)}" fill="#ffffff"/>`);

  // 상단 제목 및 치수
  out.push(`<text x="${padL}" y="6.2" font-size="3.2" font-weight="700">${esc(project.name)} — ${f(bw)} x ${f(bh)} mm (1:1 TRUE SCALE)</text>`);
  out.push(`<text x="${padL}" y="9.8" font-size="2.1" fill="#444">Print at 100% scale (no fit-to-page). Verify ruler below before ordering.</text>`);

  // 보드 좌표계 그룹
  out.push(`<g transform="translate(${padL} ${padT})">`);
  out.push(`<rect x="0" y="0" width="${f(bw)}" height="${f(bh)}" fill="#fafafa" stroke="#111" stroke-width="0.25"/>`);

  // 안테나 금지 구역
  for (const k of keepoutRects(project)) {
    out.push(`<rect x="${f(k.x1)}" y="${f(k.y1)}" width="${f(k.x2 - k.x1)}" height="${f(k.y2 - k.y1)}" fill="#ffe8cc" fill-opacity="0.55" stroke="#d97706" stroke-width="0.2" stroke-dasharray="1 0.8"/>`);
    out.push(`<text x="${f((k.x1 + k.x2) / 2)}" y="${f((k.y1 + k.y2) / 2)}" font-size="2.0" text-anchor="middle" dominant-baseline="middle" fill="#92400e">ANTENNA KEEPOUT</text>`);
  }

  // 마운팅 홀
  for (const [hx, hy] of mountingHoles(project)) {
    out.push(`<circle cx="${f(hx)}" cy="${f(hy)}" r="${f(HOLE_D / 2)}" fill="#fff" stroke="#111" stroke-width="0.22"/>`);
    out.push(`<line x1="${f(hx - 2.2)}" y1="${f(hy)}" x2="${f(hx + 2.2)}" y2="${f(hy)}" stroke="#666" stroke-width="0.12"/>`);
    out.push(`<line x1="${f(hx)}" y1="${f(hy - 2.2)}" x2="${f(hx)}" y2="${f(hy + 2.2)}" stroke="#666" stroke-width="0.12"/>`);
  }

  // 옅은 배선 참고선
  for (const tr of project.tracks) {
    const pts = tr.points.map((p) => `${f(p[0])},${f(p[1])}`).join(' ');
    const col = tr.layer === 'top' ? '#d9483b' : '#3b7dd9';
    out.push(`<polyline points="${pts}" fill="none" stroke="${col}" stroke-opacity="0.28" stroke-width="${f(tr.width)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }

  // 부품 실크스크린 + 참조명 + 커넥터 핀 라벨
  for (const part of project.parts) {
    const def = getDef(part.type);
    if (!def) continue;
    for (const s of def.footprint.silk) {
      if (s.kind === 'line') {
        const [x1, y1] = rotatePoint(s.x1, s.y1, part.rot);
        const [x2, y2] = rotatePoint(s.x2, s.y2, part.rot);
        out.push(`<line x1="${f(part.x + x1)}" y1="${f(part.y + y1)}" x2="${f(part.x + x2)}" y2="${f(part.y + y2)}" stroke="#111" stroke-width="0.2" stroke-linecap="round"/>`);
      } else {
        const [cx, cy] = rotatePoint(s.x, s.y, part.rot);
        out.push(`<circle cx="${f(part.x + cx)}" cy="${f(part.y + cy)}" r="${f(s.r)}" fill="none" stroke="#111" stroke-width="0.2"/>`);
      }
    }
    const lp = refLabelPosForPart(part, project.board);
    out.push(strokePolylines(textStrokes(part.ref, lp.x, lp.y, lp.h), '#111', 0.18));
    for (const pl of partPinSilkLabels(part, project.board)) {
      out.push(strokePolylines(textStrokes(pl.text, pl.x, pl.y, pl.h), '#333', 0.14));
    }
  }

  // 패드 외곽 + 드릴 구멍 + 중심 십자선
  for (const p of project.parts.flatMap(placedPads)) {
    if (p.shape === 'circle') {
      out.push(`<circle cx="${f(p.ax)}" cy="${f(p.ay)}" r="${f(p.aw / 2)}" fill="#ddd" stroke="#111" stroke-width="0.16"/>`);
    } else {
      const rx = p.shape === 'oval' ? Math.min(p.aw, p.ah) / 2 : 0.1;
      out.push(`<rect x="${f(p.ax - p.aw / 2)}" y="${f(p.ay - p.ah / 2)}" width="${f(p.aw)}" height="${f(p.ah)}" rx="${f(rx)}" fill="#ddd" stroke="#111" stroke-width="0.16"/>`);
    }
    if (p.drill > 0) {
      out.push(`<circle cx="${f(p.ax)}" cy="${f(p.ay)}" r="${f(p.drill / 2)}" fill="#fff" stroke="#111" stroke-width="0.12"/>`);
      const c = p.drill * 0.45;
      out.push(`<line x1="${f(p.ax - c)}" y1="${f(p.ay)}" x2="${f(p.ax + c)}" y2="${f(p.ay)}" stroke="#555" stroke-width="0.08"/>`);
      out.push(`<line x1="${f(p.ax)}" y1="${f(p.ay - c)}" x2="${f(p.ax)}" y2="${f(p.ay + c)}" stroke="#555" stroke-width="0.08"/>`);
    }
  }
  out.push(`</g>`);

  // 하단 1:1 교정 눈금자
  const ry = padT + bh + 6;
  out.push(`<g transform="translate(${padL} ${f(ry)})">`);
  out.push(`<line x1="0" y1="0" x2="${rulerLen}" y2="0" stroke="#111" stroke-width="0.25"/>`);
  for (let mm = 0; mm <= rulerLen; mm++) {
    const tick = mm % 10 === 0 ? 4.2 : mm % 5 === 0 ? 2.8 : 1.6;
    out.push(`<line x1="${mm}" y1="0" x2="${mm}" y2="${tick}" stroke="#111" stroke-width="${mm % 10 === 0 ? 0.25 : 0.14}"/>`);
    if (mm % 10 === 0) out.push(`<text x="${mm}" y="7.2" font-size="2.2" text-anchor="middle">${mm}</text>`);
  }
  out.push(`<text x="${rulerLen + 3}" y="3.2" font-size="2.4" font-weight="600">mm (1:1 ruler)</text>`);
  out.push(`</g>`);

  out.push(`</svg>`);
  return out.join('\n');
}

/** PCB 프리뷰 SVG (편집 보기 또는 실물 보기, Node MCP/브라우저 공용) */
export function renderPcbSvg(project: Project, opts?: { mode?: 'edit' | 'real'; side?: 'top' | 'bottom' }): string {
  const real = opts?.mode === 'real';
  const back = real && opts?.side === 'bottom';
  const { width: bw, height: bh } = project.board;
  const margin = 6;
  const vw = bw + margin * 2, vh = bh + margin * 2;
  const colors = real
    ? { bg: '#161b18', board: '#1d6b3c', edge: '#e8d9a8', top: '#2c8a50', bottom: '#2c8a50', pad: '#d9b44a', silk: '#f5f5f0', hole: '#111' }
    : { bg: '#0b1412', board: '#0d2b22', edge: '#e5c07b', top: '#d9483b', bottom: '#3b7dd9', pad: '#c8a24a', silk: '#e8e8e8', hole: '#0a0a0a' };

  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(vw * 10)}" height="${Math.round(vh * 10)}" viewBox="${-margin} ${-margin} ${f(vw)} ${f(vh)}">`);
  out.push(`<rect x="${-margin}" y="${-margin}" width="${f(vw)}" height="${f(vh)}" fill="${colors.bg}"/>`);
  const gXform = back ? ` transform="translate(${f(bw)} 0) scale(-1 1)"` : '';
  out.push(`<g${gXform}>`);
  out.push(`<rect x="0" y="0" width="${f(bw)}" height="${f(bh)}" rx="${real ? 1 : 0}" fill="${colors.board}" stroke="${colors.edge}" stroke-width="0.2"/>`);

  // GND 구리 채우기
  const gnd = pourNet(project);
  const layers: ('top' | 'bottom')[] = real ? [back ? 'bottom' : 'top'] : ['bottom', 'top'];
  const pads = project.parts.flatMap(placedPads);
  const holes = mountingHoles(project);
  const keepouts = keepoutRects(project);
  if (gnd && bw > POUR_EDGE * 2 && bh > POUR_EDGE * 2) {
    const padNet = new Map<string, string>();
    for (const n of project.nets) for (const pin of n.pins) for (const pad of resolvePin(project.parts, pin)) padNet.set(`${pad.ref}#${pad.num}`, n.name);
    const isGnd = (p: (typeof pads)[number]) => padNet.get(`${p.ref}#${p.num}`) === gnd;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    for (const side of layers) {
      const id = `pour-${side}`;
      out.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${f(bw)}" height="${f(bh)}">`);
      out.push(`<rect x="${POUR_EDGE}" y="${POUR_EDGE}" width="${f(bw - POUR_EDGE * 2)}" height="${f(bh - POUR_EDGE * 2)}" fill="white"/>`);
      for (const p of pads) {
        if (!isGnd(p)) continue;
        const pw = p.aw + POUR_CLEAR * 2, ph = p.ah + POUR_CLEAR * 2;
        if (p.shape === 'circle') out.push(`<circle cx="${f(p.ax)}" cy="${f(p.ay)}" r="${f(pw / 2)}" fill="black"/>`);
        else out.push(`<rect x="${f(p.ax - pw / 2)}" y="${f(p.ay - ph / 2)}" width="${f(pw)}" height="${f(ph)}" fill="black"/>`);
        for (const [a, b] of thermalSpokes(p)) {
          out.push(`<line x1="${f(clamp(a[0], POUR_EDGE, bw - POUR_EDGE))}" y1="${f(clamp(a[1], POUR_EDGE, bh - POUR_EDGE))}" x2="${f(clamp(b[0], POUR_EDGE, bw - POUR_EDGE))}" y2="${f(clamp(b[1], POUR_EDGE, bh - POUR_EDGE))}" stroke="white" stroke-width="${SPOKE_W}"/>`);
        }
      }
      for (const p of pads) {
        if (isGnd(p)) continue;
        const pw = p.aw + POUR_CLEAR * 2, ph = p.ah + POUR_CLEAR * 2;
        if (p.shape === 'circle') out.push(`<circle cx="${f(p.ax)}" cy="${f(p.ay)}" r="${f(pw / 2)}" fill="black"/>`);
        else out.push(`<rect x="${f(p.ax - pw / 2)}" y="${f(p.ay - ph / 2)}" width="${f(pw)}" height="${f(ph)}" fill="black"/>`);
      }
      for (const tr of project.tracks) {
        if (tr.layer !== side || tr.net === gnd) continue;
        out.push(`<polyline points="${tr.points.map((q) => `${f(q[0])},${f(q[1])}`).join(' ')}" fill="none" stroke="black" stroke-width="${f(tr.width + POUR_CLEAR * 2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
      }
      for (const v of project.vias) if (v.net !== gnd) out.push(`<circle cx="${f(v.x)}" cy="${f(v.y)}" r="${f(VIA_D / 2 + POUR_CLEAR)}" fill="black"/>`);
      for (const [hx, hy] of holes) out.push(`<circle cx="${f(hx)}" cy="${f(hy)}" r="${HOLE_KEEP}" fill="black"/>`);
      for (const k of keepouts) out.push(`<rect x="${f(k.x1)}" y="${f(k.y1)}" width="${f(k.x2 - k.x1)}" height="${f(k.y2 - k.y1)}" fill="black"/>`);
      out.push(`</mask>`);
      const op = real ? 0.6 : side === 'top' ? 0.26 : 0.22;
      out.push(`<rect x="0" y="0" width="${f(bw)}" height="${f(bh)}" fill="${real ? '#2f9a5a' : colors[side]}" fill-opacity="${op}" mask="url(#${id})"/>`);
    }
  }

  // 안테나 금지 구역 표시 (편집 모드)
  if (!real) {
    for (const k of keepouts) {
      out.push(`<rect x="${f(k.x1)}" y="${f(k.y1)}" width="${f(k.x2 - k.x1)}" height="${f(k.y2 - k.y1)}" fill="#f59e0b" fill-opacity="0.14" stroke="#f59e0b" stroke-width="0.2" stroke-dasharray="0.9 0.6"/>`);
    }
  }

  // 배선 & 비아 & 나사 구멍
  for (const side of layers) {
    for (const tr of project.tracks) {
      if (tr.layer !== side) continue;
      out.push(`<polyline points="${tr.points.map((p) => `${f(p[0])},${f(p[1])}`).join(' ')}" fill="none" stroke="${colors[side]}" stroke-width="${f(tr.width)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  }
  for (const v of project.vias) {
    out.push(`<circle cx="${f(v.x)}" cy="${f(v.y)}" r="${f(VIA_D / 2)}" fill="${real ? colors.top : '#bbb'}"/>`);
    out.push(`<circle cx="${f(v.x)}" cy="${f(v.y)}" r="${f(VIA_DRILL / 2)}" fill="${colors.hole}"/>`);
  }
  for (const [hx, hy] of holes) {
    out.push(`<circle cx="${f(hx)}" cy="${f(hy)}" r="${f(HOLE_D / 2)}" fill="${colors.hole}" stroke="${real ? '#cbb57a' : '#e5c07b'}" stroke-width="0.15"/>`);
  }

  // 실크스크린 (앞면)
  if (!back) {
    for (const part of project.parts) {
      const def = getDef(part.type);
      if (!def) continue;
      for (const s of def.footprint.silk) {
        if (s.kind === 'line') {
          const [x1, y1] = rotatePoint(s.x1, s.y1, part.rot);
          const [x2, y2] = rotatePoint(s.x2, s.y2, part.rot);
          out.push(`<line x1="${f(part.x + x1)}" y1="${f(part.y + y1)}" x2="${f(part.x + x2)}" y2="${f(part.y + y2)}" stroke="${colors.silk}" stroke-width="0.15" stroke-linecap="round"/>`);
        } else {
          const [cx, cy] = rotatePoint(s.x, s.y, part.rot);
          out.push(`<circle cx="${f(part.x + cx)}" cy="${f(part.y + cy)}" r="${f(s.r)}" fill="none" stroke="${colors.silk}" stroke-width="0.15"/>`);
        }
      }
      const lp = refLabelPosForPart(part, project.board);
      out.push(strokePolylines(textStrokes(part.ref, lp.x, lp.y, lp.h), colors.silk, 0.15));
      for (const pl of partPinSilkLabels(part, project.board)) {
        out.push(strokePolylines(textStrokes(pl.text, pl.x, pl.y, pl.h), colors.silk, 0.13));
      }
    }
  }

  // 패드
  for (const p of pads) {
    if (p.shape === 'circle') out.push(`<circle cx="${f(p.ax)}" cy="${f(p.ay)}" r="${f(p.aw / 2)}" fill="${colors.pad}"/>`);
    else out.push(`<rect x="${f(p.ax - p.aw / 2)}" y="${f(p.ay - p.ah / 2)}" width="${f(p.aw)}" height="${f(p.ah)}" rx="${f(p.shape === 'oval' ? Math.min(p.aw, p.ah) / 2 : 0.1)}" fill="${colors.pad}"/>`);
    if (p.drill > 0) out.push(`<circle cx="${f(p.ax)}" cy="${f(p.ay)}" r="${f(p.drill / 2)}" fill="${colors.hole}"/>`);
  }

  out.push(`</g>`);
  out.push(`<text x="${f(bw / 2)}" y="${f(bh + 3.6)}" fill="#8a8f98" font-family="ui-monospace,monospace" font-size="2.2" text-anchor="middle">${f(bw)} × ${f(bh)} mm</text>`);
  out.push(`</svg>`);
  return out.join('\n');
}

const DIRV: Record<Dir, [number, number]> = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] };

/** 회로도 프리뷰 SVG (Node MCP/브라우저 공용) */
export function renderSchematicSvg(project: Project): string {
  const pos = layoutSchematic(project.parts, project.nets, project.sch ?? {});
  const route = routeSchematic(project.parts, project.nets, pos);
  const pad = 4;
  const x1 = route.bounds.x1 - pad, y1 = route.bounds.y1 - pad;
  const w = Math.max(20, route.bounds.x2 - route.bounds.x1 + pad * 2);
  const h = Math.max(16, route.bounds.y2 - route.bounds.y1 + pad * 2);

  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * 20)}" height="${Math.round(h * 20)}" viewBox="${f(x1)} ${f(y1)} ${f(w)} ${f(h)}">`);
  out.push(`<style>text{font-family:ui-monospace,Menlo,monospace;}</style>`);
  out.push(`<rect x="${f(x1)}" y="${f(y1)}" width="${f(w)}" height="${f(h)}" fill="#11161d"/>`);

  // 신호 전선
  for (const wire of route.wires) {
    out.push(`<polyline points="${wire.points.map((p) => `${f(p[0])},${f(p[1])}`).join(' ')}" fill="none" stroke="#4cc9f0" stroke-width="0.16" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  for (const d of route.dots) {
    out.push(`<circle cx="${f(d.x)}" cy="${f(d.y)}" r="0.22" fill="#4cc9f0"/>`);
  }

  // 전원/GND 기호
  for (const pw of route.power) {
    const [dx, dy] = DIRV[pw.dir];
    const col = pw.kind === 'gnd' ? '#7fd1ae' : '#f4a261';
    const ex = pw.x + dx * 1.4, ey = pw.y + dy * 1.4;
    out.push(`<line x1="${f(pw.x)}" y1="${f(pw.y)}" x2="${f(ex)}" y2="${f(ey)}" stroke="${col}" stroke-width="0.16"/>`);
    if (pw.kind === 'gnd') {
      const px = -dy, py = dx;
      for (const [k, len] of [[0, 0.8], [0.4, 0.5], [0.8, 0.2]] as const) {
        const cx = ex + dx * k, cy = ey + dy * k;
        out.push(`<line x1="${f(cx - px * len)}" y1="${f(cy - py * len)}" x2="${f(cx + px * len)}" y2="${f(cy + py * len)}" stroke="${col}" stroke-width="0.16"/>`);
      }
    } else {
      out.push(`<circle cx="${f(ex)}" cy="${f(ey)}" r="0.28" fill="none" stroke="${col}" stroke-width="0.16"/>`);
      const tx = ex + dx * 0.6, ty = ey + dy * 0.6;
      const anc = pw.dir === 'l' ? 'end' : pw.dir === 'r' ? 'start' : 'middle';
      out.push(`<text x="${f(tx)}" y="${f(ty + (pw.dir === 'u' ? -0.2 : pw.dir === 'd' ? 0.7 : 0.25))}" fill="${col}" font-size="0.85" text-anchor="${anc}">${esc(pw.net)}</text>`);
    }
  }

  // 라벨
  for (const lb of route.labels) {
    const [dx, dy] = DIRV[lb.dir];
    const anc = lb.dir === 'l' ? 'end' : lb.dir === 'r' ? 'start' : 'middle';
    out.push(`<text x="${f(lb.x + dx * 0.5)}" y="${f(lb.y + dy * 0.5)}" fill="#ffd166" font-size="0.8" text-anchor="${anc}">${esc(lb.net)}</text>`);
  }

  // 부품 기호
  const emptyMap = new Map<string, string>();
  for (const part of project.parts) {
    const ps = pos[part.ref];
    if (!ps) continue;
    const sym = symbolFor(part.type);
    const xform = sym.rotatable
      ? `translate(${f(ps.x)} ${f(ps.y)}) rotate(${ps.rot})`
      : ps.rot === 180
        ? `translate(${f(ps.x)} ${f(ps.y)}) scale(-1 1)`
        : `translate(${f(ps.x)} ${f(ps.y)})`;
    out.push(`<g transform="${xform}">`);
    for (const sh of sym.shapes) {
      if (sh.k === 'path') {
        out.push(`<path d="${sh.d}" fill="${sh.fill ? '#e6edf3' : 'none'}" stroke="#e6edf3" stroke-width="0.16" stroke-linecap="round" stroke-linejoin="round"/>`);
      } else if (sh.k === 'circle') {
        out.push(`<circle cx="${f(sh.cx)}" cy="${f(sh.cy)}" r="${f(sh.r)}" fill="${sh.fill ? '#e6edf3' : 'none'}" stroke="#e6edf3" stroke-width="0.16"/>`);
      } else if (sh.k === 'rect') {
        out.push(`<rect x="${f(sh.x)}" y="${f(sh.y)}" width="${f(sh.w)}" height="${f(sh.h)}" fill="#1c2530" stroke="#e6edf3" stroke-width="0.16"/>`);
      } else if (sh.k === 'text') {
        const flip = !sym.rotatable && ps.rot === 180 ? ` transform="translate(${f(sh.x * 2)} 0) scale(-1 1)"` : '';
        out.push(`<text x="${f(sh.x)}" y="${f(sh.y)}" fill="#9fb0c4" font-size="${f(sh.size ?? 0.7)}" text-anchor="${sh.anchor ?? 'middle'}" dominant-baseline="middle"${flip}>${esc(sh.t)}</text>`);
      }
    }
    out.push(`</g>`);
    // 핀 끝점 점
    for (const ap of absPins(part, ps, emptyMap)) {
      out.push(`<circle cx="${f(ap.x)}" cy="${f(ap.y)}" r="0.12" fill="#8b949e"/>`);
    }
    const lp = labelPlacement(part, ps);
    out.push(`<text x="${f(lp.x)}" y="${f(lp.y1)}" fill="#f0f6fc" font-size="0.95" font-weight="600" text-anchor="${lp.anchor}">${esc(part.ref)}</text>`);
    if (part.value) out.push(`<text x="${f(lp.x)}" y="${f(lp.y2)}" fill="#8b949e" font-size="0.78" text-anchor="${lp.anchor}">${esc(part.value)}</text>`);
  }

  out.push(`</svg>`);
  return out.join('\n');
}
