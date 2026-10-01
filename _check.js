const fs = require('fs');
const h = fs.readFileSync('index.html', 'utf8');

/* ---------- 1. every locally referenced asset must exist ---------- */
console.log('--- local asset references ---');
const re = /(?:src|href|content|srcset)="([^":,]+\.(?:jpg|jpeg|png|pdf|webp|avif))/g;
const refs = [...new Set([...h.matchAll(re)].map(m => m[1]))];
let missing = 0;
for (const r of refs) {
  const ok = fs.existsSync(r);
  if (!ok) missing++;
  console.log('  ', r.padEnd(24), ok ? 'EXISTS' : 'MISSING');
}

/* ---------- 2. CSS class <-> markup wiring for the 3D stage ---------- */
console.log('\n--- 3D stage wiring ---');
const checks = {
  'no legacy .photo3d left': !/photo3d/.test(h),
  '.portrait3d root': /class="portrait3d"[^>]*data-portrait-3d/.test(h),
  '.p3d-stage rig': /class="p3d-stage"/.test(h),
  'perspective declared': /\.portrait3d\{[\s\S]*?perspective:1150px/.test(h),
  'preserve-3d on rig': /\.p3d-stage\{[\s\S]*?transform-style:preserve-3d/.test(h),
  'rig composes CSS vars': /transform:rotateX\(var\(--rx/.test(h),
  'aura plane (Z-260)': /\.p3d-aura\{[\s\S]*?translateZ\(-260px\)/.test(h),
  'pool plane (Z-150)': /\.p3d-pool\{[\s\S]*?translateZ\(-150px\)/.test(h),
  'far echo (Z-130)': /\.p3d-echo--far\{[\s\S]*?translateZ\(-130px\)/.test(h),
  'near echo (Z-54)': /\.p3d-echo--near\{[\s\S]*?translateZ\(-54px\)/.test(h),
  'card keeps preserve-3d': /\.p3d-card\{[\s\S]*?transform-style:preserve-3d/.test(h),
  'veil plane (Z+2)': /\.p3d-veil\{[\s\S]*?translateZ\(2px\)/.test(h),
  'edge plane (Z+6)': /\.p3d-edge\{[\s\S]*?translateZ\(6px\)/.test(h),
  'scan plane (Z+8)': /\.p3d-scan\{[\s\S]*?translateZ\(8px\)/.test(h),
  'gloss plane (Z+14)': /\.p3d-gloss\{[\s\S]*?translateZ\(14px\)/.test(h),
  'caption plane (Z+30)': /\.p3d-name\{[\s\S]*?translateZ\(30px\)/.test(h),
  'chips plane (Z+70)': /\.p3d-chip\{[\s\S]*?translateZ\(70px\)/.test(h),
  'counter floats in front': /\.counter-card\{[\s\S]*?transform-style:flat/.test(h)
};

/* every .p3d-* selector in CSS must exist in markup, and vice versa */
const css = h.slice(h.indexOf('<style>'), h.indexOf('</style>'));
const body = h.slice(h.indexOf('</style>'));
const cssClasses = [...new Set([...css.matchAll(/\.p3d-[a-z-]+/g)].map(m => m[0].slice(1)))];
const htmlClasses = new Set([...body.matchAll(/class="([^"]*)"/g)].flatMap(m => m[1].split(/\s+/)));
const orphanCss = cssClasses.filter(c => !htmlClasses.has(c));
const orphanHtml = [...htmlClasses].filter(c => c.startsWith('p3d-') && !cssClasses.includes(c));
checks['CSS classes all used in markup'] = orphanCss.length === 0;
checks['markup classes all styled'] = orphanHtml.length === 0;

/* ---------- 3. responsive image + a11y ---------- */
const pic = h.slice(h.indexOf('<picture class="p3d-shot">'), h.indexOf('</picture>'));
checks['avif source first'] = /<source type="image\/avif"/.test(pic);
checks['webp source second'] = /<source type="image\/webp"/.test(pic);
checks['jpeg fallback last'] = /<img[\s\S]*?src="profile-960\.jpg"/.test(pic);
checks['srcset widths declared'] = /srcset="profile-480\.avif 480w, profile-960\.avif 960w"/.test(pic);
checks['sizes on all 3 candidates'] = (pic.match(/sizes="/g) || []).length === 3;
checks['intrinsic w/h on img'] = /width="960" height="1200"/.test(pic);
checks['img alt text'] = /alt="Heri Bwiza Alain — professional portrait"/.test(pic);
checks['decorative imgs empty alt'] = (body.match(/<img src="profile-echo\.webp" alt=""/g) || []).length === 2;
checks['figcaption caption'] = /<figcaption class="p3d-name">/.test(h);
checks['og:image is 1200x630 asset'] = /property="og:image" content="og-image\.jpg"/.test(h);
checks['og:image width/height/alt'] = /og:image:width/.test(h) && /og:image:height/.test(h) && /og:image:alt/.test(h);
checks['twitter:image mirrors og'] = /name="twitter:image" content="og-image\.jpg"/.test(h);
checks['LQIP token replaced'] = /--lqip: data:image\/jpeg;base64,/.test(h);
checks['LQIP used as shot bg'] = /\.p3d-shot\{[\s\S]*?background:var\(--lqip\)/.test(h);
checks['preload hits a srcset file'] = /rel="preload" as="image" href="profile-(480|960)\.avif"/.test(h);

/* ---------- 4. motion / accessibility guards ---------- */
checks['JS honours reduced-motion'] = /matchMedia\('\(prefers-reduced-motion: reduce\)'\);\s*\n\s*if \(reduce\.matches\) return;/.test(h);
checks['JS gates on document.hidden'] = /document\.hidden/.test(h);
checks['JS cleans up on pagehide'] = /'pagehide'/.test(h);
checks['JS throttles via IntersectionObserver'] = /new IntersectionObserver/.test(h);
checks['CSS freezes rig under reduce'] = /@media \(prefers-reduced-motion: reduce\)\{[\s\S]*?\.p3d-stage\{transform:none;\}/.test(h);
/* no layout-animating keyframes: every @keyframes block must only touch transform/opacity */
const kf = [...css.matchAll(/@keyframes\s+[\w-]+\s*\{(?:[^{}]|\{[^{}]*\})*\}/g)].map(m => m[0]);
const kfSrc = kf.join('\n').replace(/transform[^;]*;|opacity[^;]*;|[0-9]+%\{|from\{|to\{/g, '');
checks['keyframes only animate transform/opacity'] = kf.length > 0 &&
  !kfSrc.match(/(^|[;{\s])(width|height|top|left|right|bottom|margin|padding|filter|box-shadow)\s*:/);

console.log('');
let failed = 0;
for (const [k, v] of Object.entries(checks)) {
  if (!v) failed++;
  console.log('  ', (v ? 'PASS' : 'FAIL').padEnd(5), k);
}
if (orphanCss.length) console.log('   orphan CSS classes:', orphanCss.join(', '));
if (orphanHtml.length) console.log('   unstyled markup classes:', orphanHtml.join(', '));

/* ---------- 5. tag balance inside the hero visual (proper subtree scan) ---------- */
console.log('\n--- hero-visual tag balance ---');
const start = h.indexOf('<div class="hero-visual">');
let depth = 0, heroEnd = -1;
const tagRe = /<\/?div\b[^>]*>/g;
tagRe.lastIndex = start;
let m;
while ((m = tagRe.exec(h))) {
  depth += m[0][1] === '/' ? -1 : 1;
  if (depth === 0) { heroEnd = tagRe.lastIndex; break; }
}
if (heroEnd < 0) { console.log('   PROBLEM: hero-visual subtree never closes'); failed++; }
else {
  const hero = h.slice(start, heroEnd);
  console.log('   subtree length:', hero.length, 'chars');
  for (const t of ['div', 'figure', 'figcaption', 'picture', 'span', 'a', 'button']) {
    const o = (hero.match(new RegExp('<' + t + '(\\s|>)', 'g')) || []).length;
    const c = (hero.match(new RegExp('</' + t + '>', 'g')) || []).length;
    console.log('  ', t.padEnd(11), 'open', String(o).padStart(2), 'close', String(c).padStart(2), o === c ? 'OK' : 'PROBLEM');
    if (o !== c) failed++;
  }
}

/* void tags: must exist and be self-closed */
for (const t of ['img', 'source']) {
  const seg = h.slice(start, heroEnd);
  const o = (seg.match(new RegExp('<' + t + '(\\s|>)', 'g')) || []).length;
  const closed = (seg.match(new RegExp('<' + t + '\\b[^>]*/>', 'g')) || []).length;
  console.log('  ', t.padEnd(11), 'count', String(o).padStart(2), o > 0 && closed === o ? 'OK (void, self-closed)' : 'CHECK');
}

/* ---------- 6. inline JS parses ---------- */
const js = h.match(/<script>([\s\S]*?)<\/script>/)[1];
try { new Function(js); console.log('\n--- inline JS: parses OK,', js.split('\n').length, 'lines ---'); }
catch (e) { failed++; console.log('\n--- inline JS SYNTAX ERROR:', e.message, '---'); }

console.log('\nRESULT:', failed === 0 && missing === 0 ? 'ALL CHECKS PASSED' : failed + ' failed, ' + missing + ' missing assets');
process.exit(failed === 0 && missing === 0 ? 0 : 1);
