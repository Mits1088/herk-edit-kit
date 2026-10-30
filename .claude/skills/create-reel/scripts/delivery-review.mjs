// delivery-review.mjs - the creative execution review: does each rendered scene deliver its approved visual intent?
//
// Three parts, pure where possible so tests can drive them directly:
//   - intentFrames / findKeyframes / intentSheetHtml: qa-reel draws intent-sheet.jpg, one encoded frame per plan scene at
//     its main planned event, at phone width, beside that scene's Gate B keyframe when one exists, with the approved
//     intent printed on the sheet only (never in the video).
//   - motionFrames / motionSheetHtml: motion-sheet.jpg, one row per scene of frames in time order across the whole
//     scene (about every 0.4 s, planned events added and outlined), so the action the intent describes is judged, not
//     only its end state. Stills are not full-speed viewing; the review records which modality it used.
//   - parseDeliveryReview / deliveryReviewRow: reads the "## Delivery review" section of the project's
//     ENTERTAINMENT-REVIEW.md and checks that it names the render it judged, gives every plan scene an own-words
//     description of the frame and of the motion and a verdict, and records the modality, silhouette, keyframe and
//     slide passes. A scene marked partial or missing blocks a candidate: rebuild it, render again, review again.
//   - projectSourceHash: every input to the render (project files, files the compositions reference outside the
//     project, the profile's size and frame rate, the HyperFrames version), so a review of the latest draft carries
//     over to a candidate rendered from the same inputs and goes stale the moment any of them changes.
//
// The row proves the review was done on the latest render and covers every scene; it cannot prove the judgement is good.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename, relative, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REVIEW_FILE = 'ENTERTAINMENT-REVIEW.md';
export const VERDICTS = ['delivered', 'partial', 'missing'];
export const PHONE_WIDTH = 360;
const SETTLE = 0.4;
const MIN_WORDS = 6;
const MOTION_WORDS = 4;
const STEP = 0.4;

// ---------- intent sheet
// The frame that should show the scene's intent: its last planned event (the state the intent builds to) once it has
// settled, else the scene's midpoint. Clamped inside the scene and the film.
export function intentFrames(plan, { fps, duration }) {
  const last = Math.max(0, Math.round(duration * fps) - 1);
  const events = Array.isArray(plan?.events) ? plan.events : [];
  return (plan?.scenes || []).map(s => {
    const start = Number(s.start), end = Number(s.end);
    const own = events.filter(e => e.visual === s.id && Number(e.time) >= start && Number(e.time) < end).sort((a, b) => a.time - b.time);
    const ev = own[own.length - 1];
    const t = ev ? Math.max(Number(ev.time), Math.min(Number(ev.time) + SETTLE, end - 2 / fps)) : (start + end) / 2;
    const frame = Math.min(last, Math.max(0, Math.round(t * fps)));
    return { id: s.id, start, end, frame, t: +(frame / fps).toFixed(3), event: ev ? ev.type || 'event' : null,
      intent: String(s.visualIntent || (s.visualPurpose === 'performance' ? `performance: ${s.holdReason || 'the speaker carries it'}` : '')).trim() };
  });
}

// Motion strip per scene: evenly through the whole scene (its first and last frame), about every STEP seconds, 4 to 12
// frames, plus each planned event's own frame, marked. Returns [{ id, start, end, frames: [{ frame, t, event }] }].
export function motionFrames(plan, { fps, duration }) {
  const last = Math.max(0, Math.round(duration * fps) - 1);
  const events = Array.isArray(plan?.events) ? plan.events : [];
  const clamp = f => Math.min(last, Math.max(0, f));
  return (plan?.scenes || []).map(s => {
    const start = Number(s.start), end = Number(s.end);
    const a = clamp(Math.ceil(start * fps)), b = clamp(Math.max(a, Math.ceil(end * fps) - 1));
    const n = Math.max(4, Math.min(12, Math.round((end - start) / STEP) + 1));
    const byFrame = new Map();
    for (let k = 0; k < n; k++) { const f = Math.round(a + (b - a) * k / (n - 1)); byFrame.set(f, { frame: f, t: +(f / fps).toFixed(3), event: null }); }
    for (const e of events) if (e.visual === s.id && Number(e.time) >= start && Number(e.time) < end) {
      const f = clamp(Math.round(Number(e.time) * fps));
      byFrame.set(f, { frame: f, t: +(f / fps).toFixed(3), event: e.type || 'event' });
    }
    return { id: s.id, start, end, frames: [...byFrame.values()].sort((x, y) => x.frame - y.frame) };
  });
}

// rows: motionFrames output with frameUrl on each frame. One row per scene, read left to right.
export function motionSheetHtml(rows, { title = '' } = {}) {
  const w = 135, most = Math.max(1, ...rows.map(r => r.frames.length));
  const width = 120 + most * (w + 4) + 32;
  const row = r => `<section><h2>${esc(r.id)}<br><small>${r.start.toFixed(1)}-${r.end.toFixed(1)} s</small></h2>${r.frames.map(f =>
    `<div class="${f.event ? 'ev' : ''}"><img src="${esc(f.frameUrl)}"><span>${f.t.toFixed(2)}${f.event ? ` ${esc(f.event)}` : ''}</span></div>`).join('')}</section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#111;color:#ddd;font:13px/1.3 system-ui,Segoe UI,Arial,sans-serif}
main{width:${width}px;padding:16px;box-sizing:border-box}
h1{margin:0 0 12px;font-size:16px;color:#fff}
section{display:flex;gap:4px;margin-bottom:10px;align-items:flex-start}
h2{width:112px;flex:none;margin:0;font-size:15px;color:#fff}small{color:#aaa;font-weight:400}
section>div{position:relative;width:${w}px;outline:2px solid transparent}section>div.ev{outline-color:#f5b400}
img{display:block;width:${w}px;height:auto}
span{position:absolute;left:3px;bottom:3px;background:#000b;color:#fff;font-size:11px;padding:1px 4px;border-radius:3px;max-width:${w - 12}px;overflow:hidden;white-space:nowrap}
</style></head><body><main><h1>${esc(title)} · motion sheet: each scene left to right, about every ${STEP} s; planned events outlined. Stills, not full-speed viewing.</h1>
${rows.map(row).join('\n')}</main></body></html>`;
}

// Gate B keyframes: keyframes/<scene id>.png (or -anything, .jpg/.jpeg/.webp). Returns { id: relative path }.
export function findKeyframes(dir, ids) {
  const kdir = join(dir, 'keyframes');
  if (!existsSync(kdir)) return {};
  const files = readdirSync(kdir).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).sort();
  const out = {};
  for (const id of ids) {
    const f = files.find(n => new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[-_.][^/]*)?\\.(png|jpe?g|webp)$`, 'i').test(n));
    if (f) out[id] = `keyframes/${f}`;
  }
  return out;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// items: [{ id, start, end, t, event, intent, frameUrl, keyframeUrl? }]. A self-contained page for a headless screenshot.
export function intentSheetHtml(items, { title = '' } = {}) {
  const paired = items.some(i => i.keyframeUrl);
  const cols = Math.max(1, Math.min(paired ? 2 : 4, items.length)), cardW = paired ? PHONE_WIDTH * 2 + 12 : PHONE_WIDTH, gap = 16;
  const width = cols * cardW + (cols + 1) * gap;
  const card = i => `<figure><div class="imgs"><div><img src="${esc(i.frameUrl)}"><span>render ${i.t.toFixed(2)} s</span></div>${
    i.keyframeUrl ? `<div><img src="${esc(i.keyframeUrl)}"><span>Gate B keyframe</span></div>` : paired ? '<div class="none"><span>no keyframe</span></div>' : ''}</div>
<figcaption><b>${esc(i.id)}</b> ${i.start.toFixed(1)}-${i.end.toFixed(1)} s${i.event ? ` · after ${esc(i.event)}` : ' · midpoint'}<br>${esc(i.intent || 'no visual intent in the plan')}</figcaption></figure>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#111;color:#ddd;font:15px/1.35 system-ui,Segoe UI,Arial,sans-serif}
main{width:${width}px;padding:${gap}px;box-sizing:border-box;display:grid;grid-template-columns:repeat(${cols},${cardW}px);gap:${gap}px}
h1{grid-column:1/-1;margin:0;font-size:18px;color:#fff}
figure{margin:0;background:#1c1c1c;border-radius:6px;overflow:hidden}
.imgs{display:flex;gap:12px}.imgs>div{position:relative;width:${PHONE_WIDTH}px}
img{display:block;width:${PHONE_WIDTH}px;height:auto}
.none{background:#222;min-height:${Math.round(PHONE_WIDTH * 16 / 9)}px}
span{position:absolute;left:6px;top:6px;background:#000b;color:#fff;font-size:12px;padding:2px 5px;border-radius:3px}
figcaption{padding:8px 10px 10px}b{color:#fff}
</style></head><body><main><h1>${esc(title)} · intent sheet: each scene at phone width (${PHONE_WIDTH} px), sound off. Labels exist on this sheet only.</h1>
${items.map(card).join('\n')}</main></body></html>`;
}

// ---------- the review record
const norm = s => String(s).toLowerCase().replace(/[`*_]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const words = s => norm(s).split(' ').filter(Boolean);
const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

// Returns { found, render, sha, scenes: { id: { seen, motion, verdict, fix } }, notes: { modality, silhouettes, keyframes, slide }, errors }.
export function parseDeliveryReview(text) {
  const out = { found: false, render: null, sha: null, scenes: {}, notes: {}, errors: [] };
  const m = String(text || '').match(/^##\s+Delivery review\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im);
  if (!m) return out;
  out.found = true;
  const body = m[1];
  const r = body.match(/^\s*Reviewed render:\s*`?([^\s`()]+\.mp4)`?[^\n]*?\b([0-9a-f]{12,64})\b/im);
  if (r) { out.render = r[1].replaceAll('\\', '/'); out.sha = r[2].toLowerCase(); }
  else out.errors.push('no "Reviewed render: renders/<file>.mp4 (SHA-256 <12 hex>)" line');
  const label = name => (body.match(new RegExp(`^\\s*(?:[-*]\\s*)?\\**${name}[^:\\n]*:\\**\\s*(.+)$`, 'im')) || [])[1]?.trim() || '';
  out.notes = { modality: label('Modality'), silhouettes: label('Silhouettes'), keyframes: label('Keyframes'), slide: label('Slide test') };
  const rows = body.split(/\r?\n/).filter(l => /^\s*\|/.test(l));
  if (rows.length) {
    const head = cells(rows[0]).map(norm);
    const col = re => head.findIndex(h => re.test(h));
    const ci = { scene: col(/^scene/), seen: col(/seen|shows|frame/), motion: col(/^motion/), verdict: col(/verdict/), fix: col(/^fix|rebuil/) };
    if (ci.scene < 0 || ci.seen < 0 || ci.motion < 0 || ci.verdict < 0) out.errors.push('the scene table needs Scene, Seen, Motion and Verdict columns');
    else for (const line of rows.slice(1)) {
      const c = cells(line);
      if (c.every(x => /^:?-+:?$/.test(x) || !x)) continue;
      const id = c[ci.scene]?.replace(/[`*]/g, '').trim();
      if (id) out.scenes[id] = { seen: c[ci.seen] || '', motion: c[ci.motion] || '', verdict: norm(c[ci.verdict] || ''), fix: ci.fix >= 0 ? c[ci.fix] || '' : '' };
    }
  } else out.errors.push('no scene table');
  return out;
}

// The description must be the reviewer's own sentence about the frame, not the approved intent pasted back.
export function copiedFromIntent(seen, intent) {
  const a = norm(seen), b = norm(intent);
  if (!a || !b) return false;
  if (b.includes(a) || a.includes(b)) return true;
  const A = new Set(words(seen)), B = new Set(words(intent));
  const shared = [...A].filter(w => B.has(w)).length;
  return shared / Math.max(A.size, 1) >= 0.85 && shared / Math.max(B.size, 1) >= 0.6;
}

// Which render the review judged, and whether it still describes the render under QA. renders: reel.json "renders".
// A review counts for this render when it names this exact file (by SHA-256 prefix), or, for a candidate, the render
// logged immediately before it with the same recorded source hash (nothing changed between the draft and the final).
export function reviewFreshness(review, { render, sha, renders = [], candidate = false }) {
  if (!review.render || !review.sha) return { fresh: false, why: 'the review does not name the render it judged' };
  const name = basename(review.render), here = render ? basename(render) : null;
  if (here && name === here) {
    if (sha && !sha.startsWith(review.sha)) return { fresh: false, why: `it names ${name} with SHA-256 ${review.sha.slice(0, 12)}, but this file is ${sha.slice(0, 12)}` };
    if (!sha) {
      const entry = renders.find(e => basename(e.file) === here);
      if (entry?.sha256 && !entry.sha256.startsWith(review.sha)) return { fresh: false, why: `it names ${name} with SHA-256 ${review.sha.slice(0, 12)}, but reel.json logs ${entry.sha256.slice(0, 12)}` };
    }
    return { fresh: true, reviewed: name };
  }
  const idx = renders.findIndex(e => basename(e.file) === here);
  const prev = idx > 0 ? renders[idx - 1] : renders[renders.length - 1];
  const current = idx >= 0 ? renders[idx] : null;
  if (!prev || basename(prev.file) !== name) return { fresh: false, why: `it judged ${name}, but the latest render before this one is ${prev ? basename(prev.file) : 'none'}` };
  if (prev.sha256 && !prev.sha256.startsWith(review.sha)) return { fresh: false, why: `it names ${name} with SHA-256 ${review.sha.slice(0, 12)}, but reel.json logs ${prev.sha256.slice(0, 12)}` };
  if (!candidate) return { fresh: false, why: `it judged ${name}, not this render` };
  if (!prev.sourceHash || !current?.sourceHash) return { fresh: false, why: `no source hash recorded for ${!prev.sourceHash ? name : here}, so it cannot show nothing changed` };
  if (prev.sourceHash !== current.sourceHash) return { fresh: false, why: `the source changed between ${name} and ${here}` };
  return { fresh: true, reviewed: name, carried: true };
}

// One QA row: [area, check, status, detail, opts]. required: a candidate of a reel that has a creative preflight.
export function deliveryReviewRow({ text, plan, render, sha, renders, candidate = false, required = false, keyframes = {} }) {
  const check = 'delivery review: every scene judged against its approved intent on the latest render';
  const opts = { required, kind: 'technical' };
  const scenes = plan?.scenes || [];
  if (!scenes.length) return ['Visual', check, required ? 'NOT TESTED' : 'NOT APPLICABLE', 'no plan scenes to review', opts];
  const missingStatus = required ? 'NOT TESTED' : 'WARNING';
  if (text == null) return ['Visual', check, required ? 'NOT TESTED' : 'NOT APPLICABLE', `no ${REVIEW_FILE}: read intent-sheet.jpg and write the "## Delivery review" section (create-reel step 9)`, opts];
  const review = parseDeliveryReview(text);
  if (!review.found) return ['Visual', check, missingStatus, `${REVIEW_FILE} has no "## Delivery review" section (create-reel step 9)`, opts];
  const problems = [...review.errors];
  const fresh = reviewFreshness(review, { render, sha, renders, candidate });
  if (!fresh.fresh) problems.push(`stale: ${fresh.why}; review this render's intent-sheet.jpg and update the section`);
  const under = [];
  for (const s of scenes) {
    const r = review.scenes[s.id];
    if (!r) { problems.push(`${s.id}: no verdict`); continue; }
    if (!VERDICTS.includes(r.verdict)) { problems.push(`${s.id}: verdict "${r.verdict || 'empty'}" is not delivered, partial or missing`); continue; }
    if (words(r.seen).length < MIN_WORDS) problems.push(`${s.id}: describe what the frame shows in a sentence (${MIN_WORDS}+ words)`);
    else if (s.visualIntent && copiedFromIntent(r.seen, s.visualIntent)) problems.push(`${s.id}: the description repeats the approved intent; describe what the encoded frame actually shows`);
    if (words(r.motion).length < MOTION_WORDS) problems.push(`${s.id}: describe what moves or changes across its motion strip (${MOTION_WORDS}+ words; "holds still on the face" is an answer)`);
    else if (s.visualIntent && copiedFromIntent(r.motion, s.visualIntent)) problems.push(`${s.id}: the motion note repeats the approved intent; describe what the strip actually shows`);
    if (r.verdict !== 'delivered') under.push(`${s.id} ${r.verdict}${r.fix ? ` (${r.fix.slice(0, 60)})` : ''}`);
  }
  const extra = Object.keys(review.scenes).filter(id => !scenes.some(s => s.id === id));
  if (extra.length) problems.push(`scenes not in the plan: ${extra.join(', ')}`);
  const short = (v, name) => { if (words(v).length < MIN_WORDS) problems.push(`"${name}:" needs a sentence (${MIN_WORDS}+ words)`); };
  short(review.notes.modality, 'Modality');
  short(review.notes.silhouettes, 'Silhouettes');
  short(review.notes.slide, 'Slide test');
  if (Object.keys(keyframes).length) short(review.notes.keyframes, 'Keyframes');
  if (problems.length) return ['Visual', check, missingStatus, problems.slice(0, 6).join('; ') + (problems.length > 6 ? `; and ${problems.length - 6} more` : ''), opts];
  const on = fresh.carried ? `${fresh.reviewed} (same source as this render)` : fresh.reviewed;
  if (under.length) return ['Visual', check, required ? 'FAIL' : 'WARNING', `underdelivers on ${on}: ${under.join('; ')}; rebuild these scenes, render a new draft and review again`, opts];
  return ['Visual', check, 'PASS', `${scenes.length} scenes delivered on ${on}; the record shows the review happened, not that its judgement is right`, opts];
}

// ---------- what was rendered
// Every input to the render. Project files are hashed by content (above BIG_FILE by size and modification time:
// footage can be gigabytes), and so are files the compositions reference outside the project; plus the profile's frame
// size, rate and encoding (render-reel takes them from profiles.json, not from the project) and the HyperFrames
// version. Records, reviews, renders, archives, snapshots and keyframes are left out: writing them changes nothing
// that renders. The quality preset is left out on purpose, so a review of a draft carries to a final render of the
// same inputs.
const SKIP_DIRS = new Set(['renders', 'archive', 'snapshots', 'node_modules', '.git', '.thumbnails']);
const REF_TEXT = /\.(html?|css)$/i;
const BIG_FILE = 64 * 1024 * 1024;
const kitRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
function hashFile(h, label, p) {
  const st = statSync(p);
  h.update(label + '\0');
  h.update(st.size <= BIG_FILE ? readFileSync(p) : `${st.size}:${Math.floor(st.mtimeMs)}`);
  h.update('\0');
}

// Local file references in HTML and CSS: src, href, poster and data-src attributes, and url(...). Network, data and
// fragment references are not files.
export function fileRefs(text) {
  const out = [];
  for (const m of String(text).matchAll(/\b(?:src|href|poster|data-src)\s*=\s*["']([^"'#?]+)[^"']*["']|url\(\s*["']?([^"')#?]+)[^"')]*["']?\s*\)/gi)) {
    const ref = (m[1] || m[2] || '').trim();
    if (ref && !/^\/\//.test(ref) && !/^(?:data|blob|about|javascript|mailto|https?):/i.test(ref)) out.push(ref);
  }
  return out;
}

export function projectSourceHash(dir, { profile = null, hyperframesVersion } = {}) {
  dir = resolve(dir);
  const h = createHash('sha256');
  const texts = [];
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name), rel = relative(dir, p).replaceAll('\\', '/');
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.') && !/^keyframes/i.test(e.name)) walk(p); continue; }
      if (!e.isFile() || /\.md$/i.test(e.name) || rel === 'reel.json') continue;
      hashFile(h, rel, p);
      if (REF_TEXT.test(e.name)) texts.push(p);
    }
  };
  walk(dir);
  // Files outside the project that a composition or stylesheet points at; a missing one is recorded as missing.
  const outside = new Set();
  for (const p of texts) for (const ref of fileRefs(readFileSync(p, 'utf8'))) {
    let target;
    try { target = /^file:/i.test(ref) ? fileURLToPath(ref) : /^[a-z]:[\\/]/i.test(ref) ? ref : resolve(dirname(p), decodeURIComponent(ref)); } catch { continue; }
    const rel = relative(dir, target);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) continue; // inside the project: already hashed
    if (rel) outside.add(resolve(target).replaceAll('\\', '/'));
  }
  for (const t of [...outside].sort()) {
    if (existsSync(t) && statSync(t).isFile()) hashFile(h, `external:${t}`, t);
    else h.update(`external:${t}\0missing\0`);
  }
  if (profile) h.update(`profile:${JSON.stringify(['name', 'width', 'height', 'fps', 'codec', 'pixFmt'].map(k => profile[k] ?? null))}\0`);
  let version = hyperframesVersion;
  if (version === undefined) { try { version = JSON.parse(readFileSync(join(kitRoot, 'node_modules/hyperframes/package.json'), 'utf8')).version; } catch { version = null; } }
  h.update(`hyperframes:${version}\0`);
  return h.digest('hex');
}
