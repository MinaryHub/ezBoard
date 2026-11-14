// 앱 스토어 등록용 스크린샷 생성기
// 사용법: npm run build && npx electron scripts/screenshots.cjs
// 빌드된 dist/를 숨은 창에 띄워 예제 회로를 불러오고, 화면을 정해진 크기로 캡처한다.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots');
const MODE = process.env.SHOT_MODE; // 'desktop2x' | 'desktop1x' | 'phone' | 'feature' (없으면 전체를 하위 프로세스로 실행)

// w,h: 화면(CSS) 크기, zoom: 페이지 확대 배율, out: 저장할 이미지 크기
const MODES = {
  desktop2x: { w: 1440, h: 900, zoom: 1, out: [2880, 1800], dir: 'desktop-2880x1800' },
  desktop1x: { w: 1920, h: 1080, zoom: 1, out: [1920, 1080], dir: 'desktop-1920x1080' },
  phone: { w: 540, h: 960, zoom: 1.5, out: [1080, 1920], dir: 'android-phone-1080x1920' },
};

if (!MODE) {
  // 배율마다 별도 프로세스로 실행 (장치 배율은 프로세스 시작 시에만 정할 수 있음)
  for (const m of ['desktop2x', 'desktop1x', 'phone', 'feature']) {
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, SHOT_MODE: m }, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  process.exit(0);
}


const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeWindow(w, h) {
  const win = new BrowserWindow({
    width: w, height: h, useContentSize: true, show: false, enableLargerThanScreen: true, frame: false,
    backgroundColor: '#0f1216',
    webPreferences: { backgroundThrottling: false, partition: `shot-${MODE}-${Date.now()}` },
  });
  win.setContentSize(w, h);
  return win;
}

async function shot(win, file, out = MODES[MODE]?.out) {
  await wait(500);
  let img = await win.webContents.capturePage();
  // 디스플레이 배율(레티나 등)과 관계없이 스토어 규격 크기로 맞춘다
  if (out && (img.getSize().width !== out[0] || img.getSize().height !== out[1])) img = img.resize({ width: out[0], height: out[1], quality: 'best' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, img.toPNG());
  const { width, height } = img.getSize();
  console.log(`  ${path.relative(ROOT, file)}  ${width}x${height}`);
}

const js = (win, code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
const click = (sel, idx = 0) => `document.querySelectorAll(${JSON.stringify(sel)})[${idx}]?.click(); await new Promise(r => setTimeout(r, 400));`;
const clickText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(b => b.textContent.includes(${JSON.stringify(text)}))?.click(); await new Promise(r => setTimeout(r, 400));`;
const hover = (sel, text) => `{ const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(b => b.textContent.includes(${JSON.stringify(text)}));
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse', clientX: r.x + 4, clientY: r.y + 4 }));
  await new Promise(r => setTimeout(r, 900)); }`;

async function load(win, file = path.join(ROOT, 'dist', 'index.html')) {
  for (let i = 0; ; i++) {
    try { await win.loadFile(file); if (MODES[MODE]) win.webContents.setZoomFactor(MODES[MODE].zoom); return; }
    catch (e) { if (i >= 4) throw e; await wait(800); }
  }
}

async function fresh(win, lang) {
  await load(win);
  await js(win, `localStorage.clear(); localStorage.setItem('ezboard.lang', '${lang}');
    localStorage.setItem('ezboard.settings', JSON.stringify({ provider: 'claude', keys: { claude: 'demo', gemini: 'demo', openai: 'demo' } }));`);
  await load(win);
  await wait(600);
}

// 영어가 기본 세트, 한국어는 ko/ 아래
const langDir = (lang) => (lang === 'en' ? OUT : path.join(OUT, 'ko'));
const LANGS = ['en', 'ko'];

// 스토어 화면용 AI 대화 (실제 앱이 보여주는 답변 형식과 같게)
const CHAT = {
  en: {
    blink: [
      { role: 'user', content: 'I want an LED that blinks about once a second, powered by a 9V battery.' },
      { role: 'assistant', circuitApplied: true, content: "Here's a classic **555 timer blinker**, a great first project!\n\n#### How it works\n- The 555 timer (**U1**) charges and discharges **C1** through **R1** and **R2**, switching its OUT pin on and off.\n- With 10kΩ, 68kΩ and 10µF it toggles about **once per second** (f ≈ 1.44 / ((R1 + 2·R2)·C1) ≈ 1 Hz).\n- **R3** (470Ω) limits the LED current to about 12 mA so it won't burn out.\n- **C3** (100nF) next to the IC keeps the power supply clean.\n\n#### Soldering tips\n1. Start with the low parts: resistors and ceramic capacitors.\n2. Mind the polarity of **C1** (+) and the **LED** (long leg = A).\n\n✅ **Applied to the PCB** — placed 9 parts, auto routing done" },
    ],
    nano: [
      { role: 'user', content: 'Make a traffic light with red, yellow and green LEDs and a button on an Arduino Nano.' },
      { role: 'assistant', circuitApplied: true, content: "Done! Here's your **Arduino traffic light**.\n\n- Each LED gets its own **220Ω** resistor on pins **D5, D6, D7**.\n- The button goes to **D2** and uses the Nano's internal pull-up (`INPUT_PULLUP`), so no extra resistor is needed.\n- Power and code both come over USB.\n\n✅ **Applied to the PCB** — placed 8 parts, auto routing done" },
    ],
  },
  ko: {
    blink: [
      { role: 'user', content: '9V 건전지로 1초마다 깜빡이는 LED 만들고 싶어' },
      { role: 'assistant', circuitApplied: true, content: "초보자에게 딱 좋은 **555 타이머 깜빡이** 회로를 만들었어요!\n\n#### 동작 원리\n- 555 타이머(**U1**)가 **R1**, **R2**를 통해 **C1**을 충전·방전하면서 OUT 핀을 켰다 껐다 해요.\n- 10kΩ, 68kΩ, 10µF 조합이면 약 **1초에 한 번** 깜빡여요 (f ≈ 1.44 / ((R1 + 2·R2)·C1) ≈ 1Hz).\n- **R3**(470Ω)가 LED 전류를 약 12mA로 제한해서 LED가 타지 않아요.\n- IC 옆의 **C3**(100nF)가 전원 노이즈를 줄여줘요.\n\n#### 납땜 팁\n1. 키가 낮은 부품(저항, 세라믹 커패시터)부터 납땜하세요.\n2. **C1**(+)과 **LED**(긴 다리 = A)의 방향을 꼭 확인하세요.\n\n✅ **PCB에 적용했어요** — 부품 9개 배치, 자동 배선 완료" },
    ],
    nano: [
      { role: 'user', content: '아두이노 나노로 빨강/노랑/초록 신호등이랑 버튼 하나 만들어줘' },
      { role: 'assistant', circuitApplied: true, content: "**아두이노 신호등**을 만들었어요!\n\n- LED마다 **220Ω** 저항을 달아 **D5, D6, D7** 핀에 연결했어요.\n- 버튼은 **D2**에 연결하고 나노의 내부 풀업(`INPUT_PULLUP`)을 쓰니까 저항이 따로 필요 없어요.\n- 전원과 코드는 USB로 넣으면 돼요.\n\n✅ **PCB에 적용했어요** — 부품 8개 배치, 자동 배선 완료" },
    ],
  },
};

// 예제 회로를 불러온 뒤 대화 내용을 스토어용 대화로 바꾸고 다시 불러온다
async function loadExampleWithChat(win, idx, msgs) {
  await js(win, click('.example', idx));
  await js(win, `localStorage.setItem('ezboard.chat', ${JSON.stringify(JSON.stringify(msgs))});`);
  await load(win);
  await wait(700);
}

const L = {
  ko: { autoRoute: '자동 배선', pcb: 'PCB', real: '실물 보기', order: '주문', check: '검사', sch: '회로도', side: '부품·주문', chat: 'AI 대화' },
  en: { autoRoute: 'Auto route', pcb: 'PCB', real: 'Realistic', order: 'Order', check: 'Check', sch: 'Schematic', side: 'Parts & order', chat: 'AI chat' },
};

async function desktop(cfg) {
  const win = await makeWindow(cfg.w, cfg.h);
  for (const lang of LANGS) {
    const dir = path.join(langDir(lang), cfg.dir);
    await fresh(win, lang);
    // 1. 환영 화면
    await shot(win, path.join(dir, '01-welcome.png'));
    // 2. AI 대화 + 회로도 (555 예제)
    await loadExampleWithChat(win, 1, CHAT[lang].blink);
    await shot(win, path.join(dir, '02-ai-schematic.png'));
    // 3. PCB 편집 + 기능 설명 풍선
    await js(win, clickText('.stage-switch button', L[lang].pcb));
    await js(win, click('.tabs button', 3));
    await js(win, hover('.toolbar button', L[lang].autoRoute));
    await shot(win, path.join(dir, '03-pcb-tooltip.png'));
    // 4. 실물 보기 + 주문 파일
    await js(win, `document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));`);
    await js(win, clickText('.seg button', L[lang].real));
    await js(win, click('.tabs button', 4));
    await shot(win, path.join(dir, '04-realistic-order.png'));
    // 5. 아두이노 예제 회로도
    await js(win, `window.confirm = () => true;` + click('.top-actions button', 0));
    await loadExampleWithChat(win, 2, CHAT[lang].nano);
    await shot(win, path.join(dir, '05-arduino-schematic.png'));
  }
  win.destroy();
}

async function phone(cfg) {
  const win = await makeWindow(cfg.w, cfg.h);
  for (const lang of LANGS) {
    const dir = path.join(langDir(lang), cfg.dir);
    await fresh(win, lang);
    await shot(win, path.join(dir, '01-welcome.png'));
    await loadExampleWithChat(win, 1, CHAT[lang].blink);
    await js(win, clickText('.mobile-nav button', L[lang].sch));
    await shot(win, path.join(dir, '02-schematic.png'));
    await js(win, clickText('.stage-switch button', L[lang].pcb));
    await shot(win, path.join(dir, '03-pcb.png'));
    await js(win, clickText('.seg button', L[lang].real));
    await shot(win, path.join(dir, '04-realistic.png'));
    await js(win, clickText('.mobile-nav button', L[lang].side));
    await js(win, click('.tabs button', 4));
    await shot(win, path.join(dir, '05-order.png'));
    await js(win, clickText('.mobile-nav button', L[lang].chat));
    await js(win, `const l = document.querySelector('.chat-list'); l.style.scrollBehavior = 'auto'; l.scrollTop = 0; await new Promise(r => setTimeout(r, 300));`);
    await shot(win, path.join(dir, '06-chat.png'));
  }
  win.destroy();
}

// Google Play 대표 이미지 (1024x500)
async function feature() {
  const logo = fs.readFileSync(path.join(ROOT, 'logo', 'logo-dark-transparent.svg')).toString('base64');
  for (const lang of LANGS) {
    const shotFile = path.join(langDir(lang), 'desktop-1920x1080', '03-pcb-tooltip.png');
    const img = fs.readFileSync(shotFile).toString('base64');
    const text = lang === 'ko'
      ? { t: '말로 만드는 PCB', s: 'AI와 대화하면 회로도, PCB, 주문 파일까지<br>초보자도 쉽게 완성해요', b: ['Claude · Gemini · GPT', '자동 배치 · 자동 배선', '거버 파일 내보내기'] }
      : { t: 'Design PCBs by chatting', s: 'Talk to AI and get a schematic, a PCB,<br>and order files. Made for beginners.', b: ['Claude · Gemini · GPT', 'Auto place & route', 'Gerber export'] };
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;width:1024px;height:500px;overflow:hidden;font-family:-apple-system,'Apple SD Gothic Neo','Pretendard',sans-serif;
        background:radial-gradient(circle at 20% 30%,#1f8f5f 0%,#0b4d33 55%,#082d20 100%);color:#fff;position:relative}
      .l{position:absolute;left:56px;top:70px;width:430px}
      .logo{height:78px;margin-left:-12px}
      h1{font-size:44px;line-height:1.15;margin:18px 0 14px;letter-spacing:-1px}
      p{font-size:19px;line-height:1.5;margin:0 0 22px;color:#d6f5e6}
      .b{display:flex;flex-wrap:wrap;gap:8px}.b i{font-style:normal;font-size:14px;background:#ffffff1f;border:1px solid #ffffff33;border-radius:999px;padding:5px 12px}
      .shot{position:absolute;left:520px;top:58px;width:640px;border-radius:12px;box-shadow:0 20px 60px #0009;border:1px solid #ffffff22}
    </style></head><body>
      <div class="l"><img class="logo" src="data:image/svg+xml;base64,${logo}">
      <h1>${text.t}</h1><p>${text.s}</p><div class="b">${text.b.map((x) => `<i>${x}</i>`).join('')}</div></div>
      <img class="shot" src="data:image/png;base64,${img}">
    </body></html>`;
    const tmp = path.join(app.getPath('temp'), `ezboard-feature-${lang}.html`);
    fs.writeFileSync(tmp, html);
    const win = await makeWindow(1024, 500);
    await load(win, tmp);
    await shot(win, path.join(langDir(lang), 'play-feature-graphic-1024x500.png'), [1024, 500]);
    win.destroy();
  }
  fs.copyFileSync(path.join(ROOT, 'build', 'icons', '512x512.png'), path.join(OUT, 'app-icon-512.png'));
  console.log('  screenshots/app-icon-512.png  512x512');
}

// 창을 닫아도 앱이 종료되지 않게 (여러 창을 차례로 쓰기 때문)
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try {
    console.log(`[${MODE}]`);
    if (MODE === 'feature') await feature();
    else if (MODE === 'phone') await phone(MODES.phone);
    else await desktop(MODES[MODE]);
  } catch (e) {
    console.error(e);
    app.exit(1);
    return;
  }
  app.exit(0);
});
