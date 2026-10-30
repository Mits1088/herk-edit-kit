#!/usr/bin/env node
// seek-check.mjs - prove one composition has one deterministic animation clock.
//
// Usage:  node .claude/skills/create-reel/scripts/seek-check.mjs <project-folder> [--samples 8] [--json]
//
// Static checks: meta.json, root id, data-composition-id, data-width/height/duration and the window.__timelines key agree;
// exactly one timeline registration and one GSAP script. Runtime checks (headless Chrome via Playwright): the registered
// timeline is paused and as long as data-duration; every sample time renders the same animated state and pixels when
// reached forward, backward, repeatedly, in a shuffled order, and on a freshly loaded page seeked straight to it. On a
// mismatch it names the differing elements and properties, or, when only pixels differ, the region and the visible
// elements there. These orders are the source of truth; a timeline-settling line in a composition never replaces them. Source scan warns about Math.random, Date, performance.now,
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
      // Each element's row is kept (not only the hash) so a mismatch can name the elements and properties involved.
      const PROPS = ['transform', 'opacity', 'visibility', 'display', 'filter', 'left', 'top', 'width', 'height', 'clipPath', 'color', 'backgroundColor', 'backgroundPosition'];
      const shotOn = async (pg, t) => {
        const rows = await pg.evaluate(([id, time, props]) => new Promise(done => {
          const tl = window.__timelines[id]; tl.pause(); tl.seek(time, false);
          const els = document.querySelectorAll(`[data-composition-id="${id}"], [data-composition-id="${id}"] *`);
          const name = e => {
            const cls = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
            const clip = e.closest('[data-start]');
            return `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${cls}${clip && clip !== e && clip.id ? ` in #${clip.id}` : ''}`;
          };
          const out = [...els].map(e => { const s = getComputedStyle(e); return [name(e), ...props.map(p => s[p]), String(e.textContent.length)]; });
          requestAnimationFrame(() => requestAnimationFrame(() => done(out)));
        }), [comp.id, t, PROPS]);
        const png = await pg.screenshot({ type: 'png' });
        return { rows, s: createHash('sha256').update(rows.map(r => r.slice(1).join('|')).join(';')).digest('hex'), h: createHash('sha256').update(png).digest('hex'), png };
      };
      const shot = t => shotOn(page, t);
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
      // Fresh-page initialisation: a newly loaded page seeked straight to each sample, the way a render worker starts.
      for (const t of times) {
        const fresh = await browser.newPage({ viewport: { width: comp.width || 1080, height: comp.height || 1920 }, deviceScaleFactor: 1 });
        try {
          await fresh.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
          await fresh.evaluate(() => document.fonts && document.fonts.ready);
          hashes.get(t).push({ label: 'fresh', ...(await shotOn(fresh, t)) });
        } finally { await fresh.close(); }
      }
      // Name which seek orders agree with each other at a mismatching frame, e.g. "forward=fresh | backward=repeat=shuffled".
      const groups = (t, key) => {
        const by = new Map();
        for (const x of hashes.get(t)) by.set(x[key], [...(by.get(x[key]) || []), x.label]);
        return [...by.values()].map(g => g.join('=')).join(' | ');
      };
      // Which elements and properties differ between the first two disagreeing seek orders.
      const explainState = t => {
        const list = hashes.get(t), a = list[0], b = list.find(x => x.s !== a.s);
        if (!b) return '';
        if (a.rows.length !== b.rows.length) return `; element count differs (${a.label} ${a.rows.length}, ${b.label} ${b.rows.length})`;
        const diffs = [];
        for (let i = 0; i < a.rows.length && diffs.length < 12; i++) {
          const ch = PROPS.map((p, k) => (a.rows[i][k + 1] !== b.rows[i][k + 1] ? `${p} ${a.label}=${a.rows[i][k + 1]} ${b.label}=${b.rows[i][k + 1]}` : null)).filter(Boolean);
          if (ch.length) diffs.push(`${a.rows[i][0]}: ${ch.join(', ')}`);
        }
        return diffs.length ? `; differing elements: ${diffs.join(' ; ')}` : '';
      };
      // Pixels can differ while the state matches (anti-aliasing, compositing layers, media decode). Then report where:
      // the bounding box and count of pixels that differ by more than 2 levels, and the visible elements at its centre.
      const explainPixels = async t => {
        const list = hashes.get(t), a = list[0], b = list.find(x => x.h !== a.h);
        if (!b) return '';
        const d = await page.evaluate(async ([pa, pb]) => {
          const load = async b64 => { const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob()); const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return g.getImageData(0, 0, bmp.width, bmp.height); };
          const A = await load(pa), B = await load(pb);
          let n = 0, max = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
          for (let i = 0; i < A.data.length; i += 4) {
            const m = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
            if (m > max) max = m;
            if (m > 2) { n++; const p = i / 4, x = p % A.width, y = (p - x) / A.width; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
          }
          return { n, max, box: n ? [x0, y0, x1, y1] : null };
        }, [a.png.toString('base64'), b.png.toString('base64')]);
        if (!d.n) return `; ${a.label} vs ${b.label}: max difference ${d.max}/255, no pixel over 2 levels (sub-visible)`;
        const [x0, y0, x1, y1] = d.box;
        const at = await page.evaluate(([id, time, x, y]) => {
          const tl = window.__timelines[id]; tl.seek(time, false);
          return document.elementsFromPoint(x, y).filter(e => getComputedStyle(e).opacity !== '0' && getComputedStyle(e).visibility !== 'hidden')
            .slice(0, 3).map(e => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/)[0] : ''}`);
        }, [comp.id, t, Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)]);
        return `; ${a.label} vs ${b.label}: ${d.n} px differ (max ${d.max}/255) in [${x0},${y0},${x1},${y1}]${at.length ? `, visible there: ${at.join(', ')}` : ''}`;
      };
      const compare = async (key, what) => {
        const bad = times.filter(t => new Set(hashes.get(t).map(x => x[key])).size !== 1);
        const why = [];
        for (const t of bad) why.push(`${t.toFixed(3)} s (${groups(t, key)})${key === 's' ? explainState(t) : await explainPixels(t)}`);
        add(bad.length ? 'FAIL' : 'PASS', `identical ${what} at ${times.length} frames reached forward, backward, repeatedly, shuffled and on a fresh page`,
          bad.length ? `differs at ${why.join(', ')}` : `frames ${frames.join(', ')} @ ${fps} fps`);
      };
      await compare('s', 'animated state');
      await compare('h', 'pixels');
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
