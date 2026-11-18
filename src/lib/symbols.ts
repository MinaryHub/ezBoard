// 회로도 기호. 좌표 단위는 회로도 그리드 1칸. 핀 끝점은 항상 정수 좌표.
import { getDef, rotatePoint } from './library';

export type Dir = 'l' | 'r' | 'u' | 'd';

export interface SymPin {
  name: string;
  x: number;
  y: number;
  dir: Dir;           // 핀이 기호 바깥으로 뻗는 방향
}

export type SymShape =
  | { k: 'path'; d: string; fill?: boolean }
  | { k: 'circle'; cx: number; cy: number; r: number; fill?: boolean }
  | { k: 'rect'; x: number; y: number; w: number; h: number }
  | { k: 'text'; x: number; y: number; t: string; size?: number; anchor?: 'start' | 'middle' | 'end' };

export interface SchSymbol {
  pins: SymPin[];
  shapes: SymShape[];
  body: { x1: number; y1: number; x2: number; y2: number };
  rotatable: boolean;
}

const two = (a: string, b: string): SymPin[] => [
  { name: a, x: -3, y: 0, dir: 'l' },
  { name: b, x: 3, y: 0, dir: 'r' },
];
const BODY2 = { x1: -2, y1: -1, x2: 2, y2: 1 };
const ZIGZAG = 'M-3 0H-1.5L-1.25 -0.6L-0.75 0.6L-0.25 -0.6L0.25 0.6L0.75 -0.6L1.25 0.6L1.5 0H3';

function box(sides: { left?: string[]; right?: string[]; top?: string[]; bottom?: string[] }): SchSymbol {
  const L = sides.left ?? [], R = sides.right ?? [], T = sides.top ?? [], B = sides.bottom ?? [];
  const cw = 0.62;
  const maxL = Math.max(0, ...L.map((s) => s.length));
  const maxR = Math.max(0, ...R.map((s) => s.length));
  // 위/아래 핀은 전원 기호 이름이 겹치지 않게 4칸 간격
  const hw = Math.max(3, 2 * Math.max(T.length, B.length) + 1, Math.ceil(((maxL + maxR) * cw) / 2 + 1.6));
  const rows = Math.max(L.length, R.length, 1);
  const hh = Math.max(2, rows + (T.length || B.length ? 1 : 0));
  const pins: SymPin[] = [];
  const shapes: SymShape[] = [{ k: 'rect', x: -hw, y: -hh, w: hw * 2, h: hh * 2 }];
  const stubs: string[] = [];
  const at = (n: number, i: number) => -(n - 1) + 2 * i;
  const atTB = (n: number, i: number) => -2 * (n - 1) + 4 * i;
  L.forEach((name, i) => {
    const y = at(L.length, i);
    pins.push({ name, x: -hw - 2, y, dir: 'l' });
    stubs.push(`M${-hw - 2} ${y}H${-hw}`);
    shapes.push({ k: 'text', x: -hw + 0.4, y: y + 0.35, t: name, size: 0.9, anchor: 'start' });
  });
  R.forEach((name, i) => {
    const y = at(R.length, i);
    pins.push({ name, x: hw + 2, y, dir: 'r' });
    stubs.push(`M${hw + 2} ${y}H${hw}`);
    shapes.push({ k: 'text', x: hw - 0.4, y: y + 0.35, t: name, size: 0.9, anchor: 'end' });
  });
  T.forEach((name, i) => {
    const x = atTB(T.length, i);
    pins.push({ name, x, y: -hh - 2, dir: 'u' });
    stubs.push(`M${x} ${-hh - 2}V${-hh}`);
    shapes.push({ k: 'text', x, y: -hh + 1.1, t: name, size: 0.8, anchor: 'middle' });
  });
  B.forEach((name, i) => {
    const x = atTB(B.length, i);
    pins.push({ name, x, y: hh + 2, dir: 'd' });
    stubs.push(`M${x} ${hh + 2}V${hh}`);
    shapes.push({ k: 'text', x, y: hh - 0.5, t: name, size: 0.8, anchor: 'middle' });
  });
  shapes.push({ k: 'path', d: stubs.join('') });
  return { pins, shapes, body: { x1: -hw, y1: -hh, x2: hw, y2: hh }, rotatable: false };
}

const SYMBOLS: Record<string, () => SchSymbol> = {
  resistor: () => ({ pins: two('1', '2'), shapes: [{ k: 'path', d: ZIGZAG }], body: BODY2, rotatable: true }),
  ldr: () => ({
    pins: two('1', '2'),
    shapes: [
      { k: 'path', d: ZIGZAG },
      { k: 'path', d: 'M-1.6 -2.4L-0.7 -1.1M-0.4 -2.4L0.5 -1.1' },
      { k: 'path', d: 'M-0.7 -1.1L-1.15 -1.25L-0.85 -1.5ZM0.5 -1.1L0.05 -1.25L0.35 -1.5Z', fill: true },
    ],
    body: { x1: -2, y1: -2, x2: 2, y2: 1 },
    rotatable: true,
  }),
  capacitor: () => ({
    pins: two('1', '2'),
    shapes: [{ k: 'path', d: 'M-3 0H-0.35M0.35 0H3M-0.35 -1.2V1.2M0.35 -1.2V1.2' }],
    body: BODY2,
    rotatable: true,
  }),
  capacitor_pol: () => ({
    pins: two('+', '-'),
    shapes: [
      { k: 'path', d: 'M-3 0H-0.35M0.45 0H3M-0.35 -1.2V1.2M0.75 -1.2Q0.2 0 0.75 1.2' },
      { k: 'text', x: -1.3, y: -0.6, t: '+', size: 1.1, anchor: 'middle' },
    ],
    body: BODY2,
    rotatable: true,
  }),
  led: () => ({
    pins: two('A', 'K'),
    shapes: [
      { k: 'path', d: 'M-3 0H-1M1 0H3M1 -1V1' },
      { k: 'path', d: 'M-1 -1L1 0L-1 1Z', fill: true },
      { k: 'path', d: 'M0.1 -1.1L0.9 -1.9M0.8 -0.8L1.6 -1.6' },
      { k: 'path', d: 'M0.9 -1.9L0.45 -1.75L0.75 -1.45ZM1.6 -1.6L1.15 -1.45L1.45 -1.15Z', fill: true },
    ],
    body: { x1: -2, y1: -2, x2: 2, y2: 1 },
    rotatable: true,
  }),
  diode: () => ({
    pins: two('A', 'K'),
    shapes: [{ k: 'path', d: 'M-3 0H-1M1 0H3M1 -1V1' }, { k: 'path', d: 'M-1 -1L1 0L-1 1Z', fill: true }],
    body: BODY2,
    rotatable: true,
  }),
  buzzer: () => ({
    pins: two('+', '-'),
    shapes: [
      { k: 'path', d: 'M-3 0H-1.3M1.3 0H3' },
      { k: 'circle', cx: 0, cy: 0, r: 1.3 },
      { k: 'text', x: 0, y: 0.35, t: 'BZ', size: 0.8, anchor: 'middle' },
      { k: 'text', x: -2.1, y: -0.5, t: '+', size: 1, anchor: 'middle' },
    ],
    body: { x1: -2, y1: -1.5, x2: 2, y2: 1.5 },
    rotatable: true,
  }),
  button: () => ({
    pins: two('1', '2'),
    shapes: [
      { k: 'path', d: 'M-3 0H-1.6M1.6 0H3M-1.6 -0.9H1.6M0 -0.9V-1.8M-0.6 -1.8H0.6' },
      { k: 'circle', cx: -1.4, cy: 0, r: 0.2 },
      { k: 'circle', cx: 1.4, cy: 0, r: 0.2 },
    ],
    body: { x1: -2, y1: -2, x2: 2, y2: 1 },
    rotatable: true,
  }),
  switch: () => ({
    pins: [
      { name: 'COM', x: -3, y: 0, dir: 'l' },
      { name: 'A', x: 3, y: -1, dir: 'r' },
      { name: 'B', x: 3, y: 1, dir: 'r' },
    ],
    shapes: [
      { k: 'path', d: 'M-3 0H-1.2M3 -1H1.4M3 1H1.4M-1 0L1.1 -0.9' },
      { k: 'circle', cx: -1.1, cy: 0, r: 0.2 },
      { k: 'circle', cx: 1.2, cy: -1, r: 0.2 },
      { k: 'circle', cx: 1.2, cy: 1, r: 0.2 },
    ],
    body: { x1: -2, y1: -1.5, x2: 2, y2: 1.5 },
    rotatable: true,
  }),
  potentiometer: () => ({
    pins: [...two('1', '3'), { name: 'W', x: 0, y: 2, dir: 'd' }],
    shapes: [{ k: 'path', d: ZIGZAG + 'M0 2V1.1' }, { k: 'path', d: 'M-0.35 1.3L0 0.7L0.35 1.3Z', fill: true }],
    body: BODY2,
    rotatable: true,
  }),
  npn: () => ({
    pins: [{ name: 'B', x: -3, y: 0, dir: 'l' }, { name: 'C', x: 1, y: -3, dir: 'u' }, { name: 'E', x: 1, y: 3, dir: 'd' }],
    shapes: [
      { k: 'circle', cx: 0.2, cy: 0, r: 1.9 },
      { k: 'path', d: 'M-3 0H-0.6M-0.6 -1.1V1.1M-0.6 -0.5L1 -1.5V-3M-0.6 0.5L1 1.5V3' },
      { k: 'path', d: 'M0.8 1.375L0.05 1.26L0.37 0.75Z', fill: true },
    ],
    body: { x1: -2, y1: -2, x2: 2, y2: 2 },
    rotatable: true,
  }),
  pnp: () => ({
    pins: [{ name: 'B', x: -3, y: 0, dir: 'l' }, { name: 'E', x: 1, y: -3, dir: 'u' }, { name: 'C', x: 1, y: 3, dir: 'd' }],
    shapes: [
      { k: 'circle', cx: 0.2, cy: 0, r: 1.9 },
      { k: 'path', d: 'M-3 0H-0.6M-0.6 -1.1V1.1M-0.6 -0.5L1 -1.5V-3M-0.6 0.5L1 1.5V3' },
      { k: 'path', d: 'M-0.2 -0.75L0.55 -0.87L0.24 -1.38Z', fill: true },
    ],
    body: { x1: -2, y1: -2, x2: 2, y2: 2 },
    rotatable: true,
  }),
  nmos: () => mosfet(),
  nmos_power: () => mosfet(),
  power_in: () => ({
    pins: [{ name: '+', x: 0, y: -3, dir: 'u' }, { name: '-', x: 0, y: 3, dir: 'd' }],
    shapes: [
      { k: 'path', d: 'M0 -3V-0.4M0 0.4V3M-1.3 -0.4H1.3M-0.6 0.4H0.6' },
      { k: 'text', x: 1.1, y: -1, t: '+', size: 1, anchor: 'middle' },
    ],
    body: { x1: -1.5, y1: -1, x2: 1.5, y2: 1 },
    rotatable: true,
  }),
  ne555: () => box({ left: ['TRIG', 'THR', 'CTRL'], right: ['DIS', 'OUT'], top: ['VCC', 'RESET'], bottom: ['GND'] }),
  lm358: () => box({ left: ['IN1+', 'IN1-', 'IN2+', 'IN2-'], right: ['OUT1', 'OUT2'], top: ['VCC'], bottom: ['GND'] }),
  regulator_5v: () => box({ left: ['IN'], right: ['OUT'], bottom: ['GND'] }),
  regulator_3v3: () => box({ left: ['IN'], right: ['OUT'], bottom: ['GND'] }),
  zener: () => ({
    pins: two('A', 'K'),
    shapes: [{ k: 'path', d: 'M-3 0H-1M1 0H3M1 -1V1M1 -1L1.5 -1.4M1 1L0.5 1.4' }, { k: 'path', d: 'M-1 -1L1 0L-1 1Z', fill: true }],
    body: BODY2,
    rotatable: true,
  }),
  crystal: () => ({
    pins: two('1', '2'),
    shapes: [{ k: 'path', d: 'M-3 0H-1M1 0H3M-1 -1.1V1.1M1 -1.1V1.1' }, { k: 'rect', x: -0.55, y: -1.3, w: 1.1, h: 2.6 }],
    body: BODY2,
    rotatable: true,
  }),
  rgb_led: () => box({ left: ['R', 'G', 'B'], right: ['K'] }),
  lm317: () => box({ left: ['IN'], right: ['OUT'], bottom: ['ADJ'] }),
  hc595: () => box({ left: ['SER', 'SRCLK', 'RCLK', 'SRCLR', 'OE'], right: ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', "QH'"], top: ['VCC'], bottom: ['GND'] }),
  uln2003: () => box({ left: ['IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7'], right: ['OUT1', 'OUT2', 'OUT3', 'OUT4', 'OUT5', 'OUT6', 'OUT7'], top: ['COM'], bottom: ['GND'] }),
  l293d: () => box({ left: ['EN1', 'IN1', 'IN2', 'EN2', 'IN3', 'IN4'], right: ['OUT1', 'OUT2', 'OUT3', 'OUT4'], top: ['VCC1', 'VCC2'], bottom: ['GND'] }),
  esp32_devkit: () => box({
    left: ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13'],
    right: ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15'],
    top: ['VIN', '3V3'],
    bottom: ['GND'],
  }),
  pico: () => box({
    left: ['GP0', 'GP1', 'GP2', 'GP3', 'GP4', 'GP5', 'GP6', 'GP7', 'GP8', 'GP9', 'GP10', 'GP11', 'GP12', 'GP13', 'GP14', 'GP15'],
    right: ['GP16', 'GP17', 'GP18', 'GP19', 'GP20', 'GP21', 'GP22', 'GP26', 'GP27', 'GP28', 'RUN', 'ADC_VREF', '3V3_EN'],
    top: ['VBUS', 'VSYS', '3V3'],
    bottom: ['GND', 'AGND'],
  }),
  dht22: () => box({ left: ['DATA'], right: ['NC'], top: ['VCC'], bottom: ['GND'] }),
  oled_i2c: () => box({ right: ['GND', 'VCC', 'SCL', 'SDA'] }),
  hcsr04: () => box({ right: ['VCC', 'TRIG', 'ECHO', 'GND'] }),
  servo: () => box({ right: ['GND', 'VCC', 'SIG'] }),
  usb_power: () => box({ right: ['VBUS', 'GND'] }),
  terminal3: () => box({ right: ['1', '2', '3'] }),
  arduino_nano: () =>
    box({
      left: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13'],
      right: ['VIN', '5V', '3V3', 'AREF', 'RST', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'],
      bottom: ['GND'],
    }),
};

function mosfet(): SchSymbol {
  return {
    pins: [{ name: 'G', x: -3, y: 0, dir: 'l' }, { name: 'D', x: 1, y: -3, dir: 'u' }, { name: 'S', x: 1, y: 3, dir: 'd' }],
    shapes: [
      { k: 'circle', cx: 0.2, cy: 0, r: 1.9 },
      { k: 'path', d: 'M-3 0H-0.9M-0.9 -1V1M-0.4 -1.2V-0.6M-0.4 -0.3V0.3M-0.4 0.6V1.2M-0.4 -0.9H1V-3M-0.4 0.9H1V3M-0.4 0H1V0.9' },
      { k: 'path', d: 'M-0.4 0L0.2 -0.3L0.2 0.3Z', fill: true },
    ],
    body: { x1: -2, y1: -2, x2: 2, y2: 2 },
    rotatable: true,
  };
}

const cache = new Map<string, SchSymbol>();

export function symbolFor(type: string): SchSymbol {
  let s = cache.get(type);
  if (s) return s;
  const make = SYMBOLS[type];
  if (make) s = make();
  else {
    // 핀 헤더, 범용 DIP 등: 핀 번호 순서대로 상자 기호
    const def = getDef(type);
    const names = [...new Set((def?.footprint.pads ?? []).map((p) => p.pin))];
    if (/^header/.test(type)) s = box({ right: names });
    else {
      const half = Math.ceil(names.length / 2);
      s = box({ left: names.slice(0, half), right: names.slice(half).reverse() });
    }
  }
  cache.set(type, s);
  return s;
}

/** 기호 좌표 변환. 회전 가능한 기호는 회전, 상자 기호(IC 등)는 rot=180일 때 좌우 반전 */
export function xformPoint(sym: SchSymbol, x: number, y: number, rot: number): [number, number] {
  if (sym.rotatable) return rotatePoint(x, y, rot);
  return (((rot % 360) + 360) % 360) === 180 ? [-x, y] : [x, y];
}

const ROT_DIR: Record<Dir, Dir> = { r: 'd', d: 'l', l: 'u', u: 'r' };
export function xformDir(sym: SchSymbol, d: Dir, rot: number): Dir {
  const r = ((rot % 360) + 360) % 360;
  if (!sym.rotatable) return r === 180 ? (d === 'l' ? 'r' : d === 'r' ? 'l' : d) : d;
  let out = d;
  for (let i = 0; i < r / 90; i++) out = ROT_DIR[out];
  return out;
}
