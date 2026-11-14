import { EXAMPLES } from '../src/lib/examples';
import { circuitToParts } from '../src/lib/ai';
import { autoPlace } from '../src/lib/geometry';
import { autoRoute } from '../src/lib/router';
import { runDrc } from '../src/lib/drc';
import { buildGerbers } from '../src/lib/gerber';
import type { Project } from '../src/types';
for (const ex of EXAMPLES) {
  const { parts } = circuitToParts(ex.circuit, []);
  let p: Project = { name: ex.circuit.name!, board: ex.circuit.board!, parts, nets: ex.circuit.nets, tracks: [], vias: [] };
  p = autoPlace(p, new Set());
  const t = performance.now();
  const r = autoRoute(p);
  p = { ...p, tracks: r.tracks, vias: r.vias };
  console.log(ex.title, 'route ms', Math.round(performance.now() - t), 'tracks', r.tracks.length, 'vias', r.vias.length, 'failed', r.failed);
  for (const i of runDrc(p)) console.log('  ', i.level, i.message);
  const g = buildGerbers(p);
  console.log('  files', Object.keys(g).map(k => k + ':' + g[k].length).join(' '));
}
import { clearanceViolations } from '../src/lib/drc';
for (const ex of EXAMPLES) {
  const { parts } = circuitToParts(ex.circuit, []);
  let p: Project = { name: '', board: ex.circuit.board!, parts, nets: ex.circuit.nets, tracks: [], vias: [] };
  p = autoPlace(p, new Set());
  const r = autoRoute(p);
  p = { ...p, tracks: r.tracks, vias: r.vias };
  const v = clearanceViolations(p);
  console.log('CLEAR', ex.title, v.length, v.slice(0, 6).map(x => `${x.a}/${x.b}@${x.x.toFixed(2)},${x.y.toFixed(2)} gap ${x.gap.toFixed(3)}`));
}
