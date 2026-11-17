// Zernio publishing for the Command Centre. Two Zernio logins, one key each, and a fixed route from each destination
// to its key: a destination is never sent with the other login's key. One Zernio post per destination, so each
// platform is tracked, scheduled and retried on its own. Keys are read on the server, sent only to zernio.com,
// and never returned to the page or written to a log or a manifest.
// Docs: https://docs.zernio.com/posts/create-post  /guides/media-uploads  /products/scheduler
import { readFileSync, existsSync, statSync, openAsBlob } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const BASE = 'https://zernio.com/api/v1';
export const TZ = 'Europe/London';
export const LOGINS = {
  A: { env: 'ZERNIO_KEY_TIKTOK_YOUTUBE', name: 'TikTok and YouTube login', platforms: ['tiktok', 'youtube'] },
  B: { env: 'ZERNIO_KEY_INSTAGRAM_FACEBOOK', name: 'Instagram and Facebook login', platforms: ['instagram', 'facebook'] },
};
export const ROUTE = { tiktok: 'A', youtube: 'A', instagram: 'B', facebook: 'B' };
export const NAMES = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube Shorts' };
export const ORDER = ['instagram', 'facebook', 'tiktok', 'youtube'];
const SHORT = { instagram: 'ig', facebook: 'fb', tiktok: 'tt', youtube: 'yt' };
const LIMIT = { instagram: 2200, facebook: 5000, tiktok: 2200, youtube: 5000 };
const OPEN = ['prepared', 'uploading', 'submitting', 'retrying', 'processing', 'scheduled', 'unknown'];
const HOLDS = [...OPEN, 'published', 'inbox', 'verify', 'failed']; // failed work is retried explicitly, using its saved identity
const sha = t => createHash('sha256').update(t).digest('hex');
export const scrub = s => String(s ?? '').replace(/sk_[A-Za-z0-9_-]{8,}/g, '[redacted]').slice(0, 600);

// Keys: process.env first, then the workspace .env (the repo's existing pattern). Tests inject cfg.zernio.keys.
export function keys(cfg) {
  if (cfg.zernio && cfg.zernio.keys) return cfg.zernio.keys;
  const env = {}; const file = join(cfg.root, '.env');
  if (existsSync(file)) for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  const out = {}; for (const [id, l] of Object.entries(LOGINS)) { const v = process.env[l.env] || env[l.env] || ''; out[id] = /^sk_[A-Za-z0-9]{20,}$/.test(v) ? v : null; }
  return out;
}

async function api(cfg, login, method, path, { body, headers } = {}) {
  const key = keys(cfg)[login]; if (!key) throw new Error(`No Zernio key is set for the ${LOGINS[login].name} (${LOGINS[login].env} in .env)`);
  const f = (cfg.zernio && cfg.zernio.fetch) || fetch;
  const r = await f(BASE + path, { method, redirect: 'error', signal: AbortSignal.timeout(method === 'GET' ? 20000 : 300000), headers: { authorization: 'Bearer ' + key, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* an empty or non-JSON body */ }
  return { status: r.status, json: json || {} };
}
const errText = r => scrub([r.json.error, r.json.message, r.json.code && `(${r.json.code})`].filter(Boolean).join(' ') || `Zernio answered ${r.status}`);

// ---- connected accounts: read-only ----
function describe(platform, login, a, h, extra) {
  const perms = a.permissions || []; const md = a.metadata || {}; const notes = []; let eligible = true;
  if (platform === 'instagram') {
    const type = ((md.profileData || {}).extraData || {}).accountType || null;
    const pro = /^(MEDIA_CREATOR|CREATOR|BUSINESS)$/i.test(type || ''); const can = perms.some(p => /content_publish/.test(p));
    eligible = pro && can; notes.push(pro ? `Professional account (${type.replace(/_/g, ' ').toLowerCase()})` : 'Not confirmed as a professional account; a personal account cannot post through the API');
    if (!can) notes.push('The connection lacks permission to publish');
  } else if (platform === 'facebook') {
    const page = md.selectedPageId || null; const can = perms.includes('pages_manage_posts');
    eligible = !!page && can; notes.push(page ? `Facebook Page “${md.selectedPageName || page}”` : 'No Facebook Page is selected; a personal profile cannot post through the API');
    if (!can) notes.push('The connection lacks permission to post to the Page');
  } else if (platform === 'youtube') {
    eligible = perms.some(p => /youtube\.upload$/.test(p)); if (!eligible) notes.push('The connection lacks permission to upload');
  } else if (platform === 'tiktok') {
    const direct = perms.includes('video.publish'), inbox = perms.includes('video.upload'); eligible = direct || inbox;
    notes.push(direct ? 'Direct Post is available' : 'Direct Post is not available'); notes.push(inbox ? 'Creator Inbox handoff is available' : 'Creator Inbox handoff is not available');
  }
  const healthy = !!h && h.canPost === true && !h.needsReconnect && !a.needsReconnection && a.isActive !== false && a.enabled !== false;
  return { platform, name: NAMES[platform], login, loginName: LOGINS[login].name, connected: true, accountId: a._id, handle: a.username || null, displayName: (a.displayName || '').trim() || null, profileUrl: a.profileUrl || null,
    health: h ? h.status : 'unknown', canPost: healthy, needsReconnect: !!(h && h.needsReconnect) || !!a.needsReconnection, issues: (h && h.issues) || [], eligible, ready: healthy && eligible && !(extra && extra.error), notes,
    pageId: platform === 'facebook' ? (a.metadata || {}).selectedPageId || null : undefined, tiktok: platform === 'tiktok' ? extra : undefined };
}

export async function accounts(cfg, { fresh = false } = {}) {
  const rt = (cfg.runtime ||= {}); const c = rt.zernioAccounts;
  if (!fresh && c && Date.now() - c.at < 5 * 60000) return c.data;
  const k = keys(cfg); const data = { checkedAt: new Date().toISOString(), logins: {}, destinations: {}, other: [] };
  for (const [login, L] of Object.entries(LOGINS)) {
    data.logins[login] = { name: L.name, env: L.env, configured: !!k[login], ok: false, error: null };
    for (const p of L.platforms) data.destinations[p] = { platform: p, name: NAMES[p], login, loginName: L.name, connected: false, ready: false, notes: [k[login] ? `No ${NAMES[p]} account is connected under this login` : `Add ${L.env} to .env`] };
    if (!k[login]) continue;
    try {
      const [a, h] = await Promise.all([api(cfg, login, 'GET', '/accounts'), api(cfg, login, 'GET', '/accounts/health')]);
      if (a.status !== 200) { data.logins[login].error = errText(a); for (const p of L.platforms) data.destinations[p].notes = [`Zernio refused this login: ${errText(a)}`]; continue; }
      data.logins[login].ok = true; const health = (h.status === 200 && h.json.accounts) || [];
      for (const acc of a.json.accounts || []) {
        const hl = health.find(x => x.accountId === acc._id) || null;
        if (!L.platforms.includes(acc.platform)) { data.other.push({ platform: acc.platform, handle: acc.username || null, login, note: `Connected under the ${L.name}, which is not the login this dashboard uses for ${acc.platform}. It is ignored.` }); continue; }
        if (data.destinations[acc.platform].connected) { data.destinations[acc.platform].ready = false; data.destinations[acc.platform].notes.push('Several accounts match this destination. Resolve the account mapping before publishing.'); continue; }
        let extra;
        if (acc.platform === 'tiktok') {
          const ci = await api(cfg, login, 'GET', `/accounts/${acc._id}/tiktok/creator-info?mediaType=video`);
          extra = ci.status === 200 ? { privacyLevels: ci.json.privacyLevels || [], interactions: (ci.json.postingLimits || {}).interactionSettings || {}, maxSeconds: (ci.json.postingLimits || {}).maxVideoDurationSec || null, canPostMore: (ci.json.creator || {}).canPostMore !== false, commercial: ci.json.commercialContentTypes || [], flavor: (acc.metadata || {}).apiFlavor || null }
            : { privacyLevels: [], interactions: {}, error: errText(ci) };
        }
        data.destinations[acc.platform] = describe(acc.platform, login, acc, hl, extra);
      }
    } catch (e) { data.logins[login].error = scrub(e.message); for (const p of L.platforms) data.destinations[p].notes = [`Could not reach Zernio: ${scrub(e.message)}`]; }
  }
  rt.zernioAccounts = { at: Date.now(), data }; return data;
}

// ---- gates: only an approved script with its approved final video, and a live resource, can be sent ----
export function gate(item) {
  const reasons = []; const p = item.project; const r = item.resource || {};
  if (item.videoOnly || !(item.files && item.files.approved)) reasons.push('No approved script is linked to this video.');
  if (/PENDING REVIEW|REVIEW REQUIRED/i.test(item.review || '')) reasons.push('The script still requires review.');
  if (!p) reasons.push('There is no video project, so there is no final video.');
  else if (!p.approval || !p.finalExists) reasons.push('The final video is not approved yet. Approve a QA-passed candidate first.');
  else {
    // An outside edit (e.g. Canva) is publishable only as a finish of a QA-passed candidate approved before it.
    const base = p.approval.kind === 'external-edit' ? p.approval.basedOn || {} : { candidate: p.approval.candidate, sha256: p.approval.sha };
    const candidate = (p.renders || []).find(x => x.file === base.candidate);
    if (!candidate || candidate.sha !== base.sha256 || candidate.qa?.state !== 'passed') reasons.push(p.approval.kind === 'external-edit' ? 'The outside edit must finish a candidate with matching, passed QA.' : 'The approved candidate needs matching, passed QA.');
    if (p.preflightRequired && p.preflight?.status !== 'approved') reasons.push('The creative preflight is not approved.');
  }
  if (r.keyword && r.state !== 'live') reasons.push(`Keyword ${r.keyword} is not live yet, so viewers could not receive what the caption promises.`);
  if (r.keyword && (!r.pdf || r.gate !== 'approved')) reasons.push('The promised resource needs approval of its current PDF.');
  if ((item.feedback || []).some(x => !x.started && (x.asset === 'candidate' && x.version === p?.approval?.sha || x.asset === 'pdf' && x.version === r.sha))) reasons.push('There is unresolved feedback on the approved assets.');
  return { ok: reasons.length === 0, reasons };
}

// The recorded approved final filename, checked byte for byte against its approval.
export function finalVideo(cfg, item) {
  const p = item.project; if (!p || !p.approval || !p.finalExists) return null;
  const full = join(cfg.root, p.finalFile); const st = statSync(full); const rt = (cfg.runtime ||= {}); const cache = (rt.zernioVideo ||= {}); const tag = `${full}|${st.size}|${st.mtimeMs}`;
  if (!cache[tag]) {
    let seconds = null; try { const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', full], { encoding: 'utf8', timeout: 8000, windowsHide: true }); const n = Number(String(r.stdout || '').trim()); if (r.status === 0 && n > 0) seconds = Math.round(n * 10) / 10; } catch { /* ffprobe is optional */ }
    cache[tag] = { sha: sha(readFileSync(full)), seconds };
  }
  return { file: p.finalFile, full, size: st.size, sha: cache[tag].sha, seconds: cache[tag].seconds, matchesApproval: /^[a-f0-9]{64}$/.test(p.approval.sha || '') && p.approval.sha === cache[tag].sha, approvedAt: p.approval.at || null };
}

// ---- time: the page gives a wall-clock time in Europe/London ----
const parts = (tz, d) => { const o = {}; for (const p of new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d)) o[p.type] = Number(p.value); return o; };
export function londonToUtc(local, tz = TZ) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local || '')); if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]); let t = wall;
  if (new Date(wall).toISOString().slice(0, 16) !== local) return null;
  for (let i = 0; i < 3; i++) { const p = parts(tz, new Date(t)); t += wall - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute); }
  const p = parts(tz, new Date(t)); if (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) !== wall) return null; // a time the clocks skip
  for (const delta of [-3600000, 3600000]) { const q = parts(tz, new Date(t + delta)); if (Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute) === wall) return null; } // ambiguous clock-change hour
  return new Date(t);
}

// ---- text: hashtags are part of the caption that is published (Zernio's hashtags field is stored only) ----
export const caption = f => [String(f.text || '').trim(), String(f.tags || '').trim().split(/[\s,]+/).filter(Boolean).map(t => (t.startsWith('#') ? t : '#' + t)).join(' ')].filter(Boolean).join('\n\n');
const keywordList = s => [...new Set(String(s || '').split(',').map(x => x.trim()).filter(Boolean))];

function checkFields(platform, f, dest, video) {
  f = f || {}; const text = caption(f);
  if (!text) return 'Write the text first';
  if (text.length > LIMIT[platform]) return `The text is ${text.length.toLocaleString('en-GB')} characters; the limit is ${LIMIT[platform].toLocaleString('en-GB')}`;
  if (platform === 'youtube') {
    const title = String(f.title || '').trim(); if (!title) return 'Write the YouTube title'; if (title.length > 100) return 'The YouTube title is over 100 characters';
    if (!['public', 'unlisted', 'private'].includes(f.visibility)) return 'Choose the YouTube visibility';
    const kw = keywordList(f.keywords); if (kw.some(k => k.length > 100)) return 'A YouTube keyword tag is over 100 characters'; if (kw.join('').length > 500) return 'The YouTube keyword tags are over 500 characters together';
  }
  if (platform === 'tiktok') {
    const t = dest.tiktok || {}; const inbox = f.mode === 'inbox';
    if (!['direct', 'inbox'].includes(f.mode)) return 'Choose Direct Post or Creator Inbox for TikTok';
    if (inbox && !dest.notes.some(n => /Inbox handoff is available/.test(n))) return 'Creator Inbox is not available on this TikTok connection';
    if (!inbox && !dest.notes.some(n => /^Direct Post is available/.test(n))) return 'Direct Post is not available on this TikTok connection';
    if (!(t.privacyLevels || []).some(p => p.value === f.privacy)) return 'Choose who can see the TikTok post';
    if (!['none', 'brand_organic', 'brand_content'].includes(f.commercial || 'none')) return 'Choose the TikTok commercial content setting';
    if (!(t.commercial || []).some(x => x.value === (f.commercial || 'none'))) return 'That commercial disclosure is unavailable for this TikTok account';
    for (const [field, key] of [['comment', 'allow_comment'], ['duet', 'allow_duet'], ['stitch', 'allow_stitch']]) {
      if (typeof f[field] !== 'boolean') return 'Choose each TikTok interaction setting';
      if (f[field] && t.interactions?.[key]?.enabled !== true) return `TikTok does not allow ${field} for this creator`;
    }
    if (f.commercial === 'brand_content' && f.privacy === 'SELF_ONLY') return 'Branded content cannot be private on TikTok';
    if (f.consentPreview !== true || f.consentExpress !== true) return 'Tick both TikTok confirmations first';
    if (t.canPostMore === false) return 'TikTok says this account has reached its posting limit for now';
    if (video.seconds && t.maxSeconds && video.seconds > t.maxSeconds) return `The video is longer than TikTok allows for this account (${t.maxSeconds} seconds)`;
  }
  if (platform === 'facebook' && video.seconds && (video.seconds < 3 || video.seconds > 60)) return `Facebook Reels must be 3 to 60 seconds; this video is ${video.seconds} seconds`;
  return null;
}

// Records every chosen destination, with its idempotency key and the exact text, before anything is sent.
// Called from applyAction with the manifest being written; accounts come from the cache filled just before.
export function prepare(cfg, item, m, a, now = new Date()) {
  if (cfg.runtime?.zernioBusy?.[item.id]) throw new Error('A submission is still running. Wait for its result before submitting again.');
  const g = gate(item); if (!g.ok) throw new Error('Not ready to publish. ' + g.reasons.join(' '));
  const acc = cfg.runtime && cfg.runtime.zernioAccounts && cfg.runtime.zernioAccounts.data; if (!acc) throw new Error('The connected accounts have not been checked yet');
  const video = finalVideo(cfg, item); if (!video) throw new Error('The approved final video was not found');
  if (!video.size || video.size > 5 * 1024 ** 3) throw new Error('The approved MP4 must be between 1 byte and 5 GB');
  if (!video.matchesApproval) throw new Error('The recorded final video is not the file that was approved. Approve the current video first.');
  if (a.sha !== video.sha) throw new Error('The final video changed since you opened this page. Look at it again first.');
  const list = [...new Set(Array.isArray(a.destinations) ? a.destinations : [])]; if (!list.length) throw new Error('Choose at least one destination');
  if (!['now', 'schedule'].includes(a.mode)) throw new Error('Choose Publish or Schedule');
  let utc = null;
  if (a.mode === 'schedule') {
    utc = londonToUtc(a.when); if (!utc) throw new Error('Enter the posting time (UK time)');
    if (utc - now < 10 * 60000) throw new Error('Choose a time at least 10 minutes from now'); if (utc - now > 180 * 864e5) throw new Error('Choose a time within the next six months');
  }
  const z = (m.zernio ||= {}); const posts = (z.posts ||= []); const made = [];
  for (const platform of list) {
    if (!ROUTE[platform]) throw new Error('Unknown destination');
    const dest = acc.destinations[platform]; const N = NAMES[platform];
    if (!dest || !dest.connected) throw new Error(`${N} is not connected in Zernio`);
    if (dest.login !== ROUTE[platform]) throw new Error(`${N} must go through the ${LOGINS[ROUTE[platform]].name}`); // never crossed
    if (a.accounts?.[platform]?.accountId !== dest.accountId || a.accounts?.[platform]?.login !== dest.login) throw new Error(`${N}'s connected account changed. Check accounts and review the destination before submitting.`);
    if (!dest.ready) throw new Error(`${N} cannot be posted to right now: ${[...dest.issues, ...dest.notes].join('; ') || 'the connection is not healthy'}`);
    if ((m.publishing || {})[platform]) throw new Error(`${N} is already recorded as published`);
    if (((item.platforms || {})[SHORT[platform]] || {}).state === 'published') throw new Error(`${N} already reads as published for this reel`);
    const held = posts.find(x => x.platform === platform && HOLDS.includes(x.state));
    if (held) throw new Error(`${N} already has a submission (${held.state}). Nothing was sent again.`);
    const f = (a.fields || {})[platform] || {}; const bad = checkFields(platform, f, dest, video); if (bad) throw new Error(`${N}: ${bad}`);
    const attempt = posts.filter(x => x.platform === platform).length + 1; const id = `${platform}-${attempt}`;
    const rec = { id, platform, login: dest.login, accountId: dest.accountId, handle: dest.handle, attempt, key: 'herk-' + sha(`${item.id}|${dest.accountId}|${platform}|${attempt}|${video.sha}`).slice(0, 40),
      mode: a.mode, scheduledFor: a.mode === 'schedule' ? a.when : null, scheduledUtc: utc ? utc.toISOString() : null, timezone: TZ, video: { file: video.file, sha: video.sha, size: video.size },
      text: caption(f), state: 'prepared', createdAt: now.toISOString(), remote: null, error: null };
    if (platform === 'youtube') Object.assign(rec, { title: String(f.title).trim(), keywords: keywordList(f.keywords), visibility: f.visibility });
    if (platform === 'facebook') { rec.pageId = dest.pageId; if (String(f.title || '').trim()) rec.title = String(f.title).trim().slice(0, 255); }
    if (platform === 'tiktok') rec.tiktok = { mode: f.mode, privacy: f.privacy, comment: !!f.comment, duet: !!f.duet, stitch: !!f.stitch, commercial: f.commercial || 'none', consentPreview: true, consentExpress: true };
    made.push(rec);
  }
  posts.push(...made); z.draft = { fields: a.fields || {}, savedAt: now.toISOString() };
  return made.map(r => r.id);
}

// The request Zernio receives for one destination.
export function postBody(rec, itemId, mediaUrl) {
  const psd = {}; const body = { content: rec.text, mediaItems: [{ type: 'video', url: mediaUrl }], metadata: { source: 'herk-command-centre', item: itemId, submission: rec.id } };
  if (rec.platform === 'youtube') { Object.assign(psd, { title: rec.title, visibility: rec.visibility, madeForKids: false }); body.visibility = rec.visibility; if (rec.keywords.length) body.tags = rec.keywords; }
  if (rec.platform === 'instagram') psd.shareToFeed = true; // one video with no contentType publishes as a Reel
  if (rec.platform === 'facebook') { psd.contentType = 'reel'; if (rec.pageId) psd.pageId = rec.pageId; if (rec.title) psd.title = rec.title; }
  if (rec.platform === 'tiktok') { const t = rec.tiktok; body.tiktokSettings = { privacy_level: t.privacy, allow_comment: t.comment, allow_duet: t.duet, allow_stitch: t.stitch, commercialContentType: t.commercial, content_preview_confirmed: true, express_consent_given: true }; if (t.mode === 'inbox') body.tiktokSettings.draft = true; }
  body.platforms = [{ platform: rec.platform, accountId: rec.accountId, customContent: rec.text, platformSpecificData: psd }];
  if (rec.mode === 'schedule') { body.scheduledFor = rec.scheduledUtc; body.timezone = rec.timezone; } else body.publishNow = true;
  return body;
}

// What Zernio says about one destination, in the dashboard's own words.
export function readPost(rec, post) {
  const e = (post.platforms || []).find(x => x.platform === rec.platform) || {}; const ps = e.status || null; const s = post.status || null;
  let url = null;
  try { const u = new URL(e.platformPostUrl); const hosts = { instagram: ['instagram.com'], facebook: ['facebook.com', 'fb.watch'], youtube: ['youtube.com', 'youtu.be'], tiktok: ['tiktok.com'] }[rec.platform] || []; if (u.protocol === 'https:' && hosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) url = u.href; } catch { /* no public link yet */ }
  const remote = { postId: post._id || (rec.remote || {}).postId || null, postStatus: s, platformStatus: ps, url, platformPostId: e.platformPostId || null, publishedAt: e.publishedAt || null, scheduledFor: post.scheduledFor || e.scheduledFor || null, checkedAt: new Date().toISOString() };
  const error = e.errorMessage ? scrub(e.errorMessage) : null;
  let state = 'processing';
  if (ps === 'published' || (!ps && s === 'published')) state = rec.tiktok && rec.tiktok.mode === 'inbox' && !remote.url ? 'inbox' : 'published';
  else if (s === 'scheduled') state = 'scheduled'; // Zernio may already have an automatic retry scheduled
  else if (ps === 'failed' || (!ps && (s === 'failed' || s === 'partial'))) state = 'failed';
  else if (ps === 'cancelled' || s === 'cancelled') state = 'cancelled';
  return { state, remote, error: state === 'failed' ? error || 'Zernio reported a failure without a reason' : null };
}

function applyResponse(rec, r) {
  const post = r.json.post || (r.json._id ? r.json : null);
  if ([200, 201, 202, 207].includes(r.status) && post) return Object.assign(rec, readPost(rec, post));
  if (r.status === 202 && r.json.postId) return Object.assign(rec, { state: 'processing', remote: { ...(rec.remote || {}), postId: r.json.postId, checkedAt: new Date().toISOString() }, error: null });
  if (r.status === 409 && r.json.code === 'idempotency_conflict') return Object.assign(rec, { state: 'unknown', error: 'Zernio is still handling the first request. Use Check status, or explicitly retry this submission later.' });
  if (r.status === 409) return Object.assign(rec, { state: 'verify', remote: { postId: r.json.existingPostId || r.json.details?.existingPostId || null }, error: 'Zernio reports duplicate content. Check status and review the existing post before any further submission.' });
  if (r.status >= 500 || r.status === 429 || r.status >= 200 && r.status < 300) return Object.assign(rec, { state: 'unknown', error: `Zernio did not confirm (${errText(r)}). An explicit retry reuses the saved request key within its 24-hour window.` });
  return Object.assign(rec, { state: 'failed', error: errText(r) });
}

// A published destination becomes the dashboard's publication record for that platform. Inbox handoffs do not.
function recordPublished(m, rec, now) {
  if (rec.state !== 'published') return; const pub = (m.publishing ||= {});
  if (!pub[rec.platform]) pub[rec.platform] = { at: (rec.remote && rec.remote.publishedAt) || now.toISOString(), url: (rec.remote && rec.remote.url) || null, recordedAt: now.toISOString(), via: 'zernio' };
  else if (pub[rec.platform].via === 'zernio' && !pub[rec.platform].url && rec.remote && rec.remote.url) pub[rec.platform].url = rec.remote.url;
}

// Only runs after an explicit Publish, Schedule or Retry action. A record and its identity exist on disk first.
// Upload per destination: this also works with Zernio's single-use, zero-retention media setting.
export async function send(cfg, id, { update, ids }) {
  const rt = (cfg.runtime ||= {}); const busy = (rt.zernioBusy ||= {}); if (busy[id]) return; busy[id] = true;
  const save = fn => update(cfg, id, m => { fn((m.zernio ||= {}), m); });
  try {
    const z = save(() => {}).zernio; const todo = (z.posts || []).filter(r => ids.includes(r.id) && ['prepared', 'retrying'].includes(r.state));
    const set = (rid, patch) => save((zz, m) => { const r = zz.posts.find(x => x.id === rid); if (typeof patch === 'function') patch(r); else Object.assign(r, patch); recordPublished(m, r, new Date()); });
    for (const r of todo) {
      const login = ROUTE[r.platform];
      if (login !== r.login) { set(r.id, { state: 'verify', error: 'Credential routing mismatch. Nothing was sent.' }); continue; }
      const video = r.video; let url = r.mediaUrl || null;
      try {
        if (r.remote?.postId) {
          // Re-read before retrying: a transient failure may already have recovered remotely.
          const current = await api(cfg, login, 'GET', `/posts/${r.remote.postId}`);
          if (current.status !== 200 || !current.json.post) throw new Error('Could not verify the failed post. Use Check status before retrying.');
          const latest = readPost(r, current.json.post);
          if (latest.state !== 'failed') { set(r.id, rec => Object.assign(rec, latest)); continue; }
          set(r.id, { state: 'retrying', sentAt: r.sentAt || new Date().toISOString() });
          const result = await api(cfg, login, 'POST', `/posts/${r.remote.postId}/retry`, { headers: { 'idempotency-key': r.key } });
          set(r.id, rec => applyResponse(rec, result)); continue;
        }
        if (!url) {
          set(r.id, { state: 'uploading', error: null });
          const full = join(cfg.root, video.file); if (sha(readFileSync(full)) !== video.sha) throw new Error('The final video changed after this submission was recorded. Nothing was uploaded.');
          const pre = await api(cfg, login, 'POST', '/media/presign', { body: { filename: `${id}.mp4`, contentType: 'video/mp4', size: video.size } });
          if (pre.status !== 200 || !pre.json.uploadUrl || !pre.json.publicUrl) throw new Error(`Zernio would not accept the upload: ${errText(pre)}`);
          const f = (cfg.zernio && cfg.zernio.fetch) || fetch; // straight to storage: no Authorization header
          if (!pre.json.uploadUrl.startsWith('https://') || !pre.json.publicUrl.startsWith('https://')) throw new Error('Zernio returned an invalid media address');
          const put = await f(pre.json.uploadUrl, { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(300000), headers: { 'content-type': 'video/mp4' }, body: await openAsBlob(full), duplex: 'half' });
          if (put.status < 200 || put.status >= 300) throw new Error(`The video upload failed (storage answered ${put.status})`);
          url = pre.json.publicUrl; set(r.id, { mediaUrl: url, uploadedAt: new Date().toISOString() });
        }
        if (r.mode === 'schedule' && new Date(r.scheduledUtc) <= new Date()) throw new Error('The scheduled time has passed. Review this submission in Zernio before continuing.');
        set(r.id, { state: 'submitting', sentAt: r.sentAt || new Date().toISOString() });
        try { const res = await api(cfg, login, 'POST', '/posts', { body: postBody(r, id, url), headers: { 'idempotency-key': r.key } }); set(r.id, rec => applyResponse(rec, res)); }
        catch (e) { set(r.id, { state: 'unknown', error: `Zernio could not confirm the submission (${scrub(e.message)}). Check status or explicitly retry with its saved identity.` }); }
      } catch (e) { set(r.id, { state: r.remote?.postId ? 'unknown' : 'failed', error: scrub(e.message) }); }
    }
  } finally { delete busy[id]; }
}

// Check status never uploads, publishes or schedules, including after a process restart.
export async function check(cfg, id, { update }) {
  if (cfg.runtime?.zernioBusy?.[id]) return;
  const m0 = update(cfg, id, () => {}); const posts = ((m0.zernio || {}).posts || []).filter(r => r.state !== 'cancelled' && !(r.state === 'published' && r.remote?.url));
  for (const r of posts) {
    const patch = {};
    try {
      if (r.remote && r.remote.postId) { const res = await api(cfg, r.login, 'GET', `/posts/${r.remote.postId}`); if (res.status === 200 && (res.json.post || res.json._id)) Object.assign(patch, readPost(r, res.json.post || res.json)); else if (res.status === 404) Object.assign(patch, { state: 'cancelled', error: 'Zernio no longer has this post. It was deleted there.' }); else patch.error = `Status check failed: ${errText(res)}`; }
      else if (r.sentAt && Date.now() - new Date(r.sentAt) >= 23 * 3600e3) Object.assign(patch, { state: 'verify', error: 'The safe retry window has expired. Review this request in Zernio; automatic resubmission is blocked.' });
      else if (['uploading', 'submitting', 'retrying'].includes(r.state)) Object.assign(patch, { state: 'unknown', error: 'The previous process stopped before confirming this step. An explicit retry is required.' });
    } catch (e) { patch.error = `Status check failed: ${scrub(e.message)}`; }
    update(cfg, id, m => { const rec = m.zernio.posts.find(x => x.id === r.id); Object.assign(rec, patch); recordPublished(m, rec, new Date()); });
  }
}

export function prepareRetry(cfg, item, m, a, now = new Date()) {
  const g = gate(item); if (!g.ok) throw new Error('Not ready to retry. ' + g.reasons.join(' '));
  if (cfg.runtime?.zernioBusy?.[item.id]) throw new Error('A submission is still running. Check status shortly.');
  const rec = (m.zernio?.posts || []).find(x => x.id === a.submission);
  if (!rec || !['failed', 'unknown', 'prepared', 'uploading', 'submitting'].includes(rec.state)) throw new Error('This destination cannot be retried. Check status first.');
  const dest = cfg.runtime?.zernioAccounts?.data?.destinations?.[rec.platform];
  if (!dest?.ready || dest.accountId !== rec.accountId || dest.login !== rec.login || ROUTE[rec.platform] !== rec.login) throw new Error('The saved destination is no longer the same healthy connected account.');
  if (item.platforms?.[SHORT[rec.platform]]?.state === 'published' || m.publishing?.[rec.platform]) throw new Error('This destination is already published.');
  const video = finalVideo(cfg, item);
  if (!video?.matchesApproval || video.sha !== rec.video.sha || a.sha !== video.sha) throw new Error('Review the current approved video before retrying.');
  if (!rec.remote?.postId && rec.sentAt && now - new Date(rec.sentAt) >= 23 * 3600e3) throw new Error('The safe retry window has expired. Review this request in Zernio.');
  if (rec.mode === 'schedule') {
    if (rec.remote?.postId && new Date(rec.scheduledUtc) > now) throw new Error('Zernio retries a failed post immediately. Wait until its scheduled time, or change its schedule in Zernio.');
    if (!rec.remote?.postId && new Date(rec.scheduledUtc) - now < 60000) throw new Error('The original schedule is now too close or has passed. Review it in Zernio.');
  }
  rec.state = 'retrying'; rec.error = null; rec.retryRequestedAt = now.toISOString();
  rec.retryMode = rec.remote?.postId ? 'now' : rec.mode;
}

// What the page may see about one item. No key, no upload address.
export function view(cfg, item, man) {
  const z = (man && man.zernio) || {}; const busy = !!(cfg.runtime && cfg.runtime.zernioBusy && cfg.runtime.zernioBusy[item.id]);
  const posts = (z.posts || []).map(r => ({ id: r.id, platform: r.platform, accountId: r.accountId, handle: r.handle, login: r.login, attempt: r.attempt, mode: r.mode, retryMode: r.retryMode || null, scheduledFor: r.scheduledFor, scheduledUtc: r.scheduledUtc, state: r.state, createdAt: r.createdAt, text: r.text, title: r.title || null, keywords: r.keywords || null, visibility: r.visibility || null, tiktok: r.tiktok || null, videoSha: r.video.sha, error: r.error || null,
    postId: r.remote && r.remote.postId, url: r.remote && r.remote.url, publishedAt: r.remote && r.remote.publishedAt, checkedAt: r.remote && r.remote.checkedAt }));
  const latest = {}; for (const p of posts) latest[p.platform] = p;
  return { gate: gate(item), posts, latest, draft: z.draft || null, busy, open: posts.some(p => OPEN.includes(p.state)) };
}
export const isOpen = s => OPEN.includes(s);
