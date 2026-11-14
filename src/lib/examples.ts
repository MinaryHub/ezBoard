// API 키 없이도 바로 체험할 수 있는 예제 회로 (한국어/영어)
import type { AiCircuit } from './ai';
import type { Lang } from '../i18n';

type L = { ko: string; en: string };
type ExPart = { ref: string; type: string; value: L | string; note?: L };
type Ex = { title: L; desc: L; prompt: L; name: string; board: { width: number; height: number }; parts: ExPart[]; nets: AiCircuit['nets'] };

const RAW: Ex[] = [
  {
    title: { ko: 'LED 켜기', en: 'Light an LED' },
    desc: { ko: '가장 간단한 회로: 전원 + 저항 + LED', en: 'The simplest circuit: power + resistor + LED' },
    prompt: { ko: '5V 전원으로 LED 하나 켜는 회로 만들어줘', en: 'Make a circuit that lights one LED from 5V' },
    name: 'LED ON',
    board: { width: 40, height: 30 },
    parts: [
      { ref: 'J1', type: 'power_in', value: { ko: '5V 입력', en: '5V input' }, note: { ko: '5V 전원 연결', en: '5V power input' } },
      { ref: 'R1', type: 'resistor', value: '330Ω', note: { ko: '(5V-2V)/330Ω ≈ 9mA로 LED 보호', en: '(5V-2V)/330Ω ≈ 9mA protects the LED' } },
      { ref: 'LED1', type: 'led', value: { ko: '빨강', en: 'Red' } },
    ],
    nets: [
      { name: 'VCC', pins: ['J1.+', 'R1.1'] },
      { name: 'LED_A', pins: ['R1.2', 'LED1.A'] },
      { name: 'GND', pins: ['LED1.K', 'J1.-'] },
    ],
  },
  {
    title: { ko: '555 LED 깜빡이', en: '555 LED blinker' },
    desc: { ko: '555 타이머로 LED가 약 1초마다 깜빡여요', en: 'A 555 timer blinks an LED about once per second' },
    prompt: { ko: '555 타이머로 LED 깜빡이는 회로 만들어줘', en: 'Make an LED blinker with a 555 timer' },
    name: '555 BLINKER',
    board: { width: 50, height: 40 },
    parts: [
      { ref: 'J1', type: 'power_in', value: { ko: '5~9V 입력', en: '5–9V input' } },
      { ref: 'U1', type: 'ne555', value: 'NE555', note: { ko: '비안정 멀티바이브레이터', en: 'astable multivibrator' } },
      { ref: 'R1', type: 'resistor', value: '10kΩ', note: { ko: 'RA', en: 'RA' } },
      { ref: 'R2', type: 'resistor', value: '68kΩ', note: { ko: 'RB — 깜빡임 속도 결정', en: 'RB — sets the blink rate' } },
      { ref: 'C1', type: 'capacitor_pol', value: '10uF', note: { ko: '타이밍 커패시터 (약 1Hz)', en: 'timing capacitor (about 1 Hz)' } },
      { ref: 'C2', type: 'capacitor', value: '10nF', note: { ko: 'CTRL 핀 안정화', en: 'stabilizes the CTRL pin' } },
      { ref: 'C3', type: 'capacitor', value: '100nF', note: { ko: '전원 노이즈 제거', en: 'removes power noise' } },
      { ref: 'R3', type: 'resistor', value: '470Ω', note: { ko: 'LED 전류 제한', en: 'limits LED current' } },
      { ref: 'LED1', type: 'led', value: { ko: '빨강', en: 'Red' } },
    ],
    nets: [
      { name: 'VCC', pins: ['J1.+', 'U1.VCC', 'U1.RESET', 'R1.1', 'C3.1'] },
      { name: 'GND', pins: ['J1.-', 'U1.GND', 'C1.-', 'C2.2', 'C3.2', 'LED1.K'] },
      { name: 'DIS', pins: ['R1.2', 'R2.1', 'U1.DIS'] },
      { name: 'TIMING', pins: ['R2.2', 'U1.THR', 'U1.TRIG', 'C1.+'] },
      { name: 'CTRL', pins: ['U1.CTRL', 'C2.1'] },
      { name: 'OUT', pins: ['U1.OUT', 'R3.1'] },
      { name: 'LED_A', pins: ['R3.2', 'LED1.A'] },
    ],
  },
  {
    title: { ko: '아두이노 신호등', en: 'Arduino traffic light' },
    desc: { ko: '아두이노 나노 + LED 3개 + 버튼', en: 'Arduino Nano + 3 LEDs + a button' },
    prompt: { ko: '아두이노 나노로 빨강/노랑/초록 신호등이랑 버튼 하나 만들어줘', en: 'Make a red/yellow/green traffic light with a button on an Arduino Nano' },
    name: 'NANO TRAFFIC',
    board: { width: 60, height: 60 },
    parts: [
      { ref: 'A1', type: 'arduino_nano', value: 'Arduino Nano', note: { ko: 'USB로 전원·코드 업로드', en: 'power and code over USB' } },
      { ref: 'R1', type: 'resistor', value: '220Ω' },
      { ref: 'R2', type: 'resistor', value: '220Ω' },
      { ref: 'R3', type: 'resistor', value: '220Ω' },
      { ref: 'LED1', type: 'led', value: { ko: '빨강', en: 'Red' } },
      { ref: 'LED2', type: 'led', value: { ko: '노랑', en: 'Yellow' } },
      { ref: 'LED3', type: 'led', value: { ko: '초록', en: 'Green' } },
      { ref: 'SW1', type: 'button', value: { ko: '6mm 택트', en: '6mm tactile' }, note: { ko: 'D2, 내부 풀업 사용 (INPUT_PULLUP)', en: 'D2, uses the internal pull-up (INPUT_PULLUP)' } },
    ],
    nets: [
      { name: 'D5', pins: ['A1.D5', 'R1.1'] },
      { name: 'D6', pins: ['A1.D6', 'R2.1'] },
      { name: 'D7', pins: ['A1.D7', 'R3.1'] },
      { name: 'LED1_A', pins: ['R1.2', 'LED1.A'] },
      { name: 'LED2_A', pins: ['R2.2', 'LED2.A'] },
      { name: 'LED3_A', pins: ['R3.2', 'LED3.A'] },
      { name: 'BTN', pins: ['A1.D2', 'SW1.1'] },
      { name: 'GND', pins: ['A1.GND', 'LED1.K', 'LED2.K', 'LED3.K', 'SW1.2'] },
    ],
  },
];

export interface Example { title: string; desc: string; prompt: string; circuit: AiCircuit }

export function getExamples(lang: Lang): Example[] {
  const pick = (v: L | string | undefined) => (v === undefined ? undefined : typeof v === 'string' ? v : v[lang]);
  return RAW.map((e) => ({
    title: e.title[lang],
    desc: e.desc[lang],
    prompt: e.prompt[lang],
    circuit: {
      name: e.name,
      board: e.board,
      parts: e.parts.map((p) => ({ ref: p.ref, type: p.type, value: pick(p.value), note: pick(p.note) })),
      nets: e.nets,
    },
  }));
}

/** 이전 코드 호환용 (한국어) */
export const EXAMPLES = getExamples('ko');
