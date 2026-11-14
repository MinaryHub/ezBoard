import sharp from 'sharp';
const [src, out, w, h] = process.argv.slice(2);
await sharp(src, { density: 300 }).resize(Number(w), h ? Number(h) : undefined).png().toFile(out);
