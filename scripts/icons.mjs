// Launcher icons for the PWA / Quest APK: a stack of task tiles under a glowing capacity line.
// Run with `node scripts/icons.mjs`; writes public/icons/*.png.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const tile = (y, w, h, color) =>
  `<rect x="${256 - w / 2}" y="${y}" width="${w}" height="${h}" rx="18" fill="${color}"/>` +
  `<rect x="${256 - w / 2}" y="${y}" width="${w}" height="10" rx="5" fill="#ffffff" opacity="0.35"/>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#20304a"/>
      <stop offset="100%" stop-color="#0d1420"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  ${tile(318, 236, 64, '#2fb5a8')}
  ${tile(248, 236, 62, '#8f7cf0')}
  ${tile(196, 236, 44, '#f5b942')}
  <rect x="118" y="168" width="276" height="10" rx="5" fill="#5fe0d0"/>
  <rect x="118" y="166" width="276" height="14" rx="7" fill="#5fe0d0" opacity="0.35"/>
</svg>`;

await mkdir('public/icons', { recursive: true });
const png = (size, out) => sharp(Buffer.from(svg)).resize(size, size).png().toFile(out);
await png(512, 'public/icons/icon-512.png');
await png(192, 'public/icons/icon-192.png');
await png(512, 'public/icons/icon-512-maskable.png'); // full-bleed and opaque, glyph inside the safe zone
console.log('icons written');
