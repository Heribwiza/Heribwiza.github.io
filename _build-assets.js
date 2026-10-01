#!/usr/bin/env node
/* ============================================================
   _build-assets.js — image pipeline for the hero portrait
   ------------------------------------------------------------
   Turns the master portrait into every derivative the page ships:

     profile-960.jpg / profile-480.jpg     JPEG fallback + srcset widths
     profile-960.webp / profile-480.webp   WebP candidates
     profile-960.avif / profile-480.avif   AVIF candidates (first source)
     profile-echo.webp                     blurred, edge-faded copy used by
                                           the two parallax (DoF) planes
     og-image.jpg                          1200x630 social card
     profile.jpg / profile-520.jpg         masters kept in the folder
     --lqip token in index.html            inline 32px blur-up placeholder

   The portrait is cropped to the 4:5 frame the 3D stage expects
   (.p3d-stage{aspect-ratio:4/5}), so every candidate lands on the card
   without a single runtime filter or crop.

   Prerequisite:  npm i sharp
   Usage:         node _build-assets.js                 # full build
                  node _build-assets.js --probe         # crop candidates only
                  node _build-assets.js other.png       # different master
   ============================================================ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/* sharp is the only dependency and it is intentionally NOT vendored into the
   folder — run `npm i sharp` before the first build. */
let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('This script needs sharp. Run:  npm i sharp');
  process.exit(1);
}

const OUT = __dirname;
const MASTER = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : 'ChatGPT Image 29 sept. 2026, 14_24_478.png';

/* the card frame — must match .p3d-stage{aspect-ratio:4/5} */
const FRAME = { w: 960, h: 1200 };

/* vertical anchor of the 4:5 crop, 0 = flush to the top of the master,
   1 = flush to the bottom. Probed with --probe: 0.35 gives the portrait a
   ~9% head margin and keeps the chest in the lower third of the card, so the
   corners of the rounded frame never clip the head. */
const FOCUS = Number(process.env.FOCUS || 0.35);

const KB = (n) => (n / 1024).toFixed(1).padStart(7) + ' KB';

/* the native-resolution 4:5 slice, resolved once per run and shared by every
   derivative (including the social card) */
let SLICE = { left: 0, top: 0, width: FRAME.w, height: FRAME.h };
const SRC = { w: FRAME.w, h: FRAME.h };   /* master dimensions, filled by main() */
const masterShot = () => sharp(path.join(OUT, MASTER)).rotate();
const crop = () => masterShot().extract(SLICE);

async function main() {
  const masterPath = path.join(OUT, MASTER);
  if (!fs.existsSync(masterPath)) {
    console.error('master not found:', masterPath);
    process.exit(1);
  }

  const meta = await sharp(masterPath).metadata();
  const srcW = meta.width;
  const srcH = meta.height;
  SRC.w = srcW;
  SRC.h = srcH;

  /* native-resolution 4:5 slice, anchored by FOCUS */
  const cropH = Math.round(srcW * FRAME.h / FRAME.w);
  const maxTop = Math.max(0, srcH - cropH);
  const top = Math.min(maxTop, Math.round(maxTop * FOCUS));
  SLICE = { left: 0, top, width: srcW, height: Math.min(cropH, srcH) };

  if (process.argv.includes('--probe')) {
    const dir = path.join(os.tmpdir(), 'portfolio-probe');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of [0, 0.35, 1]) {
      const t = Math.min(maxTop, Math.round(maxTop * f));
      const file = path.join(dir, `crop-focus-${f}.jpg`);
      await sharp(masterPath).rotate()
        .extract({ left: 0, top: t, width: srcW, height: Math.min(cropH, srcH) })
        .resize(480, 600).jpeg({ quality: 88 }).toFile(file);
      console.log('probe:', file);
    }
    return;
  }

  console.log(`master  ${MASTER}  ${srcW}x${srcH}`);
  console.log(`crop    4:5 slice y=${SLICE.top}..${SLICE.top + SLICE.height} -> ${FRAME.w}x${FRAME.h}\n`);

  const written = [];
  const save = async (name, buf) => {
    const file = path.join(OUT, name);
    fs.writeFileSync(file, buf);
    written.push([name, buf.length]);
  };

  /* ---------- 1. srcset candidates ---------- */
  for (const w of [480, 960]) {
    const h = Math.round(w * FRAME.h / FRAME.w);
    /* a whisper of saturation so the cool navy suit sits inside the violet
       palette — baked here so the page itself never runs a filter */
    const shot = crop().resize(w, h, { fit: 'fill' }).modulate({ saturation: 1.06 });
    save(`profile-${w}.jpg`, await shot.clone().jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer());
    save(`profile-${w}.webp`, await shot.clone().webp({ quality: 80, effort: 5 }).toBuffer());
    save(`profile-${w}.avif`, await shot.clone().avif({ quality: 56, effort: 5 }).toBuffer());
  }

  /* ---------- 2. parallax echo: blurred + edge-faded ---------- */
  const echoW = 480, echoH = 600;
  const mask = Buffer.from(
    `<svg width="${echoW}" height="${echoH}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><radialGradient id="m" cx="50%" cy="38%" r="76%">` +
    `<stop offset="42%" stop-color="#fff" stop-opacity="1"/>` +
    `<stop offset="100%" stop-color="#fff" stop-opacity="0"/>` +
    `</radialGradient></defs>` +
    `<rect width="${echoW}" height="${echoH}" fill="url(#m)"/></svg>`
  );
  const echo = await crop()
    .resize(echoW, echoH, { fit: 'fill' })
    .ensureAlpha()
    .blur(12)
    .modulate({ saturation: 1.25, brightness: 0.92 })
    .composite([{ input: mask, blend: 'dest-in' }])
    .webp({ quality: 74, alphaQuality: 90, effort: 5 })
    .toBuffer();
  save('profile-echo.webp', echo);

  /* ---------- 3. masters kept in the folder ---------- */
  save('profile.jpg', await sharp(masterPath).rotate().jpeg({ quality: 90, mozjpeg: true }).toBuffer());
  save('profile-520.jpg', await crop().resize(520, 650, { fit: 'fill' }).jpeg({ quality: 86, mozjpeg: true }).toBuffer());

  /* ---------- 4. 1200x630 social card ---------- */
  save('og-image.jpg', await buildOg());

  /* ---------- 5. inline LQIP ---------- */
  const lqip = await crop().resize(32, 40, { fit: 'fill' }).jpeg({ quality: 28, mozjpeg: true }).toBuffer();
  const lqipData = 'data:image/jpeg;base64,' + lqip.toString('base64');
  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  const lqipRe = /(--lqip: )data:image\/jpeg;base64,[^;]+(;)/;
  if (!lqipRe.test(html)) {
    console.log('\n!! --lqip token not found in index.html (placeholder left untouched)');
  } else {
    const next = html.replace(lqipRe, '$1' + lqipData + '$2');
    if (next !== html) fs.writeFileSync(path.join(OUT, 'index.html'), next);
    console.log('\nLQIP refreshed in index.html (' + lqip.length + ' B inline)');
  }

  console.log('\n--- written ---');
  for (const [n, s] of written) console.log('  ', n.padEnd(20), KB(s));
}

/* 1200x630 social card: brand gradient panel on the left, portrait on the
   right, its left edge faded into the gradient so there is no hard seam. */
async function buildOg() {
  const W = 1200, H = 630, slabW = 560;

  const bg = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>` +
    `<linearGradient id="d" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#150726"/><stop offset="0.55" stop-color="#2A1145"/>` +
    `<stop offset="1" stop-color="#0B0414"/></linearGradient>` +
    `<radialGradient id="g" cx="34%" cy="34%" r="66%">` +
    `<stop offset="0" stop-color="#9B5DE5" stop-opacity="0.55"/>` +
    `<stop offset="0.6" stop-color="#9B5DE5" stop-opacity="0.12"/>` +
    `<stop offset="1" stop-color="#9B5DE5" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="p" cx="16%" cy="86%" r="52%">` +
    `<stop offset="0" stop-color="#F15BB5" stop-opacity="0.34"/>` +
    `<stop offset="1" stop-color="#F15BB5" stop-opacity="0"/></radialGradient>` +
    `</defs>` +
    `<rect width="${W}" height="${H}" fill="url(#d)"/>` +
    `<rect width="${W}" height="${H}" fill="url(#g)"/>` +
    `<rect width="${W}" height="${H}" fill="url(#p)"/>` +
    `<rect x="${W - slabW}" y="0" width="${slabW}" height="${H}" fill="#0B0414"/>` +
    `</svg>`
  );

  /* portrait slab: a 0.889 slice straight off the master, so the head lands
     around 16% of the banner height and the hair never kisses the top edge */
  const slabSliceH = Math.round(SRC.w * H / slabW);
  const slab = await masterShot()
    .extract({ left: 0, top: 0, width: SRC.w, height: Math.min(slabSliceH, SRC.h) })
    .resize(slabW, H, { fit: 'fill' })
    .toBuffer();

  const fade = Buffer.from(
    `<svg width="${slabW}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="f" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="#fff" stop-opacity="0"/>` +
    `<stop offset="0.22" stop-color="#fff" stop-opacity="1"/>` +
    `<stop offset="1" stop-color="#fff" stop-opacity="1"/>` +
    `</linearGradient></defs>` +
    `<rect width="${slabW}" height="${H}" fill="url(#f)"/></svg>`
  );

  const faded = await sharp(slab)
    .ensureAlpha()
    .composite([{ input: fade, blend: 'dest-in' }])
    .png()
    .toBuffer();

  return sharp(bg)
    .composite([{ input: faded, left: W - slabW, top: 0 }])
    .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

main().catch((e) => { console.error(e); process.exit(1); });
