// The dashboard's own records: one small JSON file per piece of content, plus an append-only history.
// It writes only inside cfg.contentDir. The two changes to workflow records (a resources.md line, an ig-insights
// link) are checked here and carried out by workflow.mjs.
import { readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { join, resolve, sep, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { versionCFile } from './jobs.mjs';
import { setResourceStatus, confirmLink, approveHook, approveCandidate, approveExternal, restoreExternal } from './workflow.mjs';
import { prepare as zernioPrepare, prepareRetry as zernioRetry } from './zernio.mjs';

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,120}$/;
export const PLATFORMS = {
  instagram: { short: 'ig', name: 'Instagram', hosts: ['instagram.com'] },
  youtube: { short: 'yt', name: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  tiktok: { short: 'tt', name: 'TikTok', hosts: ['tiktok.com'] },
  facebook: { short: 'fb', name: 'Facebook', hosts: ['facebook.com', 'fb.watch'] }, // its own record; nothing else ever implies it
};

export function readManifests(cfg) {
  const out = {};
  let names = []; try { names = readdirSync(cfg.contentDir); } catch { return out; }
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    try { const m = JSON.parse(readFileSync(join(cfg.contentDir, n), 'utf8')); if (m && m.id) out[m.id] = m; } catch { /* unreadable manifest is ignored, never overwritten blindly */ }
  }
  return out;
}

function writeManifest(cfg, m) {
  if (!SAFE_ID.test(m.id)) throw new Error('Invalid content id');
  mkdirSync(cfg.contentDir, { recursive: true });
  const target = resolve(cfg.contentDir, m.id + '.json');
  if (!target.startsWith(resolve(cfg.contentDir) + sep)) throw new Error('Refusing to write outside the content folder');
  const tmp = target + '.tmp';
  writeFileSync(tmp, JSON.stringify(m, null, 2) + '\n');
  renameSync(tmp, target);
}

const sha = t => createHash('sha256').update(t).digest('hex');
// Version C: the script Mits writes himself on the Scripts tab. Empty or missing reads as no Version C.
export function readVersionC(cfg, id) {
  try { const text = readFileSync(resolve(cfg.root, versionCFile(id)), 'utf8').replace(/\s+$/, ''); return text ? { file: versionCFile(id), text, sha: sha(text) } : null; } catch { return null; }
}
const atomic = (target, text) => { const tmp = target + '.tmp'; writeFileSync(tmp, text); renameSync(tmp, target); };

// For results that arrive later (an upload finishing, a job being queued).
export function updateManifest(cfg, id, fn) {
  if (!SAFE_ID.test(id)) throw new Error('Invalid content id');
  const file = join(cfg.contentDir, id + '.json'); const m = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { id, format: 'reel', links: {}, tasks: {} };
  fn(m); m.updatedAt = new Date().toISOString(); writeManifest(cfg, m); return m;
}

// Mits, 2026-11-16: every keyword delivers the same Gumroad pack, so a verified upload of the approved PDF is what
// makes a keyword live. Flips that keyword's one line in resources.md from draft to live and records why.
// Returns true only when it changed the line.
export const VERIFIED_UPLOAD = ['uploaded', 'already-there'];
export function liveAfterUpload(cfg, item, uploadState) {
  const r = (item && item.resource) || {};
  if (!r.keyword || r.state !== 'draft' || r.gate !== 'approved' || !VERIFIED_UPLOAD.includes(uploadState)) return false;
  setResourceStatus(cfg, r.keyword, 'draft', 'live');
  const at = new Date().toISOString();
  updateManifest(cfg, item.id, m => { m.resourceStatus = { keyword: r.keyword, status: 'live', at, by: 'verified Gumroad upload' }; });
  appendFileSync(join(cfg.contentDir, 'history.jsonl'), JSON.stringify({ at, id: item.id, action: { type: 'resource-status', keyword: r.keyword, to: 'live', by: 'verified Gumroad upload' } }) + '\n');
  return true;
}

// state: the current buildState() result, used to validate ids and choices against what really exists.
export function applyAction(cfg, state, action, now = new Date()) {
  const a = action || {};
  const item = state.items.find(i => i.id === a.id);
  if (!item) throw new Error('Unknown project');
  const file = join(cfg.contentDir, item.id + '.json');
  let m = { id: item.id, title: item.title, format: 'reel', links: {}, tasks: {}, hidden: false };
  if (existsSync(file)) m = { ...m, ...JSON.parse(readFileSync(file, 'utf8')) };
  m.links = m.links || {}; m.tasks = m.tasks || {};
  const at = now.toISOString();

  if (a.type === 'task') {
    if (!['voiceover', 'avatar'].includes(a.task)) throw new Error('Unknown task');
    m.tasks[a.task] = { ...(m.tasks[a.task] || {}), done: !!a.done, at };
  } else if (a.type === 'link') {
    const value = a.value || null;
    if (a.kind === 'project') {
      if (value && !state.projects.some(p => p.slug === value)) throw new Error('No such video project');
      const taken = value && state.items.find(i => i.id !== item.id && !i.videoOnly && i.project && i.project.slug === value);
      if (taken) throw new Error(`That video project is already linked to "${taken.title}"`);
    } else if (a.kind === 'voiceover' || a.kind === 'footage') {
      if (value && !state.files.rawMedia.includes(value)) throw new Error('That file is not in raw-media');
    } else if (a.kind === 'uploadsFile') {
      if (value && !state.files.uploads.includes(value)) throw new Error('That file is not in the Uploads folder');
    } else throw new Error('Unknown link kind');
    if (value) m.links[a.kind] = value; else delete m.links[a.kind];
  } else if (a.type === 'hide') {
    m.hidden = !!a.hidden;
  } else if (a.type === 'activity') {
    if (!['active', 'set-aside'].includes(a.activity)) throw new Error('Unknown activity');
    m.activity = a.activity;
  } else if (a.type === 'decide') {
    if (item.stage !== 'choose') throw new Error('This reel is not waiting for a script choice');
    if (a.version == null) delete m.decision;
    else {
      if (!['A', 'B', 'C'].includes(a.version)) throw new Error('Choose version A, B or C');
      m.decision = { version: a.version, at };
      if (a.version === 'C') { const c = readVersionC(cfg, item.id); if (!c) throw new Error('Version C is empty. Write it and save it first.'); m.decision.sha = c.sha; }
    }
  } else if (a.type === 'version-c') {
    if (item.stage !== 'choose') throw new Error('This reel is not waiting for a script choice');
    if (m.decision) throw new Error('A choice is already recorded. Change your choice first, then edit Version C.');
    const text = String(a.text == null ? '' : a.text).replace(/\r\n?/g, '\n').replace(/\s+$/, '');
    if (text.length > 20000) throw new Error('Keep Version C under 20,000 characters');
    const target = resolve(cfg.root, versionCFile(item.id));
    if (!target.startsWith(resolve(cfg.contentDir) + sep)) throw new Error('Refusing to write outside the content folder');
    mkdirSync(dirname(target), { recursive: true }); atomic(target, text ? text + '\n' : '');
    m.versionC = text ? { at, sha: sha(text) } : null; if (!text) delete m.versionC;
  } else if (a.type === 'approve-pdf') {
    const r = item.resource || {};
    if (!r.keyword || !r.pdf || !r.sha) throw new Error('There is no PDF to approve');
    if (a.sha !== r.sha) throw new Error('The PDF changed since you opened it. Look at the new version first.');
    if ((item.feedback || []).some(x => x.asset === 'pdf' && x.version === r.sha && !x.started)) throw new Error('You asked for changes to this version. Start the revision, or withdraw the feedback, before approving.');
    mkdirSync(cfg.contentDir, { recursive: true });
    let all = {}; if (existsSync(cfg.approvalsFile)) all = JSON.parse(readFileSync(cfg.approvalsFile, 'utf8'));
    all[r.keyword] = { sha256: r.sha, file: r.pdf, approvedAt: at, approvedIn: 'content dashboard' };
    atomic(cfg.approvalsFile, JSON.stringify(all, null, 2) + '\n');
    delete m.upload;
  } else if (a.type === 'feedback') {
    const r = item.resource || {}; const text = String(a.text || '').trim(); let version;
    if (a.asset === 'pdf') {
      if (!r.pdf || !r.sha) throw new Error('There is no PDF to comment on');
      if (r.gate === 'approved') throw new Error('This version is already approved. Rebuild the guide to change it.');
      version = r.sha;
    } else if (a.asset === 'hook') {
      const h = item.project && item.project.hook; if (item.stage !== 'hook' || !h || !h.fingerprint) throw new Error('There is no hook preview waiting for review');
      version = h.fingerprint;
    } else if (a.asset === 'candidate') {
      if (!item.candidate) throw new Error('There is no QA-passed candidate waiting for review'); version = item.candidate.sha;
    } else throw new Error('Unknown thing to comment on');
    if (!text) throw new Error('Write what should change first'); if (text.length > 2000) throw new Error('Keep feedback under 2,000 characters');
    (m.feedback ||= []).push({ asset: a.asset, version, text, at, started: null });
  } else if (a.type === 'withdraw-feedback' || a.type === 'start-revision') {
    const f = (m.feedback || [])[a.index]; if (!f) throw new Error('That feedback no longer exists');
    if (f.started) throw new Error('That revision was already started');
    if (a.type === 'withdraw-feedback') m.feedback.splice(a.index, 1); else f.started = at;
  } else if (a.type === 'retry-upload' || a.type === 'upload-pdf' || a.type === 'check-upload') {
    const r = item.resource || {};
    if (r.gate !== 'approved') throw new Error('Only an approved PDF can be uploaded');
    if (a.sha !== undefined && a.sha !== r.sha) throw new Error('The PDF changed since you opened it. Look at the new version first.');
    if (a.type === 'check-upload' && a.sha !== r.sha) throw new Error('Check the exact PDF shown on this page.');
  } else if (a.type === 'approve-hook') {
    const h = item.project && item.project.hook;
    if (item.stage !== 'hook' || !h) throw new Error('This reel is not waiting for a hook approval');
    if (h.error) throw new Error('The Gate B report could not be read, so nothing can be approved');
    if (!h.valid) throw new Error('The creative plan is not valid yet, so there is nothing to approve');
    if (!h.openingOk) throw new Error('The opening preview has not been recorded yet. Watch it first.');
    if (!/^[a-f0-9]{64}$/.test(a.fingerprint || '') || a.fingerprint !== h.fingerprint) throw new Error('The plan changed since you opened it. Look at the current version first.');
    if (h.planAfterPreview) throw new Error('The opening preview on record was shown for a different plan than this one. Record the opening again, watch it, then approve.');
    if (a.watched !== true) throw new Error('Tick the box to confirm you watched this opening');
    if ((item.feedback || []).some(x => x.asset === 'hook' && x.version === h.fingerprint && !x.started)) throw new Error('You asked for changes to this hook. Start the revision, or withdraw the feedback, before approving.');
    approveHook(cfg, item.project.slug, h.fingerprint);
  } else if (a.type === 'approve-candidate') {
    const c = item.candidate;
    if (!c) throw new Error('There is no QA-passed candidate waiting for approval');
    if (!/^[a-f0-9]{64}$/.test(a.sha || '') || a.sha !== c.sha) throw new Error('A different candidate is waiting now. Watch the current one first.');
    if ((item.feedback || []).some(x => x.asset === 'candidate' && x.version === c.sha && !x.started)) throw new Error('You asked for changes to this candidate. Start the revision, or withdraw the feedback, before approving.');
    approveCandidate(cfg, item.project.slug, c.file, c.sha);
  } else if (a.type === 'approve-external') {
    const p = item.project;
    if (!p || !p.approval) throw new Error('Approve a Reel Studio candidate first. An outside edit finishes an approved video.');
    const e = (p.outsideEdits || []).find(x => x.file === a.file);
    if (!e) throw new Error('That file is not an outside edit in this project’s renders folder');
    if (!/^[a-f0-9]{64}$/.test(a.sha || '') || a.sha !== e.sha) throw new Error('That file changed since you opened it. Watch the current version first.');
    if (a.watched !== true) throw new Error('Tick the box to confirm you watched and listened to this exact file');
    const busy = ((m.zernio || {}).posts || []).filter(r => ['prepared', 'uploading', 'submitting', 'retrying', 'processing', 'unknown', 'scheduled'].includes(r.state));
    if (busy.length) throw new Error(`Zernio still holds ${busy.map(r => r.platform).join(', ')} with the current video (${[...new Set(busy.map(r => r.state))].join(', ')}). Let it finish, or cancel it in Zernio and check status, before changing the final.`);
    const source = String(a.source || '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 60) || 'Outside edit';
    approveExternal(cfg, p.slug, e.file, e.sha, source);
  } else if (a.type === 'restore-external') {
    const p = item.project;
    if (!p || !p.approval || p.approval.kind !== 'external-edit') throw new Error('The approved final is not an outside edit');
    if (p.finalExists) throw new Error('The approved final is already in place');
    restoreExternal(cfg, p.slug);
  } else if (a.type === 'publish') {
    const P = PLATFORMS[a.platform]; if (!P) throw new Error('Unknown platform');
    const when = new Date(a.at); if (!a.at || Number.isNaN(+when)) throw new Error('Enter the time it was published');
    if (when - now > 10 * 60000) throw new Error('That time is in the future. Record a post after it is published.');
    if (when < new Date('2024-01-01')) throw new Error('That date looks wrong');
    const url = String(a.url || '').trim();
    if (url) { let h = null; try { const u = new URL(url); if (u.protocol === 'https:') h = u.hostname.toLowerCase(); } catch { /* refused below */ }
      if (url.length > 300 || !h || !P.hosts.some(d => h === d || h.endsWith('.' + d))) throw new Error(`That link is not from ${P.hosts[0]}`); }
    const st = item.platforms; m.publishing = m.publishing || {};
    if (st[P.short].state === 'published') throw new Error(`${P.name} is already recorded as published`);
    if (a.platform === 'instagram') {
      if (st.ig.state === 'blocked') throw new Error(`Keyword ${item.resource.keyword} is not live yet, so this reel is not ready to post`);
      if (st.ig.state === 'unconfirmed') throw new Error('ig-insights found a possible post for this reel. Confirm that post instead.');
      if (st.ig.state !== 'ready') throw new Error('The final video is not approved yet');
    } else if (st.ig.state !== 'published') throw new Error('Record the Instagram post first');
    m.publishing[a.platform] = { at: when.toISOString(), url: url || null, recordedAt: at };
  } else if (a.type === 'unpublish') {
    const P = PLATFORMS[a.platform]; if (!P) throw new Error('Unknown platform');
    const pub = m.publishing || {}; if (!pub[a.platform]) throw new Error('The dashboard holds no record to withdraw');
    if (a.platform === 'instagram' && (pub.youtube || pub.tiktok)) throw new Error('Withdraw the Shorts and TikTok records first');
    delete pub[a.platform];
  } else if (a.type === 'zernio-send') {
    zernioPrepare(cfg, item, m, a, now); // every destination, its request key and its exact text are saved before anything is sent
  } else if (a.type === 'zernio-retry') {
    zernioRetry(cfg, item, m, a, now);
  } else if (a.type === 'zernio-draft') {
    if (JSON.stringify(a.fields || {}).length > 40000) throw new Error('That text is too long to save');
    (m.zernio ||= {}).draft = { fields: a.fields || {}, savedAt: at };
  } else if (a.type === 'zernio-check') {
    if (!((m.zernio || {}).posts || []).length) throw new Error('Nothing has been sent to Zernio for this reel');
  } else if (a.type === 'confirm-post') {
    const sg = (item.suggestions || []).find(s => s.key && s.key === a.key && s.publishedAt); if (!sg) throw new Error('That post is no longer proposed for this reel');
    if (sg.slug && item.project && sg.slug !== item.project.slug) throw new Error(`ig-insights proposed this post for "${sg.slug}", not this reel's video project`);
    const slug = item.project ? item.project.slug : sg.slug; if (!slug) throw new Error('Link the video project first');
    confirmLink(cfg, sg.key, slug);
  } else if (a.type === 'resource-status') {
    const r = item.resource || {};
    if (!r.keyword || a.keyword !== r.keyword) throw new Error('That keyword does not belong to this reel');
    if (a.to === 'live') {
      if (r.state !== 'draft') throw new Error(r.state === 'live' ? 'This keyword is already live' : 'This keyword has no line in resources.md yet');
      if (r.pdf && !['approved', 'legacy'].includes(r.gate)) throw new Error('Approve this PDF first. A keyword cannot go live with a guide you have not approved.');
      if (a.confirmed !== true) throw new Error('Tick the box to confirm the keyword is set up and tested');
    } else if (a.to === 'draft') { if (r.state !== 'live') throw new Error('This keyword is not live'); }
    else throw new Error('Unknown status');
    setResourceStatus(cfg, r.keyword, a.to === 'live' ? 'draft' : 'live', a.to);
    m.resourceStatus = { keyword: r.keyword, status: a.to, at };
  } else throw new Error('Unknown action');

  m.updatedAt = at;
  writeManifest(cfg, m);
  appendFileSync(join(cfg.contentDir, 'history.jsonl'), JSON.stringify({ at, id: item.id, action: a }) + '\n');
  return m;
}
