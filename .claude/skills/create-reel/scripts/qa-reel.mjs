#!/usr/bin/env node
// qa-reel.mjs - run every applicable automated check on a Reel project and its render; write QA.md + qa.json.
//
// Usage:  node .claude/skills/create-reel/scripts/qa-reel.mjs <project-folder> [--render renders/<file>.mp4] [--source-only]
//
// Source checks: Herk preflight, HyperFrames lint, seek-check (one deterministic clock), motionmaxxing lint.mjs (gate G5,
// with explicit width/height/duration), and a DOM pass at sample times for text outside the canvas or the profile's
// safe area, and font loading. Render checks: ffprobe against the profile (size, fps, codec, pixel format, duration,
// audio), motionmaxxing look.py gates G0/G2/G3 and its contact sheet, plus a timecoded safe-area sheet drawn here
// (the guides exist only on that review image, never in the video).
// Visual judgement (G1, G4, continuity, timing, taste) is listed as NOT TESTED: look at the sheets.
// Statuses: PASS, FAIL, WARNING, NOT TESTED, NOT APPLICABLE. Exit 1 when anything FAILs.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { skillDir, kitRoot, motionmaxxingDir, getProfile, safeRect, run, hyperframes, python, chromePath, readComposition } from './lib.mjs';

const args = process.argv.slice(2);
if (!args[0] || args[0].startsWith('--') || args.includes('--help')) {
  console.log('Usage: node .claude/skills/create-reel/scripts/qa-reel.mjs <project-folder> [--render renders/<file>.mp4] [--source-only]');
  process.exit(args.includes('--help') ? 0 : 2);
}
const dir = resolve(args[0]);
const ri = args.indexOf('--render');
const sourceOnly = args.includes('--source-only');
const reel = existsSync(join(dir, 'reel.json')) ? JSON.parse(readFileSync(join(dir, 'reel.json'), 'utf8')) : null;
const profile = getProfile(reel?.profile);
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const comp = readComposition(html);
const fps = Number((html.match(/\bdata-fps\s*=\s*["'](\d+)/) || [])[1]) || profile.fps;
const results = [];
const add = (area, check, status, detail = '') => results.push({ area, check, status, detail });
const tail = s => s.trim().split(/\r?\n/).slice(-3).join(' / ').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(0, 300);

// Pick the render: --render, else the newest logged in reel.json, else the newest mp4 in renders/.
let render = null;
if (!sourceOnly) {
  if (ri >= 0) render = resolve(dir, args[ri + 1]);
  else if (reel?.renders?.length) render = join(dir, reel.renders[reel.renders.length - 1].file);
  else if (existsSync(join(dir, 'renders'))) {
    const mp4s = readdirSync(join(dir, 'renders')).filter(f => f.endsWith('.mp4')).map(f => join(dir, 'renders', f));
    render = mp4s.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] || null;
  }
  if (render && !existsSync(render)) { console.error(`Render not found: ${render}`); process.exit(2); }
}
const outDir = render ? join(dir, 'renders', basename(render, '.mp4') + '.qa') : join(dir, 'renders', 'source.qa');
mkdirSync(outDir, { recursive: true });

// ---------- source
{
  const r = run(process.execPath, [join(kitRoot, 'scripts/preflight.mjs'), dir]);
  add('Herk', 'preflight', r.status === 0 ? 'PASS' : 'FAIL', tail(r.stdout + r.stderr));
}
{
  const r = hyperframes(['lint'], { cwd: dir });
  const text = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const m = text.match(/(\d+) errors?, (\d+) warnings?/);
  const status = r.status !== 0 || (m && +m[1] > 0) ? 'FAIL' : m && +m[2] > 0 ? 'WARNING' : 'PASS';
  add('HyperFrames', 'lint', status, m ? m[0] : tail(text));
}
{
  const r = run(process.execPath, [join(skillDir, 'scripts/seek-check.mjs'), dir, '--json']);
  try {
    const j = JSON.parse(r.stdout);
    const bad = j.results.filter(x => x.status !== 'PASS');
    add('Clock', 'seek-check (one deterministic timeline)', j.verdict, bad.length ? bad.map(x => `${x.status}: ${x.check}`).join('; ') : `${j.results.length} checks passed`);
  } catch { add('Clock', 'seek-check (one deterministic timeline)', 'FAIL', tail(r.stdout + r.stderr)); }
}
{
  const lint = join(motionmaxxingDir, 'scripts/lint.mjs');
  if (!existsSync(lint)) add('motionmaxxing', 'G5 no page chrome (lint.mjs)', 'NOT TESTED', 'motionmaxxing is not installed');
  else {
    const r = run(process.execPath, [lint, join(dir, 'index.html'), '--json', '--width', String(comp.width), '--height', String(comp.height), '--duration', String(comp.duration)]);
    try {
      const j = JSON.parse(r.stdout);
      const fails = j.rules.filter(x => x.status === 'FAIL'), warns = j.rules.filter(x => x.status === 'WARN');
      add('motionmaxxing', 'G5 no page chrome (lint.mjs)', fails.length ? 'FAIL' : warns.length ? 'WARNING' : 'PASS',
        [...fails, ...warns].map(x => `${x.status} ${x.id || x.rule}`).join(', ') || `${j.rules.length} rules clear`);
    } catch { add('motionmaxxing', 'G5 no page chrome (lint.mjs)', r.status === 0 ? 'PASS' : 'FAIL', tail(r.stdout + r.stderr)); }
  }
}

// DOM pass: visible text outside the canvas (clipping) or outside the safe area; font loading.
{
  const require = createRequire(join(kitRoot, 'package.json'));
  let chromium = null;
  try { ({ chromium } = require('playwright')); } catch {}
  const exe = chromePath();
  if (!chromium || !exe) {
    add('Layout', 'text inside canvas and safe area', 'NOT TESTED', !chromium ? 'playwright not installed' : 'Chrome not found');
    add('Layout', 'fonts loaded', 'NOT TESTED', 'no browser');
  } else {
    const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--allow-file-access-from-files', '--disable-gpu', '--hide-scrollbars'] });
    try {
      const page = await browser.newPage({ viewport: { width: comp.width, height: comp.height }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(join(dir, 'index.html')).href, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      const safe = safeRect({ ...profile, width: comp.width, height: comp.height });
      const n = 12, times = Array.from({ length: n }, (_, i) => +(i * (comp.duration - 1 / fps) / (n - 1)).toFixed(3));
      const found = await page.evaluate(([id, times, safe]) => {
        const W = innerWidth, H = innerHeight, out = { clip: [], unsafe: [] };
        // A clip is on screen only inside its data-start/data-duration window (HyperFrames hides it otherwise).
        const live = (el, t) => { for (let e = el; e && e.getAttribute; e = e.parentElement) {
          const s = e.getAttribute('data-start'), d = e.getAttribute('data-duration');
          if (s !== null && d !== null && (t < +s || t >= +s + +d)) return false; } return true; };
        const shown = el => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
          const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; o *= +s.opacity; } return o > 0.05; };
        const textNodes = [];
        const walker = document.createTreeWalker(document.querySelector(`[data-composition-id="${id}"]`), NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent.trim()) textNodes.push(n);
        for (const t of times) {
          const tl = window.__timelines[id]; tl.pause(); tl.seek(t, false);
          for (const n of textNodes) {
            const el = n.parentElement; if (!live(el, t) || !shown(el)) continue;
            const range = document.createRange(); range.selectNodeContents(n);
            for (const r of range.getClientRects()) {
              if (r.width < 1 || r.height < 1) continue;
              const label = `${t}s "${n.textContent.trim().slice(0, 40)}" [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`;
              if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.clip.push(label);
              else if (r.left < safe.x0 || r.top < safe.y0 || r.right > safe.x1 || r.bottom > safe.y1) out.unsafe.push(label);
            }
          }
        }
        const faces = document.fonts ? [...document.fonts].map(f => `${f.family}:${f.status}`) : [];
        const families = [...new Set(textNodes.map(n => getComputedStyle(n.parentElement).fontFamily))];
        return { ...out, faces, families };
      }, [comp.id, times, safe]);
      const uniq = a => [...new Set(a)];
      add('Layout', 'text inside the canvas (no clipping)', found.clip.length ? 'FAIL' : 'PASS', uniq(found.clip).slice(0, 6).join('; ') || `${n} sample times`);
      const strict = profile.name.startsWith('ad');
      add('Layout', `text inside the ${profile.name} safe area (x ${safe.x0}-${safe.x1}, y ${safe.y0}-${safe.y1})`,
        found.unsafe.length ? (strict ? 'FAIL' : 'WARNING') : 'PASS',
        uniq(found.unsafe).slice(0, 6).join('; ') || `${n} sample times`);
      const failed = found.faces.filter(f => f.endsWith(':error'));
      add('Layout', 'fonts loaded', failed.length ? 'FAIL' : found.faces.length ? 'PASS' : 'WARNING',
        failed.length ? `failed: ${failed.join(', ')}` : found.faces.length ? found.faces.join(', ') : `no web fonts declared; text uses system fonts (${found.families.join(' / ')}), which can differ between machines`);
    } finally { await browser.close(); }
  }
}

// ---------- render
const expectsAudio = /<audio\b/i.test(html) || (existsSync(join(dir, 'compositions')) && readdirSync(join(dir, 'compositions')).some(f => /<audio\b/i.test(readFileSync(join(dir, 'compositions', f), 'utf8'))));
const sheets = [];
if (!render) {
  add('Render', 'rendered MP4', 'NOT TESTED', sourceOnly ? '--source-only' : 'no render found; run render-reel.mjs');
} else {
  const p = run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', render]);
  let probe = null; try { probe = JSON.parse(p.stdout); } catch {}
  if (!probe) add('Render', 'ffprobe reads the file', 'FAIL', tail(p.stderr));
  else {
    const v = probe.streams.find(s => s.codec_type === 'video'), a = probe.streams.filter(s => s.codec_type === 'audio');
    const [num, den] = (v?.r_frame_rate || '0/1').split('/').map(Number);
    const rate = num / (den || 1), dur = Number(probe.format.duration);
    const check = (name, ok, detail) => add('Render', name, ok ? 'PASS' : 'FAIL', detail);
    check('playable video stream', !!v, v ? `${v.codec_name} ${v.width}x${v.height}` : 'none');
    if (v) {
      check(`dimensions ${comp.width}x${comp.height} native vertical`, v.width === comp.width && v.height === comp.height && v.height > v.width, `${v.width}x${v.height}`);
      check(`frame rate ${fps} fps`, Math.abs(rate - fps) < 0.01, `${rate.toFixed(3)} fps`);
      check(`video codec ${profile.codec}`, v.codec_name === profile.codec, v.codec_name);
      check(`pixel format ${profile.pixFmt}`, v.pix_fmt === profile.pixFmt, v.pix_fmt);
    }
    check(`duration ${comp.duration} s (within one frame)`, Math.abs(dur - comp.duration) <= 1 / fps + 0.01, `${dur.toFixed(3)} s`);
    if (expectsAudio) {
      add('Render', 'audio stream present', a.length ? 'PASS' : 'FAIL', a.map(s => s.codec_name).join(', ') || 'none');
      if (a.length) add('Render', 'audio codec aac', a.every(s => s.codec_name === 'aac') ? 'PASS' : 'WARNING', a.map(s => s.codec_name).join(', '));
    } else add('Render', 'audio', 'NOT APPLICABLE', a.length ? `composition has no <audio> but the file has ${a.length} audio stream(s)` : 'composition has no audio');
  }

  // motionmaxxing look.py: contact sheet, cuts, holds, gates G0/G2/G3, loudness.
  const py = python();
  const look = join(motionmaxxingDir, 'scripts/look.py');
  if (!py || !existsSync(look)) add('motionmaxxing', 'look.py gates', 'NOT TESTED', !py ? 'python not found' : 'motionmaxxing not installed');
  else {
    const lookOut = join(outDir, 'look');
    const r = run(py, [look, render, '--out', lookOut, '--expect', String(comp.duration), ...(expectsAudio ? ['--expect-audio'] : [])]);
    try {
      const g = JSON.parse(readFileSync(join(lookOut, 'gates.json'), 'utf8'));
      for (const x of g.gates) add('motionmaxxing', `${x.id} ${x.name}`, x.status === 'FAIL' ? 'FAIL' : x.status === 'PASS' ? 'PASS' : 'WARNING', x.detail);
      const m = g.motion_mean_luma_diff, band = g.human_band;
      add('motionmaxxing', 'motion level (a question, not a gate)', 'NOT APPLICABLE', `mean frame-to-frame change ${m}/255; human-made films median ${band.median} (IQR ${band.q1}-${band.q3})`);
      sheets.push(relative(dir, join(lookOut, 'sheet.jpg')));
      for (const f of ['mid.jpg', 'strips.jpg']) if (existsSync(join(lookOut, f))) sheets.push(relative(dir, join(lookOut, f)));
    } catch { add('motionmaxxing', 'look.py gates', 'FAIL', tail(r.stdout + r.stderr)); }
  }

  // Timecoded safe-area sheet: the profile's keep-clear bands shaded red, the safe rectangle outlined.
  const s = safeRect({ ...profile, width: comp.width, height: comp.height });
  const total = Math.max(1, Math.round(comp.duration * fps));
  const picks = Array.from({ length: 12 }, (_, i) => Math.round(i * (total - 1) / 11));
  const fontCandidates = ['C:/Windows/Fonts/consola.ttf', 'C:/Windows/Fonts/arial.ttf', '/System/Library/Fonts/Menlo.ttc', '/Library/Fonts/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'];
  const font = fontCandidates.find(f => existsSync(f));
  const W = comp.width, H = comp.height;
  const filters = [
    `select='${picks.map(f => `eq(n\\,${f})`).join('+')}'`,
    `drawbox=x=0:y=0:w=${W}:h=${s.y0}:color=red@0.22:t=fill`,
    `drawbox=x=0:y=${s.y1}:w=${W}:h=${H - s.y1}:color=red@0.22:t=fill`,
    `drawbox=x=0:y=${s.y0}:w=${s.x0}:h=${s.h}:color=red@0.22:t=fill`,
    `drawbox=x=${s.x1}:y=${s.y0}:w=${W - s.x1}:h=${s.h}:color=red@0.22:t=fill`,
    `drawbox=x=${s.x0}:y=${s.y0}:w=${s.w}:h=${s.h}:color=yellow@0.9:t=4`,
    ...(font ? [`drawtext=fontfile='${font.replace(/:/g, '\\:')}':text='%{pts\\:hms}':x=12:y=h-th-12:fontsize=44:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=8`] : []),
    'scale=270:-2', 'tile=6x2:padding=6:margin=6:color=0x111111',
  ].join(',');
  const sheet = join(outDir, 'safe-area-sheet.jpg');
  const r = run('ffmpeg', ['-y', '-v', 'error', '-i', render, '-an', '-vf', filters, '-fps_mode', 'vfr', '-frames:v', '1', '-q:v', '3', sheet]);
  if (r.status === 0 && existsSync(sheet)) sheets.push(relative(dir, sheet));
  else add('Render', 'safe-area review sheet', 'FAIL', tail(r.stderr));
}

// ---------- judgement that no script can make
const hasCaptions = /caption/i.test(html);
add('Visual', 'G1 proof readable / G4 one hero per frame', 'NOT TESTED', 'judge by eye on the contact sheet');
add('Visual', 'safe areas, text clipping, font rendering in the encoded frames', render ? 'NOT TESTED' : 'NOT APPLICABLE', render ? 'look at safe-area-sheet.jpg (guides exist only on the sheet)' : 'no render');
add('Visual', 'continuity, animation timing, ending', render ? 'NOT TESTED' : 'NOT APPLICABLE', render ? 'watch the MP4 at full size' : 'no render');
add('Visual', 'captions and A/V sync', expectsAudio || hasCaptions ? 'NOT TESTED' : 'NOT APPLICABLE', expectsAudio || hasCaptions ? 'watch and listen; check word timing' : 'no audio or captions');

// ---------- report
const counts = results.reduce((c, r) => ((c[r.status] = (c[r.status] || 0) + 1), c), {});
const verdict = counts.FAIL ? 'FAIL' : 'PASS';
const md = [
  `# QA: ${reel?.slug || basename(dir)}`,
  '',
  `- Render: ${render ? relative(dir, render) : 'none'}`,
  `- Profile: ${profile.name} (${profile.width}x${profile.height} @ ${profile.fps} fps), composition \`${comp.id}\`, ${comp.duration} s`,
  `- Automated verdict: **${verdict}** (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')})`,
  '- Automated checks are not proof of visual quality. Every NOT TESTED line needs a human look.',
  '',
  '| Area | Check | Status | Detail |',
  '| --- | --- | --- | --- |',
  ...results.map(r => `| ${r.area} | ${r.check} | ${r.status} | ${String(r.detail).replace(/\|/g, '/').replace(/\r?\n/g, ' ')} |`),
  '',
  '## Review images',
  '',
  ...(sheets.length ? sheets.map(s => `- ${s}`) : ['- none']),
  '',
].join('\n');
writeFileSync(join(outDir, 'QA.md'), md);
writeFileSync(join(outDir, 'qa.json'), JSON.stringify({ project: reel?.slug, render: render && relative(dir, render), profile: profile.name, verdict, counts, results, sheets }, null, 2) + '\n');
for (const r of results) console.log(`${r.status.padEnd(14)} [${r.area}] ${r.check}: ${r.detail}`);
console.log(`\nQA ${verdict}: ${relative(process.cwd(), join(outDir, 'QA.md'))}`);
for (const s of sheets) console.log(`Review: ${relative(process.cwd(), join(dir, s))}`);
process.exitCode = verdict === 'FAIL' ? 1 : 0;
