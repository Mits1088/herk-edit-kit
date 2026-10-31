// Story mechanics (Gate B), audio balance, overlay-leak and footage-colour rows, and the browser checks behind them
// (seek-check diagnostics, overlay leaks, footage colour). Every test writes only to its own temporary folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { storyMechanics } from '../.claude/skills/create-reel/scripts/preflight-reel.mjs';
import { audioBalance, overlayLeakRow, footageColourRow, preflightStatus } from '../.claude/skills/create-reel/scripts/qa-core.mjs';
import { overlayLeakAt, footageReference, bandCompare } from '../.claude/skills/create-reel/scripts/frames.mjs';
import { kitRoot, chromePath } from '../.claude/skills/create-reel/scripts/lib.mjs';
import { validateVisualPlan } from '../.claude/skills/short-form-edit/scripts/validate-plan.mjs';
import { facelessPlan, footagePlan, brandPlan } from './fixtures/visual-plans.mjs';

const scratch = (p) => mkdtempSync(join(tmpdir(), `reel-checks-${p}-`));
const require = createRequire(join(kitRoot, 'package.json'));
let chromium = null; try { ({ chromium } = require('playwright')); } catch {}
const exe = chromePath();
const noBrowser = !chromium || !exe ? 'Chrome or Playwright not available' : false;
const GSAP = join(kitRoot, 'node_modules/gsap/dist/gsap.min.js');

// ---------- Gate B story mechanics: information only, for every kind of reel
test('story mechanics: works for faceless, footage and brand plans; needs no character or motif; changes nothing', () => {
  for (const [name, plan] of [['faceless', facelessPlan()], ['footage', footagePlan()], ['brand', brandPlan()]]) {
    const before = JSON.stringify(plan);
    const sm = storyMechanics(plan);
    assert.equal(JSON.stringify(plan), before, `${name}: plan untouched`);
    assert.ok(Object.keys(sm.layouts).length >= 1, `${name}: layouts listed`);
    assert.ok(Array.isArray(sm.motifReturns) && Array.isArray(sm.numericScenes) && Array.isArray(sm.holds), `${name}: lists present`);
  }
  // A plan with no motifs, no events and no numbers is still described, not rejected.
  const bare = { scenes: [{ id: 's00', start: 0, end: 3, layout: 'face', visualPurpose: 'performance' }] };
  const sm = storyMechanics(bare);
  assert.deepEqual(sm.motifReturns, []); assert.deepEqual(sm.numericScenes, []); assert.equal(sm.longestWithoutSpeaker.seconds, 0);
  // Speaker absence is measured across consecutive full-frame scenes.
  const mixed = { scenes: [{ id: 'a', start: 0, end: 2, layout: 'split' }, { id: 'b', start: 2, end: 4.5, layout: 'paper' }, { id: 'c', start: 4.5, end: 6, layout: 'broll' }, { id: 'd', start: 6, end: 7, layout: 'face' }] };
  assert.deepEqual(storyMechanics(mixed).longestWithoutSpeaker, { seconds: 4, scenes: ['b', 'c'] });
  // The layout timeline merges consecutive scenes in one layout; long runs are listed, not failed.
  const runs = { scenes: [{ id: 'a', start: 0, end: 2, layout: 'split' }, { id: 'b', start: 2, end: 6, layout: 'split' }, { id: 'c', start: 6, end: 8, layout: 'paper' }] };
  const smr = storyMechanics(runs);
  assert.deepEqual(smr.timeline.map((r) => [r.layout, r.seconds, r.scenes]), [['split', 6, ['a', 'b']], ['paper', 2, ['c']]]);
  assert.deepEqual(smr.longRuns.map((r) => r.scenes), [['a', 'b']]);
  // Faceless reels have no speaker to be away from.
  assert.equal(storyMechanics(facelessPlan()).longestWithoutSpeaker, null);
});

test('story mechanics are not part of the Gate B fingerprint', () => {
  const plan = footagePlan();
  const reel = { preflightRequired: true, mode: 'footage', profile: 'organic', direction: { hook: 'h', coreClaim: 'c', heroBeat: 'b', motif: 'm', style: 's' } };
  const a = preflightStatus({ reel, plan, transcript: null, validate: validateVisualPlan });
  storyMechanics(plan);
  const b = preflightStatus({ reel, plan, transcript: null, validate: validateVisualPlan });
  assert.equal(a.fingerprint, b.fingerprint);
});

// ---------- audio balance from stems (with gains) and from the encoded mix
const SR = 16000;
function signal(seconds, fill) { const x = new Float32Array(Math.round(seconds * SR)); for (let i = 0; i < x.length; i++) x[i] = fill(i / SR); return x; }
const voice = signal(6, (t) => 0.1 * Math.sin(2 * Math.PI * 220 * t));
const words = Array.from({ length: 10 }, (_, i) => ({ text: 'w', start: 0.2 + i * 0.55, end: 0.6 + i * 0.55 }));
const sfxAt = (amp) => signal(6, (t) => (t >= 2 && t < 2.2 ? amp * Math.sin(2 * Math.PI * 1500 * t) : 0));

test('audio balance: loud effects warn, quiet effects pass, missing gains are reported, the mix diagnostic is labelled', () => {
  const loud = audioBalance({ sr: SR, events: [2], words, stems: { voice, sfx: sfxAt(1.0), lufs: { voice: -23, sfx: -19 } }, gains: { voice: 1, sfx: 1 } });
  assert.equal(loud[0][2], 'WARNING', loud[0][3]);
  assert.match(loud[0][3], /\+4\.0 LU vs voice/);
  const quiet = audioBalance({ sr: SR, events: [2], words, stems: { voice, sfx: sfxAt(0.2), lufs: { voice: -23, sfx: -30 } }, gains: { voice: 1, sfx: 1 } });
  assert.equal(quiet[0][2], 'PASS', quiet[0][3]);
  // The same stems with a lower effects gain pass: the gain is part of the measurement.
  const lowered = audioBalance({ sr: SR, events: [2], words, stems: { voice, sfx: sfxAt(1.0), lufs: { voice: -23, sfx: -19 } }, gains: { voice: 1, sfx: 0.25 } });
  assert.equal(lowered[0][2], 'PASS', lowered[0][3]);
  // Thresholds are per reel.
  const strict = audioBalance({ sr: SR, events: [2], words, stems: { voice, sfx: sfxAt(0.2), lufs: { voice: -23, sfx: -30 } }, gains: { voice: 1, sfx: 1 }, limits: { sfxHitMaxOverVoiceDb: 0 } });
  assert.equal(strict[0][2], 'WARNING');
  const noGains = audioBalance({ sr: SR, events: [2], words, stems: { voice, sfx: sfxAt(1.0) }, gains: null });
  assert.equal(noGains[0][2], 'NOT TESTED');
  const mix = new Float32Array(voice.length); const hit = sfxAt(1.0);
  for (let i = 0; i < mix.length; i++) mix[i] = (Math.abs(i / SR - 2) < 0.65 ? 0 : voice[i]) + hit[i];
  const diag = audioBalance({ mix, sr: SR, events: [2], words });
  assert.equal(diag[0][1], 'effects hits against the voice in the encoded mix (diagnostic)');
  assert.equal(diag[0][2], 'WARNING'); assert.match(diag[0][3], /estimate, not proof/);
  assert.equal(diag[0][4].kind, 'info');
});

// ---------- rows: overlay leaks and footage colour
test('overlay leak row: a leak fails with its region, a clean run passes', () => {
  assert.equal(overlayLeakRow([{ t: 1, count: 0, max: 1, leak: false, hiddenClips: [] }])[2], 'PASS');
  const fail = overlayLeakRow([{ t: 1, count: 90000, max: 140, box: [0, 0, 1079, 879], leak: true, hiddenClips: ['s03'] }]);
  assert.equal(fail[2], 'FAIL'); assert.match(fail[3], /\[0,0,1079,879\]/); assert.match(fail[3], /s03/);
  assert.equal(overlayLeakRow([])[2], 'NOT APPLICABLE');
});

test('footage colour row: a local tint fails, a uniform offset passes, a large uniform offset warns', () => {
  const bands = (ds) => ds.map((d, i) => ({ band: i, coverage: 0.9, dLuma: d, dMax: Math.abs(d) }));
  // Caveman v4 as measured: the tinted top against the rest (spread about 32).
  assert.equal(footageColourRow([{ t: 5.43, bands: bands([20.7, 20.7, 9, -11.2, -11.2, -11.2]) }])[2], 'FAIL');
  // Fixed v4 and v5: every band about -11 (the encoder colour path).
  const ok = footageColourRow([{ t: 5.43, bands: bands([-10.7, -12.8, -11.2, -11, -10.9, -11.4]) }]);
  assert.equal(ok[2], 'PASS', ok[3]); assert.match(ok[3], /uniform offset -1\d\.\d/);
  assert.equal(footageColourRow([{ t: 1, bands: bands([-30, -31, -29, -30, -30, -31]) }])[2], 'WARNING');
  // Bands hidden by intentional overlays are skipped, not failed.
  assert.equal(footageColourRow([{ t: 1, bands: [{ band: 0, coverage: 0.05, dLuma: 40, dMax: 40 }, { band: 1, coverage: 0.9, dLuma: -11, dMax: 11 }] }])[2], 'NOT TESTED');
  assert.equal(footageColourRow([])[2], 'NOT APPLICABLE');
});

// ---------- browser checks on tiny compositions
function composition(dir, { body, script, duration = 4 }) {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  copyFileSync(GSAP, join(dir, 'assets/gsap.min.js'));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id: 'fx', name: 'fx', width: 1080, height: 1920, fps: 30 }));
  writeFileSync(join(dir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><script src="assets/gsap.min.js"></script>
<style>html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#000}#fx{position:relative;width:1080px;height:1920px;background:#3a3f46}</style></head><body>
<div id="fx" data-composition-id="fx" data-start="0" data-duration="${duration}" data-width="1080" data-height="1920" data-fps="30">${body}</div>
<script>(function(){const tl=gsap.timeline({paused:true});${script}
tl.to({},{duration:${duration}},0);window.__timelines=window.__timelines||{};window.__timelines['fx'] = tl;})();</script></body></html>`);
  return dir;
}
const seekCheck = (dir) => spawnSync(process.execPath, [join(kitRoot, '.claude/skills/create-reel/scripts/seek-check.mjs'), dir], { encoding: 'utf8' });

test('seek-check names the element when two tweens disagree, and passes the chained fix (fresh page included)', { skip: noBrowser }, () => {
  const eye = '<div id="eye" style="position:absolute;left:500px;top:900px;width:80px;height:80px;border-radius:50%;background:#fff"></div>';
  const bad = composition(scratch('seek-bad'), { body: eye, script: "tl.fromTo('#eye',{x:0,y:0},{x:-80,y:-40,duration:0.3},0.5);tl.fromTo('#eye',{x:0,y:0},{x:120,y:0,duration:0.3},2.0);" });
  const r1 = seekCheck(bad);
  assert.equal(r1.status, 1, r1.stdout);
  assert.match(r1.stdout, /FAIL\s+identical animated state .*fresh page: differs at .*div#eye in #fx: transform/);
  const good = composition(scratch('seek-good'), { body: eye, script: "tl.fromTo('#eye',{x:0,y:0},{x:-80,y:-40,duration:0.3},0.5);tl.fromTo('#eye',{x:-80,y:-40},{x:120,y:0,duration:0.3,immediateRender:false},2.0);" });
  const r2 = seekCheck(good);
  assert.equal(r2.status, 0, r2.stdout);
  assert.match(r2.stdout, /PASS\s+identical pixels .*on a fresh page/);
});

async function withPage(dir, fn) {
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--allow-file-access-from-files', '--disable-gpu'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(join(dir, 'index.html')).href, { waitUntil: 'load' });
    return await fn(page);
  } finally { await browser.close(); }
}
// Caveman v4's defect, reduced: an out-of-window clip holding an SVG noise filter with an overlay blend.
const leakyGrain = '<div class="clip" data-start="2" data-duration="2" data-track-index="1" style="position:absolute;left:0;top:0;width:1080px;height:880px;background:#202328"><svg style="position:absolute;inset:0;width:100%;height:100%;opacity:.55;mix-blend-mode:overlay" viewBox="0 0 100 100" preserveAspectRatio="none"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" seed="7"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg></div>';
const bakedGrain = '<div class="clip" data-start="2" data-duration="2" data-track-index="1" style="position:absolute;left:0;top:0;width:1080px;height:880px;background:#202328 repeating-linear-gradient(45deg,#2a2d32 0 2px,#202328 2px 4px)"></div>';

test('overlay leak: the v4-style SVG grain in a hidden clip is caught; a baked texture is not', { skip: noBrowser }, async (t) => {
  const leaky = composition(scratch('leak-bad'), { body: leakyGrain, script: '' });
  const r1 = await withPage(leaky, (p) => overlayLeakAt(p, 'fx', 0.5));
  const baked = composition(scratch('leak-good'), { body: bakedGrain, script: '' });
  const r2 = await withPage(baked, (p) => overlayLeakAt(p, 'fx', 0.5));
  assert.equal(r2.leak, false, JSON.stringify(r2));
  // Whether this Chrome build paints the hidden SVG filter decides r1; the full v4 copy reproduces it (see VERIFY notes).
  if (!r1.leak) return t.skip('this Chrome build does not paint the hidden SVG filter in the reduced fixture');
  assert.ok(r1.count >= 400); assert.equal(overlayLeakRow([r1])[2], 'FAIL');
});

test('footage colour: a tint over part of the video fails; a grade on the video and a visible overlay pass', { skip: noBrowser || spawnSync('ffmpeg', ['-version']).status !== 0 }, async () => {
  const dir = scratch('footage');
  spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x806040:s=1080x1920:d=2:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'clip.mp4')]);
  assert.ok(existsSync(join(dir, 'clip.mp4')));
  const video = (style = '') => `<video src="clip.mp4" muted playsinline data-start="0" data-duration="2" data-track-index="0" style="position:absolute;left:0;top:0;width:1080px;height:1920px;${style}"></video>`;
  const run = async (body) => {
    composition(dir, { body, script: '', duration: 2 });
    return withPage(dir, async (p) => {
      await p.evaluate(() => Promise.all([...document.querySelectorAll('video')].map((v) => (v.readyState >= 2 ? 0 : new Promise((r) => v.addEventListener('loadeddata', r, { once: true }))))));
      const ref = await footageReference(p, 'fx', 1);
      // The "encoded" frame: the composition as shown, with the runtime's visibility rules.
      await p.evaluate(() => { for (const el of document.querySelectorAll('[data-start]')) { const s = +el.dataset.start, d = +el.dataset.duration; if (el.tagName !== 'VIDEO' && !(1 >= s && 1 < s + d)) el.style.visibility = 'hidden'; } });
      const shown = await p.screenshot({ type: 'png' });
      return footageColourRow([{ t: 1, ...(await bandCompare(p, shown, ref.png, ref.masks, { bands: 6 })) }]);
    });
  };
  // A semi-transparent wash over the top third that the DOM calls invisible would be the v4 defect; here a hidden
  // overlay is simulated by a visible, unmasked tint layer with no paint of its own besides a backdrop filter.
  const tinted = await run(video() + '<div style="position:absolute;left:0;top:0;width:1080px;height:640px;backdrop-filter:brightness(1.6)"></div>');
  assert.equal(tinted[2], 'FAIL', tinted[3]);
  const graded = await run(video('filter:saturate(1.4) brightness(1.1)'));
  assert.equal(graded[2], 'PASS', graded[3]);
  const overlay = await run(video() + '<div style="position:absolute;left:100px;top:200px;width:880px;height:300px;background:#ebc934"></div>');
  assert.equal(overlay[2], 'PASS', overlay[3]);
});

// ---------- the starter exposes the profile's safe area to captions
test('new reels get the profile safe area as CSS variables (organic and ad differ)', async () => {
  const { safeVars } = await import('../.claude/skills/create-reel/scripts/new-reel.mjs');
  const { getProfile } = await import('../.claude/skills/create-reel/scripts/lib.mjs');
  assert.equal(safeVars(getProfile('organic')), '--safe-top:200px;--safe-bottom:320px;--safe-left:90px;--safe-right:150px');
  assert.match(safeVars(getProfile('ad')), /--safe-bottom:672px/);
});
