#!/usr/bin/env node
// Turns one research draft (raw Signal Room results plus last30free output files) into an importer batch.
// The mapping lives here so times and metrics are converted by code, not retyped by hand.
// Run: node .claude/skills/research-signals/build-batch.mjs <draft.json> [--check-fallback] [--out <batch.json>]
import { readFileSync, writeFileSync, mkdirSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { loadConfig } from '../../../dashboard/lib/config.mjs';
import { matchText, validateBatch } from '../../../dashboard/lib/research.mjs';

const SR = { instagram_short_form: ['instagram', 'short'], youtube_short_form: ['youtube', 'short'], youtube_long_form: ['youtube', 'long'] };
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pick = (o, map) => Object.fromEntries(Object.entries(map).map(([k, from]) => [k, num((o || {})[from])]).filter(([, v]) => v != null));

// Signal Room times are Unix milliseconds (13 digits). Anything else is refused, never guessed at.
export function iso(ms) {
  if (ms == null) return null;
  if (!Number.isInteger(ms) || ms < 1e12 || ms >= 1e13) throw new Error(`Expected a Unix time in milliseconds, got ${JSON.stringify(ms)}`);
  return new Date(ms).toISOString();
}
const spoken = m => [m.title, m.hook, m.relevantSnippet].filter(Boolean).join('\n');

// The agreed rule: run last30free YouTube discovery when Signal Room returns fewer than five relevant YouTube
// matches, or when its measurements are stale or undated. Signal Room gives no measurement time for YouTube
// (a recent publication date is not one), so any YouTube result it returns is undated.
export function youtubeFallback(draft) {
  const sr = draft.signalRoom || {}; const lanes = (sr.lanes || Object.keys(SR)).filter(l => l.startsWith('youtube'));
  if (!lanes.length) return [];
  const yt = (sr.matches || []).filter(m => lanes.includes(m.source));
  const relevant = yt.filter(m => matchText(spoken(m), draft.query)).length;
  const reasons = [];
  if ((sr.errors || []).some(e => lanes.includes(e.lane))) reasons.push('a Signal Room YouTube search failed');
  if (relevant < 5) reasons.push(`${relevant} relevant Signal Room YouTube matches (fewer than 5)`);
  if (yt.length) reasons.push('Signal Room YouTube measurements carry no measurement time');
  return reasons;
}

function fromSignalRoom(m, sr) {
  const [platform, format] = SR[m.source]; const id = String(m.externalId);
  const tr = (sr.transcripts || []).find(t => t.platform === platform && String(t.id) === id && typeof t.text === 'string' && t.text.trim());
  const post = { platform, id, provider: 'signal-room', url: m.url, format, title: m.title ?? null, publishedAt: iso(m.publishedAt), durationSeconds: num(m.durationSeconds) > 0 ? m.durationSeconds : null };
  // What the search returned around its match, word for word. Kept as evidence; never stored as a transcript.
  const excerpts = [['hook', m.hook], ['snippet', m.relevantSnippet]].filter(([, t]) => typeof t === 'string' && t.trim()).map(([kind, text]) => ({ kind, text, ...(sr.excerptsShortened ? { complete: false } : {}) }));
  if (excerpts.length) post.excerpts = excerpts;
  if (platform === 'instagram') {
    const det = (sr.instagramDetails || []).find(d => String(d.externalId) === id);
    post.creator = { handle: m.creator ?? null }; post.caption = det ? det.caption ?? null : null;
    post.transcript = tr ? { text: tr.text, origin: 'signal-room', capturedAt: det && det.transcript ? iso(det.transcript.capturedAt) : null } : null;
    // With the item detail we know when the counts were measured. Without it the time stays unknown.
    const last = det && (det.observations || []).slice().sort((a, b) => b.observedAt - a.observedAt)[0];
    const outlier = num((m.metrics || {}).reachPerFollower) != null ? { metric: 'reach_per_follower', value: m.metrics.reachPerFollower } : null;
    post.observation = last
      ? { measuredAt: iso(last.observedAt), metrics: pick(last, { plays: 'playsCount', views: 'viewsCount', likes: 'likesCount', comments: 'commentsCount', shares: 'sharesCount', followers: 'followersCount' }), outlier }
      : { measuredAt: null, metrics: pick(m.metrics, { plays: 'plays', views: 'views', reach: 'reach', likes: 'likes', comments: 'comments', shares: 'shares' }), outlier };
  } else {
    const det = (sr.videoDetails || []).find(d => String(d.externalId || d.id) === id);
    post.creator = { name: m.channel ?? null, handle: det ? det.channelHandle ?? null : null };
    post.caption = det && det.descriptionAvailable ? det.description ?? null : null;
    post.transcript = tr ? { text: tr.text, origin: 'signal-room', capturedAt: null } : null;
    post.observation = { measuredAt: null, metrics: pick(m.metrics, { views: 'views', likes: 'likes', comments: 'comments', followers: 'subscribers' }),
      outlier: num(m.performanceValue) != null && m.performanceMetric ? { metric: m.performanceMetric, value: m.performanceValue } : null };
  }
  return post;
}

// last30free fetches counts live. Its newer output stamps each item's own collection time (collected_at) and
// keeps every fetched record ("fetched", with in_window); missing counts are null and a 0 is a real 0. Older
// output has neither: the file's modification time stands in for the measurement time (measuredBasis
// "file-mtime", never used for growth) and a 0 views, likes or followers is treated as unknown.
// Whole seconds, rounded down, so a collection time can never read later than the batch's retrievedAt.
// Instagram's older API ids are '<media id>_<creator id>'; the media id alone is the post's id everywhere else.
const nativeId = (platform, sourceId) => (platform === 'instagram' ? String(sourceId).replace(/^(\d+)_\d+$/, '$1') : String(sourceId));
const isoZ = v => (typeof v === 'string' && v ? new Date(v).toISOString().replace(/\.\d{3}Z$/, 'Z') : null);
function fromLast30(it, platform, fileTime, subs, newer) {
  const raw = it.raw || {}; const m = it.metrics || {};
  const c = newer ? num : v => (num(v) > 0 ? v : null); // a count; older output wrote 0 for unknown
  const pos = v => (num(v) > 0 ? v : null); // durations: 0 is never real
  const collected = newer && it.collected_at ? isoZ(it.collected_at) : null;
  const post = { platform, id: nativeId(platform, it.source_id), provider: 'last30free', url: it.url, title: it.title || null, publishedAt: isoZ(it.created_at), transcript: null };
  const observation = metrics => ({ measuredAt: collected || fileTime, measuredBasis: collected ? 'collection' : 'file-mtime', metrics,
    discoveryScore: num(it.score), ...(it.score_formula ? { scoreFormula: it.score_formula } : {}) });
  if (platform === 'tiktok') {
    Object.assign(post, { format: 'short', creator: { handle: it.author || null, name: raw.full_name || null }, caption: it.text || null, durationSeconds: pos(raw.video_duration_secs) });
    post.observation = observation({ views: c(m.views), likes: c(m.likes), comments: num(m.comments), shares: num(m.reposts), saves: num(m.saves), followers: c(raw.followers) });
  } else if (platform === 'instagram') {
    // The Apify search returns reels (video) and sometimes photos or carousels: only a video is short-form.
    Object.assign(post, { format: raw.media_type === 'video' ? 'short' : 'unknown', creator: { handle: raw.username || it.author || null, name: raw.full_name || null }, caption: it.text || null, durationSeconds: pos(raw.video_duration_secs) });
    post.observation = observation({ views: c(m.views), likes: c(m.likes), comments: num(m.comments), shares: num(m.reposts), followers: c(raw.followers) });
  } else {
    const dur = pos(raw.duration); const text = String(it.text || '');
    // A Short cannot run past three minutes; below that, only a /shorts/ link proves the format.
    const format = /\/shorts\//.test(it.url) ? 'short' : dur > 180 ? 'long' : 'unknown';
    const caption = it.title && text.startsWith(it.title) ? text.slice(it.title.length).trim() : text.trim();
    Object.assign(post, { format, creator: { name: it.author || raw.channel || null, handle: raw.uploader_id || null }, caption: caption || null, durationSeconds: dur });
    const sub = subs && subs.transcripts ? subs.transcripts[post.id] : null;
    if (sub && sub.trim()) post.transcript = { text: sub, origin: 'subtitles', capturedAt: subs.fetchedAt || null };
    post.observation = observation({ views: c(m.views), likes: c(m.likes), comments: newer ? num(m.comments) : null, followers: newer ? num(raw.followers) : null });
  }
  return post;
}
// The same video found by two last30free searches (YouTube discovery and the Shorts feed) is one batch entry:
// details fill each other's gaps, a known Short stays a Short, and the newer measurement is kept whole (its counts,
// score, formula and time together; numbers from two measurements are never mixed).
function mergeL30(a, b) {
  const out = { ...a, creator: { ...a.creator } };
  for (const k of ['title', 'caption', 'publishedAt', 'durationSeconds']) if (out[k] == null && b[k] != null) out[k] = b[k];
  for (const k of ['handle', 'name']) if (out.creator[k] == null && (b.creator || {})[k] != null) out.creator[k] = b.creator[k];
  if (!out.transcript && b.transcript) out.transcript = b.transcript;
  if (b.format === 'short' || out.format === 'unknown') { out.format = b.format === 'unknown' ? out.format : b.format; }
  if (out.format === 'short' && /\/shorts\//.test(b.url)) out.url = b.url;
  const at = p => (p.observation && p.observation.measuredAt) || '';
  if (b.observation && (!out.observation || at(b) > at(out))) out.observation = b.observation;
  return out;
}
// last30free draft keys -> [lane, platform, the source name inside the output file]
export const L30_LANES = { youtube: ['youtube_discovery', 'youtube', 'youtube'], youtubeShorts: ['youtube_shorts_feed', 'youtube', 'youtube'],
  tiktok: ['tiktok_hashtag', 'tiktok', 'tiktok'], instagram: ['instagram_search', 'instagram', 'instagram'] };
const textOf = p => [p.title, p.caption, p.transcript && p.transcript.text].filter(Boolean).join('\n');

export function buildBatch(draft, io = { readJson: f => JSON.parse(readFileSync(f, 'utf8')), mtime: f => statSync(f).mtime }) {
  for (const k of ['batchId', 'query', 'retrievedAt']) if (!draft[k]) throw new Error(`The draft needs ${k}`);
  const sr = draft.signalRoom || {}; const l30 = draft.last30free || {};
  const posts = [], runs = []; const refOf = p => `${p.platform}:${p.id}`;
  const relevance = list => `${list.filter(p => matchText(textOf(p), draft.query)).length} of ${list.length} match "${draft.query}" in the retrieved text`;

  for (const lane of sr.lanes || Object.keys(SR)) {
    if (!SR[lane]) throw new Error(`Unknown Signal Room lane ${lane}`);
    const failed = (sr.errors || []).find(e => e.lane === lane);
    if (failed) { runs.push({ provider: 'signal-room', lane, status: 'error', error: String(failed.error), results: [] }); continue; }
    const found = (sr.matches || []).filter(m => m.source === lane).sort((a, b) => (b.balancedScore || 0) - (a.balancedScore || 0));
    const list = found.map(m => fromSignalRoom(m, sr));
    // Relevance is judged on the excerpt Signal Room returned when no full transcript was fetched.
    const rel = found.filter((m, i) => matchText(spoken(m) + '\n' + textOf(list[i]), draft.query)).length;
    posts.push(...list);
    runs.push({ provider: 'signal-room', lane, status: 'ok', note: `top matches from this search, ordered by Signal Room's balanced score; ${rel} of ${list.length} match "${draft.query}" in the retrieved text`, results: list.map(refOf) });
  }

  const reasons = youtubeFallback(draft);
  if (reasons.length && !l30.youtube) throw new Error(`The YouTube fallback is required (${reasons.join('; ')}) but the draft has no last30free.youtube. Run it, or record its error.`);
  const subs = l30.subtitles && l30.subtitles.file ? io.readJson(l30.subtitles.file) : null;
  const l30Posts = new Map(); // one last30free entry per post per batch; a second sighting is merged into it
  for (const [key, [lane, platform, source]] of Object.entries(L30_LANES)) {
    const src = l30[key]; if (!src) continue;
    const why = key === 'youtube' ? `fallback because ${reasons.join('; ') || 'requested'}; ` : '';
    let error = src.error || null, partial = null, reported = [], kept = [], tag = '', counts = null, cost = null;
    if (!error) {
      const out = io.readJson(src.file); const res = (out.results || {})[source] || {};
      counts = res.counts || null; cost = res.cost || null;
      // "partial": a paid run failed or was stopped after producing results; those results are imported, with the reason.
      if (res.status === 'partial') partial = res.error || 'partial results';
      if (res.status !== 'ok' && res.status !== 'partial') error = res.error || `last30free reported status ${res.status}`;
      else {
        const newer = !!out.fetched; const fileTime = io.mtime(src.file).toISOString().replace(/\.\d{3}Z$/, 'Z');
        const merged = (out.merged.items || []).filter(it => it.source === source);
        const all = newer ? out.fetched.items.filter(it => it.source === source) : merged;
        const shown = new Set(merged.map(it => nativeId(platform, it.source_id)));
        for (const it of all) {
          const post = fromLast30(it, platform, fileTime, subs, newer); const key = refOf(post);
          if (l30Posts.has(key)) { const merged = mergeL30(posts[l30Posts.get(key)], post); posts[l30Posts.get(key)] = merged; }
          else { l30Posts.set(key, posts.length); posts.push(post); }
          (shown.has(post.id) ? reported : kept).push(post);
        }
        // reported keeps last30free's own order (best score first)
        const order = new Map(merged.map((it, i) => [nativeId(platform, it.source_id), i])); reported.sort((a, b) => order.get(a.id) - order.get(b.id));
        tag = ((all.find(it => it.raw && it.raw.hashtag)) || { raw: {} }).raw.hashtag || '';
      }
    }
    if (error) { runs.push({ provider: 'last30free', lane, status: 'error', error: String(error), note: why.trim() || undefined, results: [], ...(cost ? { cost } : {}) }); continue; }
    const limits = { tiktok: `hashtag search #${tag} only, no transcripts; `, instagram: `Apify reel search #${tag}, no transcripts; `,
      youtube: `yt-dlp search, top matches only; ${reported.filter(p => p.transcript).length} of ${reported.length} with subtitles; `,
      youtubeShorts: `yt-dlp hashtag Shorts feed #${tag}; ` }[key];
    const extra = kept.length ? `; ${kept.length} more fetched and kept (older, undated or past the report limit)` : '';
    runs.push({ provider: 'last30free', lane, status: 'ok', note: (partial ? `PARTIAL: ${partial}. ` : '') + why + limits + relevance(reported) + extra, results: reported.map(refOf),
      ...(kept.length ? { fetchedOnly: kept.map(refOf) } : {}), ...(counts ? { counts } : {}), ...(cost ? { cost } : {}), ...(partial ? { partial } : {}) });
  }
  return { schema: 1, batchId: draft.batchId, retrievedAt: draft.retrievedAt, search: { query: draft.query, windowDays: draft.windowDays ?? null }, runs, posts };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const args = process.argv.slice(2); const outAt = args.indexOf('--out');
  const file = args.find((a, i) => !a.startsWith('--') && !(outAt >= 0 && i === outAt + 1));
  if (!file) { console.error('Usage: node build-batch.mjs <draft.json> [--check-fallback] [--out <batch.json>]'); process.exit(2); }
  try {
    const draft = JSON.parse(readFileSync(file, 'utf8'));
    if (args.includes('--check-fallback')) { const r = youtubeFallback(draft); console.log(r.length ? `Run the last30free YouTube fallback: ${r.join('; ')}.` : 'No YouTube fallback needed.'); process.exit(0); }
    const batch = buildBatch(draft); const errors = validateBatch(batch);
    if (errors.length) { console.error('The built batch is not valid. Nothing was written.'); for (const e of errors) console.error('  - ' + e); process.exit(1); }
    const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(loadConfig().researchDir, 'inbox', draft.batchId + '.json');
    mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(batch, null, 2) + '\n');
    console.log(`Batch written: ${out}`);
    // Keep what the batch was built from, so a copied number can be checked against its source later.
    const keep = join(loadConfig().researchDir, 'sources', draft.batchId); mkdirSync(keep, { recursive: true });
    copyFileSync(file, join(keep, 'draft.json'));
    for (const k of [...Object.keys(L30_LANES), 'subtitles']) { const f = ((draft.last30free || {})[k] || {}).file; if (f) copyFileSync(f, join(keep, k + '.json')); }
    console.log(`Builder inputs kept: ${keep}`);
    for (const r of batch.runs) console.log(`  ${r.lane}: ${r.status === 'ok' ? r.results.length + ' posts. ' + (r.note || '') : 'FAILED: ' + r.error}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
