// 부품 라이브러리: 초보자가 손으로 납땜하기 쉬운 스루홀(THT) 부품 위주.
import type { Part } from '../types';

export interface Pad {
  num: number;
  pin: string;            // 핀 이름. 같은 이름의 패드는 내부적으로 연결된 것으로 취급
  x: number;
  y: number;
  w: number;
  h: number;
  shape: 'circle' | 'rect' | 'oval';
  drill: number;          // 스루홀 드릴 지름 (mm)
}

export type SilkShape =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'circle'; x: number; y: number; r: number };

export interface Footprint {
  name: string;
  pads: Pad[];
  silk: SilkShape[];
  w: number;              // 점유 영역 (courtyard) 크기
  h: number;
}

export interface PartDef {
  type: string;
  name: string;           // 한국어 이름
  category: string;
  prefix: string;         // 기본 참조 접두사
  defaultValue: string;
  desc: string;           // 초보자용 설명
  pinHelp?: string;       // 핀 설명
  footprint: Footprint;
}

const PAD = 1.8;
const DRILL = 0.9;

function line(x1: number, y1: number, x2: number, y2: number): SilkShape {
  return { kind: 'line', x1, y1, x2, y2 };
}
function rect(cx: number, cy: number, w: number, h: number): SilkShape[] {
  const l = cx - w / 2, r = cx + w / 2, t = cy - h / 2, b = cy + h / 2;
  return [line(l, t, r, t), line(r, t, r, b), line(r, b, l, b), line(l, b, l, t)];
}

/** 일렬로 늘어선 스루홀 패드 (가로 방향, 중심 정렬) */
function inline(pins: string[], pitch: number, pad = PAD, drill = DRILL): Pad[] {
  const n = pins.length;
  return pins.map((pin, i) => ({
    num: i + 1,
    pin,
    x: (i - (n - 1) / 2) * pitch,
    y: 0,
    w: pad,
    h: pad,
    shape: i === 0 ? 'rect' : 'circle',
    drill,
  }));
}

/** DIP 패키지 (300mil). 1번 핀은 왼쪽 아래, 반시계 방향 */
function dip(pins: string[], rowSpacing = 7.62): Footprint {
  const n = pins.length;
  const half = n / 2;
  const pads: Pad[] = pins.map((pin, i) => {
    const bottom = i < half;
    const idx = bottom ? i : n - 1 - i;
    return {
      num: i + 1,
      pin,
      x: (idx - (half - 1) / 2) * 2.54,
      y: bottom ? rowSpacing / 2 : -rowSpacing / 2,
      w: 1.6,
      h: 2.0,
      shape: i === 0 ? 'rect' : 'oval',
      drill: 0.8,
    };
  });
  const bw = half * 2.54 + 0.4;
  const bh = rowSpacing - 2.6;
  const silk = [...rect(0, 0, bw, bh), { kind: 'circle', x: -bw / 2, y: 0, r: 0.8 } as SilkShape];
  return { name: `DIP-${n}`, pads, silk, w: bw + 1, h: rowSpacing + 2.4 };
}

function twoPinAxial(a: string, b: string, pitch: number, bodyW: number, bodyH: number, band = false): Footprint {
  const pads = inline([a, b], pitch);
  const silk = [
    ...rect(0, 0, bodyW, bodyH),
    line(-pitch / 2 + 1.1, 0, -bodyW / 2, 0),
    line(bodyW / 2, 0, pitch / 2 - 1.1, 0),
  ];
  if (band) silk.push(line(-bodyW / 2 + 0.8, -bodyH / 2, -bodyW / 2 + 0.8, bodyH / 2));
  return { name: `Axial_P${pitch}`, pads, silk, w: pitch + PAD + 0.6, h: Math.max(bodyH, PAD) + 0.8 };
}

function radial(a: string, b: string, pitch: number, r: number, plusMark = false): Footprint {
  const pads = inline([a, b], pitch);
  const silk: SilkShape[] = [{ kind: 'circle', x: 0, y: 0, r }];
  if (plusMark) {
    const px = -r - 0.9, py = -r + 0.6;
    silk.push(line(px - 0.5, py, px + 0.5, py), line(px, py - 0.5, px, py + 0.5));
  }
  return { name: `Radial_D${r * 2}`, pads, silk, w: r * 2 + 1, h: r * 2 + 1 };
}

function header(n: number): Footprint {
  const pins = Array.from({ length: n }, (_, i) => String(i + 1));
  const pads = inline(pins, 2.54, 1.7, 1.0);
  const w = n * 2.54;
  return { name: `PinHeader_1x${n}`, pads, silk: rect(0, 0, w, 2.54), w: w + 0.6, h: 3.2 };
}

function to92(pins: string[]): Footprint {
  const pads = inline(pins, 2.54, 1.6, 0.8);
  const silk: SilkShape[] = [line(-2.4, 1.6, 2.4, 1.6), { kind: 'circle', x: 0, y: 0, r: 2.6 }];
  return { name: 'TO-92', pads, silk, w: 6.4, h: 6 };
}

function to220(pins: string[]): Footprint {
  const pads = inline(pins, 2.54, 1.9, 1.1);
  return { name: 'TO-220', pads, silk: [...rect(0, 0, 10.2, 4.6), line(-5.1, -1.3, 5.1, -1.3)], w: 11, h: 5.4 };
}

function tactile(): Footprint {
  const p = (num: number, pin: string, x: number, y: number): Pad => ({
    num, pin, x, y, w: 2, h: 2, shape: num === 1 ? 'rect' : 'circle', drill: 1.0,
  });
  return {
    name: 'SW_Tactile_6mm',
    pads: [p(1, '1', -3.25, -2.25), p(2, '1', 3.25, -2.25), p(3, '2', -3.25, 2.25), p(4, '2', 3.25, 2.25)],
    silk: [...rect(0, 0, 6, 6), { kind: 'circle', x: 0, y: 0, r: 1.8 }],
    w: 8.8, h: 7,
  };
}

function nano(): Footprint {
  const left = ['D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST', 'GND', 'VIN'];
  const right = ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND', 'RST', 'D0', 'D1'];
  const pads: Pad[] = [];
  left.forEach((pin, i) => pads.push({ num: i + 1, pin, x: -7.62, y: (i - 7) * 2.54, w: 1.7, h: 1.7, shape: i === 0 ? 'rect' : 'circle', drill: 1.0 }));
  right.forEach((pin, i) => pads.push({ num: 16 + i, pin, x: 7.62, y: (i - 7) * 2.54, w: 1.7, h: 1.7, shape: 'circle', drill: 1.0 }));
  return {
    name: 'Arduino_Nano',
    pads,
    silk: [...rect(0, 0, 18, 43.2), ...rect(0, -20, 7.6, 6)],
    w: 18.6, h: 44,
  };
}

const defs: PartDef[] = [
  {
    type: 'resistor', name: '저항', category: '기본 부품', prefix: 'R', defaultValue: '1kΩ',
    desc: '전류의 흐름을 제한합니다. LED를 보호하거나 전압을 나눌 때 사용해요. 방향이 없어서 어느 쪽으로 꽂아도 됩니다.',
    pinHelp: '1, 2 (방향 없음)',
    footprint: twoPinAxial('1', '2', 10.16, 6.4, 2.4),
  },
  {
    type: 'capacitor', name: '세라믹 커패시터', category: '기본 부품', prefix: 'C', defaultValue: '100nF',
    desc: '전기를 잠깐 저장했다가 내보냅니다. IC 전원 핀 옆에 100nF를 달면 노이즈를 줄여줘요. 방향이 없습니다.',
    pinHelp: '1, 2 (방향 없음)',
    footprint: { ...twoPinAxial('1', '2', 5.08, 4.6, 2.6), name: 'C_Disc_P5.08' },
  },
  {
    type: 'capacitor_pol', name: '전해 커패시터', category: '기본 부품', prefix: 'C', defaultValue: '10uF',
    desc: '용량이 큰 커패시터로 전원을 안정시킵니다. 극성(+/-)이 있으니 방향에 주의하세요! 다리가 긴 쪽이 +입니다.',
    pinHelp: '+ (긴 다리), - (짧은 다리, 띠 표시)',
    footprint: radial('+', '-', 2.54, 3.2, true),
  },
  {
    type: 'led', name: 'LED (5mm)', category: '기본 부품', prefix: 'LED', defaultValue: '빨강',
    desc: '빛을 내는 다이오드입니다. 반드시 저항과 함께 써야 타지 않아요. 다리가 긴 쪽이 A(+), 짧은 쪽이 K(-)입니다.',
    pinHelp: 'A = 애노드(+, 긴 다리), K = 캐소드(-, 짧은 다리)',
    footprint: { ...radial('K', 'A', 2.54, 2.9), name: 'LED_D5.0mm' },
  },
  {
    type: 'diode', name: '다이오드', category: '기본 부품', prefix: 'D', defaultValue: '1N4007',
    desc: '전류를 한 방향으로만 흐르게 합니다. 전원을 거꾸로 꽂았을 때 회로를 보호해요. 띠가 있는 쪽이 K입니다.',
    pinHelp: 'A = 애노드, K = 캐소드(띠 표시)',
    footprint: twoPinAxial('K', 'A', 10.16, 5.6, 2.8, true),
  },
  {
    type: 'npn', name: 'NPN 트랜지스터', category: '반도체', prefix: 'Q', defaultValue: '2N3904',
    desc: '작은 신호로 큰 전류를 켜고 끄는 스위치입니다. 아두이노로 모터나 많은 LED를 켤 때 사용해요.',
    pinHelp: 'E = 이미터(GND 쪽), B = 베이스(제어, 저항 거쳐서), C = 컬렉터(부하 쪽)',
    footprint: to92(['E', 'B', 'C']),
  },
  {
    type: 'pnp', name: 'PNP 트랜지스터', category: '반도체', prefix: 'Q', defaultValue: '2N3906',
    desc: 'NPN과 반대로 동작하는 트랜지스터입니다. 전원(+) 쪽을 스위칭할 때 씁니다.',
    pinHelp: 'E = 이미터(+ 쪽), B = 베이스, C = 컬렉터',
    footprint: to92(['E', 'B', 'C']),
  },
  {
    type: 'nmos', name: 'N-MOSFET (소형)', category: '반도체', prefix: 'Q', defaultValue: '2N7000',
    desc: '전압으로 제어하는 스위치입니다. 게이트(G)에 전압을 주면 D-S 사이가 연결돼요.',
    pinHelp: 'S = 소스(GND), G = 게이트(제어), D = 드레인(부하)',
    footprint: to92(['S', 'G', 'D']),
  },
  {
    type: 'nmos_power', name: 'N-MOSFET (전력용)', category: '반도체', prefix: 'Q', defaultValue: 'IRLZ44N',
    desc: '모터, LED 스트립처럼 큰 전류를 제어하는 스위치입니다. 5V 로직으로 바로 켤 수 있어요.',
    pinHelp: 'G = 게이트, D = 드레인, S = 소스',
    footprint: to220(['G', 'D', 'S']),
  },
  {
    type: 'regulator_5v', name: '5V 레귤레이터', category: '전원', prefix: 'U', defaultValue: 'LM7805',
    desc: '7~12V 입력을 일정한 5V로 바꿔줍니다. 입력·출력에 커패시터를 함께 달아주세요.',
    pinHelp: 'IN = 입력, GND = 접지, OUT = 5V 출력',
    footprint: to220(['IN', 'GND', 'OUT']),
  },
  {
    type: 'regulator_3v3', name: '3.3V 레귤레이터', category: '전원', prefix: 'U', defaultValue: 'LD1117V33',
    desc: '5V 등을 3.3V로 바꿔줍니다. ESP32나 센서 전원에 사용해요. 출력에 10uF 커패시터가 필요합니다.',
    pinHelp: 'GND = 접지, OUT = 3.3V 출력, IN = 입력',
    footprint: to220(['GND', 'OUT', 'IN']),
  },
  {
    type: 'power_in', name: '전원 단자', category: '전원', prefix: 'J', defaultValue: '5V 입력',
    desc: '나사로 전선을 고정하는 전원 입력 단자입니다. 배터리나 어댑터 선을 연결해요.',
    pinHelp: '+ = 전원 플러스, - = GND',
    footprint: { ...header(2), name: 'TerminalBlock_P5.08', pads: inline(['+', '-'], 5.08, 2.4, 1.3), silk: rect(0, 0, 10.2, 7.6), w: 10.8, h: 8.2 },
  },
  {
    type: 'ne555', name: '555 타이머', category: 'IC', prefix: 'U', defaultValue: 'NE555',
    desc: '깜빡임(발진), 타이머를 만드는 유명한 IC입니다. 저항 2개와 커패시터 1개로 LED를 깜빡일 수 있어요.',
    pinHelp: '1 GND, 2 TRIG, 3 OUT, 4 RESET, 5 CTRL, 6 THR, 7 DIS, 8 VCC',
    footprint: dip(['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THR', 'DIS', 'VCC']),
  },
  {
    type: 'lm358', name: '연산 증폭기', category: 'IC', prefix: 'U', defaultValue: 'LM358',
    desc: '작은 신호를 키우거나 두 전압을 비교하는 IC입니다. 앰프 2개가 들어있어요.',
    pinHelp: '1 OUT1, 2 IN1-, 3 IN1+, 4 GND, 5 IN2+, 6 IN2-, 7 OUT2, 8 VCC',
    footprint: dip(['OUT1', 'IN1-', 'IN1+', 'GND', 'IN2+', 'IN2-', 'OUT2', 'VCC']),
  },
  ...[8, 14, 16].map((n) => ({
    type: `ic_dip${n}`, name: `범용 IC (DIP-${n})`, category: 'IC', prefix: 'U', defaultValue: `IC`,
    desc: `${n}핀 DIP 패키지 IC입니다. 핀 번호(1~${n})로 연결해요. 1번 핀은 동그라미 표시가 있는 쪽입니다.`,
    pinHelp: `1 ~ ${n}`,
    footprint: dip(Array.from({ length: n }, (_, i) => String(i + 1))),
  })),
  {
    type: 'arduino_nano', name: '아두이노 나노', category: '모듈', prefix: 'A', defaultValue: 'Arduino Nano',
    desc: '프로그래밍할 수 있는 작은 컴퓨터입니다. 핀 헤더 소켓에 꽂아서 사용해요. USB로 전원과 코드를 넣을 수 있습니다.',
    pinHelp: 'D0~D13 디지털, A0~A7 아날로그, 5V, 3V3, VIN, GND, RST, AREF',
    footprint: nano(),
  },
  ...[2, 3, 4, 5, 6, 8].map((n) => ({
    type: `header${n}`, name: `핀 헤더 ${n}핀`, category: '연결', prefix: 'J', defaultValue: `${n}P`,
    desc: `외부 센서·모듈·전선을 연결하는 ${n}핀 커넥터입니다.`,
    pinHelp: `1 ~ ${n}`,
    footprint: header(n),
  })),
  {
    type: 'button', name: '푸시 버튼', category: '입력', prefix: 'SW', defaultValue: '6mm 택트',
    desc: '누르는 동안만 연결되는 버튼입니다. 다리가 4개지만 2개씩 내부에서 연결되어 있어요.',
    pinHelp: '1, 2 (누르면 1-2가 연결됨)',
    footprint: tactile(),
  },
  {
    type: 'switch', name: '슬라이드 스위치', category: '입력', prefix: 'SW', defaultValue: 'SPDT',
    desc: '밀어서 켜고 끄는 스위치입니다. 전원 ON/OFF에 많이 써요.',
    pinHelp: 'A, COM(가운데), B — COM이 A 또는 B와 연결됨',
    footprint: { ...to92(['A', 'COM', 'B']), name: 'SW_Slide_SPDT', silk: rect(0, 0, 8.6, 3.6), w: 9.2, h: 4.2 },
  },
  {
    type: 'potentiometer', name: '가변저항', category: '입력', prefix: 'RV', defaultValue: '10kΩ',
    desc: '손잡이를 돌려 저항값을 바꿉니다. 밝기·볼륨 조절에 쓰고, 가운데 핀(W)에서 전압이 나와요.',
    pinHelp: '1, W(가운데, 와이퍼), 3',
    footprint: { ...to92(['1', 'W', '3']), name: 'Potentiometer_Trimmer', silk: rect(0, -1, 9.6, 6.4), w: 10.2, h: 7.6 },
  },
  {
    type: 'ldr', name: '조도 센서 (CdS)', category: '입력', prefix: 'R', defaultValue: 'GL5528',
    desc: '빛이 밝으면 저항이 작아지는 센서입니다. 저항 하나와 함께 전압 분배기로 써요.',
    pinHelp: '1, 2 (방향 없음)',
    footprint: { ...radial('1', '2', 5.08, 2.6), name: 'LDR_5mm' },
  },
  {
    type: 'buzzer', name: '부저', category: '출력', prefix: 'BZ', defaultValue: '능동 5V',
    desc: '소리를 내는 부품입니다. 능동 부저는 전원만 주면 삐- 소리가 나요. +/- 극성이 있습니다.',
    pinHelp: '+ (긴 다리), -',
    footprint: { ...radial('+', '-', 7.62, 6, true), name: 'Buzzer_12mm' },
  },
];

export const LIBRARY: Record<string, PartDef> = Object.fromEntries(defs.map((d) => [d.type, d]));
export const LIBRARY_LIST = defs;

export function getDef(type: string): PartDef | undefined {
  return LIBRARY[type];
}

/** 부품의 회전/위치를 적용한 패드 절대 좌표 */
export function rotatePoint(x: number, y: number, rot: number): [number, number] {
  switch (((rot % 360) + 360) % 360) {
    case 90: return [-y, x];
    case 180: return [-x, -y];
    case 270: return [y, -x];
    default: return [x, y];
  }
}

export interface PlacedPad extends Pad {
  ref: string;
  ax: number;
  ay: number;
  aw: number;
  ah: number;
}

export function placedPads(part: Part): PlacedPad[] {
  const def = getDef(part.type);
  if (!def) return [];
  const swap = part.rot % 180 !== 0;
  return def.footprint.pads.map((p) => {
    const [dx, dy] = rotatePoint(p.x, p.y, part.rot);
    return { ...p, ref: part.ref, ax: part.x + dx, ay: part.y + dy, aw: swap ? p.h : p.w, ah: swap ? p.w : p.h };
  });
}

/** 부품 점유 영역 (절대 좌표 사각형) */
export function partBox(part: Part): { x1: number; y1: number; x2: number; y2: number } {
  const def = getDef(part.type);
  const fw = def?.footprint.w ?? 4, fh = def?.footprint.h ?? 4;
  const swap = part.rot % 180 !== 0;
  const w = swap ? fh : fw, h = swap ? fw : fh;
  return { x1: part.x - w / 2, y1: part.y - h / 2, x2: part.x + w / 2, y2: part.y + h / 2 };
}

/** "R1.2", "U1.VCC", "U1.8" 같은 핀 참조를 해당 패드들로 변환 */
export function resolvePin(parts: Part[], pinRef: string): PlacedPad[] {
  const dot = pinRef.lastIndexOf('.');
  if (dot < 0) return [];
  const ref = pinRef.slice(0, dot).trim();
  const pin = pinRef.slice(dot + 1).trim();
  const part = parts.find((p) => p.ref.toLowerCase() === ref.toLowerCase());
  if (!part) return [];
  const pads = placedPads(part);
  const byName = pads.filter((p) => p.pin.toLowerCase() === pin.toLowerCase());
  if (byName.length) return byName;
  const num = Number(pin);
  if (Number.isInteger(num)) {
    const pad = pads.find((p) => p.num === num);
    if (pad) return pads.filter((p) => p.pin === pad.pin);
  }
  return [];
}

export function nextRef(parts: Part[], prefix: string): string {
  let i = 1;
  const used = new Set(parts.map((p) => p.ref));
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

/** AI 시스템 프롬프트에 넣을 라이브러리 요약 */
export function librarySummary(): string {
  return defs
    .map((d) => {
      const pins = [...new Set(d.footprint.pads.map((p) => p.pin))].join(', ');
      return `- ${d.type}: ${d.name} (기본값 ${d.defaultValue}) — 핀: ${pins}`;
    })
    .join('\n');
}
