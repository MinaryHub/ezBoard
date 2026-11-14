// build/icon.svg → 데스크톱/안드로이드/웹 아이콘
import sharp from 'sharp';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const svg = readFileSync('build/icon.svg');
await sharp(svg).resize(1024, 1024).png().toFile('build/icon.png');
await sharp(svg).resize(256, 256).png().toFile('build/icons/256x256.png');
await sharp(svg).resize(512, 512).png().toFile('build/icons/512x512.png');
await sharp(svg).resize(64, 64).png().toFile('public/favicon.png');
writeFileSync('public/logo-mark.svg', svg);

// Windows .ico (PNG 압축 이미지를 담은 ICO 컨테이너)
const sizes = [16, 32, 48, 64, 128, 256];
const pngs = await Promise.all(sizes.map((s) => sharp(svg).resize(s, s).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s === 256 ? 0 : s, e); header.writeUInt8(s === 256 ? 0 : s, e + 1);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(pngs[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
writeFileSync('build/icon.ico', Buffer.concat([header, ...pngs]));

// Android 런처 아이콘 (android 폴더가 있을 때)
const dens = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const fg = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
try {
  for (const [d, s] of Object.entries(dens)) {
    const dir = `android/app/src/main/res/mipmap-${d}`;
    mkdirSync(dir, { recursive: true });
    await sharp(svg).resize(s, s).png().toFile(`${dir}/ic_launcher.png`);
    await sharp(svg).resize(s, s).png().toFile(`${dir}/ic_launcher_round.png`);
    // 적응형 아이콘 전경: 배경 사각형을 뺀 그림을 안전 영역 안에 (배경색은 values/ic_launcher_background.xml)
    const inner = Math.round(fg[d] * 0.82);
    const fgSvg = readFileSync('logo/mark-foreground.svg');
    const icon = await sharp(fgSvg).resize(inner, inner).png().toBuffer();
    await sharp({ create: { width: fg[d], height: fg[d], channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: icon, gravity: 'center' }]).png().toFile(`${dir}/ic_launcher_foreground.png`);
  }
  writeFileSync('android/app/src/main/res/values/ic_launcher_background.xml',
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0B6B45</color>\n</resources>\n');
  // 시작 화면: 어두운 배경 가운데 아이콘
  const { readdirSync, existsSync } = await import('node:fs');
  for (const dir of readdirSync('android/app/src/main/res').filter((x) => x.startsWith('drawable'))) {
    const f = `android/app/src/main/res/${dir}/splash.png`;
    if (!existsSync(f)) continue;
    const { width, height } = await sharp(f).metadata();
    const size = Math.round(Math.min(width, height) * 0.32);
    const icon = await sharp(svg).resize(size, size).png().toBuffer();
    const out = await sharp({ create: { width, height, channels: 4, background: '#0f1216' } }).composite([{ input: icon, gravity: 'center' }]).png().toBuffer();
    writeFileSync(f, out);
  }
  console.log('android icons ok');
} catch (e) { console.log('android icons skipped', e.message); }
console.log('icons ok');
