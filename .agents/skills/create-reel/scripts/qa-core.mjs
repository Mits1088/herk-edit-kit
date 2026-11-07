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

// ---------- audio balance: how loud the sound effects sit against the voice. Measurements, not listening.
// Two sources, reported separately:
//  1. Stems (preferred): assets/audio/stem-voice.wav and stem-sfx.wav plus the gains the mix applied to them
//     (assets/audio/mix-levels.json {"voice": g, "sfx": g} or reel.json "audio": {"stemGains": {...}}). Then the effects
//     level in the mix is computed exactly: integrated loudness and the loudest 150 ms hits against the voice.
//  2. The encoded mix (diagnostic only): RMS in 150 ms windows at each planned visual event against the median of
//     voice-only windows (transcript words with no event nearby). Voice and effects overlap there, so this estimates.
// Thresholds are starting points, not limits, set per reel in reel.json "audio": {"sfxHitMaxOverVoiceDb": 15,
// "mixHitMaxOverVoiceDb": 10, "sfxMaxOverVoiceLU": 3}. Calibrated on Caveman v5, whose v002 mix the person judged too
// loud and whose v003 mix was the correction: stems hits +17.1 / +13.2 dB, stems integrated +4.8 / +0.9 LU, encoded
// event windows +12.0 / +8.3 dB. The two sources read differently (the mix window also holds the voice), hence two
// hit limits. Peak level is useless here: the master limiter flattens every hit to the same ceiling.
export const AUDIO_BALANCE_DEFAULTS = { sfxHitMaxOverVoiceDb: 15, mixHitMaxOverVoiceDb: 10, sfxMaxOverVoiceLU: 3 };
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
export function rmsDb(samples, sr, t0, dur) {
  const a = Math.max(0, Math.floor(t0 * sr)), b = Math.min(samples.length, Math.floor((t0 + dur) * sr));
  if (b <= a) return -Infinity;
  let s = 0; for (let i = a; i < b; i++) s += samples[i] * samples[i];
  return db(Math.sqrt(s / (b - a)));
}
const median = (xs) => { const v = xs.filter(Number.isFinite).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; };
// Voice level: median RMS of 150 ms windows inside spoken words, optionally only those far from any event.
function voiceLevel(samples, sr, words, events = [], keepClear = 0) {
  const w = [];
  for (const x of words || []) {
    const s = Number(x.start), e = Number(x.end); if (!(e - s >= 0.15)) continue;
    const mid = (s + e) / 2 - 0.075;
    if (keepClear && events.some((t) => Math.abs(t - mid) < keepClear)) continue;
    w.push(rmsDb(samples, sr, mid, 0.15));
  }
  return median(w);
}
// Loudest 150 ms hits: windows starting at each event time (and 50 ms later) on the given signal.
function hits(samples, sr, events) {
  return events.map((t) => ({ t, db: Math.max(rmsDb(samples, sr, t, 0.15), rmsDb(samples, sr, t + 0.05, 0.15)) })).filter((h) => Number.isFinite(h.db)).sort((a, b) => b.db - a.db);
}
// ---------- perceived effects level (the gate). The ear hears short bright hits louder than plain RMS says, and an
// effect in a pause is heard against silence, not against the voice. So: both stems K-weighted (ITU-R BS.1770, the
// curve LUFS uses), 100 ms windows every 50 ms over the whole reel (not only at planned events), each effects window
// against the median speaking level of the voice. A window where the voice itself is quiet (more than 12 dB under its
// speaking level: a pause or a word tail) is "exposed" and has a stricter limit.
// Calibration (Nov 2026): the three reels that save the as-mixed effects stem all drew "effects too loud / overpowering"
// feedback and read here: karpathy-rules -11.9 speech / -12.1 pauses, claude-animated-reels -12.8 / -12.6, claude-arena
// v001 -11.0 / -9.4 (it passed the old check at "-16 dB" plain RMS). The limits sit clear of all three. Limits are dB
// relative to the voice's speaking level (negative = under). A mix aiming at the limit has no margin: aim 3 dB lower.
export const SFX_PERCEIVED_DEFAULTS = { sfxSpeechMaxDb: -16, sfxExposedMaxDb: -18, sfxIntegratedMaxLU: -20 };
function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
export function kWeight(x, sr) {
  // Stage 1: high shelf about +4 dB above 1.7 kHz. Stage 2: high-pass at 38 Hz. RBJ forms of the BS.1770 filters.
  let w = 2 * Math.PI * 1681.974 / sr, A = Math.pow(10, 3.99984 / 40), al = Math.sin(w) / (2 * 0.7071752), c = Math.cos(w), r = 2 * Math.sqrt(A) * al;
  let a0 = (A + 1) - (A - 1) * c + r;
  const s1 = biquad(x, A * ((A + 1) + (A - 1) * c + r) / a0, -2 * A * ((A - 1) + (A + 1) * c) / a0, A * ((A + 1) + (A - 1) * c - r) / a0,
    2 * ((A - 1) - (A + 1) * c) / a0, ((A + 1) - (A - 1) * c - r) / a0);
  w = 2 * Math.PI * 38.13547 / sr; al = Math.sin(w) / (2 * 0.5003270); c = Math.cos(w); a0 = 1 + al;
  return biquad(s1, (1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0);
}
function windowLevels(x, sr, gainDb, win = 0.1, hop = 0.05) {
  const n = Math.floor(win * sr), h = Math.floor(hop * sr), out = [];
  for (let a = 0; a + n <= x.length; a += h) { let s = 0; for (let i = a; i < a + n; i++) s += x[i] * x[i]; out.push(10 * Math.log10(s / n + 1e-20) + gainDb); }
  return out;
}
export function sfxPerceived({ voice, sfx, sr = 16000, gains, words = [], lufs = null, limits = {} }) {
  const L = { ...SFX_PERCEIVED_DEFAULTS, ...limits }, hop = 0.05;
  const gv = db(Number(gains.voice)), gs = db(Number(gains.sfx));
  const vw = windowLevels(kWeight(voice, sr), sr, gv), sw = windowLevels(kWeight(sfx, sr), sr, gs);
  const n = Math.min(vw.length, sw.length), centre = (i) => i * hop + 0.05;
  const spoken = []; let k = 0;
  const ws = [...words].map((x) => [Number(x.start), Number(x.end)]).filter(([s, e]) => e > s).sort((p, q) => p[0] - q[0]);
  for (let i = 0; i < n; i++) { const t = centre(i); while (k < ws.length && ws[k][1] < t) k++; if (k < ws.length && ws[k][0] <= t) spoken.push(vw[i]); }
  const ref = median(spoken);
  if (ref === null) return { ref: null };
  const speech = [], exposed = [];
  for (let i = 0; i < n; i++) {
    if (!(sw[i] > ref - 60)) continue;
    (vw[i] < ref - 12 ? exposed : speech).push({ t: centre(i), db: sw[i] - ref });
  }
  const peaks = (hs) => { const top = []; for (const h of [...hs].sort((p, q) => q.db - p.db)) { if (top.every((x) => Math.abs(x.t - h.t) >= 0.3)) top.push(h); if (top.length === 3) break; } return top; };
  const integrated = lufs && Number.isFinite(lufs.voice) && Number.isFinite(lufs.sfx) ? (lufs.sfx + gs) - (lufs.voice + gv) : null;
  const sp = peaks(speech), ex = peaks(exposed);
  const fails = [];
  if (sp.length && sp[0].db > L.sfxSpeechMaxDb) fails.push(`over speech ${sp[0].db.toFixed(1)} dB > ${L.sfxSpeechMaxDb}`);
  if (ex.length && ex[0].db > L.sfxExposedMaxDb) fails.push(`exposed (pause) ${ex[0].db.toFixed(1)} dB > ${L.sfxExposedMaxDb}`);
  if (integrated !== null && integrated > L.sfxIntegratedMaxLU) fails.push(`integrated ${integrated.toFixed(1)} LU > ${L.sfxIntegratedMaxLU}`);
  return { ref, speech: sp, exposed: ex, integrated, fails, limits: L };
}

export function audioBalance({ mix = null, sr = 16000, events = [], words = [], stems = null, gains = null, limits = {} } = {}) {
  const L = { ...AUDIO_BALANCE_DEFAULTS, ...limits }, out = [];
  const fmt = (h, ref) => `${h.t.toFixed(2)} s ${h.db - ref >= 0 ? '+' : ''}${(h.db - ref).toFixed(1)} dB`;
  if (stems?.voice && stems?.sfx && gains && Number(gains.voice) > 0 && Number(gains.sfx) > 0 && !/^applied/i.test(String(gains.sfx_stem || ''))) {
    out.push(['Audio', 'sound effects not overpowering the voice (perceived: K-weighted 100 ms windows, stems with mix gains)', 'NOT TESTED',
      'legacy mix: stem-sfx.wav is not the as-mixed effects (mix-levels.json has no "sfx_stem": "applied"), so it cannot be measured honestly. New reels mix through scripts/audio/reelmix.py, which writes cues.json and is checked per cue',
      { kind: 'info' }]);
  } else if (stems?.voice && stems?.sfx && gains && Number(gains.voice) > 0 && Number(gains.sfx) > 0) {
    const p = sfxPerceived({ voice: stems.voice, sfx: stems.sfx, sr, gains, words, lufs: stems.lufs, limits });
    const list = (hs) => hs.map((h) => `${h.t.toFixed(2)} s ${h.db.toFixed(1)} dB`).join(', ') || 'none';
    out.push(['Audio', 'sound effects not overpowering the voice (perceived: K-weighted 100 ms windows, stems with mix gains)',
      p.ref === null ? 'NOT TESTED' : p.fails.length ? 'FAIL' : 'PASS',
      p.ref === null ? 'no spoken words to measure the voice stem against' :
        `${p.fails.length ? `TOO LOUD: ${p.fails.join('; ')}. Lower the effects gain or the guard limits in the mix and re-render. ` : ''}` +
        `loudest over speech ${list(p.speech)}; loudest in pauses ${list(p.exposed)}` +
        `${p.integrated !== null ? `; integrated ${p.integrated.toFixed(1)} LU` : ''} (relative to the voice's speaking level). ` +
        `Limits: speech <= ${p.limits.sfxSpeechMaxDb} dB, pauses <= ${p.limits.sfxExposedMaxDb} dB, integrated <= ${p.limits.sfxIntegratedMaxLU} LU (reel.json "audio"; loosen only with the owner's say-so)`,
      { required: true, kind: 'technical' }]);
  } else if (stems?.voice && stems?.sfx) {
    out.push(['Audio', 'sound effects against the voice (stems with mix gains)', 'NOT TESTED', 'stems found but not the gains the mix applied: add assets/audio/mix-levels.json {"voice": g, "sfx": g}', { kind: 'info' }]);
  }
  if (mix) {
    const voice = voiceLevel(mix, sr, words, events, 0.6);
    const hs = hits(mix, sr, events);
    if (voice === null || !hs.length) out.push(['Audio', 'effects hits against the voice in the encoded mix (diagnostic)', 'NOT APPLICABLE', !hs.length ? 'no planned events to measure' : 'no voice-only stretch to measure', { kind: 'info' }]);
    else {
      const over = hs[0].db - voice;
      out.push(['Audio', 'effects hits against the voice in the encoded mix (diagnostic)', over > L.mixHitMaxOverVoiceDb ? 'WARNING' : 'PASS',
        `loudest event windows ${hs.slice(0, 3).map((h) => fmt(h, voice)).join(', ')} over voice-only RMS (voice and effects overlap here: an estimate, not proof; starting point <= +${L.mixHitMaxOverVoiceDb} dB; listen)`, { kind: 'info' }]);
    }
  }
  return out;
}

// ---------- per-cue audio QA for reels mixed by scripts/audio/reelmix.py (house profile: audio-library/house-profile.json)
// Same basis as the mixer: each cue's K-weighted 100 ms level as mixed (cues-applied.wav), in dB against the voice's
// median speaking level; a frame is "speech" where the voice is within profile.speechWindowDb of that level.
export const CUE_HOP = 0.01;
export function loadAudioProfile(root, reel = null) {
  const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object' ? merge(o[k], v) : v; return o; };
  return merge(JSON.parse(readFileSync(join(root, 'audio-library', 'house-profile.json'), 'utf8')), reel?.audio?.profileOverrides);
}
// 100 ms level (K-weighted by default) centred on each frame k*CUE_HOP, for a segment that starts at t0 seconds.
export function levelFrames(x, sr, frames, t0 = 0, { weight = true, win = 0.1 } = {}) {
  const y = weight ? kWeight(x, sr) : x, c = new Float64Array(y.length + 1);
  for (let i = 0; i < y.length; i++) c[i + 1] = c[i] + y[i] * y[i];
  const n = Math.floor(win * sr), out = new Float64Array(frames).fill(-Infinity);
  for (let k = 0; k < frames; k++) {
    const centre = Math.round((k * CUE_HOP - t0) * sr), a = Math.max(0, centre - (n >> 1)), b = Math.min(y.length, a + n);
    if (centre < 0 || centre >= y.length || b <= a) continue;
    out[k] = 10 * Math.log10((c[b] - c[a]) / (b - a) + 1e-20);
  }
  return out;
}
function butter2(x, sr, f, type) { // RBJ 2nd-order Butterworth high- or low-pass
  const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w), a0 = 1 + al, a1 = -2 * c / a0, a2 = (1 - al) / a0;
  const b = (type === 'hp' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [(1 - c) / 2, 1 - c, (1 - c) / 2]).map((v) => v / a0);
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
export const highpass = (x, sr, f) => butter2(butter2(x, sr, f, 'hp'), sr, f, 'hp');
export const bandpass = (x, sr, lo, hi) => butter2(butter2(x, sr, lo, 'hp'), sr, hi, 'lp');
export function lufsOf(x, sr) { // integrated loudness; for a dual-mono file folded down by ffmpeg -ac 1 this reads as the stereo file
  const y = kWeight(x, sr), n = Math.floor(0.4 * sr), h = Math.floor(0.1 * sr), z = [];
  const c = new Float64Array(y.length + 1); for (let i = 0; i < y.length; i++) c[i + 1] = c[i] + y[i] * y[i];
  for (let a = 0; a + n <= y.length; a += h) z.push((c[a + n] - c[a]) / n);
  const L = (v) => -0.691 + 10 * Math.log10(v + 1e-20), mean = (v) => v.reduce((p, q) => p + q, 0) / (v.length || 1);
  let g = z.filter((v) => L(v) > -70); if (!g.length) return -70;
  const rel = L(mean(g)) - 10; g = g.filter((v) => L(v) > rel);
  return L(mean(g));
}
function onsetSec(seg, sr, belowPeakDb = 24) { // first point within belowPeakDb of the cue's own 5 ms peak
  const n = Math.max(1, Math.floor(0.005 * sr)), e = new Float64Array(seg.length); let s = 0, peak = 0;
  for (let i = 0; i < seg.length; i++) { s += seg[i] * seg[i]; if (i >= n) s -= seg[i - n] * seg[i - n]; e[i] = Math.sqrt(Math.max(0, s) / n); if (e[i] > peak) peak = e[i]; }
  const th = peak * 10 ** (-belowPeakDb / 20);
  for (let i = 0; i < e.length; i++) if (peak > 0 && e[i] >= th) return Math.max(0, i - (n >> 1)) / sr;
  return 0;
}
// Length (s) of the pause in speech at time t: 0 inside a word.
export function pauseAround(words, t) {
  const ws = words.map((w) => [Number(w.start), Number(w.end)]).sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < ws.length; i++) {
    if (ws[i][0] <= t && ws[i][1] >= t) return 0;
    if (ws[i][0] > t) return ws[i][0] - (i ? ws[i - 1][1] : 0);
  }
  return Infinity;
}
export function cueChecks({ cues, applied, voice, bed = null, sfx = null, sr = 16000, words = [], events = [], profile, report = null, mix = null, encoded = null, fps = 30 }) {
  const P = profile, out = [], F = Math.ceil(voice.length / sr / CUE_HOP) + 1, tag = { kind: 'technical' };
  const vdb = levelFrames(voice, sr, F), wordFrames = (curve) => { const r = []; for (const w of words) for (let k = Math.floor(Number(w.start) / CUE_HOP); k < Math.ceil(Number(w.end) / CUE_HOP) && k < F; k++) r.push(curve[k]); return r; };
  const ref = median(wordFrames(vdb));
  if (ref === null) return [['Audio', 'effects by role (house profile)', 'NOT TESTED', 'no spoken words to measure the voice against', tag]];
  const speech = (k) => vdb[k] >= ref + P.speechWindowDb, scale = sr / (cues.sr || sr), f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : 'none');
  const rows = (cues.cues || []).map((c) => {
    const seg = applied.subarray(Math.round(c.offset * scale), Math.min(applied.length, Math.round((c.offset + c.length) * scale)));
    const lev = levelFrames(seg, sr, F, c.start);
    let sp = -Infinity, gp = -Infinity, pk = -Infinity, pt = c.start;
    for (let k = 0; k < F; k++) { if (!Number.isFinite(lev[k])) continue; const r = lev[k] - ref; if (speech(k)) sp = Math.max(sp, r); else gp = Math.max(gp, r); if (r > pk) { pk = r; pt = k * CUE_HOP; } }
    return { ...c, sp, gp, pk, pt, onset: c.start + onsetSec(seg, sr) };
  });
  const role = (c) => P.roles[c.role] || P.roles.foley;
  // 1. overpowering: each cue against its role's ceiling, over speech and in pauses
  const loud = rows.filter((c) => c.sp > role(c).max.speech || c.gp > role(c).max.gap);
  out.push(['Audio', 'effects not overpowering the voice, by role (house profile, per cue as mixed)', loud.length ? 'FAIL' : rows.length ? 'PASS' : 'NOT APPLICABLE',
    loud.length ? `${loud.length} cue(s) over their role ceiling: ${loud.slice(0, 5).map((c) => `${c.name} (${c.role}) ${c.pt.toFixed(2)} s: speech ${f1(c.sp)} / pause ${f1(c.gp)} dB, ceiling ${role(c).max.speech} / ${role(c).max.gap}`).join('; ')}`
      : `${rows.length} cue(s) within their ceilings (dB vs the voice's speaking level; profile ${P.name} v${P.version})`, { required: true, kind: 'technical' }]);
  // 2. heroes: one for every planned hero event, with impact, peaking in a pause, and rare
  const H = P.roles.hero, heroes = rows.filter((c) => c.role === 'hero');
  const planned = events.filter((e) => (e.sfx?.role || e.sfx) === 'hero');
  const missing = planned.filter((e) => !heroes.some((c) => Math.abs(c.at - Number(e.time)) <= 0.3 || (c.event === e.type && Math.abs(c.at - Number(e.time)) <= 1)));
  const quiet = heroes.filter((c) => !(c.pk >= H.floor)), tight = heroes.filter((c) => pauseAround(words, c.pt) < H.minGapSeconds);
  const parts = [
    missing.length && `planned hero event(s) with no hero cue: ${missing.map((e) => `${e.type} ${Number(e.time).toFixed(2)} s`).join(', ')}`,
    quiet.length && `too quiet (floor ${H.floor} dB): ${quiet.map((c) => `${c.name} ${f1(c.pk)} dB at ${c.pt.toFixed(2)} s${pauseAround(words, c.pt) < H.minGapSeconds ? ' (no pause there: protect one in the cut with cut-silences --protect)' : ''}`).join(', ')}`,
    tight.length && `peaking with under ${H.minGapSeconds} s of pause: ${tight.map((c) => `${c.name} ${c.pt.toFixed(2)} s`).join(', ')}`,
    heroes.length > H.maxPerReel && `${heroes.length} heroes (house maximum ${H.maxPerReel}: contrast needs them rare)`,
    heroes.length && `heroes: ${heroes.map((c) => `${c.name} ${f1(c.pk)} dB at ${c.pt.toFixed(2)} s`).join(', ')}`].filter(Boolean);
  out.push(['Audio', 'hero sounds present and with impact (not too quiet, peaking in a pause)', missing.length || quiet.length ? 'FAIL' : tight.length || heroes.length > H.maxPerReel ? 'WARNING' : heroes.length ? 'PASS' : 'NOT APPLICABLE',
    parts.join('; ') || 'no hero cues planned or placed', { required: true, kind: 'technical' }]);
  // 3. accents audible on a phone
  if (rows.some((c) => c.role === 'accent') && P.roles.accent.floor !== null) {
    const faint = rows.filter((c) => c.role === 'accent' && !(c.pk >= P.roles.accent.floor));
    out.push(['Audio', 'accents audible (above the accent floor)', faint.length ? 'WARNING' : 'PASS',
      faint.length ? `under ${P.roles.accent.floor} dB, likely lost on a phone: ${faint.slice(0, 6).map((c) => `${c.name} ${f1(c.pk)} dB at ${c.pt.toFixed(2)} s`).join(', ')}` : 'every accent above its floor', tag]);
  }
  // 4. timing: the audible onset against the plan event the cue names
  const timed = rows.filter((x) => x.event), off = [];
  for (const c of timed) {
    const ev = events.filter((e) => e.type === c.event).sort((p, q) => Math.abs(p.time - c.at) - Math.abs(q.time - c.at))[0];
    if (!ev) { off.push(`${c.name}: no plan event "${c.event}"`); continue; }
    const d = (c.onset - Number(ev.time)) * 1000;
    if (d < -P.timing.earlyMs || d > P.timing.lateMs) off.push(`${c.name} ${d > 0 ? '+' : ''}${d.toFixed(0)} ms vs ${c.event} ${Number(ev.time).toFixed(2)} s`);
  }
  if (timed.length) out.push(['Audio', 'effects land on their planned events (audible onset)', off.length ? 'WARNING' : 'PASS',
    off.length ? `off by more than -${P.timing.earlyMs} / +${P.timing.lateMs} ms: ${off.slice(0, 6).join('; ')}` : `${timed.length} cue(s) on time`, tag]);
  // 5. masking: music and effects in the speech band during each word (a proxy for intelligibility)
  if (bed || sfx) {
    const [lo, hi] = P.masking.bandHz, other = new Float32Array(voice.length);
    for (let i = 0; i < other.length; i++) other[i] = (bed?.[i] || 0) + (sfx?.[i] || 0);
    const vb = bandpass(voice, sr, lo, hi), ob = bandpass(other, sr, lo, hi);
    const en = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return 10 * Math.log10(s / Math.max(1, b - a) + 1e-20); };
    const hit = [];
    for (const w of words) {
      const a = Math.floor(Number(w.start) * sr), b = Math.min(voice.length, Math.floor(Number(w.end) * sr));
      if (b - a < sr * 0.05) continue;
      const m = en(vb, a, b) - en(ob, a, b); if (m < P.masking.minMarginDb) hit.push({ w: w.text, t: Number(w.start), m });
    }
    hit.sort((p, q) => p.m - q.m);
    out.push(['Audio', `music and effects leave the words clear (${lo}-${hi} Hz speech band; a proxy, listen)`, hit.length ? 'WARNING' : 'PASS',
      hit.length ? `${hit.length} word(s) under ${P.masking.minMarginDb} dB margin: ${hit.slice(0, 6).map((h) => `"${h.w}" ${h.t.toFixed(2)} s ${h.m.toFixed(1)} dB`).join(', ')}` : `every word at least ${P.masking.minMarginDb} dB above music and effects in the speech band`, tag]);
  }
  // 6. limiter load, from the mixer's report
  if (report?.limiter) {
    const L = P.master.limiter, l = report.limiter, bad = l.max_reduction_db > L.maxReductionDb || l.share_touched > L.maxShareTouched;
    out.push(['Audio', 'master limiter working gently (not squashing the mix)', bad ? 'WARNING' : 'PASS',
      `max ${l.max_reduction_db} dB reduction, ${(l.share_touched * 100).toFixed(1)}% of the reel touched by more than 1 dB (limits ${L.maxReductionDb} dB, ${(L.maxShareTouched * 100).toFixed(0)}%)${report.voice_peaks ? `; voice peak control before the mix: max ${report.voice_peaks.max_reduction_db} dB, ${(report.voice_peaks.share_touched * 100).toFixed(1)}% of the reel` : ''}`, tag]);
  }
  // 7. the encoded MP4 against the mix it came from (loudness, sync, hero levels), and a phone-speaker view
  if (mix && encoded) {
    const E = P.encoded, li = lufsOf(mix, sr), le = lufsOf(encoded, sr);
    const em = levelFrames(mix, sr, F, 0, { weight: false, win: 0.02 }), ee = levelFrames(encoded, sr, F, 0, { weight: false, win: 0.02 });
    let lag = 0, best = -Infinity;
    for (let l = -20; l <= 20; l++) { let s = 0; for (let k = 25; k < F - 25; k++) if (Number.isFinite(em[k]) && Number.isFinite(ee[k + l])) s -= Math.abs(em[k] - ee[k + l]); if (s > best) { best = s; lag = l; } }
    const mf = levelFrames(mix, sr, F), ef = levelFrames(encoded, sr, F);
    const hd = heroes.map((c) => { const k = Math.round(c.pt / CUE_HOP); return { c, d: ef[k] - mf[k] }; }).filter((x) => Number.isFinite(x.d) && Math.abs(x.d) > E.maxLevelDiffDb);
    const bad = Math.abs(le - li) > E.maxIntegratedDiffLu || Math.abs(lag * CUE_HOP) > E.maxOffsetFrames / fps || hd.length;
    out.push(['Audio', 'encoded MP4 audio matches the mix (loudness, sync, hero levels)', bad ? 'WARNING' : 'PASS',
      `integrated ${li.toFixed(1)} -> ${le.toFixed(1)} LUFS; offset ${(lag * CUE_HOP * 1000).toFixed(0)} ms${hd.length ? `; hero level changed: ${hd.map((x) => `${x.c.name} ${x.d.toFixed(1)} dB`).join(', ')}` : ''}`, tag]);
    if (heroes.length) {
      const hf = levelFrames(highpass(encoded, sr, P.phone.highpassHz), sr, F), vhp = levelFrames(highpass(voice, sr, P.phone.highpassHz), sr, F);
      const vloss = ref - median(wordFrames(vhp));
      const lost = heroes.map((c) => { const k = Math.round(c.pt / CUE_HOP); return { c, x: (ef[k] - hf[k]) - vloss }; }).filter((h) => h.x > P.phone.maxExtraLossDb);
      out.push(['Audio', `hero sounds survive a phone speaker (high-pass ${P.phone.highpassHz} Hz)`, lost.length ? 'WARNING' : 'PASS',
        lost.length ? `bass-heavy, loses its impact on a phone: ${lost.map((h) => `${h.c.name} ${h.x.toFixed(1)} dB more than the voice`).join(', ')}` : 'every hero keeps its level relative to the voice', tag]);
    }
  }
  return out;
}

// ---------- overlay leaks and footage colour integrity (rows from frames.mjs measurements)
export function overlayLeakRow(results) {
  const n = results.length, leaks = results.filter((r) => r.leak), errors = results.filter((r) => r.error);
  if (!n) return ['Visual', 'no layer paints while its clip is hidden (pixel test)', 'NOT APPLICABLE', 'no sample times', { kind: 'technical' }];
  if (errors.length) return ['Visual', 'no layer paints while its clip is hidden (pixel test)', 'FAIL', `checker error: ${errors[0].error}`, { kind: 'checker' }];
  return ['Visual', 'no layer paints while its clip is hidden (pixel test)', leaks.length ? 'FAIL' : 'PASS',
    leaks.length ? `${leaks.length} of ${n} times: ${leaks.slice(0, 4).map((l) => `${l.t.toFixed(2)} s ${l.count} px (max ${l.max}/255) in [${l.box.join(',')}], hidden clips there include ${l.hiddenClips.slice(0, 4).join(', ')}`).join('; ')}. Something under a hidden clip still paints (for example an SVG filter or blend mode): bake it into an image, or check it in the encoded frames`
      : `${n} sample times: hidden clips paint nothing`, { required: true, kind: 'technical' }];
}
// Encoded talking-head frames against the footage-only reference, per horizontal band, outside intentional overlays.
// The encoder's colour path and the browser's differ by a roughly uniform offset (about -11 luma on the Caveman
// renders, in every band), so the test is relative: a band that departs from the others is a local tint (Caveman v4's
// leak: top band +20.7, bottom -11.2, a spread of 32 against about 2 once fixed). A large uniform offset is a WARNING
// to look at, not a failure. A tint covering the whole frame evenly is not separable from that offset here; the
// pixel leak test above is the primary check for it.
export const FOOTAGE_COLOUR_LIMITS = { spread: 12, global: 25, minCoverage: 0.15 };
export function footageColourRow(results, limits = {}) {
  const L = { ...FOOTAGE_COLOUR_LIMITS, ...limits };
  const check = 'talking-head footage keeps its colour (encoded frame vs footage-only reference)';
  if (!results.length) return ['Visual', check, 'NOT APPLICABLE', 'no face scenes in the plan, or no render', { kind: 'technical' }];
  const errors = results.filter((r) => r.error);
  if (errors.length) return ['Visual', check, 'FAIL', `checker error: ${errors[0].error}`, { kind: 'checker' }];
  const local = [], global = [];
  let worstSpread = 0, offsets = [];
  for (const r of results) {
    const bands = (r.bands || []).filter((b) => b.coverage >= L.minCoverage);
    if (bands.length < 2) continue;
    const d = bands.map((b) => b.dLuma).sort((a, b) => a - b);
    const spread = d[d.length - 1] - d[0], mid = d[Math.floor(d.length / 2)];
    worstSpread = Math.max(worstSpread, spread); offsets.push(mid);
    if (spread > L.spread) {
      const by = (r.bands || []).map((b) => (b.coverage >= L.minCoverage ? `${b.dLuma >= 0 ? '+' : ''}${Math.round(b.dLuma)}` : '·')).join(' ');
      local.push(`${r.t.toFixed(2)} s luma by band, top to bottom: ${by} (spread ${spread.toFixed(1)})`);
    }
    if (Math.abs(mid) > L.global) global.push(`${r.t.toFixed(2)} s ${mid >= 0 ? '+' : ''}${mid.toFixed(1)}`);
  }
  if (!offsets.length) return ['Visual', check, 'NOT TESTED', 'overlays cover most of every face frame; nothing left to compare', { kind: 'technical' }];
  const status = local.length ? 'FAIL' : global.length ? 'WARNING' : 'PASS';
  const offset = offsets.sort((a, b) => a - b)[Math.floor(offsets.length / 2)];
  return ['Visual', check, status,
    local.length ? `${local.slice(0, 4).join('; ')} (band spread limit ${L.spread}). Part of the footage is tinted outside every visible overlay: compare the side-by-side frames in footage/`
      : `${results.length} face frame(s); bands agree within ${worstSpread.toFixed(1)} luma; uniform offset ${offset >= 0 ? '+' : ''}${offset.toFixed(1)} (encoder colour path)${global.length ? `, large at ${global.slice(0, 3).join(', ')}: look at footage/` : ''}; grading on the video and visible overlays are allowed`,
    { required: true, kind: 'technical' }];
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

// Herk's validate-plan result split into source mapping, caption alignment (captions only when the plan has them) and,
// for schema v2 plans, the visual plan (errors prefixed "Visual:").
export function planChecks(v, plan) {
  const req = { required: true };
  const visual = v.errors.filter(e => /^Visual:/.test(e));
  const cap = v.errors.filter(e => /^Caption/.test(e)), rest = v.errors.filter(e => !/^Caption/.test(e) && !/^Visual:/.test(e));
  return [
    ['Herk', 'validate-plan: source mapping, scenes, anchors', rest.length ? 'FAIL' : 'PASS', rest.slice(0, 5).join('; ') || `${v.metrics.retainedWords} words, ${v.metrics.scenes} scenes`, req],
    ['Captions', 'caption words and timing match the retimed transcript', !plan.captions?.length ? 'NOT APPLICABLE' : cap.length ? 'FAIL' : 'PASS',
      !plan.captions?.length ? 'plan has no captions' : cap.slice(0, 5).join('; ') || `${plan.captions.length} caption groups`, req],
    visualPlanRow(v, plan),
  ];
}

// The schema v2 visual plan at production stage: metadata, motifs, planned callbacks, planned assets present and hashed.
export function visualPlanRow(v, plan) {
  if (!(plan?.schemaVersion >= 2)) return ['Herk', 'validate-plan: visual plan (schema v2)', 'NOT APPLICABLE', 'legacy plan (no schemaVersion 2)'];
  const errs = v.errors.filter(e => /^Visual:/.test(e));
  const m = v.metrics?.visual || v.metrics || {};
  return ['Herk', 'validate-plan: visual plan (schema v2)', errs.length ? 'FAIL' : (v.warnings?.length ? 'WARNING' : 'PASS'),
    errs.slice(0, 5).join('; ') || [...(v.warnings || []).slice(0, 3), `${plan.scenes.length} scenes; authentic ${m.authenticScenes?.length ?? 0}, simulated ${m.simulatedScenes?.length ?? 0}, planned callbacks ${m.callbacks?.length ?? 0}`].join('; '),
    { required: true }];
}

// ---------- Gate B: the creative preflight. A new reel renders only after a person approves its creative plan.
// The fingerprint covers creative decisions only (direction, motifs, each scene's purpose, intent, B-roll mode, evidence,
// asset identity and planned callbacks), never times, layout, captions, events, file paths, hashes, renders or approvals,
// so technical revisions keep the approval. The script is compared word by word: fillers, stutters, case and
// punctuation are allowed; any other change needs a new approval.
const normText = s => String(s ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
const sorted = a => [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));

export function creativeSnapshot(reel, plan) {
  const carry = list => sorted((Array.isArray(list) ? list : []).map(c => `${c.motif ?? ''}|${c.element ?? ''}`));
  return {
    v: 1,
    mode: reel?.mode ?? null,
    profile: reel?.profile ?? null,
    direction: Object.fromEntries(DIRECTION_FIELDS.map(k => [k, normText(reel?.direction?.[k])])),
    motifs: (Array.isArray(plan?.motifs) ? plan.motifs : []).map(m => ({ id: String(m.id), description: normText(m.description) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    scenes: (Array.isArray(plan?.scenes) ? plan.scenes : []).map(s => ({
      visualPurpose: s.visualPurpose ?? null,
      brollMode: s.brollMode ?? null,
      evidenceType: s.evidenceType ?? null,
      visualIntent: normText(s.visualIntent),
      asset: s.asset ? {
        ref: normText(s.asset.ref), source: String(s.asset.source ?? '').trim(), method: s.asset.method ?? null,
        provider: normText(s.asset.provider), paid: s.asset.paid === true, whyThis: normText(s.asset.whyThis),
      } : null,
      motifs: sorted((Array.isArray(s.motifs) ? s.motifs : []).map(String)),
      carryOut: carry(s.carryOut),
      carryIn: carry(s.carryIn),
    })),
  };
}
export const creativeFingerprint = snapshot => createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

// Field-level differences between an approved snapshot and the current one, readable in a refusal message.
export function diffSnapshot(approved, current, plan) {
  const flat = (o, p = '', out = {}) => {
    if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out);
    else out[p] = JSON.stringify(o);
    return out;
  };
  const a = flat({ ...approved, scenes: undefined, motifs: undefined }), b = flat({ ...current, scenes: undefined, motifs: undefined });
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) out.push(`${k} ${a[k] ?? 'absent'} -> ${b[k] ?? 'absent'}`);
  const am = new Map((approved?.motifs || []).map(m => [m.id, m])), cm = new Map((current?.motifs || []).map(m => [m.id, m]));
  for (const [id, m] of am) if (!cm.has(id)) out.push(`motif ${id} removed`); else if (cm.get(id).description !== m.description) out.push(`motif ${id} description changed`);
  for (const id of cm.keys()) if (!am.has(id)) out.push(`motif ${id} added`);
  const as = approved?.scenes || [], cs = current?.scenes || [];
  if (as.length !== cs.length) out.push(`scene count ${as.length} -> ${cs.length} (scenes added, removed, split or merged)`);
  for (let i = 0; i < Math.min(as.length, cs.length); i++) {
    const x = flat(as[i]), y = flat(cs[i]), name = `scene ${i + 1}${plan?.scenes?.[i]?.id ? ` (${plan.scenes[i].id})` : ''}`;
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (x[k] !== y[k]) out.push(`${name} ${k} ${x[k] ?? 'absent'} -> ${y[k] ?? 'absent'}`);
  }
  return out;
}

// The words of the reel's script: the retimed transcript when there is one, else the plan's planned "script".
export function scriptWords(plan, transcript) {
  const words = Array.isArray(transcript?.words) ? transcript.words.filter(w => w.type !== 'spacing').map(w => normWord(w.text)).filter(Boolean)
    : String(plan?.script ?? '').split(/\s+/).map(normWord).filter(Boolean);
  return words.length ? words : null;
}

// Word changes between the approved script and the current one that need a new approval. Deleted fillers and deleted
// immediate repetitions (stutters) are allowed; every other deletion, insertion or substitution is returned, with
// negations, numbers and qualifiers first.
export const SCRIPT_FILLERS = new Set(['um', 'uh', 'er', 'erm', 'ah', 'hmm', 'like', 'basically', 'actually', 'literally', 'so']);
const FILLER_PAIRS = [['you', 'know'], ['i', 'mean']];
export function scriptChanges(approved, current) {
  const a = approved || [], b = current || [], n = a.length, m = b.length;
  // LCS table (scripts are a few hundred words).
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const removed = [], added = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) added.push({ type: 'added', word: b[j], index: j++ });
    else removed.push({ type: 'removed', word: a[i], index: i++ });
  }
  const disallowed = [];
  for (let k = 0; k < removed.length; k++) {
    const r = removed[k], idx = r.index;
    const pair = FILLER_PAIRS.find(([p, q]) => a[idx] === p && a[idx + 1] === q && removed[k + 1]?.index === idx + 1);
    if (pair) { k++; continue; }
    if (SCRIPT_FILLERS.has(r.word)) continue;
    if (a[idx - 1] === r.word || a[idx + 1] === r.word) continue; // stutter: the same word is still beside it
    disallowed.push(r);
  }
  disallowed.push(...added);
  for (const c of disallowed) c.risk = riskOf(c.word);
  const rank = c => c.risk === 'negation' ? 0 : c.risk === 'number' ? 1 : c.risk === 'qualifier' ? 2 : 3;
  return disallowed.sort((x, y) => rank(x) - rank(y) || x.index - y.index);
}

export const preflightRequired = (reel, plan) => reel?.preflightRequired === true || plan?.schemaVersion >= 2;

// validate: validateVisualPlan from short-form-edit (injected so this module stays pure).
// Returns { required, ok, problems, warnings, fingerprint, snapshot, words, validation }.
export function preflightStatus({ reel, plan, transcript, validate }) {
  if (!preflightRequired(reel, plan)) return { required: false, ok: true, problems: [], warnings: [] };
  const problems = [], warnings = [];
  if (!plan) return { required: true, ok: false, warnings, problems: ['no assets/plan.json: write the creative plan with "schemaVersion": 2 (create-reel references/preflight.md)'] };
  const validation = validate(plan, { stage: 'preflight' });
  if (plan.schemaVersion !== 2) problems.push(`assets/plan.json is schema ${plan.schemaVersion ?? 1}; a new reel needs "schemaVersion": 2 with each scene's visualPurpose, brollMode and evidenceType`);
  else problems.push(...validation.errors);
  warnings.push(...(validation.warnings || []));
  const snapshot = creativeSnapshot(reel, plan), fingerprint = creativeFingerprint(snapshot), words = scriptWords(plan, transcript);
  const p = reel?.preflight;
  if (validation.metrics?.paidAssets?.length && !p?.paidScope) warnings.push(`paid assets planned (${validation.metrics.paidAssets.join(', ')}) but no paid provider and spending limit are approved; ask before any paid call`);
  if (!p || p.status !== 'approved') problems.push('no approved creative preflight: present the preflight report, stop, and record the person\'s explicit approval with preflight-reel --approve');
  else {
    if (p.fingerprint !== fingerprint) {
      const diff = diffSnapshot(p.snapshot, snapshot, plan);
      problems.push(`the creative plan changed since it was approved (${p.fingerprint.slice(0, 12)} -> ${fingerprint.slice(0, 12)}): ${diff.slice(0, 8).join('; ') || 'snapshot differs'}${diff.length > 8 ? `; and ${diff.length - 8} more` : ''}`);
    }
    if (Array.isArray(p.scriptWords) && words) {
      const ch = scriptChanges(p.scriptWords, words);
      if (ch.length) problems.push(`the script changed since approval: ${ch.slice(0, 6).map(c => `${c.type} "${c.word}" at word ${c.index + 1}${c.risk ? ` (${c.risk})` : ''}`).join('; ')}${ch.length > 6 ? `; and ${ch.length - 6} more` : ''}`);
    } else if (Array.isArray(p.scriptWords) !== !!words) problems.push(words ? 'a script now exists but none was approved' : 'the approved script is missing from the plan and transcript');
  }
  return { required: true, ok: !problems.length, problems, warnings, fingerprint, snapshot, words, validation };
}

// Reads the inputs for preflightStatus from a project folder. Unreadable JSON is reported, never ignored.
export function readPreflightInputs(dir) {
  const read = name => {
    const p = join(dir, 'assets', name);
    if (!existsSync(p)) return { value: null };
    try { return { value: JSON.parse(readFileSync(p, 'utf8')) }; } catch (e) { return { value: null, error: `assets/${name} is not valid JSON: ${e.message}` }; }
  };
  const plan = read('plan.json'), transcript = read('transcript.json');
  return { plan: plan.value, transcript: transcript.value, errors: [plan.error, transcript.error].filter(Boolean) };
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
