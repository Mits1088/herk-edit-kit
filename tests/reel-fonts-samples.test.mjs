import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, cpSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const { getProfile } = await import('../.claude/skills/create-reel/scripts/lib.mjs');
const { convertToVertical } = await import('../.claude/skills/create-reel/scripts/new-reel.mjs');
const { listStyles, resolveStyle, styleFontCss, installFonts, faceCovers, FONT_CSS } = await import('../.claude/skills/create-reel/scripts/fonts.mjs');
const { fontChecks, networkFontRefs } = await import('../.claude/skills/create-reel/scripts/qa-core.mjs');
const { planSamples, planEvents } = await import('../.claude/skills/create-reel/scripts/samples.mjs');
const scratch = () => mkdtempSync(join(tmpdir(), 'reel-fonts-test-'));

function starter(style) {
  const dir = join(scratch(), 'font-reel');
  cpSync(join(root, 'examples/starter'), dir, { recursive: true });
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets/gsap.min.js'), '');
  convertToVertical(dir, { slug: 'font-reel', profile: getProfile('organic'), duration: 10, mode: 'faceless', title: 't', brandDesign: null, style });
  return dir;
}
const reelOf = dir => JSON.parse(readFileSync(join(dir, 'reel.json'), 'utf8'));

test('library styles ship local, licensed WOFF2 fonts and no network font imports', () => {
  for (const id of ['vox-explainer', 'kallaway']) {
    const s = resolveStyle(id);
    assert.deepEqual(s.missing, [], `${id} font files`);
    assert.deepEqual(s.unlicensed, [], `${id} licences`);
    for (const f of s.files) {
      assert.equal(readFileSync(f.path).subarray(0, 4).toString('latin1'), 'wOF2', f.file);
      assert.match(readFileSync(f.licensePath, 'utf8'), /SIL OPEN FONT LICENSE/);
    }
    assert.equal(readFileSync(join(s.root, 'fonts/fonts.css'), 'utf8'), styleFontCss(s), `${id} fonts.css is generated from style.json`);
    const tokens = readFileSync(join(s.root, 'tokens.css'), 'utf8');
    assert.match(tokens, /@import url\("fonts\/fonts\.css"\)/);
    assert.deepEqual(networkFontRefs([{ file: 'tokens.css', text: tokens }]), []);
  }
  assert.ok(listStyles().some(s => s.id === 'brand'), 'brand manifest is listed');
});

test('an explicit style installs its fonts into the reel and links one stylesheet', () => {
  const dir = starter('kallaway');
  const reel = reelOf(dir), html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.equal(reel.style, 'kallaway');
  assert.equal(reel.fonts.length, 6);
  for (const f of reel.fonts) assert.ok(existsSync(join(dir, f.file)) && existsSync(join(dir, f.license)), f.file);
  assert.match(html, /<link rel="stylesheet" href="assets\/fonts\/fonts\.css">/);
  assert.match(html, /font-family:"Plus Jakarta Sans",Arial,sans-serif/);
  const css = readFileSync(join(dir, FONT_CSS), 'utf8');
  assert.match(css, /font-family: "Space Mono";\n  src: url\("space-mono-latin-700-normal\.woff2"\)/);
  assert.doesNotMatch(css, /https?:/);
  assert.match(readFileSync(join(dir, 'DESIGN.md'), 'utf8'), /Fonts: style `kallaway`/);
});

test('no style means no font link and an honest empty font list', () => {
  const dir = starter('none');
  assert.deepEqual([reelOf(dir).style, reelOf(dir).fonts], ['none', []]);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /fonts\.css/);
  assert.match(html, /font-family:Arial,sans-serif/);
});

test('re-syncing a style swaps the font files; a missing font changes nothing', () => {
  const dir = starter('kallaway');
  installFonts(dir, 'vox-explainer');
  const reel = reelOf(dir), files = readdirSync(join(dir, 'assets/fonts'));
  assert.equal(reel.style, 'vox-explainer');
  assert.deepEqual([...new Set(reel.fonts.map(f => f.family))], ['Fraunces', 'Archivo', 'Caveat']);
  assert.ok(!files.some(f => /jakarta|space-mono|^inter/.test(f)), `old fonts removed: ${files}`);
  assert.match(readFileSync(join(dir, FONT_CSS), 'utf8'), /Fraunces/);

  // A kit root whose brand manifest names a file that is not there.
  const kit = scratch();
  mkdirSync(join(kit, 'brand'));
  writeFileSync(join(kit, 'brand/fonts.json'), JSON.stringify({ files: [{ family: 'Gone', file: 'assets/fonts/Gone.woff2', weight: '400', style: 'normal' }] }));
  assert.throws(() => installFonts(dir, 'brand', kit), /missing font files[\s\S]*Gone\.woff2/);
  assert.equal(reelOf(dir).style, 'vox-explainer', 'reel.json untouched');
  assert.equal(readdirSync(join(dir, 'assets/fonts')).length, files.length, 'fonts untouched');
  assert.throws(() => installFonts(dir, 'no-such-style'), /Unknown style/);

  installFonts(dir, 'none');
  assert.deepEqual([reelOf(dir).style, reelOf(dir).fonts], ['none', []]);
  assert.deepEqual(readdirSync(join(dir, 'assets/fonts')), ['fonts.css']);
});

test('variable and static faces cover the right weights and styles', () => {
  assert.ok(faceCovers({ weight: '100 900', style: 'normal' }, 900));
  assert.ok(!faceCovers({ weight: '100 900', style: 'normal' }, 400, 'italic'));
  assert.ok(faceCovers({ weight: '700', style: 'normal' }, 700));
  assert.ok(!faceCovers({ weight: '400', style: 'normal' }, 500));
});

const declared = [
  { family: 'Inter', weight: '100 900', style: 'normal', file: 'assets/fonts/inter.woff2' },
  { family: 'Space Mono', weight: '400', style: 'normal', file: 'assets/fonts/mono.woff2' },
];
const goodBrowser = () => ({
  faces: [{ family: 'Inter', weight: '100 900', style: 'normal', status: 'loaded' }, { family: '"Space Mono"', weight: '400', style: 'normal', status: 'loaded' }],
  used: [{ family: 'Inter, Arial, sans-serif', weight: '900', style: 'normal', text: 'Hook' }, { family: '"Space Mono", monospace', weight: '400', style: 'normal', text: '42%' }],
  loaded: ['file:///D:/p/assets/fonts/inter.woff2', 'file:///D:/p/assets/fonts/mono.woff2'], failed: [], blocked: [],
});
const files = { 'assets/fonts/inter.woff2': true, 'assets/fonts/mono.woff2': true };
const statusOf = (rows, check) => rows.find(r => r[1].startsWith(check))?.[2];

test('font QA passes only when every declared face loaded from its own local file', () => {
  const ok = fontChecks({ declared, browser: goodBrowser(), files, styleName: 'x', covers: faceCovers });
  assert.deepEqual(ok.map(r => r[2]), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS']);

  const b1 = goodBrowser(); b1.blocked.push('https://fonts.gstatic.com/s/inter.woff2');
  assert.equal(statusOf(fontChecks({ declared, browser: b1, files, covers: faceCovers }), 'no network font requests'), 'FAIL');

  const refs = networkFontRefs([{ file: 'index.html', text: '<link href="https://fonts.googleapis.com/css2?family=Inter">' }]);
  assert.equal(statusOf(fontChecks({ declared, browser: goodBrowser(), files, refs, covers: faceCovers }), 'no network font references'), 'FAIL');

  const b2 = goodBrowser(); b2.faces[1].status = 'error'; b2.loaded.pop();
  assert.equal(statusOf(fontChecks({ declared, browser: b2, files, covers: faceCovers }), 'each declared face'), 'FAIL');

  const b3 = goodBrowser(); b3.loaded = ['file:///D:/p/assets/fonts/inter.woff2']; // mono "loaded" from somewhere else
  assert.match(fontChecks({ declared, browser: b3, files, covers: faceCovers }).find(r => r[1].startsWith('each declared'))[3], /not from assets\/fonts\/mono\.woff2/);

  const b4 = goodBrowser(); b4.used.push({ family: '"Space Mono"', weight: '700', style: 'normal', text: 'bold' }, { family: 'Inter', weight: '400', style: 'italic', text: 'aside' });
  const r4 = fontChecks({ declared, browser: b4, files, covers: faceCovers }).find(r => r[1].startsWith('text weights'));
  assert.equal(r4[2], 'FAIL');
  assert.match(r4[3], /Space Mono 700 normal[\s\S]*Inter 400 italic/);

  assert.equal(statusOf(fontChecks({ declared, browser: goodBrowser(), files: { 'assets/fonts/inter.woff2': true }, covers: faceCovers }), 'declared font files'), 'FAIL');

  const b5 = goodBrowser(); b5.used.push({ family: 'Arial', weight: '400', style: 'normal', text: 'x' });
  assert.equal(statusOf(fontChecks({ declared, browser: b5, files, covers: faceCovers }), "text uses only"), 'WARNING');

  // Without declared fonts the old behaviour stands: system fonts are a warning, a broken face a failure.
  const none = fontChecks({ declared: [], browser: { ...goodBrowser(), faces: [] }, covers: faceCovers });
  assert.equal(statusOf(none, 'fonts loaded'), 'WARNING');
});

test('event samples cover a short transition before, at, during, end and after', () => {
  const s = planSamples([{ t: 2, end: 2.25, reason: 'tween #title', source: 'tween' }], { fps: 30, duration: 10 });
  assert.deepEqual(s.map(x => x.frame), [59, 60, 64, 68, 69]);
  assert.deepEqual(s.map(x => x.phase), ['before', 'at', 'during', 'end', 'after']);
  // A 200 ms move has a sample strictly inside it, which +-2 frames around its start would not guarantee.
  assert.ok(s.some(x => x.t > 2 && x.t < 2.25 && x.phase === 'during'));
});

test('event samples dedupe by frame, keep the higher priority, clamp, and thin evenly under the cap', () => {
  const s = planSamples([
    { t: 1, reason: 'clip #a', source: 'clip' },
    { t: 1, reason: 'event hero', source: 'authored' },
    { t: 0, reason: 'clip #bg', source: 'clip' },
    { t: 9.99, reason: 'end', source: 'clip' },
  ], { fps: 30, duration: 10 });
  const at1 = s.find(x => x.frame === 30);
  assert.equal(at1.priority, 0);
  assert.match(at1.reason, /event hero \(at\); clip #a \(at\)/);
  assert.equal(new Set(s.map(x => x.frame)).size, s.length);
  assert.ok(s.every(x => x.frame >= 0 && x.frame <= 299));

  const tweens = Array.from({ length: 60 }, (_, i) => ({ t: i * 0.15, end: i * 0.15 + 0.1, reason: `tween ${i}`, source: 'tween' }));
  const capped = planSamples([{ t: 5, reason: 'event hero', source: 'authored' }, ...tweens], { fps: 30, duration: 10, cap: 20 });
  assert.equal(capped.length, 20);
  assert.ok(capped.some(x => /event hero/.test(x.reason)), 'authored event kept');
  assert.ok(capped[0].t < 1 && capped.at(-1).t > 8, 'thinned across the film, not truncated');
});

test('plan events become samples for events, scene cuts and caption groups', () => {
  const plan = JSON.parse(readFileSync(join(root, 'examples/short-form/assets/plan.json'), 'utf8'));
  const ev = planEvents(plan);
  assert.ok(ev.some(e => e.source === 'plan') && ev.some(e => e.source === 'scene') && ev.some(e => e.source === 'caption'));
  assert.ok(planSamples(ev, { fps: plan.fps || 30, duration: plan.duration }).length > 0);
});
