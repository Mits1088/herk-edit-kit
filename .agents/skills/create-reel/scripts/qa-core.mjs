// qa-core.mjs - shared Reel Studio QA logic: statuses, the blocking rule, candidate records, hashing, speech
// integrity, audio measurements and safe promotion. Pure functions where possible so tests can drive them directly.
//
// The blocking rule (Stage 1, automated technical verification):
//   - any FAIL blocks (a technical problem, or a checker that crashed or could not read its input);
//   - a REQUIRED check blocks unless it is PASS, WARNING (ran, finding is non-blocking) or NOT APPLICABLE,
//     so a required check that is NOT TESTED never counts as passed;
//   - creative findings (motionmaxxing gates) are WARNING, never FAIL: review them, do not chase them;
//   - human review items are NOT TESTED by design and are the Stage 2 checklist, not Stage 1.
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync, existsSync, copyFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, basename, relative } from 'node:path';

export const STATUSES = ['PASS', 'FAIL', 'WARNING', 'NOT TESTED', 'NOT APPLICABLE'];
export const KINDS = ['technical', 'creative', 'checker', 'human', 'info'];
const OK_REQUIRED = new Set(['PASS', 'WARNING', 'NOT APPLICABLE']);

// Stage 2 checklist shown to the person approving a candidate.
export const HUMAN_CHECKLIST = [
  'Natural speech continuity (no clipped words, no audible jumps)',
  'Editing and pacing',
  'Voice quality',
  'Caption accuracy',
  'Graphics and transitions',
  'Overall creative quality',
];

export function makeCollector() {
  const results = [];
  const add = (area, check, status, detail = '', { required = false, kind = 'technical' } = {}) => {
    if (!STATUSES.includes(status)) throw new Error(`Unknown status ${status}`);
    if (!KINDS.includes(kind)) throw new Error(`Unknown kind ${kind}`);
    // A creative rule finding is never a technical failure.
    if (kind === 'creative' && status === 'FAIL') status = 'WARNING';
    results.push({ area, check, status, detail: String(detail ?? ''), required, kind });
  };
  return { results, add };
}

// scope says what was checked. Only full QA of a rendered video can be VERIFIED; a source-only run that passes is
// SOURCE_VALIDATED and a draft's quick checks DRAFT_CHECKED, so neither reads as "the video is verified".
// passed: nothing blocks at this scope (exit codes). technicallyVerified: passed full QA of a render (approval).
const PASS_VERDICT = { render: 'VERIFIED', source: 'SOURCE_VALIDATED', draft: 'DRAFT_CHECKED' };
export function evaluate(results, { scope = 'render' } = {}) {
  if (!PASS_VERDICT[scope]) throw new Error(`Unknown QA scope ${scope}`);
  const blocking = results.filter(r => r.status === 'FAIL' || (r.required && !OK_REQUIRED.has(r.status)));
  const counts = results.reduce((c, r) => ((c[r.status] = (c[r.status] || 0) + 1), c), {});
  const passed = blocking.length === 0;
  return { scope, passed, technicallyVerified: passed && scope === 'render', verdict: passed ? PASS_VERDICT[scope] : 'BLOCKED', blocking, counts };
}

// reel.json "direction": the compact creative direction, required before a final render.
export const DIRECTION_FIELDS = ['hook', 'coreClaim', 'heroBeat', 'motif', 'style'];
export const missingDirection = reel => DIRECTION_FIELDS.filter(k => !String(reel?.direction?.[k] ?? '').trim());

export function sha256File(file) {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(file).on('error', rej).on('data', d => h.update(d)).on('end', () => res(h.digest('hex')));
  });
}

// Render file naming. Finals are "candidates" until a person approves one into renders/final.mp4.
export const isCandidateFile = (file, slug) => new RegExp(`^${slug}-candidate-v\\d{3}\\.mp4$`).test(basename(file));
export const qaDirFor = (dir, render) => join(dir, 'renders', basename(render, '.mp4') + '.qa');
export const recordPathFor = (dir, render) => join(qaDirFor(dir, render), 'qa.json');
export const finalPath = dir => join(dir, 'renders', 'final.mp4');

// Footage (Mode B) always needs a person; other modes follow reel.json, defaulting to required.
export function humanApprovalRequired(reel) {
  if (reel?.mode === 'footage') return true;
  return reel?.requireHumanApproval !== false;
}

// ---------- motionmaxxing results: separate a creative finding from a checker that did not work.
// run: { status, stdout, stderr, error }; gatesText: contents of gates.json written by THIS run, or null.
export function interpretLook(run, gatesText) {
  const out = [];
  let g = null;
  try { g = gatesText ? JSON.parse(gatesText) : null; } catch {}
  if (!g || !Array.isArray(g.gates)) {
    out.push(['motionmaxxing', 'look.py ran and wrote gates.json', 'FAIL',
      `checker error (exit ${run.status ?? 'none'}${run.error ? `, ${run.error.message}` : ''}): ${tailText(run.stdout + run.stderr) || 'no output'}`, { kind: 'checker' }]);
    return out;
  }
  for (const x of g.gates) {
    const status = x.status === 'PASS' ? 'PASS' : 'WARNING';
    out.push(['motionmaxxing', `${x.id} ${x.name} (creative rule)`, status, `${x.status === 'PASS' ? '' : `gate ${x.status}: review, do not chase. `}${x.detail ?? ''}`, { kind: 'creative' }]);
  }
  return out;
}

export function interpretLint(run) {
  let j = null;
  try { j = JSON.parse(run.stdout); } catch {}
  if (!j || !Array.isArray(j.rules)) {
    return [['motionmaxxing', 'G5 lint.mjs ran', 'FAIL', `checker error (exit ${run.status ?? 'none'}): ${tailText(run.stdout + run.stderr) || 'no output'}`, { kind: 'checker' }]];
  }
  const flagged = j.rules.filter(x => x.status === 'FAIL' || x.status === 'WARN');
  return [['motionmaxxing', 'G5 no page chrome (creative rule)', flagged.length ? 'WARNING' : 'PASS',
    flagged.map(x => `${x.status} ${x.id || x.rule}`).join(', ') || `${j.rules.length} rules clear`, { kind: 'creative' }]];
}

export function tailText(s) {
  return String(s || '').trim().split(/\r?\n/).slice(-3).join(' / ').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(0, 300);
}

// ---------- render probe (used by draft quick checks and full QA)
// probe: parsed ffprobe JSON or null; expect: { width, height, fps, duration, audio: true|false|null, codec, pixFmt }
export function probeChecks(probe, expect) {
  const out = [];
  const req = { required: true };
  if (!probe || !Array.isArray(probe.streams)) { out.push(['Render', 'ffprobe reads the file', 'FAIL', 'unreadable', req]); return out; }
  const v = probe.streams.find(s => s.codec_type === 'video'), a = probe.streams.filter(s => s.codec_type === 'audio');
  const [num, den] = (v?.r_frame_rate || '0/1').split('/').map(Number);
  const rate = num / (den || 1), dur = Number(probe.format?.duration);
  out.push(['Render', 'playable video stream', v ? 'PASS' : 'FAIL', v ? `${v.codec_name} ${v.width}x${v.height}` : 'none', req]);
  if (v) {
    out.push(['Render', `dimensions ${expect.width}x${expect.height} native vertical`, v.width === expect.width && v.height === expect.height && v.height > v.width ? 'PASS' : 'FAIL', `${v.width}x${v.height}`, req]);
    out.push(['Render', `frame rate ${expect.fps} fps`, Math.abs(rate - expect.fps) < 0.01 ? 'PASS' : 'FAIL', `${rate.toFixed(3)} fps`, req]);
    if (expect.codec) out.push(['Render', `video codec ${expect.codec}`, v.codec_name === expect.codec ? 'PASS' : 'FAIL', v.codec_name, req]);
    if (expect.pixFmt) out.push(['Render', `pixel format ${expect.pixFmt}`, v.pix_fmt === expect.pixFmt ? 'PASS' : 'FAIL', v.pix_fmt, req]);
  }
  out.push(['Render', `duration ${expect.duration} s (within one frame)`, Math.abs(dur - expect.duration) <= 1 / expect.fps + 0.01 ? 'PASS' : 'FAIL', Number.isFinite(dur) ? `${dur.toFixed(3)} s` : 'unknown', req]);
  if (expect.audio === true) {
    out.push(['Render', 'audio stream present', a.length ? 'PASS' : 'FAIL', a.map(s => s.codec_name).join(', ') || 'none', req]);
    if (a.length) out.push(['Render', 'audio codec aac', a.every(s => s.codec_name === 'aac') ? 'PASS' : 'WARNING', a.map(s => s.codec_name).join(', ')]);
  } else if (expect.audio === false) {
    out.push(['Render', 'audio', 'NOT APPLICABLE', a.length ? `composition has no <audio> but the file has ${a.length} audio stream(s)` : 'composition has no audio']);
  }
  return out;
}

export function decodeCheck(run) {
  const err = tailText(run.stderr);
  return ['Render', 'every frame decodes (ffmpeg full decode)', run.status === 0 && !err ? 'PASS' : 'FAIL',
    run.status === 0 && !err ? 'no decoder errors' : `exit ${run.status ?? 'none'}: ${err || run.error?.message || 'decoder error'}`, { required: true }];
}

// ---------- audio measurements from one ffmpeg pass (silencedetect, astats, ebur128). Measurements, not listening.
export const AUDIO_FILTER = 'silencedetect=n=-50dB:d=0.8,astats=measure_perchannel=none,ebur128=peak=true';
export function parseAudioAnalysis(stderr) {
  const s = String(stderr || '');
  const sum = s.slice(s.lastIndexOf('Summary:'));
  const num = (re, text = s) => { const m = text.match(re); return m ? Number(m[1]) : null; };
  const lufs = s.includes('Summary:') ? num(/I:\s+(-?[\d.]+|-inf) LUFS/, sum) : null;
  const truePeak = s.includes('Summary:') ? num(/Peak:\s+(-?[\d.]+) dBFS/, sum) : null;
  const overall = s.slice(s.lastIndexOf('] Overall'));
  const peak = s.includes('] Overall') ? num(/Peak level dB:\s+(-?[\d.]+|-inf)/, overall) : null;
  const flat = s.includes('] Overall') ? num(/Flat factor:\s+([\d.]+)/, overall) : null;
  const silences = [...s.matchAll(/silence_end:\s+([\d.]+)\s+\|\s+silence_duration:\s+([\d.]+)/g)].map(m => ({ end: +m[1], duration: +m[2], start: +m[1] - +m[2] }));
  return { lufs, truePeak, peak, flat, silences, parsed: lufs !== null || peak !== null };
}

export function audioChecks(run, analysis, { duration, required }) {
  const opts = { required };
  if (run.status !== 0 || !analysis.parsed) {
    return [['Audio', 'ffmpeg audio analysis ran', 'FAIL', `checker error (exit ${run.status ?? 'none'}): ${tailText(run.stderr) || 'no output'}`, { ...opts, kind: 'checker' }]];
  }
  const out = [];
  const { lufs, truePeak, peak, flat } = analysis;
  out.push(['Audio', 'integrated loudness (ebur128)', lufs === null ? 'WARNING' : lufs < -18 || lufs > -9 ? 'WARNING' : 'PASS',
    lufs === null ? 'no loudness measured (silent track?)' : `${lufs} LUFS (social delivery is commonly about -14; outside -18 to -9 is flagged)`, opts]);
  const clipped = (truePeak !== null && truePeak > 0) || (peak !== null && peak >= -0.1 && flat > 0);
  out.push(['Audio', 'clipping (true peak, sample peak, flat factor)', clipped ? 'WARNING' : 'PASS',
    `true peak ${truePeak ?? '?'} dBFS, sample peak ${peak ?? '?'} dB, flat factor ${flat ?? '?'}`, opts]);
  const inner = analysis.silences.filter(x => x.start > 0.3 && x.end < duration - 0.3);
  out.push(['Audio', 'dead air inside the reel (silence >= 0.8 s at -50 dB)', inner.length ? 'WARNING' : 'PASS',
    inner.length ? inner.map(x => `${x.start.toFixed(2)}-${x.end.toFixed(2)} s`).join(', ') : 'none', opts]);
  return out;
}

// ---------- Mode B speech integrity: compare the retained edit against the verified source transcript.
// A word scan for risky removals (negations, qualifiers, numbers). It flags cuts for a person; it does not judge meaning.
const NEGATIONS = new Set(['not', 'no', 'never', 'none', 'nobody', 'nothing', 'neither', 'nor', 'without', 'cannot', 'nowhere', 'hardly', 'barely']);
const QUALIFIERS = new Set(['only', 'just', 'almost', 'nearly', 'maybe', 'might', 'may', 'probably', 'possibly', 'perhaps', 'sometimes', 'rarely',
  'usually', 'often', 'some', 'few', 'most', 'least', 'except', 'unless', 'but', 'however', 'although', 'though', 'if', 'until', 'than', 'more',
  'less', 'fewer', 'mostly', 'partly', 'roughly', 'about', 'around', 'up', 'over', 'under', 'percent', 'half']);
const NUMBER_WORDS = new Set(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'twenty',
  'thirty', 'forty', 'fifty', 'hundred', 'thousand', 'million', 'billion', 'trillion', 'first', 'second', 'third']);
export const normWord = t => String(t).toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9']/g, '');
export function riskOf(text) {
  const w = normWord(text);
  if (!w) return null;
  if (NEGATIONS.has(w) || w.endsWith("n't")) return 'negation';
  if (/\d/.test(w) || NUMBER_WORDS.has(w)) return 'number';
  if (QUALIFIERS.has(w)) return 'qualifier';
  return null;
}

// source: { words:[{text,start,end}] } on the SOURCE timeline; retained: { words:[{text,start,end,sourceStart,sourceEnd}] };
// edl: { keeps:[{sourceStart,sourceEnd,start,end}] }. Returns rows for the collector plus the flagged cut list.
export function speechIntegrity(source, retained, edl, { tol = 0.01 } = {}) {
  const rows = [], flagged = [];
  const req = { required: true };
  const sw = (source?.words || []).filter(w => w.type !== 'spacing');
  const rw = (retained?.words || []).filter(w => w.type !== 'spacing');
  const keeps = [...(edl?.keeps || [])].sort((a, b) => a.sourceStart - b.sourceStart);
  const badSource = sw.filter((w, i) => !(w.end > w.start) || w.start < 0 || (i && w.start < sw[i - 1].start - tol));
  if (!sw.length || badSource.length) {
    rows.push(['Speech', 'source transcript has ordered word-level timestamps', 'FAIL', !sw.length ? 'no words' : `${badSource.length} words with invalid or out-of-order times, first "${badSource[0].text}"`, req]);
    return { rows, flagged };
  }
  rows.push(['Speech', 'source transcript has ordered word-level timestamps', 'PASS', `${sw.length} words`, req]);
  if (!keeps.length || keeps.some(k => !(k.sourceEnd > k.sourceStart))) {
    rows.push(['Speech', 'edit decision list has valid keep ranges', 'FAIL', keeps.length ? 'a keep has no duration' : 'no keeps', req]);
    return { rows, flagged };
  }
  // Cuts must fall between words, never inside one.
  const splits = [];
  for (const k of keeps) for (const b of [k.sourceStart, k.sourceEnd]) {
    const w = sw.find(w => b > w.start + tol && b < w.end - tol);
    if (w) splits.push(`${b.toFixed(3)} s splits "${w.text}" (${w.start.toFixed(3)}-${w.end.toFixed(3)})`);
  }
  rows.push(['Speech', 'no cut splits a spoken word', splits.length ? 'FAIL' : 'PASS', splits.slice(0, 6).join('; ') || `${keeps.length * 2} cut boundaries checked against ${sw.length} words`, req]);
  // The retained transcript must be exactly the source words inside the keeps, in order.
  const mid = w => (w.start + w.end) / 2;
  const kept = sw.filter(w => keeps.some(k => mid(w) >= k.sourceStart && mid(w) <= k.sourceEnd));
  const a = kept.map(w => normWord(w.text)), b = rw.map(w => normWord(w.text));
  const diff = a.findIndex((x, i) => x !== b[i]);
  const same = a.length === b.length && diff === -1;
  rows.push(['Speech', 'retained transcript equals the source words inside the kept ranges', same ? 'PASS' : 'FAIL',
    same ? `${a.length} words` : `source keeps ${a.length} words, transcript has ${b.length}; first difference at word ${diff === -1 ? Math.min(a.length, b.length) : diff}: source "${kept[diff === -1 ? a.length - 1 : diff]?.text ?? '-'}" vs transcript "${rw[diff === -1 ? b.length - 1 : diff]?.text ?? '-'}"`, req]);
  // Removed spans: before the first keep, between keeps, after the last keep.
  const gaps = [{ from: -Infinity, to: keeps[0].sourceStart, at: 0 }];
  for (let i = 1; i < keeps.length; i++) gaps.push({ from: keeps[i - 1].sourceEnd, to: keeps[i].sourceStart, at: keeps[i].start });
  gaps.push({ from: keeps.at(-1).sourceEnd, to: Infinity, at: keeps.at(-1).end });
  gaps.forEach((g, i) => {
    const removed = sw.filter(w => mid(w) > g.from && mid(w) < g.to);
    const risks = removed.map(w => [w.text, riskOf(w.text)]).filter(x => x[1]);
    if (!risks.length) return;
    const before = kept.filter(w => w.end <= g.from + tol).slice(-4).map(w => w.text).join(' ');
    const after = kept.filter(w => w.start >= g.to - tol).slice(0, 4).map(w => w.text).join(' ');
    flagged.push({ cut: i, editedTime: g.at, sourceFrom: g.from, sourceTo: g.to, removed: removed.map(w => w.text).join(' '), risks, before, after });
  });
  rows.push(['Speech', 'cuts that remove a negation, qualifier or number (heuristic word scan)', flagged.length ? 'WARNING' : 'PASS',
    flagged.length ? flagged.map(f => `at ${f.editedTime.toFixed(2)} s removed "${f.removed.slice(0, 80)}" [${f.risks.map(r => `${r[1]}: ${r[0]}`).join(', ')}] between "${f.before}" and "${f.after}"`).join('; ')
      : `${gaps.length} removed spans scanned; none removed a negation, qualifier or number. This is a word scan, not a meaning check.`,
    { kind: flagged.length ? 'human' : 'technical' }]);
  return { rows, flagged };
}

// Herk's validate-plan result split into source mapping and caption alignment (captions only when the plan has them).
export function planChecks(v, plan) {
  const req = { required: true };
  const cap = v.errors.filter(e => /^Caption/.test(e)), rest = v.errors.filter(e => !/^Caption/.test(e));
  return [
    ['Herk', 'validate-plan: source mapping, scenes, anchors', rest.length ? 'FAIL' : 'PASS', rest.slice(0, 5).join('; ') || `${v.metrics.retainedWords} words, ${v.metrics.scenes} scenes`, req],
    ['Captions', 'caption words and timing match the retimed transcript', !plan.captions?.length ? 'NOT APPLICABLE' : cap.length ? 'FAIL' : 'PASS',
      !plan.captions?.length ? 'plan has no captions' : cap.slice(0, 5).join('; ') || `${plan.captions.length} caption groups`, req],
  ];
}

// ---------- fonts: every face the reel declares must come from its local file; nothing may load from the network.
// A font that fails during a HyperFrames render falls back silently, so these checks run before the render is trusted.
export const NETWORK_FONT = /https?:\/\/[^"')\s]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com|typekit\.net|fonts\.bunny\.net|\.woff2?\b|\.[ot]tf\b)/i;

// texts: [{ file, text }] of the project's HTML and CSS. Returns the remote font references found.
export function networkFontRefs(texts) {
  const out = [];
  for (const { file, text } of texts) for (const m of text.matchAll(new RegExp(NETWORK_FONT.source, 'gi'))) out.push(`${file}: ${m[0]}`);
  return out;
}

const cleanFamily = f => String(f || '').split(',')[0].trim().replace(/^["']|["']$/g, '');

// declared: reel.json "fonts"; browser: { faces: [{family, weight, style, status}], used: [{family, weight, style, text}],
// loaded: [url], failed: [{url, error}], blocked: [url] }; files: { [file]: true when present and a WOFF2 }; refs: source scan.
// covers(face, weight, style) decides whether a declared face covers a weight/style (fonts.mjs faceCovers).
export function fontChecks({ declared = [], browser, files = {}, refs = [], styleName = 'none', covers }) {
  const req = { required: true }, out = [];
  out.push(['Fonts', 'no network font references in the source', refs.length ? 'FAIL' : 'PASS', refs.slice(0, 4).join('; ') || 'none', req]);
  if (!browser) return out;
  out.push(['Fonts', 'no network font requests (blocked during QA)', browser.blocked.length ? 'FAIL' : 'PASS', browser.blocked.slice(0, 4).join('; ') || 'none', req]);
  if (!declared.length) {
    const failed = browser.faces.filter(f => f.status === 'error');
    out.push(['Fonts', 'fonts loaded', failed.length ? 'FAIL' : browser.faces.length ? 'PASS' : 'WARNING',
      failed.length ? `failed: ${failed.map(f => f.family).join(', ')}` : browser.faces.length ? browser.faces.map(f => `${f.family}:${f.status}`).join(', ')
        : `no style fonts installed (reel.json style "${styleName}"); text uses system fonts (${[...new Set(browser.used.map(u => cleanFamily(u.family)))].join(' / ')}), which differ between machines`]);
    return out;
  }
  const missing = declared.filter(f => !files[f.file]).map(f => f.file);
  out.push(['Fonts', `declared font files present in the project (style ${styleName})`, missing.length ? 'FAIL' : 'PASS',
    missing.length ? `missing or not WOFF2: ${missing.join(', ')}` : `${declared.length} file(s)`, req]);
  // Each declared face: a matching FontFace that loaded, and a successful request for its own local file.
  const faceProblems = [];
  for (const d of declared) {
    const face = browser.faces.find(f => cleanFamily(f.family) === d.family && (f.style || 'normal') === d.style && String(f.weight) === String(d.weight));
    const fromFile = browser.loaded.some(u => decodeURIComponent(u).replaceAll('\\', '/').endsWith('/' + d.file));
    const failed = browser.failed.find(x => decodeURIComponent(x.url).replaceAll('\\', '/').endsWith('/' + d.file));
    if (!face) faceProblems.push(`${d.family} ${d.weight} ${d.style}: no @font-face declared`);
    else if (face.status !== 'loaded') faceProblems.push(`${d.family} ${d.weight} ${d.style}: ${face.status}${failed ? ` (${failed.error})` : ''}`);
    else if (!fromFile) faceProblems.push(`${d.family} ${d.weight} ${d.style}: loaded, but not from ${d.file}`);
  }
  out.push(['Fonts', 'each declared face loaded from its local file', faceProblems.length ? 'FAIL' : 'PASS',
    faceProblems.slice(0, 6).join('; ') || declared.map(d => `${d.family} ${d.weight} ${d.style}`).join(', '), req]);
  // Text in a declared family must be covered by a real face; otherwise the browser synthesizes bold or italic.
  const families = new Set(declared.map(d => d.family));
  const uncovered = [], foreign = [];
  for (const u of browser.used) {
    const fam = cleanFamily(u.family), style = /italic|oblique/.test(u.style) ? 'italic' : 'normal', weight = Number(u.weight);
    if (!families.has(fam)) foreign.push(`${fam} ("${u.text}")`);
    else if (!declared.some(d => d.family === fam && covers(d, weight, style))) uncovered.push(`${fam} ${weight} ${style} ("${u.text}")`);
  }
  const uniq = a => [...new Set(a)];
  out.push(['Fonts', 'text weights and styles covered by installed faces', uncovered.length ? 'FAIL' : 'PASS',
    uncovered.length ? `no face for ${uniq(uncovered).slice(0, 5).join('; ')} (the browser would synthesize it)` : `${browser.used.length} text style(s)`, req]);
  // A family outside the style with no loaded local face renders in whatever the machine has: usually a stale name
  // left from an earlier style, or a system font. That fails. One the project loads itself is only a warning.
  const backed = new Set(browser.faces.filter(f => f.status === 'loaded').map(f => cleanFamily(f.family)));
  const unbacked = foreign.filter(x => !backed.has(x.slice(0, x.indexOf(' ("'))));
  const extra = foreign.filter(x => !unbacked.includes(x));
  out.push(['Fonts', 'every text family has a local face (no machine fallback)', unbacked.length ? 'FAIL' : 'PASS',
    unbacked.length ? `not in style ${styleName} and not loaded from the project: ${uniq(unbacked).slice(0, 5).join('; ')}; rename to the style's families (reel-fonts renames by role)` : 'all text families load from the project', req]);
  if (extra.length) out.push(['Fonts', 'text uses only the style\'s families', 'WARNING',
    `loaded from the project but not in style ${styleName}: ${uniq(extra).slice(0, 5).join('; ')}`]);
  return out;
}

// ---------- records
export function writeJson(file, value) { writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
export function readJson(file) { return JSON.parse(readFileSync(file, 'utf8')); }

export function reportMarkdown({ title, render, profileLine, record }) {
  const { results, counts } = record;
  return [
    `# QA: ${title}`,
    '',
    `- Render: ${render || 'none'}`,
    ...(record.sha256 ? [`- SHA-256: \`${record.sha256}\``] : []),
    profileLine,
    `- Stage 1, automated technical verification: **${record.verdict}** (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')})`,
    ...(record.scope === 'source' ? ['- Source only: the composition was checked; no rendered video was. Render a candidate for Stage 1 verification.'] : []),
    ...(record.blocking.length ? ['- Blocking: ' + record.blocking.map(r => `[${r.area}] ${r.check}: ${r.status}`).join('; ')] : []),
    ...(record.candidate ? [`- Stage 2, human creative approval: ${approvalLine(record)}`] : []),
    '- Automated checks are not proof of visual or audio quality. Every NOT TESTED line needs a person.',
    '',
    '| Area | Check | Required | Kind | Status | Detail |',
    '| --- | --- | --- | --- | --- | --- |',
    ...results.map(r => `| ${r.area} | ${r.check} | ${r.required ? 'yes' : ''} | ${r.kind} | ${r.status} | ${String(r.detail).replace(/\|/g, '/').replace(/\r?\n/g, ' ')} |`),
    '',
  ].join('\n');
}

export function approvalLine(record) {
  const a = record.approval || { status: 'pending' };
  if (a.status === 'approved') return `APPROVED by ${a.approvedBy} at ${a.approvedAt} for \`${a.sha256.slice(0, 12)}\`, promoted to renders/final.mp4`;
  if (a.status === 'promoted-without-human-approval') return `not required by project settings; promoted at ${a.approvedAt}`;
  return record.technicallyVerified ? 'PENDING: watch and listen, then approve explicitly' : 'not available until Stage 1 passes';
}

// Project-level QA.md: the latest summary only. Approval never reads it.
export function writeProjectSummary(dir, record, reportRel) {
  const lines = [
    `# QA summary: ${record.project}`,
    '',
    'Latest QA run. The authoritative record for each render is its own `qa.json`; this file is a summary.',
    '',
    `- Render: ${record.render}${record.candidate ? ' (candidate)' : ' (draft, not eligible for approval)'}`,
    ...(record.sha256 ? [`- SHA-256: \`${record.sha256}\``] : []),
    `- QA run: ${record.qaAt}`,
    `- Full report: ${reportRel}`,
    '',
    '## Stage 1: automated technical verification',
    '',
    `**${record.verdict}**${record.blocking.length ? '' : ' (all essential checks passed)'}`,
    ...(record.blocking.length ? ['', ...record.blocking.map(r => `- ${r.status} [${r.area}] ${r.check}: ${r.detail}`)] : []),
    '',
  ];
  if (record.candidate) {
    lines.push('## Stage 2: human creative approval', '', approvalLine(record), '');
    if (record.approval?.status !== 'approved' && record.technicallyVerified) {
      // Speech items apply to footage; every other item applies to every mode.
      const items = record.mode === 'footage' ? HUMAN_CHECKLIST : HUMAN_CHECKLIST.filter(x => !/speech|Voice/.test(x));
      lines.push('Watch and listen to the candidate, then check each item:', '', ...items.map(x => `- [ ] ${x}`), '',
        'Approve only this file, in your own message or by running:', '',
        '```', `npm run approve-reel -- ${record.projectArg || '<project>'} --candidate ${record.render} --sha ${record.sha256.slice(0, 12)} --approved-by "<your name>"`, '```', '');
    }
  }
  writeFileSync(join(dir, 'QA.md'), lines.join('\n'));
}

// ---------- promotion: copy to a temp file, verify, archive the old final by copy, atomic rename, verify again.
// Any failure before the rename leaves renders/final.mp4 untouched; a mismatch after it restores the archive.
export async function promote(dir, candidate, expectedSha, { copy = copyFileSync, now = new Date() } = {}) {
  const renders = join(dir, 'renders');
  const final = finalPath(dir);
  const tmp = join(renders, `.final.mp4.tmp-${process.pid}`);
  let archived = null;
  const cleanup = () => { try { if (existsSync(tmp)) unlinkSync(tmp); } catch {} };
  try {
    copy(candidate, tmp);
    if (await sha256File(tmp) !== expectedSha) throw new Error('copied file does not match the approved hash');
    if (existsSync(final)) {
      const oldSha = await sha256File(final);
      if (oldSha === expectedSha) { cleanup(); return { final, archived: null, unchanged: true }; }
      mkdirSync(join(renders, 'approved'), { recursive: true });
      archived = join(renders, 'approved', `final-${now.toISOString().replace(/[:.]/g, '-')}-${oldSha.slice(0, 12)}.mp4`);
      copy(final, archived);
      if (await sha256File(archived) !== oldSha) { try { unlinkSync(archived); } catch {} throw new Error('archive copy of the previous final does not match it'); }
    }
    renameSync(tmp, final);
  } catch (e) {
    cleanup();
    throw new Error(`Promotion stopped; renders/final.mp4 was not changed. ${e.message}`);
  }
  if (await sha256File(final) !== expectedSha) {
    if (archived) copyFileSync(archived, final); else unlinkSync(final);
    throw new Error(`renders/final.mp4 did not match the approved hash after promotion${archived ? '; the previous final was restored' : ''}.`);
  }
  return { final, archived: archived && relative(dir, archived), unchanged: false };
}
