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

export interface KeepoutZone {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  reason: string;
}

export interface Footprint {
  name: string;
  pads: Pad[];
  silk: SilkShape[];
  w: number;              // 점유 영역 (courtyard) 크기
  h: number;
  /** 보드 실크스크린에 핀 이름(VCC, GND 등)을 함께 인쇄 */
  pinLabels?: boolean;
  /** 구리 채우기·배선 금지 영역 (예: ESP32 Wi-Fi 안테나) */
  keepout?: KeepoutZone[];
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
  return { name: `Radial_D${r * 2}`, pads, silk, w: r * 2 + (plusMark ? 3.0 : 1), h: r * 2 + 1 };
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
  return { name: 'TO-92', pads, silk, w: 7, h: 6 };
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
    w: 18.6, h: 46.6,
  };
}

/** 두 줄 핀 모듈 (아래쪽에서 본 핀 배치가 아닌, 위에서 본 배치). left/right는 위→아래 순서 */
function module2(name: string, left: string[], right: string[], rowSpacing: number, bodyW: number, bodyH: number, offsetY = 0): Footprint {
  const pads: Pad[] = [];
  const n = left.length;
  left.forEach((pin, i) => pads.push({ num: i + 1, pin, x: -rowSpacing / 2, y: (i - (n - 1) / 2) * 2.54 + offsetY, w: 1.7, h: 1.7, shape: i === 0 ? 'rect' : 'circle', drill: 1.0 }));
  // 오른쪽 줄 번호는 아래에서 위로 이어진다 (DIP처럼)
  const m = right.length;
  right.forEach((pin, i) => pads.push({ num: n + m - i, pin, x: rowSpacing / 2, y: (i - (m - 1) / 2) * 2.54 + offsetY, w: 1.7, h: 1.7, shape: 'circle', drill: 1.0 }));
  pads.sort((a, b) => a.num - b.num);
  return { name, pads, silk: rect(0, 0, bodyW, bodyH), w: bodyW + 0.6, h: bodyH + 0.6 };
}

/** 이름 붙은 핀 헤더 (모듈 연결용 — 보드 실크스크린에 핀 이름 인쇄) */
function namedHeader(pins: string[], name: string): Footprint {
  return { ...header(pins.length), name, pads: inline(pins, 2.54, 1.7, 1.0), pinLabels: true };
}

/** JST-XH 2.5mm 슈라우드 커넥터 (극성 노치 표시 포함) */
function jstXh(n: number): Footprint {
  const pins = Array.from({ length: n }, (_, i) => String(i + 1));
  const pads = inline(pins, 2.5, 1.7, 0.9);
  const bw = n * 2.5 + 2.4;
  const bh = 5.8;
  const silk: SilkShape[] = [
    ...rect(0, 0, bw, bh),
    // 상단 극성 노치 표시
    line(-bw / 4, -bh / 2, -bw / 4, -bh / 2 + 1.1),
    line(bw / 4, -bh / 2, bw / 4, -bh / 2 + 1.1),
    line(-bw / 4, -bh / 2 + 1.1, bw / 4, -bh / 2 + 1.1),
  ];
  return { name: `JST_XH_1x${n}`, pads, silk, w: bw + 0.8, h: bh + 0.8 };
}

/** 2열 핀 헤더 (2×cols, 2.54mm 격자) */
function header2x(cols: number): Footprint {
  const pads: Pad[] = [];
  for (let c = 0; c < cols; c++) {
    const x = (c - (cols - 1) / 2) * 2.54;
    const n1 = c * 2 + 1;
    const n2 = c * 2 + 2;
    pads.push({ num: n1, pin: String(n1), x, y: -1.27, w: 1.7, h: 1.7, shape: n1 === 1 ? 'rect' : 'circle', drill: 1.0 });
    pads.push({ num: n2, pin: String(n2), x, y: 1.27, w: 1.7, h: 1.7, shape: 'circle', drill: 1.0 });
  }
  const bw = cols * 2.54;
  const bh = 5.08;
  return { name: `PinHeader_2x${cols}`, pads, silk: rect(0, 0, bw, bh), w: bw + 0.6, h: bh + 0.8 };
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
    footprint: {
      name: 'LED_D5.0mm',
      pads: inline(['K', 'A'], 2.54),
      silk: [
        { kind: 'circle', x: 0, y: 0, r: 2.9 },
        // 캐소드(K) 평면(flat) 및 애노드(+) 표시
        line(-2.3, -1.7, -2.3, 1.7),
        line(3.2, -2.2, 4.0, -2.2),
        line(3.6, -2.6, 3.6, -1.8),
      ],
      w: 8.8,
      h: 6.8,
    },
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
    footprint: { ...header(2), name: 'TerminalBlock_P5.08', pads: inline(['+', '-'], 5.08, 2.4, 1.3), silk: rect(0, 0, 10.2, 7.6), w: 10.8, h: 8.2, pinLabels: true },
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
    footprint: { ...to92(['1', 'W', '3']), name: 'Potentiometer_Trimmer', silk: rect(0, -1, 9.6, 6.4), w: 10.2, h: 9.0 },
  },
  {
    type: 'ldr', name: '조도 센서 (CdS)', category: '입력', prefix: 'R', defaultValue: 'GL5528',
    desc: '빛이 밝으면 저항이 작아지는 센서입니다. 저항 하나와 함께 전압 분배기로 써요.',
    pinHelp: '1, 2 (방향 없음)',
    footprint: { ...radial('1', '2', 5.08, 2.6), name: 'LDR_5mm', w: 7.2 },
  },
  {
    type: 'buzzer', name: '부저', category: '출력', prefix: 'BZ', defaultValue: '능동 5V',
    desc: '소리를 내는 부품입니다. 능동 부저는 전원만 주면 삐- 소리가 나요. +/- 극성이 있습니다.',
    pinHelp: '+ (긴 다리), -',
    footprint: { ...radial('+', '-', 7.62, 6, true), name: 'Buzzer_12mm' },
  },
  // ── 모듈 · IC · 연결 부품 ──
  {
    type: 'zener', name: '제너 다이오드', category: '기본 부품', prefix: 'D', defaultValue: '5.1V',
    desc: '거꾸로 연결하면 일정한 전압(예: 5.1V)을 넘지 않게 잡아 줍니다. 입력 보호나 간단한 기준 전압에 써요. 띠가 있는 쪽이 K입니다.',
    pinHelp: 'A = 애노드, K = 캐소드(띠 표시)',
    footprint: twoPinAxial('K', 'A', 10.16, 5.6, 2.8, true),
  },
  {
    type: 'crystal', name: '크리스털 (수정 진동자)', category: '기본 부품', prefix: 'Y', defaultValue: '16MHz',
    desc: 'IC에 정확한 박자(클럭)를 줍니다. 양쪽 핀을 각각 22pF 커패시터로 GND에 연결해요. 방향이 없습니다.',
    pinHelp: '1, 2 (방향 없음)',
    footprint: { name: 'Crystal_HC49-U', pads: inline(['1', '2'], 4.88, 1.5, 0.8), silk: rect(0, 0, 11, 4.6), w: 11.6, h: 5.2 },
  },
  {
    type: 'rgb_led', name: 'RGB LED (공통 캐소드)', category: '기본 부품', prefix: 'LED', defaultValue: '5mm RGB',
    desc: '빨강·초록·파랑을 섞어 여러 색을 내는 LED입니다. 색마다 저항을 따로 달아야 해요. 가장 긴 다리가 공통 K(-)입니다.',
    pinHelp: 'R, K(가장 긴 다리, 공통 -), G, B',
    footprint: { name: 'LED_RGB_D5.0mm', pads: inline(['R', 'K', 'G', 'B'], 2.54, 1.6, 0.8), silk: [{ kind: 'circle', x: 0, y: 0, r: 2.9 }, line(-1.8, -2.2, -1.8, 2.2)], w: 9.4, h: 6.4, pinLabels: true },
  },
  {
    type: 'lm317', name: '가변 레귤레이터', category: '전원', prefix: 'U', defaultValue: 'LM317',
    desc: '저항 2개로 출력 전압을 정하는 레귤레이터입니다 (1.25V~). Vout = 1.25 × (1 + R2/R1). 입력·출력에 커패시터를 달아 주세요.',
    pinHelp: 'ADJ = 조정, OUT = 출력, IN = 입력',
    footprint: to220(['ADJ', 'OUT', 'IN']),
  },
  {
    type: 'hc595', name: '시프트 레지스터', category: 'IC', prefix: 'U', defaultValue: '74HC595',
    desc: '아두이노 핀 3개로 출력 8개를 늘려 줍니다. LED 여러 개를 켤 때 좋아요. 출력마다 LED 저항을 달아 주세요.',
    pinHelp: 'SER 데이터, SRCLK 시프트 클럭, RCLK 래치, OE(GND에), SRCLR(VCC에), QA~QH 출력, QH\' 다음 칩으로',
    footprint: dip(['QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'GND', "QH'", 'SRCLR', 'SRCLK', 'RCLK', 'OE', 'SER', 'QA', 'VCC']),
  },
  {
    type: 'uln2003', name: '달링턴 드라이버', category: 'IC', prefix: 'U', defaultValue: 'ULN2003A',
    desc: '작은 신호로 릴레이·스테핑 모터·부저처럼 전류가 큰 부하 7개를 켜 줍니다. 부하는 + 전원과 OUT 사이에 연결하고, 코일 부하면 COM을 + 전원에 이어요.',
    pinHelp: 'IN1~IN7 입력, OUT1~OUT7 출력(GND 쪽으로 당김), GND, COM(보호 다이오드 공통)',
    footprint: dip(['IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'GND', 'COM', 'OUT7', 'OUT6', 'OUT5', 'OUT4', 'OUT3', 'OUT2', 'OUT1']),
  },
  {
    type: 'l293d', name: '모터 드라이버', category: 'IC', prefix: 'U', defaultValue: 'L293D',
    desc: 'DC 모터 2개를 앞뒤로 돌려 줍니다. VCC1은 5V 로직 전원, VCC2는 모터 전원이에요. GND 핀 4개는 모두 GND에 연결하세요.',
    pinHelp: 'EN1/EN2 켜기, IN1~IN4 방향 입력, OUT1~OUT4 모터, VCC1 로직 5V, VCC2 모터 전원, GND',
    footprint: dip(['EN1', 'IN1', 'OUT1', 'GND', 'GND', 'OUT2', 'IN2', 'VCC2', 'EN2', 'IN3', 'OUT3', 'GND', 'GND', 'OUT4', 'IN4', 'VCC1']),
  },
  {
    type: 'esp32_devkit', name: 'ESP32 개발 보드', category: '모듈', prefix: 'A', defaultValue: 'ESP32 DevKit V1 (30핀)',
    desc: 'Wi-Fi와 블루투스가 되는 작은 컴퓨터입니다. 3.3V로 동작하니 5V 신호를 바로 넣지 마세요. 핀 소켓(암 헤더)에 꽂아 써요. 30핀 DOIT DevKit V1 기준이에요.',
    pinHelp: 'D2~D35 GPIO, VP=GPIO36, VN=GPIO39 (입력 전용), TX2=GPIO17, RX2=GPIO16, TX0/RX0 (USB 시리얼), EN 리셋, VIN 5V 입력, 3V3, GND',
    footprint: (() => {
      const fp = module2('ESP32_DevKit_V1_30pin',
        ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN'],
        ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND', '3V3'],
        25.4, 28.4, 51.6, 4);
      fp.silk.push(line(-14.2, -15.5, 14.2, -15.5));
      fp.keepout = [{ x1: -14.2, y1: -25.8, x2: 14.2, y2: -15.5, reason: 'antenna' }];
      return fp;
    })(),
  },
  {
    type: 'pico', name: '라즈베리 파이 피코', category: '모듈', prefix: 'A', defaultValue: 'Raspberry Pi Pico',
    desc: 'MicroPython이나 C로 프로그래밍하는 작은 보드입니다. 3.3V로 동작해요. USB(VBUS 5V)나 VSYS로 전원을 넣고, 핀 소켓에 꽂아 써요.',
    pinHelp: 'GP0~GP22, GP26~GP28 (GP26~28은 아날로그 입력), VBUS 5V(USB), VSYS 전원 입력, 3V3 출력, 3V3_EN, RUN 리셋, ADC_VREF, AGND, GND',
    footprint: module2('RaspberryPi_Pico',
      ['GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7', 'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15'],
      ['VBUS', 'VSYS', 'GND', '3V3_EN', '3V3', 'ADC_VREF', 'GP28', 'AGND', 'GP27', 'GP26', 'RUN', 'GP22', 'GND', 'GP21', 'GP20', 'GP19', 'GP18', 'GND', 'GP17', 'GP16'],
      17.78, 21.6, 51.6),
  },
  {
    type: 'dht22', name: '온습도 센서', category: '입력', prefix: 'U', defaultValue: 'DHT22',
    desc: '온도와 습도를 재는 센서입니다. DATA와 VCC 사이에 10kΩ 풀업 저항을 달아 주세요. 3번 핀(NC)은 연결하지 않아요. DHT11도 핀이 같아요.',
    pinHelp: 'VCC(1), DATA(2), NC(3, 연결 안 함), GND(4)',
    footprint: { name: 'DHT22_4pin', pads: inline(['VCC', 'DATA', 'NC', 'GND'], 2.54, 1.7, 1.0), silk: rect(0, 0, 15.5, 7.9), w: 16.1, h: 8.5, pinLabels: true },
  },
  {
    type: 'oled_i2c', name: 'OLED 화면 연결 (I2C)', category: '연결', prefix: 'J', defaultValue: '0.96" SSD1306',
    desc: '0.96인치 OLED 화면 모듈을 꽂는 4핀 소켓입니다. 모듈마다 GND와 VCC 순서가 바뀐 것이 있으니 모듈 뒷면 글씨를 꼭 확인하세요.',
    pinHelp: 'GND, VCC(3.3~5V), SCL(클럭), SDA(데이터) — 이 순서',
    footprint: namedHeader(['GND', 'VCC', 'SCL', 'SDA'], 'OLED_I2C_1x4'),
  },
  {
    type: 'hcsr04', name: '초음파 거리 센서 연결', category: '연결', prefix: 'J', defaultValue: 'HC-SR04',
    desc: 'HC-SR04 초음파 센서를 꽂는 4핀 소켓입니다. 5V로 동작하고, 3.3V 보드(ESP32·피코)에는 ECHO를 저항 분배로 낮춰서 연결해요.',
    pinHelp: 'VCC(5V), TRIG(보내기), ECHO(받기), GND',
    footprint: namedHeader(['VCC', 'TRIG', 'ECHO', 'GND'], 'HC-SR04_1x4'),
  },
  {
    type: 'servo', name: '서보 모터 연결', category: '연결', prefix: 'J', defaultValue: 'SG90',
    desc: '서보 모터 커넥터(3핀)를 꽂는 자리입니다. 갈색=GND, 빨강=VCC(5V), 주황=SIG(신호)예요. 서보가 여러 개면 전원을 넉넉히 주세요.',
    pinHelp: 'GND(갈색), VCC(빨강, 5V), SIG(주황, PWM 신호)',
    footprint: namedHeader(['GND', 'VCC', 'SIG'], 'Servo_1x3'),
  },
  {
    type: 'usb_power', name: 'USB-C 전원 모듈 연결', category: '전원', prefix: 'J', defaultValue: 'USB-C 5V',
    desc: 'USB-C 전원 보드(브레이크아웃)의 + / - 핀을 연결하는 자리입니다. 휴대폰 충전기로 5V를 쓸 수 있어요.',
    pinHelp: 'VBUS = 5V(+), GND = -',
    footprint: namedHeader(['VBUS', 'GND'], 'USB_C_Power_1x2'),
  },
  {
    type: 'terminal3', name: '나사 단자 3핀', category: '연결', prefix: 'J', defaultValue: '3P 5.08mm',
    desc: '전선을 나사로 고정하는 3핀 단자입니다. 모터, 릴레이 출력, 센서 선을 연결할 때 써요.',
    pinHelp: '1, 2, 3',
    footprint: { name: 'TerminalBlock_1x3_P5.08', pads: inline(['1', '2', '3'], 5.08, 2.4, 1.3), silk: rect(0, 0, 15.3, 7.6), w: 15.9, h: 8.2 },
  },
  // ── 실전 확장 부품 ──
  {
    type: 'dc_jack', name: 'DC 배럴잭 (5.5×2.1)', category: '전원', prefix: 'J', defaultValue: 'DC 12V',
    desc: '일반 원형 전원 어댑터(5.5×2.1mm, 센터 플러스)를 꽂는 소켓입니다. PJ-002A 표준 규격이에요.',
    pinHelp: 'VIN(중앙 +), GND(바깥 -), SW(플러그 감지 스위치, 미사용 시 비움)',
    footprint: {
      name: 'BarrelJack_PJ002A',
      pads: [
        { num: 1, pin: 'VIN', x: 0, y: -4.5, w: 2.6, h: 2.6, shape: 'rect', drill: 1.5 },
        { num: 2, pin: 'GND', x: 0, y: 1.5, w: 2.6, h: 2.6, shape: 'circle', drill: 1.5 },
        { num: 3, pin: 'SW', x: -4.7, y: -1.5, w: 2.4, h: 2.4, shape: 'circle', drill: 1.4 },
      ],
      silk: [...rect(0, 0, 9.0, 14.4), line(-4.5, 5.5, 4.5, 5.5)],
      w: 12.6,
      h: 15.0,
      pinLabels: true,
    },
  },
  {
    type: 'polyfuse', name: '복구형 퓨즈 (PTC)', category: '전원', prefix: 'F', defaultValue: '500mA',
    desc: '과전류가 흐르면 자동으로 차단되고, 식으면 다시 복구되는 안전 퓨즈입니다. 전원 입력 직후에 직렬로 달아 보드를 보호해요.',
    pinHelp: '1, 2 (방향 없음)',
    footprint: { name: 'Fuse_PTC_P5.08', pads: inline(['1', '2'], 5.08, 1.8, 0.9), silk: rect(0, 0, 6.6, 2.8), w: 7.4, h: 3.6 },
  },
  {
    type: 'buck_mod', name: 'DC-DC 벅 컨버터 모듈', category: '전원', prefix: 'U', defaultValue: 'LM2596/MP1584',
    desc: '높은 전압(12~24V)을 열 손실 적게 5V/3.3V로 낮춰주는 모듈 소켓입니다. 리니어 레귤레이터보다 큰 전류에 적합해요.',
    pinHelp: 'IN+, IN- (입력), OUT+, OUT- (강압 출력)',
    footprint: {
      name: 'BuckModule_4pin',
      pads: [
        { num: 1, pin: 'IN+', x: -16.5, y: -6.5, w: 2.6, h: 2.6, shape: 'rect', drill: 1.3 },
        { num: 2, pin: 'IN-', x: -16.5, y: 6.5, w: 2.6, h: 2.6, shape: 'circle', drill: 1.3 },
        { num: 3, pin: 'OUT+', x: 16.5, y: -6.5, w: 2.6, h: 2.6, shape: 'circle', drill: 1.3 },
        { num: 4, pin: 'OUT-', x: 16.5, y: 6.5, w: 2.6, h: 2.6, shape: 'circle', drill: 1.3 },
      ],
      silk: rect(0, 0, 38.0, 19.0),
      w: 39.0,
      h: 20.0,
      pinLabels: true,
    },
  },
  {
    type: 'relay_5v', name: '5V 릴레이 (SRD-05VDC)', category: '출력', prefix: 'K', defaultValue: 'SRD-05VDC',
    desc: '작은 제어 신호로 큰 전력 부하를 켜고 끄는 기계식 스위치입니다. 코일은 트랜지스터(NPN/ULN2003)로 구동하고, 코일 양단에 보호 다이오드(1N4007)를 역방향으로 달아 주세요.',
    pinHelp: 'COIL1/COIL2(코일), COM(공통), NO(평소 열림), NC(평소 닫힘)',
    footprint: {
      name: 'Relay_SPDT_SRD',
      pads: [
        { num: 1, pin: 'COIL1', x: -6.0, y: -6.0, w: 2.2, h: 2.2, shape: 'rect', drill: 1.2 },
        { num: 2, pin: 'COM', x: -6.0, y: 0, w: 2.2, h: 2.2, shape: 'circle', drill: 1.2 },
        { num: 3, pin: 'COIL2', x: -6.0, y: 6.0, w: 2.2, h: 2.2, shape: 'circle', drill: 1.2 },
        { num: 4, pin: 'NO', x: 6.2, y: 6.0, w: 2.2, h: 2.2, shape: 'circle', drill: 1.2 },
        { num: 5, pin: 'NC', x: 6.2, y: -6.0, w: 2.2, h: 2.2, shape: 'circle', drill: 1.2 },
      ],
      silk: [...rect(0, 0, 19.0, 15.5), line(-1.5, -7.75, -1.5, 7.75)],
      w: 19.6,
      h: 16.2,
      pinLabels: true,
    },
  },
  ...[2, 3, 4].map((n) => ({
    type: `jst_xh${n}`, name: `JST-XH ${n}핀 커넥터`, category: '연결', prefix: 'J', defaultValue: `XH-${n}P`,
    desc: `거꾸로 꽂히지 않는 잠금형 2.5mm 와이어 커넥터(${n}핀)입니다. 배터리·센서·팬 연결에 많이 써요.`,
    pinHelp: `1 ~ ${n} (상단 노치 기준으로 방향 확인)`,
    footprint: jstXh(n),
  })),
  {
    type: 'header2x4', name: '2열 핀 헤더 2×4 (8핀)', category: '연결', prefix: 'J', defaultValue: '2x4P',
    desc: 'NRF24L01 무선 모듈, ISP 프로그래머, SPI 확장 등에 쓰는 2열 8핀 헤더입니다.',
    pinHelp: '1~8 (윗줄 1,3,5,7 / 아랫줄 2,4,6,8)',
    footprint: header2x(4),
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
