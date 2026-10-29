#!/usr/bin/env node
// qa-reel.mjs - full QA for a Reel project and one render; writes <render>.qa/QA.md + qa.json and the project QA.md.
//
// Usage:  node .claude/skills/create-reel/scripts/qa-reel.mjs <project-folder> [--render renders/<file>.mp4] [--source-only]
//
// Source checks: Herk preflight, HyperFrames lint, seek-check (one deterministic clock), motionmaxxing lint.mjs (G5,
// with explicit width/height/duration), and a DOM pass at sample times for text outside the canvas or the profile's
// safe area, and font loading. Render checks: ffprobe against the profile, a full decode, audio measurements,
// motionmaxxing look.py gates and contact sheet, a timecoded safe-area sheet drawn here (guides only on that image),
// and event frames from the MP4 around transitions (samples.mjs). Fonts: network fonts are blocked and reported; every
// face reel.json "fonts" declares must load from its own local file and cover the weights the text uses.
// Mode B (footage): transcript, source transcript and EDL present; Herk's plan validator (source mapping, captions)
// and footage validator; speech integrity (no split words, retained words match the source, risky removals flagged
// with review clips and waveforms); EDL duration matches the composition.
//
// Every check is marked required or not and has a kind (technical, creative, checker, human, info). The blocking rule
// lives in qa-core.mjs: any FAIL, or a required check that is not PASS / WARNING / NOT APPLICABLE, blocks Stage 1.
// For a candidate (<slug>-candidate-vNNN.mp4) qa.json also records the full SHA-256, hashed before and after QA.
// Exit 1 when Stage 1 is blocked.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, renameSync } from 'node:fs';
import { join, resolve, relative, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { skillDir, kitRoot, motionmaxxingDir, getProfile, safeRect, run, hyperframes, python, chromePath, readComposition } from './lib.mjs';
import {
  makeCollector, evaluate, sha256File, isCandidateFile, qaDirFor, humanApprovalRequired, interpretLook, interpretLint,
  probeChecks, decodeCheck, AUDIO_FILTER, parseAudioAnalysis, audioChecks, speechIntegrity, planChecks, tailText, writeJson,
  reportMarkdown, writeProjectSummary, NETWORK_FONT, networkFontRefs, fontChecks,
} from './qa-core.mjs';
import { faceCovers } from './fonts.mjs';
import { planSamples, planEvents, collectPageEvents } from './samples.mjs';

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
const footage = reel?.mode === 'footage';
const { results, add } = makeCollector();
const req = { required: true };
// Visual events from a short-form plan (any mode that has one): plan events, scene cuts, caption groups.
let planEventCache = null;
const planEventsFor = () => planEventCache ??= (() => {
  try { return planEvents(JSON.parse(readFileSync(join(dir, 'assets/plan.json'), 'utf8'))); } catch { return []; }
})();

// Pick the render: --render, else the newest logged in reel.json, else the newest mp4 in renders/ (never final.mp4).
let render = null;
if (!sourceOnly) {
  if (ri >= 0) render = resolve(dir, args[ri + 1]);
  else if (reel?.renders?.length) render = join(dir, reel.renders[reel.renders.length - 1].file);
  else if (existsSync(join(dir, 'renders'))) {
    const mp4s = readdirSync(join(dir, 'renders')).filter(f => f.endsWith('.mp4') && f !== 'final.mp4').map(f => join(dir, 'renders', f));
    render = mp4s.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] || null;
  }
  if (render && !existsSync(render)) { console.error(`Render not found: ${render}`); process.exit(2); }
  if (render && basename(render) === 'final.mp4') { console.error('QA runs on candidates, not on renders/final.mp4.'); process.exit(2); }
}
const candidate = !!render && !!reel && isCandidateFile(render, reel.slug);
const outDir = render ? qaDirFor(dir, render) : join(dir, 'renders', 'source.qa');
mkdirSync(outDir, { recursive: true });
const shaBefore = candidate ? await sha256File(render) : null;

// ---------- source
{
  const r = run(process.execPath, [join(kitRoot, 'scripts/preflight.mjs'), dir]);
  add('Herk', 'preflight', r.status === 0 ? 'PASS' : 'FAIL', tailText(r.stdout + r.stderr), req);
}
{
  const r = hyperframes(['lint'], { cwd: dir });
  const text = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const m = text.match(/(\d+) error(?:s|\(s\))?, (\d+) warning(?:s|\(s\))?/); // HyperFrames prints "0 error(s), 2 warning(s)"
  const status = r.status !== 0 || (m && +m[1] > 0) ? 'FAIL' : !m ? 'FAIL' : +m[2] > 0 ? 'WARNING' : 'PASS';
  add('HyperFrames', 'lint', status, m ? m[0] : `could not read the lint summary: ${tailText(text)}`, { ...req, kind: m ? 'technical' : 'checker' });
}
{
  const r = run(process.execPath, [join(skillDir, 'scripts/seek-check.mjs'), dir, '--json']);
  let j = null; try { j = JSON.parse(r.stdout); } catch {}
  if (!j?.results) add('Clock', 'seek-check (one deterministic timeline)', 'FAIL', `checker error: ${tailText(r.stdout + r.stderr)}`, { ...req, kind: 'checker' });
  else {
    const bad = j.results.filter(x => x.status !== 'PASS');
    add('Clock', 'seek-check (one deterministic timeline)', j.verdict === 'PASS' ? 'PASS' : 'FAIL',
      bad.length ? bad.map(x => `${x.status}: ${x.check}`).join('; ') : `${j.results.length} checks passed`, req);
  }
}
{
  const lint = join(motionmaxxingDir, 'scripts/lint.mjs');
  if (!existsSync(lint)) add('motionmaxxing', 'G5 no page chrome (creative rule)', 'NOT TESTED', 'motionmaxxing is not installed', { kind: 'creative' });
  else for (const row of interpretLint(run(process.execPath, [lint, join(dir, 'index.html'), '--json', '--width', String(comp.width), '--height', String(comp.height), '--duration', String(comp.duration)]))) add(...row);
}

// DOM pass: visible text outside the canvas (clipping) or outside the safe area at evenly spaced and event-targeted
// times; fonts (declared faces loaded from their local files, network font requests blocked and reported).
const declaredFonts = Array.isArray(reel?.fonts) ? reel.fonts : [];
const fontFiles = Object.fromEntries(declaredFonts.map(f => {
  const p = join(dir, f.file);
  return [f.file, existsSync(p) && readFileSync(p).subarray(0, 4).toString('latin1') === 'wOF2'];
}));
const sourceTexts = [];
{
  const walk = (d, depth = 0) => {
    if (depth > 4) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!['node_modules', 'renders', '.git'].includes(e.name)) walk(join(d, e.name), depth + 1); }
      else if (/\.(html|css)$/i.test(e.name)) sourceTexts.push({ file: relative(dir, join(d, e.name)).replaceAll('\\', '/'), text: readFileSync(join(d, e.name), 'utf8') });
    }
  };
  walk(dir);
}
const fontRefs = networkFontRefs(sourceTexts);
let pageEvents = [];
{
  const require = createRequire(join(kitRoot, 'package.json'));
  let chromium = null;
  try { ({ chromium } = require('playwright')); } catch {}
  const exe = chromePath();
  if (!chromium || !exe) {
    add('Layout', 'text inside the canvas (no clipping)', 'NOT TESTED', !chromium ? 'playwright not installed' : 'Chrome not found; set CHROME_PATH', req);
    for (const row of fontChecks({ refs: fontRefs })) add(...row);
    add('Fonts', 'each declared face loaded from its local file', declaredFonts.length ? 'NOT TESTED' : 'NOT APPLICABLE', 'no browser', declaredFonts.length ? req : {});
  } else {
    let browser = null;
    try {
      browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--allow-file-access-from-files', '--disable-gpu', '--hide-scrollbars'] });
      const page = await browser.newPage({ viewport: { width: comp.width, height: comp.height }, deviceScaleFactor: 1 });
      // Fonts must come from the project. Block any network font (and font-host stylesheet) and record it; other
      // requests are left alone.
      const net = { loaded: [], failed: [], blocked: [] };
      await page.route(/^https?:/, route => {
        const r = route.request();
        if (r.resourceType() === 'font' || NETWORK_FONT.test(r.url())) { net.blocked.push(r.url()); return route.abort('blockedbyclient'); }
        return route.continue();
      });
      page.on('requestfinished', r => { if (r.resourceType() === 'font' || /\.woff2?$/i.test(r.url())) net.loaded.push(r.url()); });
      page.on('requestfailed', r => { if (r.resourceType() === 'font' || /\.woff2?$/i.test(r.url())) net.failed.push({ url: r.url(), error: r.failure()?.errorText || 'failed' }); });
      await page.goto(pathToFileURL(join(dir, 'index.html')).href, { waitUntil: 'load' });
      // Fonts load lazily: ask for every declared face at both ends of its weight range, then read the FontFace set.
      const fontState = await page.evaluate(async declared => {
        for (const d of declared) for (const w of String(d.weight).split(/\s+/)) {
          try { await document.fonts.load(`${d.style === 'italic' ? 'italic' : 'normal'} ${w} 64px "${d.family}"`, 'AaBb09'); } catch {}
        }
        await document.fonts.ready;
        const faces = [...document.fonts].map(f => ({ family: f.family, weight: f.weight, style: f.style, status: f.status }));
        const used = new Map();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = n.textContent.trim(); if (!text || !n.parentElement || /^(SCRIPT|STYLE)$/.test(n.parentElement.tagName)) continue;
          const s = getComputedStyle(n.parentElement), key = `${s.fontFamily}|${s.fontWeight}|${s.fontStyle}`;
          if (!used.has(key)) used.set(key, { family: s.fontFamily, weight: s.fontWeight, style: s.fontStyle, text: text.slice(0, 30) });
        }
        return { faces, used: [...used.values()] };
      }, declaredFonts);
      for (const row of fontChecks({ declared: declaredFonts, browser: { ...fontState, ...net }, files: fontFiles, refs: fontRefs, styleName: reel?.style || 'none', covers: faceCovers })) add(...row);

      pageEvents = await page.evaluate(collectPageEvents, comp.id);
      const safe = safeRect({ ...profile, width: comp.width, height: comp.height });
      const n = 12, even = Array.from({ length: n }, (_, i) => +(i * (comp.duration - 1 / fps) / (n - 1)).toFixed(3));
      const targeted = planSamples([...pageEvents, ...planEventsFor()], { fps, duration: comp.duration, cap: 36 });
      const times = [...even.map(t => ({ t, label: `${t}s` })), ...targeted.map(s => ({ t: s.t, label: `${s.t}s ${s.reason}`, targeted: true }))];
      const found = await page.evaluate(([id, times, safe]) => {
        const W = innerWidth, H = innerHeight, out = { clip: [], unsafe: [], eventClip: [], eventUnsafe: [] };
        // A clip is on screen only inside its data-start/data-duration window (HyperFrames hides it otherwise).
        const live = (el, t) => { for (let e = el; e && e.getAttribute; e = e.parentElement) {
          const s = e.getAttribute('data-start'), d = e.getAttribute('data-duration');
          if (s !== null && d !== null && (t < +s || t >= +s + +d)) return false; } return true; };
        const shown = el => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
          const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; o *= +s.opacity; } return o > 0.05; };
        const textNodes = [];
        const walker = document.createTreeWalker(document.querySelector(`[data-composition-id="${id}"]`), NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent.trim()) textNodes.push(n);
        for (const { t, label: at, targeted } of times) {
          const tl = window.__timelines[id]; tl.pause(); tl.seek(t, false);
          for (const n of textNodes) {
            const el = n.parentElement; if (!live(el, t) || !shown(el)) continue;
            const range = document.createRange(); range.selectNodeContents(n);
            // Text cut off by an overflow-clipping ancestor (odometer digit strips, masked reveals) is not on screen:
            // measure only the part every clipping ancestor lets through.
            const clips = [];
            for (let e = el; e && e.nodeType === 1; e = e.parentElement) if (getComputedStyle(e).overflow !== 'visible') clips.push(e.getBoundingClientRect());
            for (const raw of range.getClientRects()) {
              let l = raw.left, tp = raw.top, rt = raw.right, bt = raw.bottom;
              for (const c of clips) { l = Math.max(l, c.left); tp = Math.max(tp, c.top); rt = Math.min(rt, c.right); bt = Math.min(bt, c.bottom); }
              const r = { left: l, top: tp, right: rt, bottom: bt, width: rt - l, height: bt - tp };
              if (r.width < 1 || r.height < 1) continue;
              const label = `${at} "${n.textContent.trim().slice(0, 40)}" [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`;
              if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) (targeted ? out.eventClip : out.clip).push(label);
              else if (r.left < safe.x0 || r.top < safe.y0 || r.right > safe.x1 || r.bottom > safe.y1) (targeted ? out.eventUnsafe : out.unsafe).push(label);
            }
          }
        }
        return out;
      }, [comp.id, times, safe]);
      const uniq = a => [...new Set(a)];
      add('Layout', 'text inside the canvas (no clipping)', found.clip.length ? 'FAIL' : 'PASS', uniq(found.clip).slice(0, 6).join('; ') || `${n} sample times`, req);
      const strict = profile.name.startsWith('ad');
      add('Layout', `text inside the ${profile.name} safe area (x ${safe.x0}-${safe.x1}, y ${safe.y0}-${safe.y1})`,
        found.unsafe.length ? (strict ? 'FAIL' : 'WARNING') : 'PASS',
        uniq(found.unsafe).slice(0, 6).join('; ') || `${n} sample times`, req);
      // Around transitions text is often off canvas on purpose (entering, exiting), so findings there are for review.
      const ev = [...uniq(found.eventClip), ...uniq(found.eventUnsafe)];
      add('Layout', 'text at event boundaries and during transitions', ev.length ? 'WARNING' : targeted.length ? 'PASS' : 'NOT APPLICABLE',
        ev.length ? `review (entries and exits may be intentional): ${ev.slice(0, 5).join('; ')}` : `${targeted.length} targeted sample times from ${pageEvents.length + planEventsFor().length} events`);
    } catch (e) {
      add('Layout', 'DOM layout pass ran in headless Chrome', 'FAIL', `checker error: ${e.message.split('\n')[0]}`, { ...req, kind: 'checker' });
    } finally { if (browser) await browser.close(); }
  }
}

// ---------- Mode B: speech editing records and Herk's validators
let edl = null, flaggedCuts = [];
if (footage) {
  const assets = join(dir, 'assets');
  const load = (name, label) => {
    const p = join(assets, name);
    if (!existsSync(p)) { add('Speech', `${label} (assets/${name})`, 'NOT TESTED', 'missing: Mode B needs it before a candidate can be verified', req); return null; }
    try { const v = JSON.parse(readFileSync(p, 'utf8')); add('Speech', `${label} (assets/${name})`, 'PASS', 'present', req); return v; }
    catch (e) { add('Speech', `${label} (assets/${name})`, 'FAIL', `unreadable JSON: ${e.message}`, req); return null; }
  };
  const source = load('source-transcript.json', 'verified source transcript with word timestamps');
  const retained = load('transcript.json', 'retimed transcript of the edit');
  edl = load('edit-decisions.json', 'source-to-final edit decision list');
  const plan = load('plan.json', 'short-form plan');
  if (source && retained && edl) {
    const si = speechIntegrity(source, retained, edl);
    for (const row of si.rows) add(...row);
    flaggedCuts = si.flagged;
  } else add('Speech', 'speech integrity against the source', 'NOT TESTED', 'needs source transcript, retimed transcript and EDL', req);
  if (edl) add('Speech', 'EDL duration matches the composition', Math.abs(Number(edl.duration) - comp.duration) <= 1 / fps + 0.005 ? 'PASS' : 'FAIL', `EDL ${edl.duration} s, composition ${comp.duration} s`, req);
  if (plan && retained && edl) {
    try {
      const { validatePlan } = await import(pathToFileURL(join(kitRoot, '.claude/skills/short-form-edit/scripts/validate-plan.mjs')).href);
      for (const row of planChecks(validatePlan(plan, retained, edl, p => existsSync(join(dir, p))), plan)) add(...row);
      const needsLedger = (plan.scenes || []).some(s => s.layout?.includes('broll') || s.mode === 'footage');
      if (!needsLedger) add('Herk', 'validate-footage (B-roll ledger)', 'NOT APPLICABLE', 'plan has no B-roll scenes');
      else {
        const r = run(process.execPath, [join(kitRoot, '.claude/skills/short-form-edit/scripts/validate-footage.mjs'), dir]);
        let j = null; try { j = JSON.parse(r.stdout); } catch {}
        add('Herk', 'validate-footage (B-roll ledger)', j ? (j.ok ? 'PASS' : 'FAIL') : 'FAIL', j ? j.errors.slice(0, 5).join('; ') || `${j.scenes} rows` : `checker error: ${tailText(r.stdout + r.stderr)}`, { ...req, kind: j ? 'technical' : 'checker' });
      }
    } catch (e) { add('Herk', 'validate-plan ran', 'FAIL', `checker error: ${e.message}`, { ...req, kind: 'checker' }); }
  } else add('Herk', 'validate-plan: source mapping and captions', 'NOT TESTED', 'needs plan.json, transcript.json and edit-decisions.json', req);
} else add('Speech', 'Mode B speech integrity', 'NOT APPLICABLE', `mode ${reel?.mode || 'unknown'}`);

// ---------- render
const expectsAudio = /<audio\b/i.test(html) || (existsSync(join(dir, 'compositions')) && readdirSync(join(dir, 'compositions')).some(f => /<audio\b/i.test(readFileSync(join(dir, 'compositions', f), 'utf8'))));
const sheets = [];
if (!render) {
  if (sourceOnly) add('Render', 'rendered MP4', 'NOT APPLICABLE', '--source-only: source checks only; no render is verified by this run');
  else add('Render', 'rendered MP4', 'NOT TESTED', 'no render found; run render-reel.mjs', req);
} else {
  const p = run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', render]);
  let probe = null; try { probe = JSON.parse(p.stdout); } catch {}
  for (const row of probeChecks(probe, { width: comp.width, height: comp.height, fps, duration: comp.duration, audio: footage || expectsAudio, codec: profile.codec, pixFmt: profile.pixFmt })) add(...row);
  add(...decodeCheck(run('ffmpeg', ['-v', 'error', '-xerror', '-i', render, '-f', 'null', '-'])));
  const hasAudio = !!probe?.streams?.some(s => s.codec_type === 'audio');
  if (hasAudio) {
    const r = run('ffmpeg', ['-hide_banner', '-nostats', '-i', render, '-vn', '-af', AUDIO_FILTER, '-f', 'null', '-']);
    for (const row of audioChecks(r, parseAudioAnalysis(r.stderr), { duration: comp.duration, required: footage })) add(...row);
  } else if (footage) add('Audio', 'ffmpeg audio analysis', 'NOT TESTED', 'no audio stream to measure', req);

  // Review clips and waveforms around every flagged cut (edited timeline), for a person to watch and hear.
  if (footage && flaggedCuts.length) {
    const cutsDir = join(outDir, 'cuts');
    mkdirSync(cutsDir, { recursive: true });
    let made = 0, errors = [];
    for (const f of flaggedCuts) {
      const t0 = Math.max(0, f.editedTime - 1.5), stem = join(cutsDir, `cut-${String(f.cut).padStart(2, '0')}-${f.editedTime.toFixed(2)}s`);
      const c = run('ffmpeg', ['-y', '-v', 'error', '-ss', String(t0), '-t', '3', '-i', render, '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', `${stem}.mp4`]);
      const w = run('ffmpeg', ['-y', '-v', 'error', '-ss', String(t0), '-t', '3', '-i', render, '-filter_complex', 'showwavespic=s=1200x240:split_channels=0', '-frames:v', '1', `${stem}-wave.png`]);
      if (c.status === 0 && w.status === 0) made++; else errors.push(tailText(c.stderr + w.stderr));
    }
    add('Speech', 'review clips and waveforms for flagged cuts', errors.length ? 'FAIL' : 'PASS', errors.length ? `checker error: ${errors[0]}` : `${made} clip(s) in ${relative(dir, cutsDir).replaceAll('\\', '/')}`, { kind: errors.length ? 'checker' : 'info' });
    sheets.push(relative(dir, cutsDir));
  }

  // motionmaxxing look.py: contact sheet, cuts, holds, gates. Gates are creative rules; a crash is a checker error.
  const py = python();
  const look = join(motionmaxxingDir, 'scripts/look.py');
  if (!py || !existsSync(look)) add('motionmaxxing', 'look.py gates (creative rules)', 'NOT TESTED', !py ? 'python not found' : 'motionmaxxing not installed', { kind: 'creative' });
  else {
    const lookOut = join(outDir, 'look');
    rmSync(join(lookOut, 'gates.json'), { force: true }); // never read a previous run's gates
    const r = run(py, [look, render, '--out', lookOut, '--expect', String(comp.duration), ...(expectsAudio ? ['--expect-audio'] : [])]);
    const gatesFile = join(lookOut, 'gates.json');
    const gatesText = existsSync(gatesFile) ? readFileSync(gatesFile, 'utf8') : null;
    for (const row of interpretLook(r, gatesText)) add(...row);
    if (gatesText) {
      try {
        const g = JSON.parse(gatesText), band = g.human_band;
        add('motionmaxxing', 'motion level (a question, not a gate)', 'NOT APPLICABLE', `mean frame-to-frame change ${g.motion_mean_luma_diff}/255; human-made films median ${band.median} (IQR ${band.q1}-${band.q3})`, { kind: 'info' });
      } catch {}
      sheets.push(relative(dir, join(lookOut, 'sheet.jpg')));
      for (const f of ['mid.jpg', 'strips.jpg']) if (existsSync(join(lookOut, f))) sheets.push(relative(dir, join(lookOut, f)));
    }
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
  else add('Render', 'safe-area review sheet', 'FAIL', `checker error: ${tailText(r.stderr)}`, { kind: 'checker' });

  // Event frames from the encoded MP4 (not the DOM): before, at, during and after the moments that change.
  const samples = planSamples([...pageEvents, ...planEventsFor()], { fps, duration: comp.duration, cap: 24 });
  if (!samples.length) add('Render', 'event frames from the encoded video', 'NOT APPLICABLE', 'no clip, tween, plan or authored events found');
  else {
    const evDir = join(outDir, 'events');
    rmSync(evDir, { recursive: true, force: true });
    mkdirSync(evDir, { recursive: true });
    const select = `select='${samples.map(s => `eq(n\\,${s.frame})`).join('+')}'`;
    const stamp = font ? [`drawtext=fontfile='${font.replace(/:/g, '\\:')}':text='%{pts\\:hms}':x=12:y=h-th-12:fontsize=40:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=8`] : [];
    const one = run('ffmpeg', ['-y', '-v', 'error', '-i', render, '-an', '-vf', [select, ...stamp, 'scale=540:-2'].join(','), '-fps_mode', 'vfr', '-q:v', '3', join(evDir, '%03d.jpg')]);
    const rows = Math.ceil(samples.length / 6);
    const evSheet = join(outDir, 'event-sheet.jpg');
    const two = run('ffmpeg', ['-y', '-v', 'error', '-i', render, '-an', '-vf', [select, ...stamp, 'scale=180:-2', `tile=6x${rows}:padding=4:margin=4:color=0x111111`].join(','), '-fps_mode', 'vfr', '-frames:v', '1', '-q:v', '3', evSheet]);
    const got = existsSync(evDir) ? readdirSync(evDir).filter(f => /^\d{3}\.jpg$/.test(f)).sort() : [];
    if (one.status !== 0 || two.status !== 0 || got.length !== samples.length) {
      add('Render', 'event frames from the encoded video', 'FAIL', `checker error: ${got.length}/${samples.length} frames; ${tailText(one.stderr + two.stderr)}`, { kind: 'checker' });
    } else {
      const index = samples.map((s, i) => {
        const name = `f${String(s.frame).padStart(5, '0')}-${s.t.toFixed(2)}s.jpg`;
        renameSync(join(evDir, got[i]), join(evDir, name));
        return { file: name, ...s };
      });
      writeJson(join(evDir, 'index.json'), index);
      add('Render', 'event frames from the encoded video', 'PASS', `${samples.length} frames (${[...new Set(samples.map(s => s.phase))].join(', ')}) in ${relative(dir, evDir).replaceAll('\\', '/')}; reasons in index.json`, { kind: 'info' });
      sheets.push(relative(dir, evSheet), relative(dir, evDir));
    }
  }

  if (candidate) {
    const shaAfter = await sha256File(render);
    add('Render', 'candidate unchanged while QA ran (SHA-256 before and after)', shaAfter === shaBefore ? 'PASS' : 'FAIL', shaAfter === shaBefore ? shaBefore.slice(0, 12) : `${shaBefore.slice(0, 12)} -> ${shaAfter.slice(0, 12)}`, req);
  }
}

// ---------- judgement that no script can make: the Stage 2 checklist (never blocks Stage 1, never passes itself)
const hasCaptions = /caption/i.test(html);
const human = { kind: 'human' };
add('Visual', 'G1 proof readable / G4 one hero per frame', 'NOT TESTED', 'judge by eye on the contact sheet', human);
add('Visual', 'safe areas, text clipping, font rendering in the encoded frames', render ? 'NOT TESTED' : 'NOT APPLICABLE', render ? 'look at safe-area-sheet.jpg (guides exist only on the sheet)' : 'no render', human);
add('Visual', 'continuity, animation timing, ending', render ? 'NOT TESTED' : 'NOT APPLICABLE', render ? 'watch the MP4 at full size; step through event-sheet.jpg and events/ for transitions' : 'no render', human);
add('Visual', 'captions and A/V sync', expectsAudio || hasCaptions ? 'NOT TESTED' : 'NOT APPLICABLE', expectsAudio || hasCaptions ? 'watch and listen; check word timing' : 'no audio or captions', human);
if (footage) {
  add('Speech', 'meaning preserved at every cut', 'NOT TESTED', flaggedCuts.length ? `read the transcript around ${flaggedCuts.length} flagged cut(s) and watch the review clips` : 'read the retained transcript against the source', human);
  add('Speech', 'speech sounds natural at the joins, voice quality', 'NOT TESTED', 'listen; waveforms and loudness numbers do not prove this', human);
  add('Visual', 'vertical speaker framing (face not cropped, inside the Instagram safe area)', render ? 'NOT TESTED' : 'NOT APPLICABLE', 'no face detector in this kit: look at safe-area-sheet.jpg', human);
  add('Speech', 'transcript of the rendered audio matches the expected edit', 'NOT TESTED', 'optional; no local speech recognition is configured in this kit', { kind: 'info' });
}

// ---------- report
const ev = evaluate(results);
const sheetPaths = sheets.map(s => s.replaceAll('\\', '/'));
const projectArg = relative(kitRoot, dir).replaceAll('\\', '/');
const record = {
  schema: 'reel-qa/2', project: reel?.slug || basename(dir), projectArg, mode: reel?.mode || null,
  render: render ? relative(dir, render).replaceAll('\\', '/') : null, candidate, sha256: shaBefore,
  qaAt: new Date().toISOString(), profile: profile.name, ...ev,
  requireHumanApproval: humanApprovalRequired(reel), approval: candidate ? { status: 'pending' } : null,
  results, sheets: sheetPaths,
};
const profileLine = `- Profile: ${profile.name} (${profile.width}x${profile.height} @ ${profile.fps} fps), composition \`${comp.id}\`, ${comp.duration} s, mode ${reel?.mode || 'unknown'}`;
const md = reportMarkdown({ title: record.project, render: record.render, profileLine, record }) +
  ['## Review images', '', ...(sheetPaths.length ? sheetPaths.map(s => `- ${s}`) : ['- none']), ''].join('\n');
writeFileSync(join(outDir, 'QA.md'), md);
writeJson(join(outDir, 'qa.json'), record);
if (render) writeProjectSummary(dir, record, relative(dir, join(outDir, 'QA.md')).replaceAll('\\', '/'));
for (const r of results) console.log(`${r.status.padEnd(14)} ${r.required ? '*' : ' '} [${r.area}] ${r.check}: ${r.detail}`);
console.log(`\n* = required. Stage 1 ${ev.verdict}: ${relative(process.cwd(), join(outDir, 'QA.md'))}`);
for (const r of ev.blocking) console.log(`  blocking: ${r.status} [${r.area}] ${r.check}`);
for (const s of sheets) console.log(`Review: ${relative(process.cwd(), join(dir, s))}`);
if (candidate && ev.technicallyVerified) console.log(`Candidate ${record.render} is technically verified (SHA-256 ${shaBefore.slice(0, 12)}). Stage 2: a person must watch, listen and approve it.`);
process.exitCode = ev.technicallyVerified ? 0 : 1;
