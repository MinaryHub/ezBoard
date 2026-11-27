// KiCad 8 (.kicad_pcb) S-expression 보드 파일 내보내기
// KiCad 8 PCB Editor에서 바로 열어 수동 수정·3D 보기·고급 DRC를 이어갈 수 있다.
import type { Project } from '../types';
import { getDef, resolvePin } from './library';
import { VIA_D, VIA_DRILL } from './router';
import { HOLE_D, POUR_CLEAR, POUR_EDGE, SPOKE_W, keepoutRects, mountingHoles, pourNet } from './features';

const GEN_VER = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0';

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ');
}

function f(n: number): string {
  return Number.isInteger(n) ? String(n) : Number(n.toFixed(4)).toString();
}

function mkUuid(): () => string {
  let seq = 1;
  return () => {
    const hex = (seq++).toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  };
}

/** ezBoard 프로젝트를 KiCad 8 호환 .kicad_pcb 문자열로 변환 */
export function exportKicadPcb(project: Project): string {
  const uuid = mkUuid();
  const { width: w, height: h } = project.board;

  // 넷 번호 매핑 (0은 미연결 예약)
  const netIndex = new Map<string, number>();
  const netNames: string[] = [''];
  for (const n of project.nets) {
    if (!netIndex.has(n.name)) {
      netIndex.set(n.name, netNames.length);
      netNames.push(n.name);
    }
  }
  const padNet = new Map<string, string>();
  for (const n of project.nets) {
    for (const pin of n.pins) {
      for (const pad of resolvePin(project.parts, pin)) {
        padNet.set(`${pad.ref}#${pad.num}`, n.name);
      }
    }
  }

  const lines: string[] = [];
  lines.push(`(kicad_pcb`);
  lines.push(`  (version 20240108)`);
  lines.push(`  (generator "ezboard")`);
  lines.push(`  (generator_version "${esc(GEN_VER)}")`);
  lines.push(`  (general`);
  lines.push(`    (thickness 1.6)`);
  lines.push(`    (legacy_teardrops no)`);
  lines.push(`  )`);
  lines.push(`  (paper "A4")`);
  lines.push(`  (title_block`);
  lines.push(`    (title "${esc(project.name)}")`);
  lines.push(`  )`);
  lines.push(`  (layers`);
  lines.push(`    (0 "F.Cu" signal)`);
  lines.push(`    (31 "B.Cu" signal)`);
  lines.push(`    (36 "B.SilkS" user "B.Silkscreen")`);
  lines.push(`    (37 "F.SilkS" user "F.Silkscreen")`);
  lines.push(`    (38 "B.Mask" user)`);
  lines.push(`    (39 "F.Mask" user)`);
  lines.push(`    (44 "Edge.Cuts" user)`);
  lines.push(`    (46 "F.CrtYd" user "F.Courtyard")`);
  lines.push(`    (49 "F.Fab" user)`);
  lines.push(`  )`);
  lines.push(`  (setup`);
  lines.push(`    (pad_to_mask_clearance 0.1)`);
  lines.push(`    (allow_soldermask_bridges_in_footprints no)`);
  lines.push(`  )`);

  for (let i = 0; i < netNames.length; i++) {
    lines.push(`  (net ${i} "${esc(netNames[i])}")`);
  }

  // 보드 외곽선 (Edge.Cuts)
  lines.push(`  (gr_rect (start 0 0) (end ${f(w)} ${f(h)})`);
  lines.push(`    (stroke (width 0.1) (type solid)) (fill none) (layer "Edge.Cuts") (uuid "${uuid()}")`);
  lines.push(`  )`);

  // 고정 나사 구멍 (M3 NPTH)
  for (const [hx, hy] of mountingHoles(project)) {
    lines.push(`  (footprint "MountingHole:MountingHole_3.2mm_M3"`);
    lines.push(`    (layer "F.Cu")`);
    lines.push(`    (uuid "${uuid()}")`);
    lines.push(`    (at ${f(hx)} ${f(hy)})`);
    lines.push(`    (pad "" np_thru_hole circle (at 0 0) (size ${f(HOLE_D)} ${f(HOLE_D)}) (drill ${f(HOLE_D)}) (layers "*.Cu" "*.Mask") (uuid "${uuid()}"))`);
    lines.push(`  )`);
  }

  // 부품 풋프린트
  for (const part of project.parts) {
    const def = getDef(part.type);
    if (!def) continue;
    const fp = def.footprint;
    // ezBoard rotatePoint는 화면 좌표계(Y 아래) 기준 시계 방향(+), KiCad 풋프린트 각도는 반시계 방향(+)
    const kicadRot = (360 - ((part.rot % 360) + 360) % 360) % 360;
    const atStr = kicadRot ? `${f(part.x)} ${f(part.y)} ${kicadRot}` : `${f(part.x)} ${f(part.y)}`;
    lines.push(`  (footprint "ezBoard:${esc(fp.name)}"`);
    lines.push(`    (layer "F.Cu")`);
    lines.push(`    (uuid "${uuid()}")`);
    lines.push(`    (at ${atStr})`);
    lines.push(`    (property "Reference" "${esc(part.ref)}" (at 0 ${f(-fp.h / 2 - 1.0)}) (layer "F.SilkS") (uuid "${uuid()}") (effects (font (size 1 1) (thickness 0.15))))`);
    lines.push(`    (property "Value" "${esc(part.value || def.type)}" (at 0 ${f(fp.h / 2 + 1.0)}) (layer "F.Fab") (uuid "${uuid()}") (effects (font (size 1 1) (thickness 0.15))))`);

    // 실크스크린 도형
    for (const s of fp.silk) {
      if (s.kind === 'line') {
        lines.push(`    (fp_line (start ${f(s.x1)} ${f(s.y1)}) (end ${f(s.x2)} ${f(s.y2)}) (stroke (width 0.15) (type solid)) (layer "F.SilkS") (uuid "${uuid()}"))`);
      } else {
        lines.push(`    (fp_circle (center ${f(s.x)} ${f(s.y)}) (end ${f(s.x + s.r)} ${f(s.y)}) (stroke (width 0.15) (type solid)) (fill none) (layer "F.SilkS") (uuid "${uuid()}"))`);
      }
    }

    // 코트야드 외곽선
    const cw = fp.w / 2, ch = fp.h / 2;
    lines.push(`    (fp_rect (start ${f(-cw)} ${f(-ch)}) (end ${f(cw)} ${f(ch)}) (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd") (uuid "${uuid()}"))`);

    // 패드
    for (const pad of fp.pads) {
      const nName = padNet.get(`${part.ref}#${pad.num}`) ?? '';
      const nId = netIndex.get(nName) ?? 0;
      const shape = pad.shape === 'rect' ? 'rect' : pad.shape === 'oval' ? 'oval' : 'circle';
      const padType = pad.drill > 0 ? 'thru_hole' : 'smd';
      const layers = pad.drill > 0 ? '"*.Cu" "*.Mask"' : '"F.Cu" "F.Paste" "F.Mask"';
      const drillPart = pad.drill > 0 ? ` (drill ${f(pad.drill)})` : '';
      const netPart = nId ? ` (net ${nId} "${esc(nName)}")` : '';
      const padAt = kicadRot ? `${f(pad.x)} ${f(pad.y)} ${kicadRot}` : `${f(pad.x)} ${f(pad.y)}`;
      lines.push(`    (pad "${pad.num}" ${padType} ${shape} (at ${padAt}) (size ${f(pad.w)} ${f(pad.h)})${drillPart} (layers ${layers})${netPart} (pinfunction "${esc(pad.pin)}") (uuid "${uuid()}"))`);
    }
    lines.push(`  )`);
  }

  // 배선 세그먼트
  for (const tr of project.tracks) {
    const nId = netIndex.get(tr.net) ?? 0;
    const layer = tr.layer === 'top' ? 'F.Cu' : 'B.Cu';
    for (let i = 1; i < tr.points.length; i++) {
      const [x1, y1] = tr.points[i - 1];
      const [x2, y2] = tr.points[i];
      if (Math.hypot(x2 - x1, y2 - y1) < 1e-4) continue;
      lines.push(`  (segment (start ${f(x1)} ${f(y1)}) (end ${f(x2)} ${f(y2)}) (width ${f(tr.width)}) (layer "${layer}") (net ${nId}) (uuid "${uuid()}"))`);
    }
  }

  // 비아
  for (const v of project.vias) {
    const nId = netIndex.get(v.net) ?? 0;
    lines.push(`  (via (at ${f(v.x)} ${f(v.y)}) (size ${f(VIA_D)}) (drill ${f(VIA_DRILL)}) (layers "F.Cu" "B.Cu") (net ${nId}) (uuid "${uuid()}"))`);
  }

  // 안테나 금지 구역 (Rule Area / Keepout)
  for (const k of keepoutRects(project)) {
    lines.push(`  (zone (net 0) (net_name "") (layers "F.Cu" "B.Cu") (uuid "${uuid()}")`);
    lines.push(`    (name "${esc(k.ref)}_${esc(k.reason)}_keepout")`);
    lines.push(`    (hatch edge 0.5)`);
    lines.push(`    (keepout (tracks not_allowed) (vias not_allowed) (pads allowed) (copperpour not_allowed) (footprints allowed))`);
    lines.push(`    (polygon (pts (xy ${f(k.x1)} ${f(k.y1)}) (xy ${f(k.x2)} ${f(k.y1)}) (xy ${f(k.x2)} ${f(k.y2)}) (xy ${f(k.x1)} ${f(k.y2)})))`);
    lines.push(`  )`);
  }

  // GND 구리 채우기 존
  const gnd = pourNet(project);
  if (gnd && w > POUR_EDGE * 2 && h > POUR_EDGE * 2) {
    const gndId = netIndex.get(gnd) ?? 0;
    const e = POUR_EDGE;
    for (const layer of ['F.Cu', 'B.Cu'] as const) {
      lines.push(`  (zone (net ${gndId}) (net_name "${esc(gnd)}") (layer "${layer}") (uuid "${uuid()}")`);
      lines.push(`    (hatch edge 0.5)`);
      lines.push(`    (connect_pads (clearance ${f(POUR_CLEAR)}))`);
      lines.push(`    (min_thickness 0.25)`);
      lines.push(`    (fill (thermal_gap ${f(POUR_CLEAR)}) (thermal_bridge_width ${f(SPOKE_W)}))`);
      lines.push(`    (polygon (pts (xy ${f(e)} ${f(e)}) (xy ${f(w - e)} ${f(e)}) (xy ${f(w - e)} ${f(h - e)}) (xy ${f(e)} ${f(h - e)})))`);
      lines.push(`  )`);
    }
  }

  lines.push(`)`);
  lines.push('');
  return lines.join('\n');
}
