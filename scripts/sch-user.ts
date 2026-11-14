import { readFileSync } from 'node:fs';
import { layoutSchematic, routeSchematic } from '../src/lib/schematic';
import { EXAMPLES } from '../src/lib/examples';
import { circuitToParts } from '../src/lib/ai';
const cases: { name: string; parts: any[]; nets: any[] }[] = EXAMPLES.map(e => ({ name: e.title, parts: circuitToParts(e.circuit, []).parts, nets: e.circuit.nets }));
const f = process.argv[2];
if (f) { const u = JSON.parse(readFileSync(f, 'utf8')); cases.push({ name: 'user', parts: u.parts.map((p: any) => ({ ...p, x: 0, y: 0, rot: 0 })), nets: u.nets }); }
for (const c of cases) {
  let t = performance.now();
  const pos = layoutSchematic(c.parts, c.nets);
  const lt = performance.now() - t; t = performance.now();
  const r = routeSchematic(c.parts, c.nets, pos);
  let len = 0, bends = 0;
  for (const w of r.wires) { bends += w.points.length - 2; for (let i = 1; i < w.points.length; i++) len += Math.abs(w.points[i][0] - w.points[i-1][0]) + Math.abs(w.points[i][1] - w.points[i-1][1]); }
  console.log(c.name, `layout ${Math.round(lt)}ms route ${Math.round(performance.now() - t)}ms wires ${r.wires.length} failedLabels ${r.labels.length} len ${len} bends ${bends}`);
  if (c.name === 'user') console.log('  ', Object.entries(pos).map(([k, v]) => `${k}@${v.x},${v.y}r${v.rot}`).join(' '));
}
