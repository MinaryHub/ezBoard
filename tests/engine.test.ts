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

// ── 부품 라이브러리 ──
import { LIBRARY_LIST } from '../src/lib/library';
import { symbolFor } from '../src/lib/symbols';

test('library: every part has a schematic symbol pin for each footprint pin', () => {
  for (const d of LIBRARY_LIST) {
    const fp = new Set(d.footprint.pads.map((p) => p.pin));
    const sym = new Set(symbolFor(d.type).pins.map((p) => p.name));
    assert.deepEqual([...fp].filter((p) => !sym.has(p)), [], `${d.type}: footprint pins missing from symbol`);
    assert.deepEqual([...sym].filter((p) => !fp.has(p)), [], `${d.type}: symbol pins not on footprint`);
  }
});

test('library: pads do not overlap and sit inside the courtyard', () => {
  for (const d of LIBRARY_LIST) {
    const pads = d.footprint.pads;
    for (let i = 0; i < pads.length; i++) {
      const a = pads[i];
      assert.ok(Math.abs(a.x) + a.w / 2 <= d.footprint.w / 2 + 0.01 && Math.abs(a.y) + a.h / 2 <= d.footprint.h / 2 + 0.01, `${d.type} pad ${a.num} outside courtyard`);
      for (let j = i + 1; j < pads.length; j++) {
        const b = pads[j];
        const gapX = Math.abs(a.x - b.x) - (a.w + b.w) / 2, gapY = Math.abs(a.y - b.y) - (a.h + b.h) / 2;
        assert.ok(Math.max(gapX, gapY) >= 0.3, `${d.type} pads ${a.num}/${b.num} too close`);
      }
    }
    assert.deepEqual(pads.map((p) => p.num), pads.map((_, i) => i + 1), `${d.type} pad numbers`);
  }
});

const NEW_PART_CIRCUITS: [string, AiCircuit][] = [
  ['ESP32 weather station', {
    parts: [
      { ref: 'J1', type: 'usb_power' }, { ref: 'A1', type: 'esp32_devkit' }, { ref: 'U1', type: 'dht22' }, { ref: 'R1', type: 'resistor', value: '10kΩ' },
      { ref: 'J2', type: 'oled_i2c' }, { ref: 'LED1', type: 'rgb_led' }, { ref: 'R2', type: 'resistor' }, { ref: 'R3', type: 'resistor' }, { ref: 'R4', type: 'resistor' },
      { ref: 'C1', type: 'capacitor_pol' },
    ],
    nets: [
      { name: '5V', pins: ['J1.VBUS', 'A1.VIN', 'C1.+'] },
      { name: '3V3', pins: ['A1.3V3', 'U1.VCC', 'R1.1', 'J2.VCC'] },
      { name: 'GND', pins: ['J1.GND', 'A1.GND', 'U1.GND', 'J2.GND', 'LED1.K', 'C1.-'] },
      { name: 'DHT', pins: ['A1.D4', 'U1.DATA', 'R1.2'] },
      { name: 'SDA', pins: ['A1.D21', 'J2.SDA'] }, { name: 'SCL', pins: ['A1.D22', 'J2.SCL'] },
      { name: 'R_DRV', pins: ['A1.D25', 'R2.1'] }, { name: 'R_LED', pins: ['R2.2', 'LED1.R'] },
      { name: 'G_DRV', pins: ['A1.D26', 'R3.1'] }, { name: 'G_LED', pins: ['R3.2', 'LED1.G'] },
      { name: 'B_DRV', pins: ['A1.D27', 'R4.1'] }, { name: 'B_LED', pins: ['R4.2', 'LED1.B'] },
    ],
  }],
  ['Pico + 74HC595 LED bar', {
    parts: [
      { ref: 'A1', type: 'pico' }, { ref: 'U1', type: 'hc595' }, { ref: 'C1', type: 'capacitor' },
      ...Array.from({ length: 8 }, (_, i) => [{ ref: `R${i + 1}`, type: 'resistor' }, { ref: `LED${i + 1}`, type: 'led' }]).flat(),
    ],
    nets: [
      { name: '3V3', pins: ['A1.3V3', 'U1.VCC', 'U1.SRCLR', 'C1.1'] },
      { name: 'GND', pins: ['A1.GND', 'U1.GND', 'U1.OE', 'C1.2', ...Array.from({ length: 8 }, (_, i) => `LED${i + 1}.K`)] },
      { name: 'SER', pins: ['A1.GP2', 'U1.SER'] }, { name: 'SRCLK', pins: ['A1.GP3', 'U1.SRCLK'] }, { name: 'RCLK', pins: ['A1.GP4', 'U1.RCLK'] },
      ...['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH'].flatMap((q, i) => [
        { name: q, pins: [`U1.${q}`, `R${i + 1}.1`] },
        { name: `L${i + 1}`, pins: [`R${i + 1}.2`, `LED${i + 1}.A`] },
      ]),
    ],
  }],
  ['L293D two motors', {
    parts: [
      { ref: 'A1', type: 'arduino_nano' }, { ref: 'U1', type: 'l293d' }, { ref: 'J1', type: 'power_in', value: '9V' },
      { ref: 'J2', type: 'terminal3' }, { ref: 'J3', type: 'terminal3' }, { ref: 'C1', type: 'capacitor' }, { ref: 'C2', type: 'capacitor_pol' },
    ],
    nets: [
      { name: 'VM', pins: ['J1.+', 'U1.VCC2', 'A1.VIN', 'C2.+'] },
      { name: '5V', pins: ['A1.5V', 'U1.VCC1', 'U1.EN1', 'U1.EN2', 'C1.1'] },
      { name: 'GND', pins: ['J1.-', 'A1.GND', 'U1.GND', 'C1.2', 'C2.-', 'J2.3', 'J3.3'] },
      { name: 'IN1', pins: ['A1.D5', 'U1.IN1'] }, { name: 'IN2', pins: ['A1.D6', 'U1.IN2'] },
      { name: 'IN3', pins: ['A1.D9', 'U1.IN3'] }, { name: 'IN4', pins: ['A1.D10', 'U1.IN4'] },
      { name: 'M1A', pins: ['U1.OUT1', 'J2.1'] }, { name: 'M1B', pins: ['U1.OUT2', 'J2.2'] },
      { name: 'M2A', pins: ['U1.OUT3', 'J3.1'] }, { name: 'M2B', pins: ['U1.OUT4', 'J3.2'] },
    ],
  }],
];

for (const [name, circuit] of NEW_PART_CIRCUITS) {
  test(`new parts — ${name}: no circuit problems, routes fully with GND fill`, () => {
    const { project, route } = buildFromCircuit(blank({ pour: true }), circuit);
    assert.deepEqual(circuitIssues(project, []), []);
    assert.equal(route.failed.length, 0, `failed: ${JSON.stringify(route.failed)}`);
    assert.deepEqual(errors(project).map((e) => e.message), []);
  });
}
