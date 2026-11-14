// 부품 라이브러리의 영어 이름·설명
import { getLang } from '../i18n';
import type { PartDef } from './library';

const CATS: Record<string, string> = {
  '기본 부품': 'Basic parts',
  '반도체': 'Semiconductors',
  '전원': 'Power',
  IC: 'ICs',
  '모듈': 'Modules',
  '연결': 'Connectors',
  '입력': 'Input',
  '출력': 'Output',
};

type En = { name: string; desc: string; pinHelp?: string; value?: string };

const EN: Record<string, En> = {
  resistor: { name: 'Resistor', desc: 'Limits current. Use it to protect an LED or divide a voltage. It has no direction, so it can go in either way.', pinHelp: '1, 2 (no direction)' },
  capacitor: { name: 'Ceramic capacitor', desc: 'Stores a little charge and releases it. A 100nF next to an IC power pin reduces noise. No direction.', pinHelp: '1, 2 (no direction)' },
  capacitor_pol: { name: 'Electrolytic capacitor', desc: 'A large capacitor that smooths the power supply. It has polarity (+/-), so mind the direction! The longer leg is +.', pinHelp: '+ (long leg), - (short leg, striped side)' },
  led: { name: 'LED (5mm)', desc: 'A diode that emits light. Always use it with a resistor or it will burn out. The longer leg is A (+), the shorter is K (-).', pinHelp: 'A = anode (+, long leg), K = cathode (-, short leg)', value: 'Red' },
  diode: { name: 'Diode', desc: 'Lets current flow in only one direction. Protects the circuit if power is connected backwards. The banded side is K.', pinHelp: 'A = anode, K = cathode (band)' },
  npn: { name: 'NPN transistor', desc: 'A switch that turns a large current on and off with a small signal. Use it to drive motors or many LEDs from an Arduino.', pinHelp: 'E = emitter (to GND), B = base (control, through a resistor), C = collector (to the load)' },
  pnp: { name: 'PNP transistor', desc: 'Works the opposite way to an NPN. Used to switch the positive (+) side.', pinHelp: 'E = emitter (to +), B = base, C = collector' },
  nmos: { name: 'N-MOSFET (small)', desc: 'A voltage-controlled switch. Put a voltage on the gate (G) and D-S connects.', pinHelp: 'S = source (GND), G = gate (control), D = drain (load)' },
  nmos_power: { name: 'N-MOSFET (power)', desc: 'A switch for large currents such as motors or LED strips. Can be driven directly by 5V logic.', pinHelp: 'G = gate, D = drain, S = source' },
  regulator_5v: { name: '5V regulator', desc: 'Turns a 7–12V input into a steady 5V. Add capacitors on the input and output.', pinHelp: 'IN = input, GND = ground, OUT = 5V output' },
  regulator_3v3: { name: '3.3V regulator', desc: 'Turns 5V (etc.) into 3.3V for an ESP32 or sensors. Needs a 10uF capacitor on the output.', pinHelp: 'GND = ground, OUT = 3.3V output, IN = input' },
  power_in: { name: 'Power terminal', desc: 'A screw terminal for the power input. Connect battery or adapter wires here.', pinHelp: '+ = positive, - = GND', value: '5V input' },
  ne555: { name: '555 timer', desc: 'A famous IC for blinking (oscillating) and timing. Two resistors and one capacitor make an LED blink.', pinHelp: '1 GND, 2 TRIG, 3 OUT, 4 RESET, 5 CTRL, 6 THR, 7 DIS, 8 VCC' },
  lm358: { name: 'Op-amp', desc: 'Amplifies small signals or compares two voltages. Contains two amplifiers.', pinHelp: '1 OUT1, 2 IN1-, 3 IN1+, 4 GND, 5 IN2+, 6 IN2-, 7 OUT2, 8 VCC' },
  arduino_nano: { name: 'Arduino Nano', desc: 'A small programmable computer. Plug it into header sockets. USB gives it power and code.', pinHelp: 'D0–D13 digital, A0–A7 analog, 5V, 3V3, VIN, GND, RST, AREF' },
  button: { name: 'Push button', desc: 'Connects only while pressed. It has 4 legs, but they are connected in pairs inside.', pinHelp: '1, 2 (pressing connects 1-2)', value: '6mm tactile' },
  switch: { name: 'Slide switch', desc: 'Slide to turn on and off. Often used as a power switch.', pinHelp: 'A, COM (middle), B — COM connects to A or B' },
  potentiometer: { name: 'Potentiometer', desc: 'Turn the knob to change resistance. Used for brightness or volume; the middle pin (W) gives the voltage.', pinHelp: '1, W (middle, wiper), 3' },
  ldr: { name: 'Light sensor (LDR)', desc: 'Its resistance drops in bright light. Use it with a resistor as a voltage divider.', pinHelp: '1, 2 (no direction)' },
  buzzer: { name: 'Buzzer', desc: 'Makes sound. An active buzzer beeps as soon as it gets power. It has +/- polarity.', pinHelp: '+ (long leg), -', value: 'Active 5V' },
};

const en = (def: PartDef): En | undefined => {
  if (EN[def.type]) return EN[def.type];
  const dip = def.type.match(/^ic_dip(\d+)$/);
  if (dip) return { name: `Generic IC (DIP-${dip[1]})`, desc: `A ${dip[1]}-pin DIP IC. Connect by pin number (1–${dip[1]}). Pin 1 is next to the dot mark.`, pinHelp: `1 – ${dip[1]}` };
  const hdr = def.type.match(/^header(\d+)$/);
  if (hdr) return { name: `Pin header, ${hdr[1]} pins`, desc: `A ${hdr[1]}-pin connector for external sensors, modules, or wires.`, pinHelp: `1 – ${hdr[1]}` };
  return undefined;
};

const isEn = () => getLang() === 'en';
export const partName = (d: PartDef) => (isEn() ? en(d)?.name ?? d.name : d.name);
export const partDesc = (d: PartDef) => (isEn() ? en(d)?.desc ?? d.desc : d.desc);
export const partPinHelp = (d: PartDef) => (isEn() ? en(d)?.pinHelp ?? d.pinHelp : d.pinHelp);
export const partDefaultValue = (d: PartDef) => (isEn() ? en(d)?.value ?? d.defaultValue : d.defaultValue);
export const catName = (c: string) => (isEn() ? CATS[c] ?? c : c);
