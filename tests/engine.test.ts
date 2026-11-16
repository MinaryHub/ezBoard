// 엔진 테스트: 배치 → 배선 → 검사 → 거버. `npm test`로 실행한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../src/lib/examples';
import { buildFromCircuit, circuitIssues, fixRequest } from '../src/lib/build';
import { extractCircuit, type AiCircuit } from '../src/lib/ai';
import { clearanceViolations, runDrc, unroutedCount } from '../src/lib/drc';
import { buildGerbers } from '../src/lib/gerber';
import { mountingHoles, pourNet, hitsHole, HOLE_KEEP } from '../src/lib/features';
import { partBox } from '../src/lib/library';
import type { Project } from '../src/types';

const blank = (extra: Partial<Project> = {}): Project => ({ name: 't', board: { width: 50, height: 40 }, parts: [], nets: [], tracks: [], vias: [], ...extra });
const errors = (p: Project) => runDrc(p).filter((i) => i.level === 'error');

/** 아두이노 + 레귤레이터 + LED 6개 (부하 테스트) */
function stressCircuit(): AiCircuit {
  const parts: AiCircuit['parts'] = [{ ref: 'A1', type: 'arduino_nano' }, { ref: 'U1', type: 'regulator_5v' }, { ref: 'J1', type: 'power_in' }, { ref: 'C1', type: 'capacitor_pol' }, { ref: 'C2', type: 'capacitor_pol' }];
  const nets: AiCircuit['nets'] = [{ name: 'VIN', pins: ['J1.+', 'U1.IN', 'C1.+'] }, { name: '5V', pins: ['U1.OUT', 'C2.+', 'A1.5V'] }, { name: 'GND', pins: ['J1.-', 'U1.GND', 'C1.-', 'C2.-', 'A1.GND'] }];
  for (let i = 0; i < 6; i++) {
    parts.push({ ref: `R${i + 1}`, type: 'resistor' }, { ref: `LED${i + 1}`, type: 'led' });
    nets.push({ name: `D${i + 2}`, pins: [`A1.D${i + 2}`, `R${i + 1}.1`] }, { name: `L${i}`, pins: [`R${i + 1}.2`, `LED${i + 1}.A`] });
    nets[2].pins.push(`LED${i + 1}.K`);
  }
  return { parts, nets };
}

const CASES: [string, AiCircuit][] = [...EXAMPLES.map((e) => [e.title, e.circuit] as [string, AiCircuit]), ['stress', stressCircuit()]];

for (const [name, circuit] of CASES) {
  for (const extras of [{}, { pour: true, holes: true }]) {
    const label = `${name}${'pour' in extras ? ' + GND fill + holes' : ''}`;
    test(`${label}: routes fully with no design-check errors`, () => {
      const { project, route } = buildFromCircuit(blank(extras), circuit);
      assert.equal(route.failed.length, 0, `failed: ${JSON.stringify(route.failed)}`);
      assert.equal(unroutedCount(project), 0);
      assert.deepEqual(clearanceViolations(project), []);
      assert.deepEqual(errors(project).map((e) => e.message), []);
    });
  }
}

test('mounting holes: parts and copper stay out of the keep-out', () => {
  const { project } = buildFromCircuit(blank({ holes: true }), stressCircuit());
  const holes = mountingHoles(project);
  assert.equal(holes.length, 4);
  for (const p of project.parts) assert.ok(!hitsHole(holes, partBox(p)), `${p.ref} on a hole`);
  for (const t of project.tracks)
    for (const [x, y] of t.points)
      for (const [hx, hy] of holes) assert.ok(Math.hypot(x - hx, y - hy) >= HOLE_KEEP, `${t.net} corner inside hole keep-out`);
  const g = buildGerbers(project);
  assert.match(g['ezboard-NPTH.drl'], /T1C3\.200/);
  assert.equal(g['ezboard-NPTH.drl'].split('\n').filter((l) => /^X/.test(l)).length, 4);
});

test('mounting holes: skipped on a small board', () => {
  assert.equal(mountingHoles(blank({ holes: true, board: { width: 20, height: 30 } })).length, 0);
  assert.ok(!('ezboard-NPTH.drl' in buildGerbers(blank({ holes: false }))));
});

test('GND fill: Gerber copper has a filled region with clear-outs', () => {
  const { project } = buildFromCircuit(blank({ pour: true }), EXAMPLES[1].circuit);
  assert.equal(pourNet(project), 'GND');
  const g = buildGerbers(project);
  for (const f of ['ezboard-F_Cu.gtl', 'ezboard-B_Cu.gbl']) {
    const s = g[f];
    assert.match(s, /G36\*[\s\S]*G37\*/);
    assert.match(s, /%LPC\*%/);
    // 마지막은 원래 구리를 그리는 dark 극성이어야 한다
    const lastPol = [...s.matchAll(/%LP([DC])\*%/g)].pop()![1];
    assert.equal(lastPol, 'D');
  }
  const off = buildGerbers({ ...project, pour: false });
  assert.doesNotMatch(off['ezboard-F_Cu.gtl'], /G36/);
});

test('GND fill: no GND net means no fill and an info note', () => {
  const p = blank({ pour: true, nets: [{ name: 'SIG', pins: ['R1.1', 'R2.1'] }] });
  assert.equal(pourNet(p), undefined);
  assert.ok(runDrc(p).some((i) => i.code === 'noGndPour'));
});

test('auto-fix: circuit problems are found and phrased for the AI', () => {
  const bad: AiCircuit = {
    parts: [{ ref: 'J1', type: 'power_in' }, { ref: 'LED1', type: 'led' }, { ref: 'R1', type: 'resistor' }],
    nets: [{ name: 'VCC', pins: ['J1.+', 'LED1.A'] }, { name: 'GND', pins: ['LED1.K', 'J1.-'] }, { name: 'X', pins: ['LED1.Z'] }],
  };
  const { project } = buildFromCircuit(blank(), bad);
  const issues = circuitIssues(project, []);
  assert.ok(issues.length >= 3, issues.join('\n')); // 없는 핀, 핀 하나짜리 넷, 연결 안 된 R1, LED 저항 없음
  const req = fixRequest(issues);
  assert.match(req, /```json/);
  for (const i of issues) assert.ok(req.includes(i));
  // 깨끗한 예제는 고칠 것이 없다
  for (const ex of EXAMPLES) assert.deepEqual(circuitIssues(buildFromCircuit(blank(), ex.circuit).project, []), []);
});

test('auto-fix: unknown part types and broken JSON become problems', () => {
  const r = extractCircuit('ok\n```json\n{"parts":[{"ref":"Q9","type":"flux_capacitor"}],"nets":[]}\n```');
  assert.equal(r.circuit?.parts.length, 0);
  assert.equal(r.problems.length, 1);
  const broken = extractCircuit('```json\n{"parts": [ \n```');
  assert.equal(broken.circuit, undefined);
  assert.equal(broken.problems.length, 1);
});
