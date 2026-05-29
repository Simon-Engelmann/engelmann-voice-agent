// Generates the PWA / iOS app icon set from a single vector source using sharp.
// Run: node scripts/generate-icons.mjs
// Output: public/icons/*.png  +  public/icons/icon.svg (source) + favicon.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'public', 'icons');

// Apple-near icon: deep blue→indigo gradient with a clean white "voice orb"
// (a centred dot with two soundwave arcs). `glyphScale` controls padding so we
// can produce a safe maskable variant (more padding) and a crisp regular one.
function svgIcon(glyphScale = 1) {
  const s = 1024;
  const c = s / 2;
  const k = glyphScale;
  const dot = 78 * k;
  const r1 = 165 * k;
  const r2 = 250 * k;
  const r3 = 335 * k;
  const sw = 46 * k;
  const arc = (r) =>
    `M ${c - r} ${c} A ${r} ${r} 0 0 1 ${c + r} ${c}`; // top half-arc
  const arcB = (r) =>
    `M ${c - r} ${c} A ${r} ${r} 0 0 0 ${c + r} ${c}`; // bottom half-arc
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0A84FF"/>
      <stop offset="1" stop-color="#5E5CE6"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.38" r="0.7">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${s}" height="${s}" fill="url(#bg)"/>
  <rect width="${s}" height="${s}" fill="url(#glow)"/>
  <g fill="none" stroke="#ffffff" stroke-width="${sw}" stroke-linecap="round" opacity="0.95">
    <path d="${arc(r1)}"/><path d="${arcB(r1)}"/>
    <path d="${arc(r2)}" opacity="0.72"/><path d="${arcB(r2)}" opacity="0.72"/>
    <path d="${arc(r3)}" opacity="0.45"/><path d="${arcB(r3)}" opacity="0.45"/>
  </g>
  <circle cx="${c}" cy="${c}" r="${dot}" fill="#ffffff"/>
</svg>`;
}

const regular = Buffer.from(svgIcon(1));
const maskable = Buffer.from(svgIcon(0.66)); // extra padding for safe zone

const targets = [
  { name: 'icon-180.png', size: 180, src: regular },   // Apple touch icon
  { name: 'icon-192.png', size: 192, src: regular },
  { name: 'icon-512.png', size: 512, src: regular },
  { name: 'icon-1024.png', size: 1024, src: regular },
  { name: 'icon-192-maskable.png', size: 192, src: maskable },
  { name: 'icon-512-maskable.png', size: 512, src: maskable },
  { name: 'favicon-32.png', size: 32, src: regular },
];

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'icon.svg'), svgIcon(1));

for (const t of targets) {
  await sharp(t.src).resize(t.size, t.size).png({ compressionLevel: 9 }).toFile(path.join(outDir, t.name));
  console.log('wrote', t.name);
}
console.log('icon set generated in', outDir);
