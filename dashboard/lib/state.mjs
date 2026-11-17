// Derives the state of every piece of content from the files the workflow already writes.
// Read-only. Anything that is not recorded is reported as unknown or "needs linking", never guessed.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { titleFrom, reviewFrom, parseApproved, parseGenerated, parseYoutube, parseResources, parseDraft } from './parse.mjs';
import { view as zernioView, finalVideo, isOpen as zernioOpen, NAMES as ZNAMES } from './zernio.mjs';
import { readManifests } from './manifest.mjs';
import { createHash } from 'node:crypto';
import { approvalCommand, approvalPrompt, revisionPrompt, videoRevisionPrompt, classifyUpload } from './jobs.mjs';
import { hookReport } from './workflow.mjs';

const shaCache = new Map();
export function sha256File(full) {
  try { const st = statSync(full); const key = full + ':' + st.mtimeMs + ':' + st.size; if (!shaCache.has(key)) shaCache.set(key, createHash('sha256').update(readFileSync(full)).digest('hex')); return shaCache.get(key); } catch { return null; }
}
// Duration and size of an MP4, cached like the hash. ffprobe is optional; without it these read as unknown.
const probeCache = new Map();
function probeVideo(full) {
  try { const st = statSync(full); const key = full + ':' + st.mtimeMs + ':' + st.size;
    if (!probeCache.has(key)) { let v = { seconds: null, width: null, height: null };
      try { const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', full], { encoding: 'utf8', timeout: 8000, windowsHide: true });
        const j = JSON.parse(r.stdout || '{}'); const s = (j.streams || [])[0] || {}; const d = Number(j.format && j.format.duration);
        v = { seconds: Number.isFinite(d) ? Math.round(d * 10) / 10 : null, width: s.width || null, height: s.height || null }; } catch { /* unknown */ }
      probeCache.set(key, v); }
    return probeCache.get(key); } catch { return { seconds: null, width: null, height: null }; }
}
const DRAFT_OR_CANDIDATE = /-(draft|candidate)-v\d{3}\.mp4$/i;
// MP4s in renders/ that Reel Studio did not render and that are not an approved version: outside edits (e.g. a
// Canva export) that could be approved as the final. The named final is listed when its bytes changed after approval.
function outsideEdits(dir, r, final, approved) {
  // Only the current approved bytes are left out, so an earlier copy (e.g. the original render) can be chosen again.
  const recorded = new Set((r.renders || []).map(x => x.file)); const shas = new Set([approved.at(-1)?.sha256].filter(Boolean));
  const out = [];
  for (const name of ls(join(dir, 'renders'))) {
    const file = 'renders/' + name;
    if (!/\.mp4$/i.test(name) || name.startsWith('.') || DRAFT_OR_CANDIDATE.test(name) || recorded.has(file)) continue;
    const full = join(dir, file); const sha = sha256File(full); if (!sha || shas.has(sha)) continue;
    const st = statSync(full);
    out.push({ file, sha, size: st.size, modifiedAt: new Date(st.mtimeMs).toISOString(), changedFinal: file === final && approved.length > 0, ...probeVideo(full) });
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}
const safeName = s => String(s).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim(); // same rule as gumroad_upload.mjs

export const STAGES = ['source', 'rewrite', 'choose', 'record', 'avatar', 'hook', 'build', 'render', 'qa', 'candidate', 'instagram', 'distribute', 'done'];

const ls = (d, dirs) => { try { return readdirSync(d, { withFileTypes: true }).filter(e => (dirs ? e.isDirectory() : e.isFile())).map(e => e.name).sort(); } catch { return []; } };
const read = f => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const json = f => { const t = read(f); if (t == null) return null; try { return JSON.parse(t); } catch { return { __invalid: true }; } };
const fwd = p => String(p).replaceAll('\\', '/');
const rel = (cfg, p) => fwd(relative(cfg.root, p));
const norm = (cfg, p) => { if (!p) return null; const a = fwd(p), r = fwd(cfg.root); return a.toLowerCase().startsWith(r.toLowerCase() + '/') ? a.slice(r.length + 1) : a; };
const MEDIA = /\.(mp4|mov|m4v|webm|wav|mp3|m4a|aac|flac)$/i;

function readProject(cfg, slug) {
  const dir = join(cfg.projectsDir, slug); const r = json(join(dir, 'reel.json'));
  if (!r || r.__invalid) return null;
  const renders = (r.renders || []).map(x => {
    const out = { file: x.file, kind: x.kind, version: x.version, sha: x.sha256 || null, at: x.renderedAt || null, exists: existsSync(join(dir, x.file)) };
    if (x.kind === 'candidate') {
      const q = json(join(dir, x.file.replace(/\.mp4$/i, '.qa'), 'qa.json'));
      out.qa = !q ? { state: 'missing' } : q.__invalid ? { state: 'unreadable' }
        : { state: q.sha256 && x.sha256 && q.sha256 !== x.sha256 ? 'stale' : q.passed ? 'passed' : 'failed', verdict: q.verdict || null, blocking: Array.isArray(q.blocking) ? q.blocking.map(b => (typeof b === 'string' ? b : b.name || b.id || b.check || JSON.stringify(b).slice(0, 80))).slice(0, 8) : [], at: q.qaAt || null };
    }
    return out;
  });
  const approved = (r.approvals || []).filter(a => a.status === 'approved');
  const lastApproval = approved[approved.length - 1] || null;
  const recordedFinal = r.finalFile || lastApproval?.promotedTo || (lastApproval ? 'renders/final.mp4' : `renders/${slug}-final.mp4`);
  const final = /^renders\/[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/.test(recordedFinal) ? recordedFinal : 'renders/final.mp4';
  const pf = r.preflight || null;
  return {
    slug, mode: r.mode || null, duration: r.duration || null,
    preflightRequired: !!r.preflightRequired,
    preflight: pf ? { status: pf.status || null, approvedBy: pf.approvedBy || null, approvedAt: pf.approvedAt || null, fingerprint: pf.fingerprint ? String(pf.fingerprint).slice(0, 12) : null } : null,
    opening: r.openingPreview ? { end: r.openingPreview.end, recordedAt: r.openingPreview.recordedAt, url: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(r.openingPreview.url || '') ? r.openingPreview.url : null, file: r.openingPreview.file || null } : null,
    // Only a reel still waiting at Gate B needs the live report; it is what the approve button is checked against.
    hook: r.preflightRequired && (!pf || pf.status !== 'approved') ? hookReport(cfg, dir) : null,
    renders,
    approval: lastApproval ? { candidate: lastApproval.candidate, sha: lastApproval.sha256 || null, by: lastApproval.approvedBy || null, at: lastApproval.approvedAt || null,
      ...(lastApproval.kind === 'external-edit' ? { kind: 'external-edit', file: lastApproval.file || null, source: lastApproval.source || null, basedOn: lastApproval.basedOn || null, keptCopy: lastApproval.keptCopy || null, seconds: lastApproval.seconds ?? null, width: lastApproval.width || null, height: lastApproval.height || null } : {}) } : null,
    approvedVideo: lastApproval && existsSync(join(dir, final)) ? probeVideo(join(dir, final)) : null,
    outsideEdits: lastApproval ? outsideEdits(dir, r, final, approved) : [],
    finalExists: existsSync(join(dir, final)),
    finalFile: `video-projects/${slug}/${final}`,
  };
}

function listMedia(dir, depth) {
  const out = [];
  const walk = (d, pre, n) => { for (const f of ls(d)) if (MEDIA.test(f)) out.push(pre + f); if (n > 0) for (const s of ls(d, true)) walk(join(d, s), pre + s + '/', n - 1); };
  walk(dir, '', depth); return out;
}

let missionCache = { at: 0, value: null };
function missions(cfg, now) {
  if (cfg.missionCli === false) return { available: false, reason: 'not configured', lines: [] };
  if (now - missionCache.at < 60000 && missionCache.value) return missionCache.value;
  let value;
  if (!existsSync(cfg.missionCli)) value = { available: false, reason: 'ClaudeClaw not found', lines: [] };
  else {
    const r = spawnSync(process.execPath, [cfg.missionCli, 'list'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (r.status !== 0) value = { available: false, reason: 'the ClaudeClaw queue did not answer', lines: [] };
    else { const lines = r.stdout.split('\n').map(l => l.trim()).filter(Boolean); value = { available: true, lines: /^No mission tasks/i.test(lines[0] || '') ? [] : lines.slice(0, 40) }; }
  }
  missionCache = { at: +now, value }; return value;
}

// Wall-clock parts of an instant in a named timezone, independent of this PC's own timezone.
function partsIn(tz, date) {
  const o = {}; for (const p of new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date)) o[p.type] = Number(p.value);
  return o;
}
const whenIn = (tz, d) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
// Second calendar day after publication, at cfg.dueHour, both reckoned in cfg.dueTimeZone.
export function dueDate(cfg, publishedAt) {
  const tz = cfg.dueTimeZone; const p = partsIn(tz, new Date(publishedAt));
  const wall = Date.UTC(p.year, p.month - 1, p.day + 2, cfg.dueHour, 0, 0);
  let guess = wall;
  for (let i = 0; i < 2; i++) { const q = partsIn(tz, new Date(guess)); guess = wall - (Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second) - guess); }
  return new Date(guess);
}

export function buildState(cfg, now = new Date()) {
  const items = new Map(); const warnings = [];
  const manifests = readManifests(cfg);

  // 1. Generated scripts: one item per reel in each exported batch.
  const batches = ls(cfg.scriptsOut, true).filter(n => /^batch-/.test(n));
  for (const b of batches) {
    const pick = {};
    for (const f of ls(join(cfg.scriptsOut, b))) {
      const m = f.match(/^(\d\d)-(.+?)(?:-v(\d+))?\.(txt|md)$/i); if (!m) continue;
      const rank = Number(m[3] || 1) * 2 + (m[4].toLowerCase() === 'txt' ? 1 : 0);
      if (!pick[m[1]] || rank > pick[m[1]].rank) pick[m[1]] = { rank, f, slug: m[2] };
    }
    for (const [nn, g] of Object.entries(pick)) {
      const p = join(cfg.scriptsOut, b, g.f); const t = read(p) || ''; const id = `${b.slice(6)}-${nn}`;
      items.set(id, { id, batch: b, reel: Number(nn), title: titleFrom(t, g.slug), review: reviewFrom(t), files: { generated: rel(cfg, p) } });
    }
  }

  // 2. Batches that have inputs but no exported scripts yet.
  for (const b of ls(cfg.inputsDir, true).filter(n => /^batch-/.test(n))) {
    if (batches.includes(b)) {
      const ins = ls(join(cfg.inputsDir, b)); const mine = [...items.values()].filter(i => i.batch === b).sort((x, y) => x.reel - y.reel);
      if (ins.length === mine.length) mine.forEach((it, k) => { it.files.source = rel(cfg, join(cfg.inputsDir, b, ins[k])); it.sourceMatch = 'by order in the batch'; });
      continue;
    }
    // Working drafts (reels-data/outputs/<batch>/reel-NN-*.md) are the rewriter's output before the review exports
    // anything. A draft is a real stage of its own: it is not an export, and its absence from the export folder
    // says nothing about the batch being dropped.
    const work = ls(join(cfg.workOutDir, b)); const worked = work.length > 0;
    ls(join(cfg.inputsDir, b)).forEach((f, k) => {
      const nn = String(k + 1).padStart(2, '0'); const p = join(cfg.inputsDir, b, f); const id = `${b.slice(6)}-${nn}`;
      const ver = n => Number((n.match(/^reel-\d\d-v(\d+)-/i) || [])[1] || 1);
      const draft = work.filter(n => new RegExp(`^reel-${nn}-.+\\.md$`, 'i').test(n)).sort((x, y) => ver(x) - ver(y)).pop();
      const files = { source: rel(cfg, p) }; let review;
      if (draft) { files.draft = rel(cfg, join(cfg.workOutDir, b, draft)); review = parseDraft(read(join(cfg.workOutDir, b, draft)) || '').review; }
      items.set(id, { id, batch: b, reel: k + 1, title: titleFrom(read(p) || '', f.replace(/\.\w+$/, '')), rewriting: true, notExported: worked, review, files });
    });
  }

  // 3. Transcripts dropped but not yet batched.
  for (const d of [cfg.dropDir, cfg.inputsDir]) for (const f of ls(d).filter(n => /\.(md|txt)$/i.test(n))) {
    const p = join(d, f); const id = 'src-' + f.replace(/\.\w+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
    items.set(id, { id, batch: null, title: titleFrom(read(p) || '', f.replace(/\.\w+$/, '')), isSource: true, files: { source: rel(cfg, p) } });
  }

  // 4. Approved scripts.
  for (const d of ls(cfg.approvedDir, true)) for (const f of ls(join(cfg.approvedDir, d)).filter(n => /\.(txt|md)$/i.test(n))) {
    const p = join(cfg.approvedDir, d, f); const text = read(p) || ''; const m = f.match(/^(\d\d)-(.+)-version-([ab])\.(txt|md)$/i);
    let it;
    if (/^batch-/.test(d) && m) {
      const id = `${d.slice(6)}-${m[1]}`;
      it = items.get(id) || { id, batch: d, reel: Number(m[1]), title: titleFrom('', m[2]), files: {} };
      if (it.files.approved && statSync(join(cfg.root, it.files.approved)).mtimeMs > statSync(p).mtimeMs) { warnings.push(`${id}: more than one approved file; using the newest`); continue; }
      it.version = m[3].toUpperCase(); it.rewriting = false;
    } else {
      const id = 'pre-' + f.replace(/\.\w+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      it = { id, batch: d, title: titleFrom(text, f.replace(/\.\w+$/, '')), files: {}, lineage: 'pre-workflow' };
    }
    const ap = parseApproved(text, f);
    it.files.approved = rel(cfg, p); it.statusAtApproval = ap.status; it.ctaKeyword = ap.keyword;
    it.captions = { instagram: !!ap.instagram, tiktok: !!ap.tiktok, youtube: !!ap.youtube };
    items.set(it.id, it);
  }

  // 5. Resources: resources.md plus the .pdf.json that names the approved file it was built for.
  const resIndex = parseResources(read(cfg.resourcesMd));
  const pdfByApproved = {}; const pdfFileByKw = {};
  const approvals = (() => { const a = json(cfg.approvalsFile); return a && !a.__invalid ? a : {}; })();
  for (const f of ls(cfg.resourceSources).filter(n => n.endsWith('.pdf.json'))) {
    const j = json(join(cfg.resourceSources, f)); if (!j || j.__invalid) continue;
    const kwOf = String(j.keyword || f.replace('.pdf.json', '')).toUpperCase();
    if (j.name && j.topic) pdfFileByKw[kwOf] = `instagram_scripts_output/resources/${safeName(`${j.name} - ${j.topic}`)}.pdf`;
    const ap = norm(cfg, j.reel && j.reel.approved); if (ap) pdfByApproved[ap.toLowerCase()] = kwOf;
  }

  // 6. Publication and project links recorded by ig-insights.
  const L = json(cfg.linksJson); if (L && L.__invalid) warnings.push('links.json could not be read');
  const entries = L && L.entries ? Object.values(L.entries) : [];
  const rankLink = e => ({ confirmed: 0, 'pending-publication': 1, proposed: 2 }[e.status] ?? 3);
  const byApproved = {}, bySlug = {};
  for (const e of [...entries].sort((a, b) => rankLink(a) - rankLink(b))) {
    const ap = norm(cfg, e.approved && e.approved.file); if (ap) (byApproved[ap.toLowerCase()] ||= []).push(e);
    const s = e.project && e.project.slug; if (s) (bySlug[s] ||= []).push(e);
  }

  // 7. Video projects.
  const projects = ls(cfg.projectsDir, true).map(s => readProject(cfg, s)).filter(Boolean);
  const projBySlug = Object.fromEntries(projects.map(p => [p.slug, p]));
  const used = new Set();
  const applyEntry = (it, e) => {
    if (e.status === 'confirmed' || e.status === 'pending-publication') {
      const slug = e.project && e.project.slug;
      if (slug && projBySlug[slug] && !it.projectSlug) { it.projectSlug = slug; it.linkSource = e.status === 'confirmed' ? 'confirmed in ig-insights' : 'recorded in ig-insights, not yet published'; }
      if (e.status === 'confirmed' && e.published_at && !it.ig) it.ig = { at: e.published_at, url: e.permalink || null };
    } else if (e.status === 'proposed') {
      (it.suggestions ||= []).push({ key: e.ig_media_id || null, slug: (e.project && e.project.slug) || null, url: e.permalink || null, publishedAt: e.published_at || null, note: 'ig-insights proposed this link; it is not confirmed' });
    }
  };
  for (const it of items.values()) {
    const man = manifests[it.id];
    if (man && man.links && man.links.project && projBySlug[man.links.project]) { it.projectSlug = man.links.project; it.linkSource = 'linked in the dashboard'; }
    if (it.files.approved) for (const e of byApproved[it.files.approved.toLowerCase()] || []) applyEntry(it, e);
    if (it.projectSlug) used.add(it.projectSlug);
  }
  for (const it of items.values()) {
    if (!it.projectSlug || it.ig) continue;
    const e = (bySlug[it.projectSlug] || []).find(x => x.status === 'confirmed' && x.published_at);
    if (e) it.ig = { at: e.published_at, url: e.permalink || null };
  }
  for (const p of projects) {
    if (used.has(p.slug)) continue;
    const it = { id: 'video-' + p.slug.toLowerCase().replace(/[^a-z0-9]+/g, '-'), batch: null, title: titleFrom('', p.slug), videoOnly: true, files: {}, projectSlug: p.slug, linkSource: 'video project with no linked script' };
    for (const e of bySlug[p.slug] || []) if (!(e.approved && e.approved.file)) applyEntry(it, e);
    items.set(it.id, it);
  }

  const uploads = existsSync(cfg.uploadsDir) ? listMedia(cfg.uploadsDir, 1) : [];
  // 8. Finish each item: resource, manual tasks, stage, what is needed next.
  const proposedFor = {};
  for (const it of items.values()) for (const sg of it.suggestions || []) if (sg.slug && !it.projectSlug) proposedFor[sg.slug] = it.title;
  const out = [];
  for (const it of items.values()) {
    const man = manifests[it.id] || {}; const links = man.links || {}; const tasks = man.tasks || {};
    const p = it.projectSlug ? projBySlug[it.projectSlug] : null;
    const unknowns = []; const needs = [];
    // Publication you recorded here. A post confirmed in ig-insights (links.json) always takes precedence.
    const pub = man.publishing || {};
    if (!it.ig && pub.instagram) it.ig = { at: pub.instagram.at, url: pub.instagram.url || null, manual: true, via: pub.instagram.via || null };
    // Zernio submissions, newest per platform: an open one stops the "post it yourself" prompt; a failed one asks for you.
    const zl = {}; for (const z of (man.zernio || {}).posts || []) zl[z.platform] = z;
    const zBusy = k => !!zl[k] && (zernioOpen(zl[k].state) || zl[k].state === 'inbox' || zl[k].state === 'verify');
    // Where the file you linked sits in Uploads: the root means "on Instagram only", the all-platforms folder means "everywhere".
    const uf = links.uploadsFile && uploads.includes(links.uploadsFile) ? links.uploadsFile : null;
    const folder = !uf ? null : uf.startsWith(cfg.uploadsAllDir + '/') ? 'all' : !uf.includes('/') ? 'instagram' : null;
    if (!it.ig && folder && p) it.ig = { at: null, url: null, folder: true };
    const need = (group, label, go, tab, why) => needs.push({ group, label, go, tab, why });

    // resource
    let resource;
    const kw = (it.files.approved && pdfByApproved[it.files.approved.toLowerCase()]) || it.ctaKeyword || null;
    if (it.videoOnly) resource = { state: 'unknown', note: 'No script is linked, so the call to action is unknown' };
    else if (!it.files.approved) resource = { state: 'pending', note: 'Decided when a script is approved' };
    else if (!kw) resource = { state: 'not-required', note: 'The call to action is not a comment keyword' };
    else {
      const r = resIndex[kw]; const pdf = r ? norm(cfg, r.file) : null; const pdfExists = !!pdf && existsSync(join(cfg.root, pdf));
      resource = { keyword: kw, state: !r ? 'not-built' : r.status === 'live' ? 'live' : 'draft', delivery: r ? r.delivery : null, description: r ? r.description : null,
        pdf: pdfExists && /\.pdf$/i.test(pdf) ? pdf : null, pdfMissing: !!r && !pdfExists, gumroad: 'not recorded' };
    }

    // PDF approval gate: the approval is tied to the exact file by its SHA-256.
    const feedback = (man.feedback || []).map((x, i) => ({ ...x, index: i }));
    if (resource.keyword) {
      const exact = pdfFileByKw[resource.keyword];
      if (exact && existsSync(join(cfg.root, exact))) { resource.pdf = exact; resource.pdfMissing = false; }
      if (resource.pdf) {
        resource.sha = sha256File(join(cfg.root, resource.pdf)); const ok = approvals[resource.keyword];
        resource.gate = ok && ok.sha256 === resource.sha ? 'approved' : ok ? 'changed' : it.ig ? 'legacy' : 'awaiting';
        resource.approvedAt = ok ? ok.approvedAt : null;
        resource.upload = cfg.runtime && cfg.runtime.uploads[resource.keyword] ? { state: 'uploading' } : (man.upload && man.upload.sha === resource.sha ? man.upload : null);
        if (resource.upload && Number.isInteger(resource.upload.code)) resource.upload = { ...resource.upload, state: classifyUpload(resource.upload) };
        resource.gumroad = resource.upload ? resource.upload.state : resource.gate === 'legacy' ? 'not recorded (built before the approval step)' : 'no upload recorded by the dashboard';
        if (resource.gate === 'approved' && !resource.upload && resource.state !== 'live') need('Production', 'Upload the approved PDF to Gumroad', 'Open resource', 'resource', 'Approved, not uploaded. Uploading is a separate step.');
      }
    }

    // manual tasks: recorded by you, or implied by a project that already has renders
    const implied = !!p && p.renders.length > 0;
    const task = k => ({ done: !!(tasks[k] && tasks[k].done) || implied, at: (tasks[k] && tasks[k].at) || null, file: links[k === 'avatar' ? 'footage' : 'voiceover'] || null, implied: implied && !(tasks[k] && tasks[k].done) });
    const manual = { voiceover: task('voiceover'), avatar: task('avatar') };

    // video
    let stage, note = null, fail = null, who = 'System';
    const lastRender = p ? p.renders[p.renders.length - 1] : null;
    const lastCand = p ? [...p.renders].reverse().find(r => r.kind === 'candidate') : null;
    const finalDone = !!p && ((p.approval && p.finalExists) || (lastRender && lastRender.kind === 'final' && lastRender.exists));
    if (p && p.approval && !p.finalExists) unknowns.push(`An approval is recorded but ${p.finalFile} is missing`);
    if (p && !p.approval && p.finalExists) unknowns.push('renders/final.mp4 exists but no approval is recorded');

    if (it.isSource) { stage = 'source'; who = 'You'; need('Production', 'Start the rewrite', 'Open source', 'scripts', 'Transcript received, not yet rewritten'); }
    else if (it.rewriting && !p) {
      stage = 'rewrite';
      if (it.files.draft) {
        if (it.review === 'PENDING REVIEW') { who = 'You'; note = 'Drafts awaiting review'; need('Production', 'Drafts awaiting review', 'Open drafts', 'scripts', 'Both versions are written. The independent review has not run yet'); }
        else if (it.review === 'READY TO RECORD' || it.review === 'REVIEW REQUIRED') note = `Drafts reviewed (${it.review}); the final scripts are not exported yet`;
        else { note = 'Drafts written; their review status is not recorded'; unknowns.push(note); }
      } else if (it.notExported) { note = 'Working files exist, but no draft was found for this reel'; unknowns.push(note); }
      else note = 'Inputs are batched and no scripts are exported yet. Files cannot show whether a job is running now';
    }
    else if (!it.files.approved && !p) { stage = 'choose'; who = 'You'; if (man.decision) need('Production', `Finish approving Version ${man.decision.version}`, 'Open', 'scripts', 'Your choice is recorded; the approved file has not been written yet'); else need('Production', 'Choose Version A or B', 'Compare scripts', 'scripts', `Review status: ${it.review || 'Unknown'}`); }
    else if (!p) {
      who = 'You';
      if (!manual.voiceover.done) { stage = 'record'; need('Production', 'Record the voiceover', 'Open script', 'recording', 'The approved script is ready to read'); }
      else if (!manual.avatar.done) { stage = 'avatar'; need('Production', 'Create the HeyGen avatar', 'Open task', 'recording', manual.voiceover.file ? `Voiceover: ${manual.voiceover.file}` : 'Voiceover marked done; no audio file linked'); }
      else { stage = 'hook'; note = 'No video project is linked yet'; need('Production', 'Start the reel, or link its video project', 'Open video', 'video', `Run /create-reel and pass --script ${it.id} when creating the project, so it links here by itself`); }
    } else if (it.ig) {
      stage = 'distribute';
      if (!finalDone) unknowns.push('Published on Instagram, but no final approval is recorded for the video');
    } else if (finalDone) { stage = 'instagram'; who = 'You'; } else if (p.preflightRequired && (!p.preflight || p.preflight.status !== 'approved')) {
      stage = 'hook'; const h = p.hook || {};
      const mine = feedback.filter(x => x.asset === 'hook' && x.version === h.fingerprint);
      const answered = x => x.started && p.opening && p.opening.recordedAt > x.started; // the opening was shown again after the revision began
      if (h.error) { note = 'The Gate B report could not be read'; unknowns.push(`${note}: ${h.error}`); }
      else if (!h.valid) note = 'The creative plan is not written or not valid yet';
      else if (!h.openingOk) note = 'The opening preview has not been recorded yet';
      else if (mine.some(x => !x.started)) { who = 'You'; need('Production', 'Hook feedback recorded, revision not started', 'Open feedback', 'video', 'Start the revision when you are ready'); }
      else if (mine.some(x => x.started && !answered(x))) note = 'A hook revision was started; no new preview has been recorded yet';
      else { who = 'You'; need('Production', 'Review the hook preview', 'Review hook', 'video', 'The rest of the reel is not built until you approve it'); }
    } else if (!lastRender || lastRender.kind === 'draft') { stage = 'build'; note = lastRender ? `Draft v${String(lastRender.version).padStart(3, '0')} rendered` : 'No renders yet'; }
    else if (lastCand && lastRender.kind === 'candidate') {
      const q = lastCand.qa || { state: 'missing' };
      if (q.state === 'passed') {
        stage = 'candidate'; const mine = feedback.filter(x => x.asset === 'candidate' && x.version === lastCand.sha);
        const restore = p.approval && p.approval.candidate === lastCand.file && p.approval.sha === lastCand.sha && !p.finalExists;
        if (p.approval && p.approval.kind === 'external-edit' && !p.finalExists) { who = 'You'; need('Production', 'Restore the chosen final copy', 'Restore final', 'video', `The approval is recorded, but ${p.finalFile.replace(`video-projects/${p.slug}/`, '')} is missing`); }
        else if (restore) { who = 'You'; need('Production', 'Restore the approved final video', 'Restore final', 'video', `The approval is recorded, but ${p.finalFile.replace(`video-projects/${p.slug}/`, '')} is missing`); }
        else if (mine.some(x => !x.started)) { who = 'You'; need('Production', 'Candidate feedback recorded, revision not started', 'Open feedback', 'video', 'Start the revision when you are ready'); }
        else if (mine.length) note = 'A revision was started; no new candidate has been rendered yet';
        else { who = 'You'; need('Production', 'Review the candidate', 'Review candidate', 'video', `Candidate v${String(lastCand.version).padStart(3, '0')} passed QA`); }
      }
      else if (q.state === 'failed') { stage = 'qa'; who = 'You'; fail = `Candidate v${String(lastCand.version).padStart(3, '0')} failed QA${q.blocking && q.blocking.length ? ': ' + q.blocking.slice(0, 3).join(', ') : ''}`; need('Production', 'Recover a failed QA check', 'See failure', 'video', fail); }
      else { stage = 'qa'; note = q.state === 'missing' ? 'No QA result found for the latest candidate' : `QA result is ${q.state}`; unknowns.push(note); }
    } else { stage = 'build'; note = 'Latest render is not a draft or candidate'; unknowns.push(note); }

    if (it.videoOnly) unknowns.push('No script is linked to this video project');
    if (manual.voiceover.implied) unknowns.push('Voiceover and avatar are not recorded; assumed done because the project has renders');

    // publishing
    const platforms = { ig: { state: it.ig ? 'published' : stage === 'instagram' ? 'ready' : 'not-yet', at: it.ig ? it.ig.at : null, url: it.ig ? it.ig.url : null, manual: !!(it.ig && it.ig.manual), source: it.ig && it.ig.folder ? 'folder' : null }, yt: { state: 'not-yet' }, tt: { state: 'not-yet' } };
    let due = null;
    const proposal = (it.suggestions || []).find(x => x.publishedAt && (!x.slug || !p || x.slug === p.slug));
    if (stage === 'instagram' && proposal) {
      platforms.ig.state = 'unconfirmed'; platforms.ig.url = proposal.url; platforms.ig.at = proposal.publishedAt;
      unknowns.push('ig-insights found a possible Instagram post for this reel; it is not confirmed');
    } else if (stage === 'instagram' && it.videoOnly) {
      platforms.ig.state = 'unknown';
    } else if (stage === 'instagram') {
      const block = resource.keyword && resource.state !== 'live';
      if (block) { platforms.ig.state = 'blocked'; fail = fail || null; need('Publishing', 'Make the resource live before posting', 'Finish resource', 'resource', `Keyword ${resource.keyword} is ${resource.state === 'not-built' ? 'not built' : 'still a draft'}`); }
      else if (!zBusy('instagram')) need('Publishing', 'Post to Instagram', 'Publish', 'publish', 'The final video and caption are ready');
    }
    if (it.ig) {
      due = it.ig.at ? dueDate(cfg, it.ig.at) : null;
      // Shorts and TikTok are separate records: one never marks the other. "due" means no post is recorded, not that none exists.
      const day = d => { const q = partsIn(cfg.dueTimeZone, d); return q.year * 10000 + q.month * 100 + q.day; };
      const bucket = !due || day(due) < day(now) ? 'overdue' : day(due) === day(now) ? 'today' : 'upcoming';
      const isDue = !due || now >= due; const dueIso = due ? due.toISOString() : null;
      const backlog = !folder && new Date(it.ig.at) < cfg.trackFrom; // posted before these records existed: nobody can say from files whether it went out
      for (const [k, name, label] of [['yt', 'youtube', 'YouTube Shorts'], ['tt', 'tiktok', 'TikTok']]) {
        const r = pub[name];
        platforms[k] = r ? { state: 'published', at: r.at, url: r.url || null, due: dueIso } : folder === 'all' ? { state: 'published', at: null, url: null, due: dueIso, source: 'folder' }
          : backlog ? { state: 'not-recorded', due: dueIso } : { state: isDue ? 'due' : 'waiting', due: dueIso, bucket };
        if (platforms[k].state === 'due' && !zBusy(name)) need('Publishing', `Post to ${label}`, 'Publish', 'publish', folder === 'instagram' ? 'Its file is still in the Uploads root, which means Instagram only' : `Due since ${whenIn(cfg.dueTimeZone, due)}; no post is recorded`);
      }
      if (platforms.yt.state === 'published' && platforms.tt.state === 'published') { stage = 'done'; who = 'System'; }
      if (folder === 'all' && !(pub.youtube && pub.tiktok)) unknowns.push(`Shorts and TikTok read as posted because the linked file is in "${cfg.uploadsAllDir}"; no time or link is recorded`);
      if (it.ig.folder) unknowns.push('Instagram reads as posted from where the linked file sits in Uploads; ig-insights has not confirmed a post');
      if (backlog && !(pub.youtube && pub.tiktok)) unknowns.push('Posted on Instagram before the dashboard recorded Shorts and TikTok; record them on the Publish tab if they went out');
      if (it.ig.manual) unknowns.push(it.ig.via === 'zernio' ? 'The Instagram post was published through Zernio; ig-insights has not matched it yet' : 'The Instagram post was entered by you; ig-insights has not matched it yet');
      if (resource.keyword && resource.state !== 'live') unknowns.push(`Published on Instagram while keyword ${resource.keyword} is not marked live; confirm that viewers can receive it`);
    }
    // Facebook is recorded on its own. A file in the all-platforms folder, or an older "everywhere" record, never marks it.
    platforms.fb = pub.facebook ? { state: 'published', at: pub.facebook.at, url: pub.facebook.url || null } : { state: it.ig ? 'not-recorded' : 'not-yet' };
    for (const [k, z] of Object.entries(zl)) {
      if (z.state === 'failed') need('Publishing', `Zernio could not post to ${ZNAMES[k]}`, 'Open', 'publish', z.error || 'No reason was given');
      else if (z.state === 'inbox') need('Publishing', 'Finish the TikTok post in the TikTok app', 'Open', 'publish', 'It was sent to your TikTok inbox, not published');
      else if (z.state === 'verify' || z.state === 'unknown') need('Publishing', `Check the ${ZNAMES[k]} submission`, 'Open', 'publish', z.error || 'Zernio has not confirmed it');
    }
    if (resource.pdf && (resource.gate === 'changed' || (resource.state !== 'live' && resource.gate === 'awaiting'))) { // a rebuilt guide needs review even when its keyword is live
      const mine = feedback.filter(x => x.asset === 'pdf' && x.version === resource.sha);
      if (mine.some(x => !x.started)) need('Production', 'PDF feedback recorded, revision not started', 'Open feedback', 'resource', 'Start the revision when you are ready');
      else if (mine.length) note = note || 'A PDF revision was started; the rebuilt file will ask for approval again';
      else need('Production', 'Review the PDF guide', 'Review PDF', 'resource', resource.gate === 'changed' ? 'The PDF was rebuilt after you approved it, so it needs a new approval' : 'Nothing is uploaded to Gumroad until you approve this file');
    }
    if (resource.upload && ['failed', 'login-needed', 'held'].includes(resource.upload.state)) need('Production', 'The Gumroad upload needs attention', 'See upload', 'resource', resource.upload.state === 'login-needed' ? 'The Gumroad CLI is not logged in' : 'The upload did not complete');
    for (const sgt of it.suggestions || []) {
      // A script with a possible video project is not asked for production work until the link is settled.
      if (sgt.slug && !p) { needs.length = 0; note = 'A video project may already exist for this script'; }
      if (sgt.slug && !p) need('Needs linking', `Link the video project "${sgt.slug}"?`, 'Review link', 'video', 'ig-insights proposed this project for this script; it is not attached until you confirm');
      else if (sgt.publishedAt) need('Needs linking', 'Confirm the Instagram post', 'Review post', 'publish', 'ig-insights found a possible post; it counts as published only after you confirm it');
    }
    if (it.videoOnly) {
      needs.length = 0;
      if (proposedFor[p.slug]) note = `Proposed as the video for "${proposedFor[p.slug]}"; confirm it on that script`;
      else need('Unlinked video', 'Link this video to its script, or hide it', 'Review', 'video', 'Video project with no linked script');
    }

    // Old, undecided items stay visible under "All" but do not ask for attention.
    const bm = /^batch-(\d{4}-\d{2}-\d{2})/.exec(it.batch || ''); let born = bm ? new Date(bm[1] + 'T12:00:00') : null;
    if (!born && it.files.source) { try { born = statSync(join(cfg.root, it.files.source)).mtime; } catch { /* unknown age */ } }
    const ageDays = born ? (now - born) / 864e5 : 0;
    const early = !p && !it.files.approved;
    // Drafts awaiting review get the normal waiting period; only age makes them dormant. The wording says what the
    // files show: nothing here can tell whether work was dropped.
    const drafted = stage === 'rewrite' && !!it.files.draft, waiting = drafted && it.review === 'PENDING REVIEW';
    const dormant = man.activity !== 'active' && early && (ageDays > (stage === 'rewrite' && !waiting ? 3 : cfg.recentDays) || (!!it.notExported && !waiting));
    if (dormant && stage === 'rewrite' && !it.notExported) { note = 'Inputs only: no scripts were exported for this batch'; }
    if (dormant) { needs.length = 0; unknowns.push(drafted ? 'No final scripts were exported for these drafts; the files cannot show why' : stage === 'rewrite' ? 'No scripts were exported for this batch; the files cannot show why' : 'No version was approved; it may have been set aside'); }

    const recent = !it.ig || (it.ig.at ? (now - new Date(it.ig.at)) < cfg.recentDays * 864e5 : stage !== 'done') || (folder === 'instagram' && stage !== 'done');
    out.push({
      id: it.id, title: it.title, batch: it.batch, reel: it.reel || null, version: it.version || null, lineage: it.lineage || null,
      review: it.review || it.statusAtApproval || null, videoOnly: !!it.videoOnly, hidden: !!man.hidden, dormant, setAside: man.activity === 'set-aside', active: !man.hidden && man.activity !== 'set-aside' && (man.activity === 'active' || (recent && !dormant)),
      stage, note, fail, who, files: it.files, sourceMatch: it.sourceMatch || null, captions: it.captions || null,
      resource, manual, links: { ...links }, linkSource: it.linkSource || null,
      project: p, platforms, due: due ? due.toISOString() : null,
      candidate: stage === 'candidate' && !(p.approval && p.approval.kind === 'external-edit') && lastCand.exists && lastCand.sha ? { file: lastCand.file, sha: lastCand.sha, version: lastCand.version, ...(p.approval && p.approval.candidate === lastCand.file && p.approval.sha === lastCand.sha && !p.finalExists ? { restore: true } : {}) } : null,
      suggestions: it.suggestions || [], unknowns, needs,
      decision: man.decision && !it.files.approved && it.reel ? { ...man.decision, command: approvalCommand(it, man.decision.version) } : null,
      feedback: feedback.map(x => ({ ...x,
        current: x.asset === 'pdf' ? x.version === resource.sha : x.asset === 'hook' ? !!(p && p.hook && x.version === p.hook.fingerprint && stage === 'hook') : !!(lastCand && x.version === lastCand.sha && stage === 'candidate'),
        command: x.asset === 'pdf' ? (resource.keyword ? revisionPrompt(resource.keyword, x.text) : null) : p ? videoRevisionPrompt(p.slug, x.asset, x.version, x.text) : null })),
      jobs: (man.jobs || []).map(j => ({ ...j, status: ((cfg.runtime ? cfg.runtime.queue.missions : []).find(q => q.id === j.id) || {}).status || 'no longer in the queue' })),
    });
  }
  for (const o of out) o.zernio = zernioView(cfg, o, manifests[o.id]);
  out.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || String(b.batch || '').localeCompare(String(a.batch || '')) || a.title.localeCompare(b.title));

  return {
    generatedAt: now.toISOString(), dueHour: cfg.dueHour, dueTimeZone: cfg.dueTimeZone, dueProvisional: !cfg.dueConfirmed, stages: STAGES, items: out, warnings,
    projects: projects.map(p => ({ slug: p.slug, linked: used.has(p.slug) })),
    files: { rawMedia: existsSync(cfg.rawMedia) ? listMedia(cfg.rawMedia, 1) : [], uploads, uploadsAllDir: cfg.uploadsAllDir, uploadsFound: existsSync(cfg.uploadsDir) },
    queue: cfg.runtime ? cfg.runtime.queue : { available: false, running: false, reason: 'not checked', missions: [] },
  };
}

// Full text for one project page: scripts, captions and the source transcript.
export function itemDetail(cfg, state, id) {
  const it = state.items.find(i => i.id === id); if (!it) return null;
  const f = it.files; const out = { id };
  if (f.source) out.source = { file: f.source, text: read(join(cfg.root, f.source)) || '', match: it.sourceMatch };
  if (!f.generated && f.draft) out.generated = { file: f.draft, draft: true, ...parseDraft(read(join(cfg.root, f.draft)) || '') };
  if (f.generated) { const g = parseGenerated(read(join(cfg.root, f.generated)) || '', f.generated); out.generated = { file: f.generated, ...g }; }
  try { const v = finalVideo(cfg, it); if (v) out.video = { file: v.file, size: v.size, sha: v.sha, seconds: v.seconds, matchesApproval: v.matchesApproval, approvedAt: v.approvedAt }; } catch { /* no readable final video */ }
  if (f.approved) { const a = parseApproved(read(join(cfg.root, f.approved)) || '', f.approved); out.approved = { file: f.approved, ...a, youtubeParts: parseYoutube(a.youtube) }; }
  return out;
}
