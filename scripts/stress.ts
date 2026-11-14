import { circuitToParts } from '../src/lib/ai';
import { autoPlace, suggestBoardSize } from '../src/lib/geometry';
import { autoRoute } from '../src/lib/router';
import { clearanceViolations, unroutedCount } from '../src/lib/drc';
import { buildGerbers } from '../src/lib/gerber';
import type { Project } from '../src/types';
const parts: any[] = [{ ref: 'A1', type: 'arduino_nano' }, { ref: 'U1', type: 'regulator_5v' }, { ref: 'J1', type: 'power_in' }, { ref: 'C1', type: 'capacitor_pol' }, { ref: 'C2', type: 'capacitor_pol' }, { ref: 'J2', type: 'header3' }, { ref: 'J3', type: 'header4' }];
const nets: any[] = [{ name: 'VIN', pins: ['J1.+', 'U1.IN', 'C1.+'] }, { name: '5V', pins: ['U1.OUT', 'C2.+', 'A1.5V', 'J2.2', 'J3.1'] }, { name: 'GND', pins: ['J1.-', 'U1.GND', 'C1.-', 'C2.-', 'A1.GND', 'J2.3', 'J3.4'] }, { name: 'SERVO', pins: ['A1.D9', 'J2.1'] }, { name: 'SDA', pins: ['A1.A4', 'J3.3'] }, { name: 'SCL', pins: ['A1.A5', 'J3.2'] }];
for (let i = 0; i < 6; i++) { parts.push({ ref: `R${i+1}`, type: 'resistor' }, { ref: `LED${i+1}`, type: 'led' }); nets.push({ name: `D${i+2}`, pins: [`A1.D${i+2}`, `R${i+1}.1`] }, { name: `L${i}`, pins: [`R${i+1}.2`, `LED${i+1}.A`] }); nets[2].pins.push(`LED${i+1}.K`); }
const c = { parts, nets };
const { parts: ps } = circuitToParts(c as any, []);
let p: Project = { name: 'stress', board: suggestBoardSize(ps), parts: ps, nets, tracks: [], vias: [] };
p = autoPlace(p, new Set());
console.log('board', p.board, 'offboard', p.parts.filter(x => x.x > p.board.width).length);
const t = performance.now(); const r = autoRoute(p); p = { ...p, tracks: r.tracks, vias: r.vias };
console.log('ms', Math.round(performance.now() - t), 'failed', r.failed.length, 'vias', r.vias.length, 'unrouted', unroutedCount(p), 'clear', clearanceViolations(p).length);
const g = buildGerbers(p); console.log(g['ezboard-F_Cu.gtl'].split('\n').slice(0, 14).join('\n')); console.log(g['ezboard-PTH.drl'].split('\n').slice(0, 10).join('\n'));
