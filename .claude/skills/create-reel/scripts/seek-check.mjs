#!/usr/bin/env node
// seek-check.mjs - prove one composition has one deterministic animation clock.
//
// Usage:  node .claude/skills/create-reel/scripts/seek-check.mjs <project-folder> [--samples 8] [--json]
//
// Static checks: meta.json, root id, data-composition-id, data-width/height/duration and the window.__timelines key agree;
// exactly one timeline registration and one GSAP script. Runtime checks (headless Chrome via Playwright): the registered
// timeline is paused and as long as data-duration; every sample time renders the same pixels when reached forward,
// backward, repeatedly, and in a shuffled order. Source scan warns about Math.random, Date, performance.now,
// requestAnimationFrame, timers and CSS animations.
// Exit: 0 PASS (warnings allowed), 1 FAIL, 2 bad usage.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { kitRoot, chromePath, readComposition } from './lib.mjs';

const args = process.argv.slice(2);
if (!args[0] || args.includes('--help')) {
  console.log('Usage: node .claude/skills/create-reel/scripts/seek-check.mjs <project-folder> [--samples 8] [--json]');
  process.exit(args[0] ? 0 : 2);
}
const dir = resolve(args[0]);
const samplesArg = args.indexOf('--samples');
const nSamples = samplesArg >= 0 ? Number(args[samplesArg + 1]) : 8;
const asJson = args.includes('--json');
const results = [];
const add = (status, check, detail) => results.push({ status, check, detail });

const htmlPath = join(dir, 'index.html');
if (!existsSync(htmlPath)) { console.error(`No index.html in ${dir}`); process.exit(2); }
const html = readFileSync(htmlPath, 'utf8');
const meta = existsSync(join(dir, 'meta.json')) ? JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) : null;
const comp = readComposition(html);
if (!comp) { console.error('No root element with data-composition-id'); process.exit(2); }

// ---- static identity
const same = (label, a, b) => add(a === b ? 'PASS' : 'FAIL', label, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
same('root id equals data-composition-id', comp.elementId, comp.id);
if (meta) {
  same('meta.json id equals composition id', meta.id, comp.id);
  same('meta.json width equals data-width', meta.width, comp.width);
  same('meta.json height equals data-height', meta.height, comp.height);
} else add('FAIL', 'meta.json present', 'missing');
add(comp.timelineRegistrations.length === 1 ? 'PASS' : 'FAIL', 'exactly one window.__timelines registration in index.html', comp.timelineRegistrations.join(', ') || 'none');
if (comp.timelineRegistrations.length) same('timeline key equals composition id', comp.timelineRegistrations[0], comp.id);
add(comp.gsapScripts === 1 ? 'PASS' : 'FAIL', 'exactly one GSAP script tag', String(comp.gsapScripts));
add(comp.duration > 0 ? 'PASS' : 'FAIL', 'data-duration is a positive number', String(comp.duration));

// ---- source scan (warnings: these are only a problem if they drive what is drawn)
const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n');
const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
for (const [re, what] of [[/Math\.random\s*\(/, 'Math.random'], [/Date\.now|new Date\s*\(/, 'Date'], [/performance\.now/, 'performance.now'],
  [/requestAnimationFrame/, 'requestAnimationFrame'], [/set(?:Timeout|Interval)\s*\(/, 'setTimeout/setInterval']]) {
  if (re.test(scripts)) add('WARNING', `no ${what} in composition scripts`, 'found: make it seeded or remove it');
}
if (/@keyframes|\banimation\s*:/.test(styles)) add('WARNING', 'no CSS animations', 'found: CSS animations do not follow the seek clock');

// ---- runtime
const require = createRequire(join(kitRoot, 'package.json'));
let chromium;
try { ({ chromium } = require('playwright')); } catch { add('NOT TESTED', 'runtime seek checks', 'playwright is not installed (run npm ci)'); }
const exe = chromePath();
if (chromium && !exe) add('NOT TESTED', 'runtime seek checks', 'Chrome not found (set CHROME_PATH)');

if (chromium && exe) {
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--allow-file-access-from-files', '--disable-gpu', '--force-color-profile=srgb', '--hide-scrollbars'] });
  try {
    const page = await browser.newPage({ viewport: { width: comp.width || 1080, height: comp.height || 1920 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    const info = await page.evaluate(id => {
      const tls = window.__timelines || {};
      const tl = tls[id];
      return { keys: Object.keys(tls), has: !!tl, paused: tl ? tl.paused() : null, duration: tl ? tl.duration() : null, gsap: window.gsap ? window.gsap.version : null };
    }, comp.id);
    add(errors.length ? 'FAIL' : 'PASS', 'no page errors', errors.join(' | ') || 'none');
    add(info.keys.length === 1 && info.has ? 'PASS' : 'FAIL', 'one runtime timeline registered under the composition id', info.keys.join(', ') || 'none');
    add(info.paused ? 'PASS' : 'FAIL', 'timeline is paused (HyperFrames owns the clock)', String(info.paused));
    add(info.gsap ? 'PASS' : 'FAIL', 'GSAP version loaded', info.gsap || 'none');
    if (info.has) {
      const fps = Number((html.match(/\bdata-fps\s*=\s*["'](\d+)/) || [])[1]) || meta?.fps || 30;
      const tolerance = 1 / fps;
      add(Math.abs(info.duration - comp.duration) <= tolerance ? 'PASS' : 'FAIL', 'timeline duration matches data-duration (within one frame)', `${info.duration.toFixed(3)} s vs ${comp.duration} s`);

      // Sample times on frame boundaries, including the first and last frames.
      const lastFrame = Math.max(0, Math.round(comp.duration * fps) - 1);
      const frames = [...new Set(Array.from({ length: nSamples }, (_, i) => Math.round(i * lastFrame / Math.max(1, nSamples - 1))))];
      const times = frames.map(f => f / fps);
      // Seek, let Chrome paint (two animation frames), then fingerprint both the animated state and the pixels.
      // State = computed transform / opacity / visibility / filter of every element in the composition: the clock itself.
      const shot = async t => {
        const state = await page.evaluate(([id, time]) => new Promise(done => {
          const tl = window.__timelines[id]; tl.pause(); tl.seek(time, false);
          const els = document.querySelectorAll(`[data-composition-id="${id}"], [data-composition-id="${id}"] *`);
          const props = ['transform', 'opacity', 'visibility', 'display', 'filter', 'left', 'top', 'width', 'height', 'clipPath', 'color', 'backgroundColor', 'backgroundPosition'];
          const sig = [...els].map(e => { const s = getComputedStyle(e); return props.map(p => s[p]).join('|') + '|' + e.textContent.length; }).join(';');
          requestAnimationFrame(() => requestAnimationFrame(() => done(sig)));
        }), [comp.id, t]);
        const pixels = await page.screenshot({ type: 'png' });
        return { s: createHash('sha256').update(state).digest('hex'), h: createHash('sha256').update(pixels).digest('hex') };
      };
      const hashes = new Map(times.map(t => [t, []]));
      const record = async (order, label) => { for (const t of order) hashes.get(t).push({ label, ...(await shot(t)) }); };
      await record(times, 'forward');
      await record([...times].reverse(), 'backward');
      for (const t of times) { await shot(times[times.length - 1]); await shot(0); hashes.get(t).push({ label: 'repeat', ...(await shot(t)) }); }
      // Deterministic shuffle (seeded LCG) so the check itself is reproducible.
      let seed = 1234567;
      const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      const shuffled = [...times];
      for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
      await record(shuffled, 'shuffled');
      // Name which seek orders agree with each other at a mismatching frame, e.g. "forward | backward=repeat=shuffled".
      const groups = (t, key) => {
        const by = new Map();
        for (const x of hashes.get(t)) by.set(x[key], [...(by.get(x[key]) || []), x.label]);
        return [...by.values()].map(g => g.join('=')).join(' | ');
      };
      const compare = (key, what) => {
        const bad = times.filter(t => new Set(hashes.get(t).map(x => x[key])).size !== 1);
        add(bad.length ? 'FAIL' : 'PASS', `identical ${what} at ${times.length} frames reached forward, backward, repeatedly and shuffled`,
          bad.length ? `differs at ${bad.map(t => `${t.toFixed(3)} s (${groups(t, key)})`).join(', ')}` : `frames ${frames.join(', ')} @ ${fps} fps`);
      };
      compare('s', 'animated state');
      compare('h', 'pixels');
      const distinct = new Set(times.map(t => hashes.get(t)[0].h)).size;
      add(distinct > 1 ? 'PASS' : 'WARNING', 'the picture changes over time', `${distinct} distinct frames of ${times.length}`);
    }
  } finally { await browser.close(); }
}

const fail = results.some(r => r.status === 'FAIL');
if (asJson) console.log(JSON.stringify({ project: dir, compositionId: comp.id, results, verdict: fail ? 'FAIL' : 'PASS' }, null, 2));
else {
  for (const r of results) console.log(`${r.status.padEnd(11)} ${r.check}: ${r.detail}`);
  console.log(`SEEK CHECK: ${fail ? 'FAIL' : 'PASS'}`);
}
process.exitCode = fail ? 1 : 0;
