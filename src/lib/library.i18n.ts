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
  zener: { name: 'Zener diode', desc: 'Connected in reverse, it holds the voltage at a set level (e.g. 5.1V). Used for input protection or a simple reference. The banded side is K.', pinHelp: 'A = anode, K = cathode (band)' },
  crystal: { name: 'Crystal', desc: 'Gives an IC an accurate clock. Connect each pin to GND through a 22pF capacitor. No direction.', pinHelp: '1, 2 (no direction)' },
  rgb_led: { name: 'RGB LED (common cathode)', desc: 'Mixes red, green and blue into many colors. Each color needs its own resistor. The longest leg is the common K (-).', pinHelp: 'R, K (longest leg, common -), G, B' },
  lm317: { name: 'Adjustable regulator', desc: 'Two resistors set the output voltage (from 1.25V). Vout = 1.25 × (1 + R2/R1). Add capacitors on the input and output.', pinHelp: 'ADJ = adjust, OUT = output, IN = input' },
  hc595: { name: 'Shift register', desc: 'Turns 3 Arduino pins into 8 outputs. Great for many LEDs. Give each output its own LED resistor.', pinHelp: "SER data, SRCLK shift clock, RCLK latch, OE (to GND), SRCLR (to VCC), QA–QH outputs, QH' to the next chip" },
  uln2003: { name: 'Darlington driver', desc: 'Lets small signals switch 7 high-current loads such as relays, stepper motors or buzzers. Connect each load between + and OUT; for coils, tie COM to +.', pinHelp: 'IN1–IN7 inputs, OUT1–OUT7 outputs (pull to GND), GND, COM (protection diode common)' },
  l293d: { name: 'Motor driver', desc: 'Drives two DC motors forward and backward. VCC1 is 5V logic power, VCC2 is motor power. Connect all four GND pins to GND.', pinHelp: 'EN1/EN2 enable, IN1–IN4 direction, OUT1–OUT4 motors, VCC1 logic 5V, VCC2 motor power, GND' },
  esp32_devkit: { name: 'ESP32 dev board', desc: 'A small computer with Wi-Fi and Bluetooth. It runs at 3.3V, so do not feed it 5V signals directly. Plug it into female headers. Based on the 30-pin DOIT DevKit V1.', pinHelp: 'D2–D35 GPIO, VP=GPIO36, VN=GPIO39 (input only), TX2=GPIO17, RX2=GPIO16, TX0/RX0 (USB serial), EN reset, VIN 5V in, 3V3, GND', value: 'ESP32 DevKit V1 (30-pin)' },
  pico: { name: 'Raspberry Pi Pico', desc: 'A small board you program in MicroPython or C. Runs at 3.3V. Power it from USB (VBUS 5V) or VSYS, and plug it into female headers.', pinHelp: 'GP0–GP22, GP26–GP28 (GP26–28 are analog inputs), VBUS 5V (USB), VSYS power in, 3V3 out, 3V3_EN, RUN reset, ADC_VREF, AGND, GND' },
  dht22: { name: 'Temperature & humidity sensor', desc: 'Measures temperature and humidity. Put a 10kΩ pull-up between DATA and VCC. Pin 3 (NC) is not connected. A DHT11 has the same pins.', pinHelp: 'VCC (1), DATA (2), NC (3, leave open), GND (4)' },
  oled_i2c: { name: 'OLED display socket (I2C)', desc: 'A 4-pin socket for a 0.96" OLED module. Some modules swap GND and VCC, so check the labels on the back of yours.', pinHelp: 'GND, VCC (3.3–5V), SCL (clock), SDA (data) — in this order' },
  hcsr04: { name: 'Ultrasonic distance sensor socket', desc: 'A 4-pin socket for an HC-SR04. It runs on 5V; with a 3.3V board (ESP32, Pico) bring ECHO down through a resistor divider.', pinHelp: 'VCC (5V), TRIG (send), ECHO (receive), GND' },
  servo: { name: 'Servo connector', desc: 'Where a servo plug (3 pins) goes. Brown = GND, red = VCC (5V), orange = SIG. With several servos, give them plenty of power.', pinHelp: 'GND (brown), VCC (red, 5V), SIG (orange, PWM)' },
  usb_power: { name: 'USB-C power module', desc: 'Connects the + / - pins of a USB-C power breakout so you can use a phone charger for 5V.', pinHelp: 'VBUS = 5V (+), GND = -', value: 'USB-C 5V' },
  terminal3: { name: '3-pin screw terminal', desc: 'A 3-pin terminal that clamps wires with screws. For motors, relay outputs or sensor wires.', pinHelp: '1, 2, 3' },
  buzzer: { name: 'Buzzer', desc: 'Makes sound. An active buzzer beeps as soon as it gets power. It has +/- polarity.', pinHelp: '+ (long leg), -', value: 'Active 5V' },
  dc_jack: { name: 'DC barrel jack (5.5×2.1)', desc: 'Standard round DC power socket (5.5×2.1mm, center positive, PJ-002A).', pinHelp: 'VIN (center +), GND (sleeve -), SW (plug detect switch, optional)' },
  polyfuse: { name: 'Resettable fuse (PTC)', desc: 'Trips on overcurrent and resets once cool. Place in series with power input to protect the board.', pinHelp: '1, 2 (no direction)' },
  buck_mod: { name: 'DC-DC buck module', desc: 'Step-down converter module (LM2596/MP1584) for efficient 12–24V to 5V/3.3V conversion at higher currents.', pinHelp: 'IN+, IN- (input), OUT+, OUT- (regulated output)' },
  relay_5v: { name: '5V relay (SRD-05VDC)', desc: 'Electromechanical switch for high-power loads. Drive the coil via a transistor/ULN2003 and add a reverse flyback diode (1N4007) across COIL1–COIL2.', pinHelp: 'COIL1/COIL2 (coil), COM (common), NO (normally open), NC (normally closed)' },
  header2x4: { name: '2×4 pin header (8-pin)', desc: 'Dual-row 8-pin header for NRF24L01 modules, ISP programmers, or SPI expansion.', pinHelp: '1–8 (top 1,3,5,7 / bottom 2,4,6,8)' },
};

const en = (def: PartDef): En | undefined => {
  if (EN[def.type]) return EN[def.type];
  const dip = def.type.match(/^ic_dip(\d+)$/);
  if (dip) return { name: `Generic IC (DIP-${dip[1]})`, desc: `A ${dip[1]}-pin DIP IC. Connect by pin number (1–${dip[1]}). Pin 1 is next to the dot mark.`, pinHelp: `1 – ${dip[1]}` };
  const hdr = def.type.match(/^header(\d+)$/);
  if (hdr) return { name: `Pin header, ${hdr[1]} pins`, desc: `A ${hdr[1]}-pin connector for external sensors, modules, or wires.`, pinHelp: `1 – ${hdr[1]}` };
  const jst = def.type.match(/^jst_xh(\d+)$/);
  if (jst) return { name: `JST-XH ${jst[1]}-pin connector`, desc: `Keyed 2.5mm locking wire connector (${jst[1]}-pin) that prevents reverse plugging. Great for batteries, fans, and sensors.`, pinHelp: `1 – ${jst[1]} (check top notch for orientation)` };
  return undefined;
};

const isEn = () => getLang() === 'en';
export const partName = (d: PartDef) => (isEn() ? en(d)?.name ?? d.name : d.name);
export const partDesc = (d: PartDef) => (isEn() ? en(d)?.desc ?? d.desc : d.desc);
export const partPinHelp = (d: PartDef) => (isEn() ? en(d)?.pinHelp ?? d.pinHelp : d.pinHelp);
export const partDefaultValue = (d: PartDef) => (isEn() ? en(d)?.value ?? d.defaultValue : d.defaultValue);
export const catName = (c: string) => (isEn() ? CATS[c] ?? c : c);
